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

import { Conversation } from '@elevenlabs/client';
import { ChatMessage } from '../../types/assistant';
import { ensureElevenLabsRuntime } from './elevenLabsRuntime';
import { ensureMicPermission } from './micPermission';
import { buildClientTools } from './clientTools';
import { buildSeedContext } from './seedContext';
import { mateGreetingWord } from '../../screens/assistant/voiceCopy';
import { ElevenLabsMintedToken, LiveOfflineError } from './liveSession';
import type { VoiceSession, VoiceSessionCallbacks, VoiceSessionOptions } from './voiceSession';

/** How long to wait for onConnect before calling the open a failure. */
export const EL_CONNECT_TIMEOUT_MS = 20_000;

type Conv = Awaited<ReturnType<typeof Conversation.startSession>>;

export async function openElevenLabsVoiceSession(
  minted: ElevenLabsMintedToken,
  history: ChatMessage[],
  cb: VoiceSessionCallbacks,
  _opts: VoiceSessionOptions = {},
): Promise<VoiceSession> {
  // Registers LiveKit's WebRTC globals and the RN setup strategy. Dynamic, so
  // a tradie who never opens voice never pays for it.
  await ensureElevenLabsRuntime();
  // LiveKit does NOT request runtime permissions of its own. Without this,
  // Android fails with something that looks nothing like "no mic permission".
  await ensureMicPermission();

  let alive = true;
  let connected = false;
  let closedOnce = false;
  let speaking = false;
  let sawConnected = false;

  // Fires onClose exactly once, with onError riding along only on a real
  // failure — same contract the Gemini path guarantees.
  const finish = (err?: Error) => {
    if (closedOnce) return;
    closedOnce = true;
    alive = false;
    connected = false;
    if (err) cb.onError?.(err);
    cb.onClose?.(undefined);
  };

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

        onConnect: () => {
          clearTimeout(timer);
          connected = true;
          sawConnected = true;
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
  const seed = buildSeedContext(history);
  if (seed) {
    try { (conv as any).sendContextualUpdate(seed); } catch { /* best-effort */ }
  }

  const session: VoiceSession = {
    ownsMicrophone: true,

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
      try { void (conv as any).endSession(); } catch { /* noop */ }
      finish();
    },

    isOpen: () => alive && connected,
  };

  return session;
}
