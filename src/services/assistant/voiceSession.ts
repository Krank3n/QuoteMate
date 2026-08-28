// Long-lived Gemini Live session for voice mode.
//
// Voice differs from text in three ways:
//   * The session lives across multiple turns (user speaks → model speaks
//     → user speaks again on the same socket). Server-side VAD decides
//     when the user is done.
//   * Input is a stream of PCM chunks (`realtimeInput.audio`), not a
//     bundled `clientContent` payload.
//   * Output carries audio chunks alongside text — the screen drives the
//     queue in audioPlayer; the bubble shows the transcription.
//
// Reconnection: tradies are on job sites with patchy coverage, so a mid-
// conversation socket drop is the norm, not the exception. When an
// established socket drops without the user closing it, the session re-mints
// a token, opens a fresh socket, and reseeds the transcript — surfacing
// onReconnecting/onReconnected instead of onError/onClose, which now only
// fire when the session is truly over. Only sticky voice opts in
// (opts.reconnect); PTT stays single-shot because a half-finished
// push-to-talk turn can't be restored (the user's audio isn't in the
// transcript). Each reconnect attempt mints a fresh token (they're
// single-use), which reserves a quota turn server-side — the attempt cap
// bounds that cost.
//
// The text path (`sendAssistantTurn`) is unchanged and intentionally
// stays single-shot — burning a token mint per text turn is cheap and
// the simpler lifecycle keeps that path easy to debug.

import { httpsCallable } from 'firebase/functions';
import { ChatMessage, Proposal } from '../../types/assistant';
import { functions } from '../../config/firebase';
import { MATE_SYSTEM_PROMPT } from './systemPrompt';
import { TOOL_DECLARATIONS, CONTROL_TOOL_DECLARATIONS, isControlTool } from './toolSchemas';
import { dispatchToolCall } from './toolDispatcher';
import {
  LIVE_WS_BASE,
  MAX_HISTORY_TURNS,
  LiveAuthError,
  LiveOfflineError,
  LiveQuotaError,
  LiveRateLimitError,
  mintLiveToken,
  isElevenLabsMint,
  isOpenAiMint,
  MintedToken,
} from './liveSession';

// If the socket opens but the server never acks the setup frame (silently
// rejected token, half-open connection), fail the connect instead of leaving
// the UI stuck on "connecting" forever.
export const SETUP_TIMEOUT_MS = 12_000;
// Backoff between reconnect attempts. Length = max attempts.
export const RECONNECT_DELAYS_MS = [600, 1600, 3200];
// Cap on clientContent frames (typed text / context notes) queued while a
// reconnect is in flight. Anything beyond this is dropped oldest-first.
const MAX_PENDING_CLIENT_FRAMES = 20;

// Live API only sends usageMetadata to the client; the server-side proxy
// never sees it (the WS runs device→Gemini on an ephemeral token). We
// accumulate per-modality totals per physical connection and report once as
// each socket closes — across reconnects that yields one report per socket,
// so /admin/ai-costs still attributes real voice spend to the user.
interface LiveUsageTotals {
  inputTextTokens: number;
  outputTextTokens: number;
  inputAudioTokens: number;
  outputAudioTokens: number;
  cachedTokens: number;
  thoughtsTokens: number;
}

function emptyUsageTotals(): LiveUsageTotals {
  return {
    inputTextTokens: 0,
    outputTextTokens: 0,
    inputAudioTokens: 0,
    outputAudioTokens: 0,
    cachedTokens: 0,
    thoughtsTokens: 0,
  };
}

