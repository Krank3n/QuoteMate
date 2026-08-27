// Mate's voice session over an ElevenLabs Agent (LiveKit WebRTC).
//
// Implements the same VoiceSession facade the Gemini Live path exposes, so the
// chat screen keeps calling openVoiceSession and gets something it already
// knows how to drive. What changes underneath is most of the work:
//
//   • The SDK owns the microphone and playback. sendMicChunk is a no-op and
//     onAudioChunk never fires — audio goes out and comes back on the WebRTC
//     track, never through JS. `ownsMicrophone` tells the screen to skip its
//     own capture; running both would put two owners on the iOS audio session,
//     which reliably produces a dead mic or earpiece-instead-of-speaker output.
//   • WebRTC brings real echo cancellation, so the half-duplex mic gate that
//     existed because Gemini's VAD heard our own speaker is gone.
//   • LiveKit reconnects internally. There is no hand-rolled backoff here.
//   • onMessage delivers COMPLETE messages, not deltas — transcripts arrive
//     whole rather than streaming in word by word.
//
// React Native is WebRTC-only: the shim throws on connectionType 'websocket'
// or a signedUrl, because the WebSocket transport needs AudioContext and
// AudioWorkletNode, which RN doesn't have.

// TYPE-ONLY on purpose — see the dynamic import in openElevenLabsVoiceSession.
// `import type` is erased at compile time, so it cannot pull the module in
// early. Do NOT "tidy" this into a value import.
import type { Conversation as ConversationClass } from '@elevenlabs/client';
import { ChatMessage } from '../../types/assistant';
import { ensureElevenLabsRuntime } from './elevenLabsRuntime';
import { ensureMicPermission } from './micPermission';
import { buildClientTools } from './clientTools';
import { buildSeedContext } from './seedContext';
import { elapsedVoiceSeconds } from './voiceMinutes';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../config/firebase';
import { mateGreetingWord } from '../../screens/assistant/voiceCopy';
import { ElevenLabsMintedToken, LiveOfflineError } from './liveSession';
import type { VoiceSession, VoiceSessionCallbacks, VoiceSessionOptions } from './voiceSession';

/** How long to wait for onConnect before calling the open a failure. */
export const EL_CONNECT_TIMEOUT_MS = 20_000;

type Conv = Awaited<ReturnType<typeof ConversationClass.startSession>>;

/**
 * The previous session's teardown, if one is still unwinding.
 *
 * LiveKit releases the native audio session inside its detach, and endSession
 * is async. Closing and immediately reopening therefore raced: the new
 * session called startAudioSession() while the old one's stopAudioSession()
 * was still in flight, and the winner was whichever finished last. That is
 * one of the ways voice comes up silent and works on the second go.
 */
let pendingTeardown: Promise<void> | null = null;

