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
import { systemPromptWithProfile } from './quotingProfileContext';
import { OpenAiMintedToken, LiveOfflineError } from './liveSession';
import { base64ToBytes, bytesToBase64 } from './audioCodec';
import type { VoiceSession, VoiceSessionCallbacks, VoiceSessionOptions } from './voiceSession';
import { isMeaningfulTranscript, shouldAnswerYet } from './heardSomething';
// The trade vocabulary is shared with the ElevenLabs agent so the two can't
// drift. How it is APPLIED differs — see buildTranscriptionPrompt.
import { MATE_ASR_KEYWORDS, ASR_NAME_BUDGET } from './elevenLabsAgentConfig';

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

/**
 * Vocabulary hint for the transcriber.
 *
 * OpenAI's Realtime transcription takes a free-text `prompt` that biases
 * decoding — the same job ElevenLabs does with ASR keywords. It matters: one
 * real session turned "Karl van Leishout" into "Calvin Lyshut", then "Karl Ben
 * Lyshut", and Mate created a fresh contact for each spelling.
 *
 * Names go in WHOLE, which is where this parts company with the ElevenLabs
 * path. That one splits "Karl van Leishout" into three boostable keywords
 * because its ASR matches word by word; a transcription prompt instead biases
 * what text is likely to follow, so the intact name is the useful signal and
 * the loose tokens ("van") are noise that could corrupt other words.
 */
