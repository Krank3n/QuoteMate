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
// The text path (`sendAssistantTurn`) is unchanged and intentionally
// stays single-shot — burning a token mint per text turn is cheap and
// the simpler lifecycle keeps that path easy to debug.

import { ChatMessage, Proposal } from '../../types/assistant';
import { MATE_SYSTEM_PROMPT } from './systemPrompt';
import { TOOL_DECLARATIONS, CONTROL_TOOL_DECLARATIONS, isControlTool } from './toolSchemas';
import { dispatchToolCall } from './toolDispatcher';
import { LIVE_WS_BASE, MAX_HISTORY_TURNS, LiveOfflineError, mintLiveToken } from './liveSession';

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
  /** Fatal error; the session is closed. */
  onError?: (err: Error) => void;
  /** The server closed the connection (graceful or otherwise). */
  onClose?: (code: number | undefined) => void;
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
  /** True until close() runs or the server closes. */
  isOpen: () => boolean;
}

export async function openVoiceSession(
  history: ChatMessage[],
  cb: VoiceSessionCallbacks,
): Promise<VoiceSession> {
  const { token, model } = await mintLiveToken('voice');

  return new Promise<VoiceSession>((resolve, reject) => {
    const url = `${LIVE_WS_BASE}?access_token=${encodeURIComponent(token)}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err: any) {
      reject(new LiveOfflineError(err?.message || 'WebSocket init failed.'));
      return;
    }

    let open = true;
    let setupAcked = false;
    const pendingChunks: string[] = [];
    let resolved = false;

    const safeSend = (frame: any) => {
      if (!open) return;
      try {
        ws.send(JSON.stringify(frame));
      } catch (err: any) {
        cb.onError?.(new LiveOfflineError(err?.message || 'Send failed.'));
      }
    };

    const closeSession = (code?: number) => {
      if (!open) return;
      open = false;
      try { ws.close(); } catch { /* noop */ }
      cb.onClose?.(code);
    };

    const session: VoiceSession = {
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
      sendUserText: (text) => {
        if (!open || !text.trim()) return;
        safeSend({
          clientContent: {
            turns: [{ role: 'user', parts: [{ text }] }],
            turnComplete: true,
          },
        });
      },
      sendContextNote: (text) => {
        if (!open || !text.trim()) return;
        safeSend({
          clientContent: {
            turns: [{ role: 'user', parts: [{ text }] }],
            turnComplete: false,
          },
        });
      },
      endUserTurn: () => {
        if (!open) return;
        safeSend({ realtimeInput: { audioStreamEnd: true } });
      },
      close: () => closeSession(),
      isOpen: () => open,
    };

    ws.onopen = () => {
      // Seed the session with prior conversation history as system turns
      // so Mate picks up where the chat left off.
      const seedTurns = history
        .slice(-MAX_HISTORY_TURNS)
        .filter((m) => m.text?.trim())
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.text }],
        }));

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

      if (msg?.setupComplete && !setupAcked) {
        setupAcked = true;
        // Flush any mic chunks captured before setupComplete arrived.
        for (const chunk of pendingChunks) {
          safeSend({
            realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: chunk } },
          });
        }
        pendingChunks.length = 0;
        if (!resolved) {
          resolved = true;
          resolve(session);
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
      cb.onError?.(new LiveOfflineError('Voice connection error.'));
      if (!resolved) {
        resolved = true;
        reject(new LiveOfflineError('Voice connection error.'));
      }
    };

    ws.onclose = (event: any) => {
      const wasOpen = open;
      open = false;
      cb.onClose?.(event?.code);
      if (!resolved && wasOpen) {
        resolved = true;
        reject(new LiveOfflineError(`Voice connection closed (${event?.code || 'unknown'}).`));
      }
    };
  });
}