// Live usageMetadata carries per-modality breakdowns in *TokensDetails arrays.
// Older preview versions sometimes omit them and only ship the totals; fall
// back to bucketing everything as text in that case so we still record cost.
function accumulateLiveUsage(totals: LiveUsageTotals, u: any): void {
  if (!u || typeof u !== 'object') return;
  const promptTotal = Number(u.promptTokenCount) || 0;
  const respTotal = Number(u.responseTokenCount) || 0;
  const promptDetails = Array.isArray(u.promptTokensDetails) ? u.promptTokensDetails : [];
  const respDetails = Array.isArray(u.responseTokensDetails) ? u.responseTokensDetails : [];

  let promptAudio = 0;
  let promptText = 0;
  for (const d of promptDetails) {
    const n = Number(d?.tokenCount) || 0;
    if (String(d?.modality).toUpperCase() === 'AUDIO') promptAudio += n;
    else promptText += n;
  }
  let respAudio = 0;
  let respText = 0;
  for (const d of respDetails) {
    const n = Number(d?.tokenCount) || 0;
    if (String(d?.modality).toUpperCase() === 'AUDIO') respAudio += n;
    else respText += n;
  }
  // If details were missing, fall back to the bare totals as text.
  if (!promptDetails.length && promptTotal) promptText = promptTotal;
  if (!respDetails.length && respTotal) respText = respTotal;

  totals.inputAudioTokens += promptAudio;
  totals.inputTextTokens += promptText;
  totals.outputAudioTokens += respAudio;
  totals.outputTextTokens += respText;
  totals.cachedTokens += Number(u.cachedContentTokenCount) || 0;
  totals.thoughtsTokens += Number(u.thoughtsTokenCount) || 0;
}

async function reportLiveUsage(model: string, totals: LiveUsageTotals): Promise<void> {
  // Nothing happened (mint failed before any turn, or the session was opened
  // and closed instantly) — don't bother the server with a zero payload.
  const anyTokens =
    totals.inputTextTokens + totals.outputTextTokens +
    totals.inputAudioTokens + totals.outputAudioTokens;
  if (!anyTokens) return;
  try {
    const callable = httpsCallable(functions, 'reportAssistantLiveUsage');
    await callable({ model, sessionEnded: true, ...totals });
  } catch (err: any) {
    // Cost reporting is best-effort — a failure must not impact the user.
    // eslint-disable-next-line no-console
    console.warn('[Mate voice] usage report failed', err?.message);
  }
}

export interface VoiceSessionCallbacks {
  /** Server's transcription of what the user said. May fire multiple times per turn. */
  onInputTranscription?: (text: string, finished: boolean) => void;
  /** Text delta of the model's reply (when responseModalities includes TEXT). */
  onTextDelta?: (delta: string) => void;
  /** Server's transcription of the model's spoken reply. */
  onOutputTranscription?: (text: string, finished: boolean) => void;
  /** A base64 PCM (24 kHz, 16-bit LE, mono) audio chunk to play. */
  onAudioChunk?: (base64Pcm: string) => void;
  /** A propose_* tool call validated and ready to render as a card. */
  onProposal?: (proposal: Proposal) => void;
  /**
   * The tradie accepted or backed out of the on-screen proposal card by voice.
   * Mate signals this via the apply_/cancel_pending_proposal control tools; the
   * screen runs the same Apply / dismiss the card buttons do. The return value
   * is sent straight back as the tool response so Mate knows whether a card was
   * actually waiting (so it doesn't claim it sent something when nothing was up).
   */
  onControlAction?: (
    decision: 'apply' | 'cancel',
    proposalId?: string,
  ) => { ok: boolean; error?: string };
  /**
   * The tradie asked to see a quote and Mate called show_quote. The screen
   * renders it inline in the chat and returns whether the id actually resolved
   * — so Mate is told the truth instead of claiming a quote it couldn't find
   * is on screen.
   */
  onShowQuote?: (quoteId: string) => { ok: boolean; error?: string };
  /** One model turn finished; ready for the next user turn. */
  onTurnComplete?: () => void;
  /**
   * The socket dropped mid-session and an automatic reconnect attempt is
   * starting (attempt is 1-based). Whatever turn was in flight is gone —
   * the screen should flush half-open bubbles and show a connecting state.
   */
  onReconnecting?: (attempt: number) => void;
  /** Reconnect succeeded — session is live again with the transcript reseeded. */
  onReconnected?: () => void;
  /**
   * ElevenLabs only. Whether Mate is currently speaking or listening, straight
   * from the transport. Replaces the Gemini path's trick of inferring it from
   * whether the audio queue had anything playing — which was also what the
   * half-duplex mic gate keyed off, and WebRTC's echo cancellation makes that
   * gate unnecessary.
   */
  onModeChange?: (mode: 'speaking' | 'listening') => void;
  /**
   * ElevenLabs only. Voice-activity score, 0..1. Drives the waveform on BOTH
   * platforms — the Gemini path could only do this on web, where it had the raw
   * PCM to measure; on native the line just breathed on a timer.
   *
   * Fires continuously, including through silence. Anything treating it as
   * "the tradie is talking" has to threshold it, or the idle watchdog never
   * fires and a forgotten session bills until the daily budget stops it.
   */
  onVadScore?: (score: number) => void;
  /** Fatal error; the session is closed. Never fires for a drop that reconnects. */
  onError?: (err: Error) => void;
  /** The session is over — user close, server close (PTT), or reconnect exhausted. */
  onClose?: (code: number | undefined) => void;
}

