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
import { OpenAiMintedToken, LiveOfflineError, VoiceTransportUnavailableError } from './liveSession';
import { base64ToBytes, bytesToBase64 } from './audioCodec';
import { elapsedVoiceSeconds } from './voiceMinutes';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../config/firebase';
import type { VoiceSession, VoiceSessionCallbacks, VoiceSessionOptions } from './voiceSession';
import { isMeaningfulTranscript, shouldAnswerYet } from './heardSomething';
// The trade vocabulary is shared with the ElevenLabs agent so the two can't
// drift. How it is APPLIED differs — see buildTranscriptionPrompt.
import { MATE_ASR_KEYWORDS, ASR_NAME_BUDGET } from './elevenLabsAgentConfig';

export const OA_REALTIME_URL = 'wss://api.openai.com/v1/realtime';
export const OA_CONNECT_TIMEOUT_MS = 20_000;
/**
 * How long to wait for the server to echo our config back before treating the
 * transport as unusable. Shorter than the connect timeout because the socket
 * is already open by then — this is one round trip, not a handshake — and a
 * tradie holding a phone to their ear is paying for every second of it.
 */
export const OA_READY_TIMEOUT_MS = 8_000;

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
 *
 * DEPRECATED BY OPENAI: announced 26 Aug 2026, shuts down 26 Feb 2027, with
 * gpt-transcribe and gpt-live-transcribe named as the replacements. Staying
 * put anyway, on evidence rather than inertia. Measured 7 Sep 2026 through
 * THIS socket — a realtime transcription session, not the REST endpoint — over
 * three synthesised Australian voices and 16 utterances weighted to names and
 * job refs:
 *
 *   gpt-4o-transcribe    143/144 keywords, 0 mishearings
 *   gpt-transcribe       121/144,           4 mishearings
 *   gpt-live-transcribe  109/144,           5 mishearings
 *
 * All three accept and honour the `prompt` (gpt-transcribe falls to 100/140
 * without it), so the vocabulary hint is not the gap. Much of the raw spread
 * is formatting: the replacements transcribe "QM four seven three two" where
 * this model writes "QM4732". What decides it is the mishearings, every one of
 * them a NAME whose correct spelling was sitting in the prompt — "Luffaga" as
 * "Lafarga"/"LaFaga", "Vogt" as "spoke", "Nguyen-Talbot" as "Wintalbot", and
 * gpt-live-transcribe missing "Karl" as "Carl" in all three voices. A mangled
 * name is what makes Mate create a second contact for the same customer, which
 * is the failure this prompt exists to prevent.
 *
 * gpt-live-transcribe is further out than its score suggests, for two reasons
 * that are about wiring rather than accuracy:
 *   - it emits NO transcription.completed event, ever (0 of 48 clips, against
 *     deltas on all 48). The reply gate below would still fire, since that
 *     runs off deltas, but the `.completed` handler — what the tradie sees
 *     they said, and the backstop for a turn with no deltas — would go dead.
 *   - it rejects `turn_detection` outright ("Turn detection is not supported
 *     for this transcription model"), so the 1200ms silence window below stops
 *     being ours to set. That window is load-bearing: 700ms cut tradies off
 *     mid-thought and Mate answered the fragments.
 * It also costs $0.017/min against $0.006 here, roughly 2.8x.
 *
 * So this must move before Feb 2027, and on today's evidence neither
 * replacement is ready. Re-measure nearer the date with the harness above.
 * Note also that this model's age is not evidence against it: the id is a bare
 * alias created 2025-03-15 with no dated snapshots exposed, so what it
 * currently resolves to is not something the API will tell us.
 */
export const OA_TRANSCRIBE_MODEL = 'gpt-4o-transcribe';

// ---------------------------------------------------------------------------
// Usage metering
//
// The socket runs device→OpenAI on an ephemeral client secret, so the server
// never sees a frame of it — exactly the Gemini Live problem, and solved the
// same way: accumulate here, report once at the end. Until this existed an
// OpenAI voice session cost the business real money and recorded none of it,
// which understates the whole assistant figure by however much of the rollout
// is on this provider.
// ---------------------------------------------------------------------------

/** What a whole session used, in the shape reportAssistantVoiceUsage prices. */
export interface OpenAiUsageTotals {
  /** Input tokens INCLUDING the cached ones — see accumulateOpenAiUsage. */
  inputTextTokens: number;
  inputAudioTokens: number;
  cachedInputTextTokens: number;
  cachedInputAudioTokens: number;
  outputTextTokens: number;
  outputAudioTokens: number;
  /** Audio seconds the separately-billed transcription model charged for. */
  transcriptionSeconds: number;
  /** Model turns seen. Only used to tell "nothing happened" from "free". */
  responses: number;
}

export function emptyOpenAiUsageTotals(): OpenAiUsageTotals {
  return {
    inputTextTokens: 0,
    inputAudioTokens: 0,
    cachedInputTextTokens: 0,
    cachedInputAudioTokens: 0,
    outputTextTokens: 0,
    outputAudioTokens: 0,
    transcriptionSeconds: 0,
    responses: 0,
  };
}

const nonNegative = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Fold one `response.done` event into the running totals.
 *
 * Realtime reports per RESPONSE, and every response re-bills the conversation
 * so far as input — that is how the platform charges, so summing the events is
 * summing the bill, not double-counting it.
 *
 * `input_token_details` splits the input by modality and `cached_tokens_details`
 * splits the cached subset the same way; the modality totals INCLUDE their
 * cached part, and the server subtracts it. Both are kept rather than
 * pre-netted here because audio is 80x dearer than a cache hit and text is 10x
 * — flattening the split would be the most expensive rounding error available.
 *
 * The two fallbacks lean in OPPOSITE directions, which is worth stating
 * plainly in a money path: a payload with no modality split bills the lot as
 * text, which UNDER-counts audio eightfold ($4/M against $32/M), while a bare
 * `cached_tokens` with no split is credited against text only and so
 * OVER-counts. Both beat recording the turn as zero, which is the bug this
 * replaces, but neither is a safe direction to assume on the dashboard.
 */
export function accumulateOpenAiUsage(totals: OpenAiUsageTotals, event: any): void {
  const u = event?.response?.usage;
  if (!u || typeof u !== 'object') return;
  totals.responses += 1;

  const input = u.input_token_details || {};
  const output = u.output_token_details || {};
  const cachedDetails = input.cached_tokens_details || {};

  let inputText = nonNegative(input.text_tokens);
  const inputAudio = nonNegative(input.audio_tokens);
  // No modality split at all (an older or partial payload): bill the bare
  // total as text rather than losing the turn entirely.
  if (!inputText && !inputAudio) inputText = nonNegative(u.input_tokens);
  totals.inputTextTokens += inputText;
  totals.inputAudioTokens += inputAudio;

  const cachedText = nonNegative(cachedDetails.text_tokens);
  const cachedAudio = nonNegative(cachedDetails.audio_tokens);
  if (!cachedText && !cachedAudio) {
    totals.cachedInputTextTokens += Math.min(nonNegative(input.cached_tokens), inputText);
  } else {
    totals.cachedInputTextTokens += Math.min(cachedText, inputText);
    totals.cachedInputAudioTokens += Math.min(cachedAudio, inputAudio);
  }

  let outputText = nonNegative(output.text_tokens);
  const outputAudio = nonNegative(output.audio_tokens);
  if (!outputText && !outputAudio) outputText = nonNegative(u.output_tokens);
  totals.outputTextTokens += outputText;
  totals.outputAudioTokens += outputAudio;
}

/**
 * Fold one `conversation.item.input_audio_transcription.completed` event in.
 *
 * Transcription is a separate model on a separate bill and its usage is NOT in
 * response.usage — it rides on this event, reported as a duration. A payload
 * that reports tokens instead is skipped rather than guessed at: that arm
 * under-counts a cheap line, where a guess could misstate an expensive one.
 */
export function accumulateOpenAiTranscriptionUsage(
  totals: OpenAiUsageTotals,
  event: any,
): void {
  totals.transcriptionSeconds += nonNegative(event?.usage?.seconds);
}

/**
 * The session's meter: what it used, how long it ran, and the one report that
 * settles both.
 *
 * Owned OUT here rather than inside the session body so the open can be
 * wrapped in it. The budget hold is parked by the MINT, before this file runs
 * at all, so every throw between here and a live session leaves 120 seconds
 * parked — on the free tier, 40% of the day's talk time gone for a session
 * that never started. Keeping the meter outside the body is what lets the
 * wrapper guarantee "reported exactly once, on every terminal path", instead
 * of the three specific paths someone remembered to wire.
 */
function createUsageReporter(minted: OpenAiMintedToken) {
  const totals = emptyOpenAiUsageTotals();
  let connectedAtMs: number | null = null;
  let reported = false;

  return {
    totals,

    /**
     * Billing starts where the session becomes usable, not at socket open —
     * the mint and the config round trip are not conversation. The same line
     * the ElevenLabs path draws at onConnect.
     */
    markConnected: () => {
      if (connectedAtMs === null) connectedAtMs = Date.now();
    },

    /**
     * Report the spend and settle the hold. First caller wins, so a path with
     * a specific reason keeps it and the wrapper's catch-all is a backstop.
     *
     * Best-effort, like the ElevenLabs path: a failed report must never
     * surface to the tradie.
     *
     * Where the parity stops: ElevenLabs has a post-call webhook that tells
     * the server what a session really cost even when the client never
     * reports. OpenAI has no such callback, so this is the ONLY witness. A
     * session the OS kills outright therefore keeps its hold until midnight
     * UTC — the same way the ElevenLabs hold expires, and the safe direction
     * to fail — but also records no cost at all, which the ElevenLabs webhook
     * would have caught. Closing that would mean polling OpenAI's usage API by
     * day, not by session.
     */
    flush: (endReason: string) => {
      if (reported) return;
      reported = true;
      const durationSeconds = elapsedVoiceSeconds(connectedAtMs, Date.now());
      try {
        void httpsCallable(functions, 'reportAssistantVoiceUsage')({
          model: minted.modelLabel || `openai/${minted.model}`,
          conversationId: minted.conversationId,
          durationSeconds,
          holdSeconds: minted.heldSeconds,
          endReason,
          // Omitted entirely when no turn ever completed, so a session that
          // only ever needed its hold back doesn't write a row of zeroes
          // across the daily doc's token counters.
          usage: totals.responses
            ? {
              inputTextTokens: totals.inputTextTokens,
              inputAudioTokens: totals.inputAudioTokens,
              cachedInputTextTokens: totals.cachedInputTextTokens,
              cachedInputAudioTokens: totals.cachedInputAudioTokens,
              outputTextTokens: totals.outputTextTokens,
              outputAudioTokens: totals.outputAudioTokens,
            }
            : undefined,
          transcriptionSeconds: Math.round(totals.transcriptionSeconds),
        }).catch(() => { /* best-effort */ });
      } catch { /* best-effort */ }
    },
  };
}

type UsageReporter = ReturnType<typeof createUsageReporter>;

export async function openOpenAiVoiceSession(
  minted: OpenAiMintedToken,
  history: ChatMessage[],
  cb: VoiceSessionCallbacks,
  _opts: VoiceSessionOptions = {},
): Promise<VoiceSession> {
  const usage = createUsageReporter(minted);
  try {
    return await openRealtimeSession(minted, history, cb, _opts, usage);
  } catch (err) {
    // Nothing below the mint is allowed to keep the tradie's talk time. The
    // prompt build, the seed, the socket, the config round trip — any of them
    // can throw, and every one of them happens with 120 seconds already
    // parked. Idempotent, so a path that reported its own reason keeps it.
    usage.flush('open-failed');
    throw err;
  }
}

async function openRealtimeSession(
  minted: OpenAiMintedToken,
  history: ChatMessage[],
  cb: VoiceSessionCallbacks,
  _opts: VoiceSessionOptions,
  usage: UsageReporter,
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
    usage.flush(err ? 'error' : 'ended');
    if (err) cb.onError?.(err);
    cb.onClose?.(undefined);
  };

  const connect = new Promise<WebSocket>((resolve, reject) => {
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

  let ws: WebSocket;
  try {
    ws = await connect;
  } catch (err) {
    // The mint already parked a hold against today's talk-time budget and this
    // socket never opened. Give it back rather than charging a tradie two
    // minutes for a dead connection.
    usage.flush('connect-failed');
    throw err;
  }

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

  // ---- readiness -------------------------------------------------------
  //
  // A socket that OPENS is not a socket that works. The credit-exhaustion
  // outage handshook cleanly and then failed on the first frame, so resolving
  // this function at onopen handed the screen a corpse and the tradie an error
  // message with nowhere to go. Readiness is `session.updated` — the server
  // echoing back the config we just sent — and an `error` arriving before it
  // means this transport is unusable, which openVoiceSession answers by
  // reopening on Gemini.
  //
  // Failing safe cuts one way on purpose: if OpenAI ever stops sending
  // session.updated, every session falls back to Gemini instead of breaking.
  // That is a silent A/B kill, visible in the model stamps on
  // /admin/conversations, and much cheaper than the alternative.
  let markReady: () => void = () => {};
  let markUnusable: (err: Error) => void = () => {};
  // Set by EITHER outcome: the session was accepted, or the transport was
  // condemned. Both mean "stop deciding", which is what every guard below asks.
  let settled = false;
  const readiness = new Promise<void>((resolve, reject) => {
    markReady = () => { if (!settled) { settled = true; resolve(); } };
    markUnusable = (err: Error) => { if (!settled) { settled = true; reject(err); } };
  });
  const readyTimer = setTimeout(
    () => markUnusable(new VoiceTransportUnavailableError('Voice session never confirmed.', 'openai')),
    OA_READY_TIMEOUT_MS,
  );

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

  ws.onclose = () => {
    if (!settled) { clearTimeout(readyTimer); markUnusable(new VoiceTransportUnavailableError('Voice session closed before it started.', 'openai')); return; }
    if (alive) finish();
  };
  ws.onerror = () => {
    if (!settled) { clearTimeout(readyTimer); markUnusable(new VoiceTransportUnavailableError('Voice connection failed.', 'openai')); return; }
    if (alive) finish(new LiveOfflineError('Voice connection lost.'));
  };

  ws.onmessage = async (event: { data: unknown }) => {
    let msg: any;
    try { msg = JSON.parse(String(event.data)); } catch { return; }

    switch (msg.type) {
      // The server echoed our config back: tools, transcription and audio
      // contract all accepted. Only now is this transport known to work.
      case 'session.updated':
        clearTimeout(readyTimer);
        // Where the billable conversation starts — see markConnected.
        usage.markConnected();
        markReady();
        break;

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
        // Before the noise check: the transcriber billed for that audio
        // whether or not what it heard was worth answering.
        accumulateOpenAiTranscriptionUsage(usage.totals, msg);
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
        // The only place the tokens this turn cost are ever visible.
        accumulateOpenAiUsage(usage.totals, msg);
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
        // Before readiness this is not "a turn went wrong", it is "this
        // provider cannot serve anyone" — an exhausted key, a model the
        // account cannot reach, a rejected config. Condemn the transport so
        // the caller can reopen on Gemini, instead of reporting a dead end.
        if (!settled) {
          clearTimeout(readyTimer);
          markUnusable(new VoiceTransportUnavailableError(text, 'openai'));
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

  // Nothing below here runs until the server has accepted the session, or the
  // rejection has already been handed to openVoiceSession to retry elsewhere.
  try {
    await readiness;
  } catch (err) {
    clearTimeout(readyTimer);
    alive = false;
    closedOnce = true;   // this socket never became a session; no onClose is owed
    // A hold is still parked against today's budget. Settle it at zero
    // seconds so a provider outage costs the tradie nothing — this is the
    // path the whole Gemini fallback runs through, so it is the common case,
    // not the rare one.
    usage.flush('transport-unavailable');
    try { ws.close(); } catch { /* already gone */ }
    throw err;
  }

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