export async function openElevenLabsVoiceSession(
  minted: ElevenLabsMintedToken,
  history: ChatMessage[],
  cb: VoiceSessionCallbacks,
  _opts: VoiceSessionOptions = {},
): Promise<VoiceSession> {
  // Let the previous session finish releasing the native audio session before
  // this one claims it. See pendingTeardown.
  if (pendingTeardown) {
    try { await pendingTeardown; } catch { /* the old session's problem */ }
    pendingTeardown = null;
  }

  // Permission FIRST, before any audio or WebRTC initialisation.
  //
  // This used to sit after the runtime shim and the client import, which put
  // the iOS permission dialog in the middle of audio-session setup — the
  // system prompt appears, LiveKit configures and starts its session behind
  // it, and the mic track is created against a session the user has not
  // answered for yet. It comes up silent, and the next attempt works because
  // permission is already settled. Asking first removes the dialog from the
  // sequence entirely.
  await ensureMicPermission();

  // Registers LiveKit's WebRTC globals and the RN setup strategy. Dynamic, so
  // a tradie who never opens voice never pays for it.
  await ensureElevenLabsRuntime();

  // @elevenlabs/client is loaded HERE, after the shim, and never as a static
  // import at the top of this file. It is a browser library: it constructs
  // DOMException, which Hermes has no global for. @livekit/react-native ships
  // the polyfill (its index.js line 1 is `import './polyfills/DOMException'`)
  // and ensureElevenLabsRuntime is what pulls that in.
  //
  // A static import would defeat that entirely — ES modules evaluate every
  // static import before any of the importing module's own code runs, so the
  // client would initialise before the polyfill existed. It fails at import
  // time with "Property 'DOMException' doesn't exist", on device only, and
  // neither the unit tests nor a server-side simulation can see it.
  const { Conversation } = await import('@elevenlabs/client');

  let alive = true;
  let connected = false;
  let closedOnce = false;
  let speaking = false;
  let sawConnected = false;
  let connectedAtMs: number | null = null;
  let usageReported = false;

  /**
   * Settle the budget hold parked at mint. Exactly once, on every terminal
   * path — a session that never reports leaves its 120s held until midnight
   * UTC, and on the free tier that is a third of the day's talk time gone for
   * a call that may have lasted ten seconds.
   *
   * Best-effort: a failed report must never surface to the tradie. The
   * post-call webhook is the authoritative backstop.
   */
  const flushUsage = (endReason: string) => {
    if (usageReported) return;
    usageReported = true;
    const durationSeconds = elapsedVoiceSeconds(connectedAtMs, Date.now());
    try {
      void httpsCallable(functions, 'reportAssistantVoiceUsage')({
        model: minted.model,
        conversationId: minted.conversationId,
        durationSeconds,
        holdSeconds: minted.heldSeconds,
        endReason,
      }).catch(() => { /* best-effort */ });
    } catch { /* best-effort */ }
  };

  // Fires onClose exactly once, with onError riding along only on a real
  // failure — same contract the Gemini path guarantees.
  const finish = (err?: Error) => {
    if (closedOnce) return;
    closedOnce = true;
    alive = false;
    connected = false;
    flushUsage(err ? 'error' : 'ended');
    if (err) cb.onError?.(err);
    cb.onClose?.(undefined);
  };

  // Computed before connecting: whether there is prior conversation decides
  // whether Mate should greet at all.


  // Computed before connecting: whether there is prior conversation decides
  // both whether to seed context AND whether Mate should greet at all.
  const seed = buildSeedContext(history);

  let conv: Conv;
  try {
    conv = await new Promise<Conv>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new LiveOfflineError('Mate took too long to answer — try again.')),
        EL_CONNECT_TIMEOUT_MS,
      );

      Conversation.startSession({
        conversationToken: minted.token,
        // WebRTC only on React Native. Never pass signedUrl here.
        connectionType: 'webrtc',
        userId: minted.conversationId || undefined,
        clientTools: buildClientTools(cb),
        // Every {{placeholder}} in the agent's prompt or first_message must be
        // supplied on EVERY session — a missing one errors the turn, which
        // here would mean dead air instead of a greeting.
        dynamicVariables: { greeting: mateGreetingWord(new Date().getHours()) },
        // NOTE: do NOT suppress first_message on a chat with history.
        //
        // Tried it, to stop a second greeting when voice is reopened
        // mid-conversation. It fires on ANY chat with prior turns, which is
        // most of them — the tradie taps the mic and Mate says nothing at all,
        // with no signal it is even listening. Two sessions logged
        // `agent "null"` and then died to "Ending conversation after 60
        // seconds of silence".
        //
        // The duplicate greeting was only ever a symptom of the DOMException
        // bug opening two sessions back to back. That is fixed. Silence is a
        // far worse failure than a repeated hello.

        onConnect: () => {
          clearTimeout(timer);
          connected = true;
          sawConnected = true;
          // Billing starts here, not at open — the mint, the handshake and the
          // permission prompt are not conversation.
          if (connectedAtMs === null) connectedAtMs = Date.now();
        },

        onDisconnect: () => {
          if (!alive) return;
          finish();
        },

        onError: (message: string) => {
          clearTimeout(timer);
          const err = new LiveOfflineError(message || 'Voice connection failed.');
          if (!sawConnected) {
            reject(err);
            return;
          }
          finish(err);
        },

        // Complete messages, not deltas. `finished` is always true because
        // there is no partial state on this transport to represent.
        onMessage: ({ message, source }: { message: string; source: string }) => {
          if (!message) return;
          if (source === 'user') cb.onInputTranscription?.(message, true);
          else cb.onOutputTranscription?.(message, true);
        },

        onModeChange: ({ mode }: { mode: string }) => {
          const nowSpeaking = mode === 'speaking';
          cb.onModeChange?.(nowSpeaking ? 'speaking' : 'listening');
          // Speaking → listening is the reply having finished PLAYING, which
          // is strictly better than Gemini's turnComplete: that only meant the
          // model had stopped generating, so the screen had to fake this by
          // watching the audio queue drain.
          if (speaking && !nowSpeaking) cb.onTurnComplete?.();
          speaking = nowSpeaking;
        },

        onStatusChange: ({ status }: { status: string }) => {
          if (!alive) return;
          if (status === 'connecting' && sawConnected) {
            connected = false;
            cb.onReconnecting?.(1);
          } else if (status === 'connected' && sawConnected && !connected) {
            connected = true;
            cb.onReconnected?.();
          }
        },

        onVadScore: ({ vadScore }: { vadScore: number }) => cb.onVadScore?.(vadScore),
      })
        .then((c) => {
          clearTimeout(timer);
          resolve(c);
        })
        .catch((err: any) => {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new LiveOfflineError(String(err)));
        });
    });
  } catch (err: any) {
    alive = false;
    throw err instanceof Error ? err : new LiveOfflineError('Voice failed to start.');
  }

  // Prior turns, as a contextual update so it doesn't trigger a reply. Sent
  // after connect — before it, there is nothing to send it down.
  if (seed) {
    try { (conv as any).sendContextualUpdate(seed); } catch { /* best-effort */ }
  }

  const session: VoiceSession = {
    ownsMicrophone: true,
    ownsGreeting: true,

    // The SDK captures and plays audio on the WebRTC track. Kept so the
    // facade matches the Gemini path; calling it does nothing.
    sendMicChunk: () => {},

    sendUserText: (text: string) => {
      if (!alive) return;
      try { (conv as any).sendUserMessage(text); } catch { /* session died */ }
    },

    // Non-reply-triggering by design — the exact semantics the Gemini path was
    // approximating with turnComplete:false.
    sendContextNote: (text: string) => {
      if (!alive) return;
      try { (conv as any).sendContextualUpdate(text); } catch { /* noop */ }
    },

    // The agent's own turn detection decides when a turn ends. Muting is the
    // closest honest equivalent to "I've stopped talking".
    endUserTurn: () => {
      if (!alive) return;
      try { (conv as any).setMicMuted?.(true); } catch { /* noop */ }
    },

    setMicMuted: (muted: boolean) => {
      if (!alive) return;
      try { (conv as any).setMicMuted?.(muted); } catch { /* noop */ }
    },

    getInputVolume: () => {
      try { return (conv as any).getInputVolume?.() ?? 0; } catch { return 0; }
    },

    getConversationId: () => {
      try { return (conv as any).getId?.() ?? minted.conversationId; } catch { return minted.conversationId; }
    },

    close: () => {
      // Flip synchronously: the screen's teardown checks isOpen() straight
      // after calling this, and endSession is async.
      if (!alive) return;
      alive = false;
      connected = false;
      // Keep the teardown so the NEXT open can wait for the native audio
      // session to be released before claiming it.
      pendingTeardown = (async () => {
        try { await (conv as any).endSession(); } catch { /* already gone */ }
      })();
      finish();  // reports usage exactly once
    },

    isOpen: () => alive && connected,
  };

  return session;
}
