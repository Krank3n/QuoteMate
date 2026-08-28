// Mate's voice session over OpenAI Realtime (gpt-realtime-2).
//
// Built so the OpenAI model can be judged on a real device rather than from
// benchmarks. Like Gemini Live and unlike ElevenLabs, this is a NATIVE audio
// model — audio goes in and comes out of one model, with no transcribe-then-
// reason pipeline in between. That is the property under test: a side-by-side
// on synthesised Australian speech had OpenAI and Gemini both hearing "custom
// wooden shoes" and "three hundred mil" correctly, where the ElevenLabs ASR
// pipeline gave "shades".
//
// Deliberately reuses the Gemini-era audio stack — mic.ts for capture,
// audioPlayer.ts for playback — rather than the WebRTC path. Those are proven
// in production, and this is an evaluation build: the fewer new variables
// between the tradie's ear and the model, the more the comparison means.
//
// The cost of that choice is real and worth stating: WebSocket PCM has no
// acoustic echo cancellation, so the half-duplex gate the Gemini path used
// (drop mic chunks while Mate is speaking) applies here too. WebRTC would give
// hardware AEC, and is the right transport if this model is chosen.

import { ChatMessage } from '../../types/assistant';
import { buildClientTools } from './clientTools';
import { buildSeedContext } from './seedContext';
import { ALL_TOOL_DECLARATIONS } from './toolSchemas';
import { MATE_SYSTEM_PROMPT } from './systemPrompt';
import { OpenAiMintedToken, LiveOfflineError } from './liveSession';
import { base64ToBytes, bytesToBase64 } from './audioCodec';
import type { VoiceSession, VoiceSessionCallbacks, VoiceSessionOptions } from './voiceSession';

export const OA_REALTIME_URL = 'wss://api.openai.com/v1/realtime';
export const OA_CONNECT_TIMEOUT_MS = 20_000;

/** Mate's tools in OpenAI's function shape. The schemas are already JSON Schema. */
export function toOpenAiTools() {
  return ALL_TOOL_DECLARATIONS.map((d) => ({
    type: 'function' as const,
    name: d.name,
    description: d.description,
    parameters: d.parameters,
  }));
}

/**
 * Upsample 16 kHz PCM16 to 24 kHz.
 *
 * react-native-audio-record is initialised at 16 kHz on both platforms and
 * that path is proven — asking it for 24 kHz produced empty buffers on device
 * and OpenAI rejected every frame ("Expected base64-encoded audio bytes (mono
 * PCM16 at 24kHz) but got empty bytes"). Rather than fight the recorder, we
 * capture at the rate it actually delivers and convert here.
 *
 * The ratio is exactly 3:2, so each pair of input samples becomes three
 * output samples with one linear interpolation between them. Cheap enough to
 * run on every 100 ms frame, and the artefacts are far below what a worksite
 * microphone contributes anyway.
 */
export function upsample16kTo24k(base64Pcm16: string): string {
  const bytes = base64ToBytes(base64Pcm16);
  const inSamples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  if (inSamples.length < 2) return '';
  const outCount = Math.floor((inSamples.length * 3) / 2);
  const out = new Int16Array(outCount);
  for (let i = 0; i < outCount; i++) {
    const src = (i * 2) / 3;
    const lo = Math.floor(src);
    const hi = Math.min(lo + 1, inSamples.length - 1);
    const frac = src - lo;
    out[i] = (inSamples[lo] + (inSamples[hi] - inSamples[lo]) * frac) | 0;
  }
  return bytesToBase64(new Uint8Array(out.buffer, out.byteOffset, out.byteLength));
}

