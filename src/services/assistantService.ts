// Mate client transport — Gemini Live over a direct WebSocket.
//
// Flow per user turn:
//   1. POST /assistantToken (Firebase Function) with a Firebase ID token.
//      The Function verifies, rate-limits, reserves a quota turn, and mints
//      a single-use ephemeral Gemini token bound to the Live model.
//   2. Open wss://… BidiGenerateContentConstrained with the token as the
//      access_token query param.
//   3. Send `setup` (system prompt + TEXT response modality), wait for
//      `setupComplete`.
//   4. Send `clientContent` with the conversation history + turnComplete.
//   5. Stream `serverContent.modelTurn.parts[].text` deltas back via
//      `onTextDelta`; resolve when `serverContent.turnComplete` arrives.
//
// Phase A is text-only and tool-less. Phase B adds tool declarations and the
// tool-call dispatcher; the API surface (`sendAssistantTurn`) stays stable.

import { Platform } from 'react-native';
import { auth } from '../config/firebase';
import { AssistantChatResponse, ChatMessage, Proposal } from '../types/assistant';
import { generateId } from '../utils/generateId';
import { MATE_SYSTEM_PROMPT } from './assistant/systemPrompt';
import { TOOL_DECLARATIONS } from './assistant/toolSchemas';
import { dispatchToolCall } from './assistant/toolDispatcher';

const USE_EMULATOR = process.env.USE_FIREBASE_EMULATOR === 'true';
const FIREBASE_FUNCTIONS_URL = USE_EMULATOR
  ? 'http://127.0.0.1:5001/hansendev/us-central1'
  : 'https://us-central1-hansendev.cloudfunctions.net';

const LIVE_WS_BASE =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained';

// One Live session per user turn. 60s is plenty for text-only — once audio
// lands a session can stretch much longer and this cap moves up.
const TURN_TIMEOUT_MS = 60_000;
const MAX_HISTORY_TURNS = 20;

export class AssistantQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssistantQuotaError';
  }
}

export class AssistantOfflineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssistantOfflineError';
  }
}

interface MintedToken {
  token: string;
  expiresAt: string;
  model: string;
}

async function mintToken(): Promise<MintedToken> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new AssistantOfflineError('Sign in to use Mate.');

  const url = `${FIREBASE_FUNCTIONS_URL}/assistantToken`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ platform: Platform.OS }),
    });
  } catch (err: any) {
    throw new AssistantOfflineError(err?.message || 'Network error.');
  }

  if (response.status === 402) {
    const data = await response.json().catch(() => ({}));
    throw new AssistantQuotaError(data.error || "You've hit today's Mate limit.");
  }
  if (response.status === 429) {
    throw new AssistantOfflineError('Whoa — too many requests. Wait a moment.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new AssistantOfflineError(data.error || `Mate is offline (${response.status}).`);
  }

  const data = (await response.json()) as MintedToken;
  if (!data?.token || !data?.model) {
    throw new AssistantOfflineError('Mate is offline (bad token response).');
  }
  return data;
}

interface SendTurnArgs {
  history: ChatMessage[]; // includes the just-appended user turn at the tail
  // Called with each text fragment as it arrives. Use this to stream the
  // assistant bubble; the resolved AssistantChatResponse still has the full
  // text for callers that don't care about deltas.
  onTextDelta?: (delta: string) => void;
}