export interface VoiceSessionOptions {
  /**
   * Reconnect automatically when an established socket drops. Sticky voice
   * passes true; PTT leaves it off (single-shot turn — the user's audio isn't
   * in the transcript, so half a turn can't be restored).
   */
  reconnect?: boolean;
  /**
   * Fresh transcript to reseed a reconnected session, so turns that happened
   * after the original open aren't lost. Falls back to the history passed to
   * openVoiceSession.
   */
  getSeedHistory?: () => ChatMessage[];
  /**
   * The tradie's own customer names, newest first, for ASR keyword boosting.
   *
   * Passed in rather than read from the store, so the session module stays
   * free of native dependencies and testable. A general speech model has never
   * heard of Luffaga: one real conversation rendered "Geraldine Luffaga" as
   * "Jared Dane" twice and took five turns and a spelling-out to recover.
   */
  asrKeywordNames?: string[];
}

export interface VoiceSession {
  /** Stream a base64 PCM 16 kHz mono chunk from the mic. */
  sendMicChunk: (base64Pcm: string) => void;
  /** Send a text user turn over the same session (useful when the tradie types mid-voice). */
  sendUserText: (text: string) => void;
  /**
   * Drop a context note into the session without triggering a model
   * reply. Use after the tradie taps Apply on a proposal so Mate sees
   * the resulting quote id on the next user turn instead of having to
   * re-search for it. `turnComplete: false` keeps it as a soft prefix.
   */
  sendContextNote: (text: string) => void;
  /** Mark the end of a user audio turn explicitly (server-side VAD usually handles this). */
  endUserTurn: () => void;
  /** Close the WS — drops any in-flight model output. */
  close: () => void;
  /** True until close() runs, the server closes (PTT), or reconnects exhaust. */
  isOpen: () => boolean;
  /**
   * The transport speaks its own opening line (ElevenLabs first_message), so
   * the screen must NOT also send the [greet] prompt. Sending both greets the
   * tradie twice — verified on device: "Morning — I can draft you a quote or
   * an invoice" immediately followed by "G'day, I'm Mate. Need a quote or
   * invoice drafted?".
   *
   * This is also the prompt-leak fix actually landing. A configured
   * first_message is spoken verbatim with no model turn behind it, so the
   * chain-of-thought that twice reached a tradie has nowhere to come from —
   * but only if the LLM-driven greeting is genuinely gone.
   */
  ownsGreeting?: boolean;
  /**
   * The transport captures and plays audio itself, so the screen must NOT
   * start its own mic capture. Two owners on the iOS audio session gives a
   * dead mic or earpiece-instead-of-speaker output, intermittently.
   * Absent/false on the Gemini path, which expects the screen to feed it.
   */
  ownsMicrophone?: boolean;
  /**
   * Sample rate this transport expects for mic chunks. Gemini takes 16 kHz;
   * OpenAI Realtime rejects anything below 24 kHz. Absent means 16 kHz.
   */
  micSampleRate?: number;
  /** Mute without tearing the session down — used when a modal takes over. */
  setMicMuted?: (muted: boolean) => void;
  /** Input level 0..1, for the waveform when no raw PCM reaches JS. */
  getInputVolume?: () => number;
  /** Provider-side conversation id, for cost reconciliation and breadcrumbs. */
  getConversationId?: () => string;
}