export async function openOpenAiVoiceSession(
  minted: OpenAiMintedToken,
  history: ChatMessage[],
  cb: VoiceSessionCallbacks,
  _opts: VoiceSessionOptions = {},
): Promise<VoiceSession> {
  const tools = buildClientTools(cb);

  let alive = true;
  let connected = false;
  let closedOnce = false;
  let speaking = false;

  const finish = (err?: Error) => {
    if (closedOnce) return;
    closedOnce = true;
    alive = false;
    connected = false;
    if (err) cb.onError?.(err);
    cb.onClose?.(undefined);
  };

  const ws: WebSocket = await new Promise((resolve, reject) => {
    let socket: WebSocket;
    try {
      const WS = WebSocket as unknown as new (
        url: string, protocols?: string | string[], options?: { headers: Record<string, string> },
      ) => WebSocket;
      socket = new WS(`${OA_REALTIME_URL}?model=${encodeURIComponent(minted.model)}`, undefined, {
        headers: { Authorization: `Bearer ${minted.token}` },
      });
    } catch (err: any) {
      reject(new LiveOfflineError(err?.message || 'Realtime socket init failed.'));
      return;
    }
    const timer = setTimeout(
      () => { try { socket.close(); } catch { /* noop */ } reject(new LiveOfflineError('Mate took too long to answer — try again.')); },
      OA_CONNECT_TIMEOUT_MS,
    );
    socket.onopen = () => { clearTimeout(timer); resolve(socket); };
    socket.onerror = () => { clearTimeout(timer); reject(new LiveOfflineError('Voice connection failed.')); };
  });

  const send = (frame: unknown) => {
    if (!alive) return;
    try { ws.send(JSON.stringify(frame)); } catch { /* socket died */ }
  };

  // One session.update carries the prompt, the tools and the audio contract.
  // Server VAD does turn detection, matching what Gemini did — the alternative
  // is us deciding when the tradie stopped talking, which we are worse at.
  send({
    type: 'session.update',
    session: {
      type: 'realtime',
      output_modalities: ['audio'],
      instructions: MATE_SYSTEM_PROMPT,
      tools: toOpenAiTools(),
      tool_choice: 'auto',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: { model: 'gpt-realtime-whisper' },
          // 700ms cut tradies off mid-thought — one utterance came back as
          // three turns ("I didn't give you a job." / "Well, I'm just like
          // quoting a job for um" / "I'm wondering how Van Lish"), and the
          // model answered each fragment. 1200ms is what the Gemini path used
          // in production, where people pause to think on a worksite.
          turn_detection: {
            type: 'server_vad',
            silence_duration_ms: 1200,
            prefix_padding_ms: 300,
          },
        },
        // 24 kHz out is exactly what audioPlayer already expects from the
        // Gemini path, so playback needs no change at all.
        output: { format: { type: 'audio/pcm', rate: 24000 }, voice: minted.voice || 'cedar' },
      },
    },
  });

  const seed = buildSeedContext(history);
  if (seed) {
    send({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: seed }] },
    });
  }

  connected = true;

  ws.onclose = () => { if (alive) finish(); };
  ws.onerror = () => { if (alive) finish(new LiveOfflineError('Voice connection lost.')); };

  ws.onmessage = async (event: { data: unknown }) => {
    let msg: any;
    try { msg = JSON.parse(String(event.data)); } catch { return; }

    switch (msg.type) {
      // What the tradie said.
      case 'conversation.item.input_audio_transcription.completed':
        if (msg.transcript) cb.onInputTranscription?.(msg.transcript, true);
        break;

      // What Mate said, as it is spoken.
      //
      // Deltas ONLY. The screen ACCUMULATES what it is handed
      // (assistantBubbleTextRef.current + text), so also forwarding the
      // .done event's full transcript printed the whole greeting twice inside
      // one bubble. The .done event still matters as an end-of-turn marker,
      // but its text is a repeat of what has already been shown.
      case 'response.output_audio_transcript.delta':
        if (msg.delta) cb.onOutputTranscription?.(msg.delta, false);
        break;
      case 'response.output_audio_transcript.done':
        cb.onOutputTranscription?.('', true);
        break;

      case 'response.output_audio.delta':
        if (msg.delta) {
          if (!speaking) { speaking = true; cb.onModeChange?.('speaking'); }
          cb.onAudioChunk?.(msg.delta);
        }
        break;

      // The tradie started talking over Mate — drop the queued audio so the
      // reply doesn't keep playing over the top of them.
      case 'input_audio_buffer.speech_started':
        if (speaking) { speaking = false; cb.onModeChange?.('listening'); }
        break;

      case 'response.done': {
        if (speaking) { speaking = false; cb.onModeChange?.('listening'); }
        // Tool calls arrive as output items rather than a dedicated event.
        const calls = (msg.response?.output || []).filter((o: any) => o.type === 'function_call');
        for (const call of calls) {
          const handler = tools[call.name];
          let result = JSON.stringify({ error: `Unknown tool: ${call.name}` });
          if (handler) {
            let args: any = {};
            try { args = JSON.parse(call.arguments || '{}'); } catch { /* keep {} */ }
            try { result = await handler(args); } catch (err: any) {
              result = JSON.stringify({ error: err?.message || 'Tool execution failed.' });
            }
          }
          send({
            type: 'conversation.item.create',
            item: { type: 'function_call_output', call_id: call.call_id, output: result },
          });
        }
        // Only ask for another turn when a tool actually ran; otherwise this
        // loops the model against itself forever.
        if (calls.length) send({ type: 'response.create' });
        else cb.onTurnComplete?.();
        break;
      }

      case 'error':
        cb.onError?.(new LiveOfflineError(String(msg.error?.message || 'Realtime error.')));
        break;
      default:
        break;
    }
  };

  return {
    // The screen feeds the mic and owns playback, exactly as on the Gemini
    // path — so ownsMicrophone and ownsGreeting stay unset.
    // Capture stays at the recorder's proven 16 kHz and is converted here —
    // see upsample16kTo24k for why asking the recorder for 24 kHz doesn't work.
    sendMicChunk: (base64Pcm: string) => {
      if (!base64Pcm) return;
      const converted = upsample16kTo24k(base64Pcm);
      // An empty frame is rejected outright by the API and tears the session
      // down, so drop it here rather than sending it.
      if (!converted) return;
      send({ type: 'input_audio_buffer.append', audio: converted });
    },

    sendUserText: (text: string) => {
      send({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
      });
      send({ type: 'response.create' });
    },

    // No reply wanted — created without a following response.create, which is
    // the same "silent update" semantics the other transports have.
    sendContextNote: (text: string) => send({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
    }),

    endUserTurn: () => send({ type: 'input_audio_buffer.commit' }),

    close: () => {
      if (!alive) return;
      alive = false;
      connected = false;
      try { ws.close(); } catch { /* noop */ }
      finish();
    },

    isOpen: () => alive && connected,
  };
}