export function buildTranscriptionPrompt(contactNames: string[]): string {
  const seen = new Set(MATE_ASR_KEYWORDS.map((k) => k.toLowerCase()));
  const names: string[] = [];
  for (const raw of contactNames) {
    if (names.length >= ASR_NAME_BUDGET) break;
    const name = String(raw || '').replace(/\s+/g, ' ').trim();
    if (name.length < 3) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  const vocab = [...MATE_ASR_KEYWORDS, ...names];
  return `Australian tradie talking about a job. Likely words: ${vocab.join(', ')}.`;
}

/**
 * How long to wait for a transcript before replying anyway.
 *
 * Replies are gated on the transcript so Mate never answers room noise, which
 * means a transcription that never lands would leave Mate mute. This is the
 * backstop: speak rather than stall.
 */
export const OA_TRANSCRIPT_WAIT_MS = 2_000;

/**
 * Transcriber for the reply gate — and for what the tradie sees they said.
 *
 * NOT gpt-realtime-whisper, which rejects a vocabulary `prompt` outright
 * ("The 'prompt' parameter is not supported for this model") and without one
 * heard "Quote for Karl van Leishout" as "Vote for Kyle Van Leeuwen". Measured
 * against the same synthesised Australian speech, gpt-4o-transcribe with the
 * prompt returned the name, "Colorbond", "Villaboard" and "square metres"
 * exactly right.
 */
export const OA_TRANSCRIBE_MODEL = 'gpt-4o-transcribe';

export async function openOpenAiVoiceSession(
  minted: OpenAiMintedToken,
  history: ChatMessage[],
  cb: VoiceSessionCallbacks,
  _opts: VoiceSessionOptions = {},
): Promise<VoiceSession> {
  const tools = buildClientTools(cb);
  const transcriptionPrompt = buildTranscriptionPrompt(_opts.asrKeywordNames || []);

  let alive = true;
  let connected = false;
  let closedOnce = false;
  let speaking = false;

  const finish = (err?: Error) => {
    if (closedOnce) return;
    closedOnce = true;
    alive = false;
    connected = false;
    clearTranscriptFallback();
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

  // Per-turn state for the reply gate: what the transcriber has heard so far,
  // and whether this turn has already been answered.
  let heardSoFar = '';
  let answeredTurn = false;
  // Only ONE response may be generating at a time. A second turn can commit
  // while the first reply is still being produced — the tradie talks again, or
  // a tool result lands mid-reply — and asking for another response then is
  // rejected outright: "Conversation already has an active response in
  // progress". That surfaced to the tradie as a dead end mid-quote.
  let responseInFlight = false;
  let queuedResponse = false;
  let transcriptTimer: ReturnType<typeof setTimeout> | null = null;
  const clearTranscriptFallback = () => {
    if (transcriptTimer) { clearTimeout(transcriptTimer); transcriptTimer = null; }
  };

  const send = (frame: unknown) => {
    if (!alive) return;
    try { ws.send(JSON.stringify(frame)); } catch { /* socket died */ }
  };

  /** Ask for a reply, waiting our turn if one is already being generated. */
  const requestResponse = () => {
    if (responseInFlight) { queuedResponse = true; return; }
    responseInFlight = true;
    send({ type: 'response.create' });
  };

  const armTranscriptFallback = () => {
    clearTranscriptFallback();
    transcriptTimer = setTimeout(() => {
      transcriptTimer = null;
      if (!alive || answeredTurn) return;
      answeredTurn = true;
      requestResponse();
    }, OA_TRANSCRIPT_WAIT_MS);
  };

  // One session.update carries the prompt, the tools and the audio contract.
  // Server VAD does turn detection, matching what Gemini did — the alternative
  // is us deciding when the tradie stopped talking, which we are worse at.
  send({
    type: 'session.update',
    session: {
      type: 'realtime',
      output_modalities: ['audio'],
      instructions: systemPromptWithProfile(),
      tools: toOpenAiTools(),
      tool_choice: 'auto',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: {
            model: OA_TRANSCRIBE_MODEL,
            language: 'en',
            ...(transcriptionPrompt ? { prompt: transcriptionPrompt } : {}),
          },
          // 700ms cut tradies off mid-thought — one utterance came back as
          // three turns ("I didn't give you a job." / "Well, I'm just like
          // quoting a job for um" / "I'm wondering how Van Lish"), and the
          // model answered each fragment. 1200ms is what the Gemini path used
          // in production, where people pause to think on a worksite.
          //
          // create_response is OFF: the VAD commits a turn for any sound it
          // takes for speech, and Mate then answered nothing at all — one
          // session ended with four unprompted wrap-ups in a row, each phantom
          // turn making it restate what it was still waiting on. We create the
          // response ourselves once the transcript proves someone spoke.
          turn_detection: {
            type: 'server_vad',
            silence_duration_ms: 1200,
            prefix_padding_ms: 300,
            create_response: false,
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
      // The VAD decided a turn ended. Nothing is said back until the
      // transcript shows someone actually spoke — but arm a backstop so a
      // transcription that never lands can't leave Mate mute.
      case 'input_audio_buffer.committed':
        heardSoFar = '';
        answeredTurn = false;
        armTranscriptFallback();
        break;

      // The gate. Fire on the FIRST delta that proves speech rather than
      // waiting for the finished transcript: measured, that is ~180ms after
      // the turn ends instead of ~780ms, and the model is reasoning from the
      // AUDIO anyway — the transcript is our noise filter and the tradie's
      // read-back, never the model's input. Waiting for it would cost half a
      // second on every single turn for nothing.
      case 'conversation.item.input_audio_transcription.delta':
        if (answeredTurn) break;
        heardSoFar += String(msg.delta || '');
        // Partial text: "Thank" reads as speech until " you." arrives.
        if (!shouldAnswerYet(heardSoFar)) break;
        answeredTurn = true;
        clearTranscriptFallback();
        requestResponse();
        break;

      // The finished transcript is what the tradie sees they said. It also
      // catches a turn that produced no deltas at all.
      case 'conversation.item.input_audio_transcription.completed': {
        const heard = String(msg.transcript || '');
        if (!isMeaningfulTranscript(heard)) break;   // room noise; stay quiet
        cb.onInputTranscription?.(heard, true);
        if (!answeredTurn) {
          answeredTurn = true;
          clearTranscriptFallback();
          requestResponse();
        }
        break;
      }

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

      case 'response.created':
        responseInFlight = true;
        break;

      case 'response.done': {
        if (speaking) { speaking = false; cb.onModeChange?.('listening'); }
        responseInFlight = false;
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
        if (calls.length) requestResponse();
        else cb.onTurnComplete?.();
        // A turn that arrived while this one was generating has been waiting.
        if (queuedResponse) { queuedResponse = false; requestResponse(); }
        break;
      }

      case 'error': {
        const text = String(msg.error?.message || 'Realtime error.');
        // Our create was refused because one was already running: retry when
        // it finishes rather than showing the tradie a dead end.
        if (/active response/i.test(text)) {
          responseInFlight = true;
          queuedResponse = true;
          break;
        }
        responseInFlight = false;
        cb.onError?.(new LiveOfflineError(text));
        break;
      }
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
      requestResponse();
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