export async function sendAssistantTurn({ history, onTextDelta }: SendTurnArgs): Promise<AssistantChatResponse> {
  const { token, model } = await mintToken();

  const turns = history.slice(-MAX_HISTORY_TURNS).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.text }],
  }));

  return new Promise<AssistantChatResponse>((resolve, reject) => {
    const url = `${LIVE_WS_BASE}?access_token=${encodeURIComponent(token)}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err: any) {
      reject(new AssistantOfflineError(err?.message || 'WebSocket init failed.'));
      return;
    }

    let textBuf = '';
    let setupAcked = false;
    let settled = false;
    const proposals: Proposal[] = [];

    const timeout = setTimeout(() => {
      if (settled) return;
      finish(textBuf ? undefined : new AssistantOfflineError('Mate timed out.'));
    }, TURN_TIMEOUT_MS);

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { ws.close(); } catch { /* noop */ }
      if (err) { reject(err); return; }
      resolve({
        messageId: generateId(),
        text: textBuf,
        proposals,
        usage: {
          inputTokens: 0,
          // outputTokens isn't reported per turn on Live the way it was on
          // Messages — char count is a useful proxy and the quota counter
          // already gated this turn at the token-mint step.
          outputTokens: textBuf.length,
          model,
          escalated: false,
        },
      });
    };

    ws.onopen = () => {
      const setup = {
        setup: {
          model: `models/${model}`,
          generationConfig: { responseModalities: ['TEXT'] },
          systemInstruction: { parts: [{ text: MATE_SYSTEM_PROMPT }] },
          tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        },
      };
      try {
        ws.send(JSON.stringify(setup));
      } catch (err: any) {
        finish(new AssistantOfflineError(err?.message || 'Setup send failed.'));
      }
    };

    ws.onmessage = async (event: WebSocketMessageEvent) => {
      let raw: string;
      const data: any = event.data;
      if (typeof data === 'string') {
        raw = data;
      } else if (data && typeof data.text === 'function') {
        // Blob (web)
        raw = await data.text();
      } else if (data instanceof ArrayBuffer) {
        raw = new TextDecoder().decode(data);
      } else {
        raw = String(data);
      }

      let msg: any;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      if (msg?.setupComplete && !setupAcked) {
        setupAcked = true;
        try {
          ws.send(JSON.stringify({ clientContent: { turns, turnComplete: true } }));
        } catch (err: any) {
          finish(new AssistantOfflineError(err?.message || 'Turn send failed.'));
        }
        return;
      }

      // Tool call from the model: dispatch every functionCall in this frame
      // concurrently, then send back a single toolResponse with all results.
      // Gemini expects the responses array to match the calls array in this
      // turn — partial responses can stall the session.
      const toolCalls = msg?.toolCall?.functionCalls;
      if (Array.isArray(toolCalls) && toolCalls.length) {
        try {
          const results = await Promise.all(
            toolCalls.map((call: any) =>
              dispatchToolCall({ name: String(call.name), id: String(call.id), args: call.args || {} }),
            ),
          );
          for (const r of results) {
            if (r.proposal) proposals.push(r.proposal);
          }
          const toolResponse = {
            toolResponse: {
              functionResponses: results.map((r) => ({
                name: r.name,
                id: r.id,
                response: r.response,
              })),
            },
          };
          ws.send(JSON.stringify(toolResponse));
        } catch (err: any) {
          // eslint-disable-next-line no-console
          console.warn('[Mate] tool dispatch failed', err?.message);
          finish(new AssistantOfflineError(err?.message || 'Tool dispatch failed.'));
        }
        return;
      }

      const parts = msg?.serverContent?.modelTurn?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (part && typeof part.text === 'string') {
            textBuf += part.text;
            onTextDelta?.(part.text);
          }
        }
      }

      if (msg?.serverContent?.turnComplete) {
        finish();
      }
    };

    ws.onerror = (event: any) => {
      // RN WebSocket onerror provides very little detail — keep the message
      // generic; the surrounding screen surfaces the user-facing reason.
      // eslint-disable-next-line no-console
      console.warn('[Mate] ws error', event?.message || event);
      finish(new AssistantOfflineError('Mate connection error.'));
    };

    ws.onclose = (event: WebSocketCloseEvent) => {
      if (settled) return;
      // If the server closed mid-turn, surface what little we got rather
      // than erroring — the user prefers a partial reply over nothing.
      finish(textBuf ? undefined : new AssistantOfflineError(`Mate connection closed (${event.code || 'unknown'}).`));
    };
  });
}