function buildSeedTurns(history: ChatMessage[]) {
  return history
    .slice(-MAX_HISTORY_TURNS)
    .filter((m) => m.text?.trim())
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.text }],
    }));
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// One physical socket. The facade returned by openVoiceSession outlives these
// across reconnects.
interface Connection {
  send: (frame: any) => void;
  sendMicChunk: (b64: string) => void;
  close: () => void;
  isUsable: () => boolean;
}

/**
 * Open a voice session with whichever provider the SERVER nominates.
 *
 * The mint answers "which transport", not the client — that indirection is
 * what makes rolling back to Gemini Live a Firestore edit plus a functions
 * deploy, with no app-store release in the loop. The token is minted once
 * here and handed to whichever implementation wins, so a fork never costs
 * two mints (and two quota turns).
 */
export async function openVoiceSession(
  history: ChatMessage[],
  cb: VoiceSessionCallbacks,
  opts: VoiceSessionOptions = {},
): Promise<VoiceSession> {
  const minted = await mintLiveToken('voice');
  if (isElevenLabsMint(minted)) {
    const { openElevenLabsVoiceSession } = await import('./elevenLabsVoiceSession');
    return openElevenLabsVoiceSession(minted, history, cb, opts);
  }
  if (isOpenAiMint(minted)) {
    const { openOpenAiVoiceSession } = await import('./openAiVoiceSession');
    return openOpenAiVoiceSession(minted, history, cb, opts);
  }
  return openGeminiVoiceSession(minted, history, cb, opts);
}

async function openGeminiVoiceSession(
  firstMint: MintedToken,
  history: ChatMessage[],
  cb: VoiceSessionCallbacks,
  opts: VoiceSessionOptions = {},
): Promise<VoiceSession> {
  // The mint that chose this provider is single-use and still unspent — hand
  // it to the first socket rather than burning a second one (and a second
  // quota turn) to open the very session it was minted for.
  let pendingMint: MintedToken | null = firstMint;
  // ---- session-level state, shared across physical connections ----
  let alive = true; // false once the user closed or recovery gave up
  let reconnecting = false;
  let conn: Connection | null = null;
  // Closes the socket of a connect attempt that hasn't settled yet, so a
  // user close during a reconnect doesn't leave it dangling until the
  // setup timeout.
  let abortInFlightConnect: (() => void) | null = null;
  const pendingClientFrames: any[] = [];

  // Single funnel for "the session is over" — guarantees onClose fires once
  // and onError only rides along when there's a real failure to surface.
  let finished = false;
  const finishSession = (code?: number, err?: Error) => {
    if (finished) return;
    finished = true;
    alive = false;
    if (err) cb.onError?.(err);
    cb.onClose?.(code);
  };

  // An established socket dropped without close() being called.
  const handleDrop = (code?: number) => {
    if (!alive) {
      finishSession(code);
      return;
    }
    if (opts.reconnect) {
      void runReconnect(code);
      return;
    }
    finishSession(code);
  };

  async function runReconnect(dropCode?: number): Promise<void> {
    if (reconnecting || !alive) return;
    reconnecting = true;
    conn = null;
    let lastErr: Error | null = null;
    for (let attempt = 1; attempt <= RECONNECT_DELAYS_MS.length; attempt++) {
      // Re-check before every attempt: the user may have closed during the
      // previous attempt's backoff or in-flight connect. Without this the
      // callback fires after teardown and wedges the screen on 'connecting'.
      if (!alive) {
        reconnecting = false;
        return;
      }
      cb.onReconnecting?.(attempt);
      await sleep(RECONNECT_DELAYS_MS[attempt - 1]);
      if (!alive) {
        reconnecting = false;
        return; // user closed while we were waiting
      }
      try {
        const seed = opts.getSeedHistory ? opts.getSeedHistory() : history;
        const next = await connectOnce(seed);
        if (!alive) {
          // User closed while the connect was in flight — don't resurrect.
          next.close();
          reconnecting = false;
          return;
        }
        conn = next;
        reconnecting = false;
        cb.onReconnected?.();
        return;
      } catch (err: any) {
        lastErr = err instanceof Error ? err : new LiveOfflineError('Voice reconnect failed.');
        // Quota, auth, and rate-limit failures won't heal with another attempt
        // — and re-minting into a rate limit only deepens it. Bail now rather
        // than burning more mints.
        if (
          err instanceof LiveQuotaError ||
          err instanceof LiveAuthError ||
          err instanceof LiveRateLimitError
        ) break;
      }
    }
    reconnecting = false;
    finishSession(dropCode, lastErr ?? new LiveOfflineError('Voice connection lost.'));
  }

  // Mint a token, open a socket, resolve once the server acks the setup
  // frame. Rejects on error/close/timeout before that ack.
  async function connectOnce(seedHistory: ChatMessage[]): Promise<Connection> {
    // Reconnects mint fresh — Gemini's ephemeral tokens are single-use.
    const consumed = pendingMint;
    pendingMint = null;
    const { token, model } = consumed ?? (await mintLiveToken('voice'));

    return new Promise<Connection>((resolve, reject) => {
      const url = `${LIVE_WS_BASE}?access_token=${encodeURIComponent(token)}`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err: any) {
        reject(new LiveOfflineError(err?.message || 'WebSocket init failed.'));
        return;
      }
      abortInFlightConnect = () => {
        try { ws.close(); } catch { /* noop */ }
      };

      let open = true; // this socket is usable
      let setupAcked = false;
      let settled = false; // this promise resolved/rejected
      const pendingChunks: string[] = [];
      const usageTotals = emptyUsageTotals();
      let usageReported = false;
      const flushUsage = () => {
        if (usageReported) return;
        usageReported = true;
        // Fire-and-forget — the WS is already torn down by the time this runs.
        void reportLiveUsage(model, usageTotals);
      };

      const setupTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        open = false;
        try { ws.close(); } catch { /* noop */ }
        reject(new LiveOfflineError('Voice connection timed out during setup.'));
      }, SETUP_TIMEOUT_MS);

      const safeSend = (frame: any) => {
        if (!open) return;
        try {
          ws.send(JSON.stringify(frame));
        } catch {
          // A failed send means the socket is on its way out. Close it and
          // let onclose decide between reconnect and final teardown.
          try { ws.close(); } catch { /* noop */ }
        }
      };

      const connection: Connection = {
        send: safeSend,
        sendMicChunk: (b64) => {
          if (!open || !b64) return;
          if (!setupAcked) {
            // Drain after setupComplete so we don't lose the start of the
            // first utterance.
            pendingChunks.push(b64);
            return;
          }
          safeSend({
            realtimeInput: {
              audio: { mimeType: 'audio/pcm;rate=16000', data: b64 },
            },
          });
        },
        close: () => {
          if (!open) return;
          open = false;
          try { ws.close(); } catch { /* noop */ }
          flushUsage();
        },
        isUsable: () => open && setupAcked,
      };

      ws.onopen = () => {
        // Seed the session with prior conversation history as system turns
        // so Mate picks up where the chat left off.
        const seedTurns = buildSeedTurns(seedHistory);

        const setup = {
          setup: {
            model: `models/${model}`,
            generationConfig: {
              responseModalities: ['AUDIO'],
              // Pin the session to English. gemini-live-2.5-flash is a
              // half-cascade model, so it accepts speechConfig.languageCode
              // (native-audio models don't). Without it the ASR auto-detects
              // per utterance and intermittently renders plain English in
              // another language (a known Live preview bug — e.g. a stray
              // "à compter de Non, je ne pense pas." for "No, I don't think
              // so."). en-US is the only widely-supported English code: en-AU
              // and en-GB are NOT on the supported list and get rejected,
              // which would kill the whole setup frame. The Aussie *tone*
              // comes from the system prompt + the chosen voice, not this.
              speechConfig: { languageCode: 'en-US' },
            },
            systemInstruction: { parts: [{ text: MATE_SYSTEM_PROMPT }] },
            // Voice gets the control tools on top of the shared set so the tradie
            // can accept/cancel a card by voice when they can't tap.
            tools: [{ functionDeclarations: [...TOOL_DECLARATIONS, ...CONTROL_TOOL_DECLARATIONS] }],
            // Server-side VAD — Mate replies when the tradie stops speaking,
            // no client-side turn boundary needed.
            realtimeInputConfig: {
              automaticActivityDetection: {
                disabled: false,
                silenceDurationMs: 1200,
                prefixPaddingMs: 300,
              },
            },
            // Get both transcriptions — bubble shows the heard user text and
            // the spoken reply text alongside the audio playback.
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        };
        safeSend(setup);

        // Seed history as a separate clientContent turn after setup so the
        // model has context but doesn't speak yet — turnComplete=false keeps
        // it as a soft prefix.
        if (seedTurns.length) {
          safeSend({ clientContent: { turns: seedTurns, turnComplete: false } });
        }

        // Replay anything the tradie typed (or context notes queued) while
        // this reconnect was in flight, in order, after the seed.
        if (pendingClientFrames.length) {
          for (const frame of pendingClientFrames.splice(0)) safeSend(frame);
        }
      };

      ws.onmessage = async (event: any) => {
        let raw: string;
        const data: any = event.data;
        if (typeof data === 'string') raw = data;
        else if (data && typeof data.text === 'function') raw = await data.text();
        else if (data instanceof ArrayBuffer) raw = new TextDecoder().decode(data);
        else raw = String(data);

        let msg: any;
        try { msg = JSON.parse(raw); } catch { return; }

        // usageMetadata can ride along with serverContent, toolCall, or arrive on
        // its own — always sample it before branching on the message type.
        if (msg?.usageMetadata) {
          accumulateLiveUsage(usageTotals, msg.usageMetadata);
        }

        if (msg?.setupComplete && !setupAcked) {
          setupAcked = true;
          // Flush any mic chunks captured before setupComplete arrived.
          for (const chunk of pendingChunks) {
            safeSend({
              realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: chunk } },
            });
          }
          pendingChunks.length = 0;
          if (!settled) {
            settled = true;
            clearTimeout(setupTimer);
            // Socket is established — it's reachable via conn.close() now.
            abortInFlightConnect = null;
            resolve(connection);
          }
          return;
        }

        const toolCalls = msg?.toolCall?.functionCalls;
        if (Array.isArray(toolCalls) && toolCalls.length) {
          try {
            const results = await Promise.all(
              toolCalls.map(async (call: any) => {
                const name = String(call.name);
                const id = String(call.id);
                // Control tools (accept/cancel the on-screen card) don't hit the
                // dispatcher — hand the decision to the screen and ack the model
                // with whatever it reports back.
                if (isControlTool(name)) {
                  const decision = name === 'apply_pending_proposal' ? 'apply' : 'cancel';
                  const proposalId = call.args?.proposalId ? String(call.args.proposalId) : undefined;
                  const response =
                    cb.onControlAction?.(decision, proposalId) ?? { ok: false, error: 'Voice control unavailable.' };
                  return { name, id, response, proposal: undefined as Proposal | undefined };
                }
                const r = await dispatchToolCall({ name, id, args: call.args || {} });
                // show_quote is a screen action — let the screen render it and
                // tell the model whether the quote actually resolved.
                if (r.view?.kind === 'show_quote') {
                  const response = cb.onShowQuote?.(r.view.quoteId) ?? { ok: true };
                  return { name: r.name, id: r.id, response, proposal: undefined as Proposal | undefined };
                }
                return { name: r.name, id: r.id, response: r.response, proposal: r.proposal };
              }),
            );
            for (const r of results) {
              if (r.proposal) cb.onProposal?.(r.proposal);
            }
            safeSend({
              toolResponse: {
                functionResponses: results.map((r) => ({ name: r.name, id: r.id, response: r.response })),
              },
            });
          } catch (err: any) {
            cb.onError?.(new LiveOfflineError(err?.message || 'Tool dispatch failed.'));
          }
          return;
        }

        const serverContent = msg?.serverContent;
        const parts = serverContent?.modelTurn?.parts;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            if (part?.inlineData?.data) {
              cb.onAudioChunk?.(part.inlineData.data);
            } else if (typeof part?.text === 'string') {
              cb.onTextDelta?.(part.text);
            }
          }
        }
        if (serverContent?.inputTranscription) {
          const t = serverContent.inputTranscription;
          cb.onInputTranscription?.(String(t.text || ''), !!t.finished);
        }
        if (serverContent?.outputTranscription) {
          const t = serverContent.outputTranscription;
          cb.onOutputTranscription?.(String(t.text || ''), !!t.finished);
        }
        if (serverContent?.turnComplete) {
          cb.onTurnComplete?.();
        }
      };

      ws.onerror = (event: any) => {
        // eslint-disable-next-line no-console
        console.warn('[Mate voice] ws error', event?.message || event);
        if (!settled) {
          settled = true;
          open = false;
          clearTimeout(setupTimer);
          flushUsage();
          try { ws.close(); } catch { /* noop */ }
          reject(new LiveOfflineError('Voice connection error.'));
        }
        // Post-setup transport errors are always followed by onclose, which
        // owns the reconnect-or-finish decision.
      };

      ws.onclose = (event: any) => {
        const wasUsable = open;
        open = false;
        clearTimeout(setupTimer);
        flushUsage();
        if (!settled) {
          settled = true;
          reject(new LiveOfflineError(`Voice connection closed (${event?.code || 'unknown'}).`));
          return;
        }
        // wasUsable=false means connection.close() already ran (user close or
        // superseded socket) — handleDrop still funnels through finishSession,
        // which no-ops if close() already finished the session.
        if (wasUsable || !alive) handleDrop(event?.code);
      };
    });
  }

  const queueClientFrame = (frame: any) => {
    pendingClientFrames.push(frame);
    if (pendingClientFrames.length > MAX_PENDING_CLIENT_FRAMES) pendingClientFrames.shift();
  };

  const session: VoiceSession = {
    sendMicChunk: (b64) => {
      // Deliberately dropped while reconnecting — replaying seconds-old audio
      // in a burst would read as one garbled utterance to server VAD.
      if (!alive || !b64) return;
      conn?.sendMicChunk(b64);
    },
    sendUserText: (text) => {
      if (!alive || !text.trim()) return;
      const frame = {
        clientContent: {
          turns: [{ role: 'user', parts: [{ text }] }],
          turnComplete: true,
        },
      };
      if (conn?.isUsable()) conn.send(frame);
      else if (reconnecting) queueClientFrame(frame);
    },
    sendContextNote: (text) => {
      if (!alive || !text.trim()) return;
      const frame = {
        clientContent: {
          turns: [{ role: 'user', parts: [{ text }] }],
          turnComplete: false,
        },
      };
      if (conn?.isUsable()) conn.send(frame);
      else if (reconnecting) queueClientFrame(frame);
    },
    endUserTurn: () => {
      if (!alive) return;
      if (conn?.isUsable()) conn.send({ realtimeInput: { audioStreamEnd: true } });
    },
    close: () => {
      alive = false;
      pendingClientFrames.length = 0;
      const c = conn;
      conn = null;
      c?.close();
      // Also kill any connect attempt still mid-handshake (reconnect in
      // flight) so its socket doesn't dangle until the setup timeout.
      abortInFlightConnect?.();
      abortInFlightConnect = null;
      finishSession(undefined);
    },
    isOpen: () => alive,
  };

  conn = await connectOnce(history);
  return session;
}
