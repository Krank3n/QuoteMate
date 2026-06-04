// Mate client transport — text chat over Gemini generateContent.
//
// The voice path runs on the Live WebSocket + a native-audio model
// (gemini-3.1-flash-live-preview), which only emits AUDIO. Text needs a model
// that emits TEXT, so it uses a separate transport: a thin Firebase proxy
// (assistantChat) in front of a text-capable flash model, with the master key
// kept server-side.
//
// Mate's tools run here on the client (they read the local store), so each user
// turn is a function-calling loop:
//   1. POST the conversation → /assistantChat. The reply is the model turn's
//      parts (text and/or functionCall).
//   2. Any text parts stream into the bubble via onTextDelta.
//   3. functionCall parts are dispatched locally; we echo the model turn back
//      verbatim (preserving each part's thoughtSignature so the thinking model
//      keeps its reasoning context) plus the tool results, then POST again.
//   4. Repeat until the model returns a turn with no functionCall.
//
// Only the first POST of a turn sets countTurn, so quota charges once per user
// turn regardless of how many tool hops it takes — matching the voice token mint.

import { auth } from '../config/firebase';
import { AssistantChatResponse, ChatMessage, Proposal } from '../types/assistant';
import { generateId } from '../utils/generateId';
import { MATE_SYSTEM_PROMPT } from './assistant/systemPrompt';
import { TOOL_DECLARATIONS } from './assistant/toolSchemas';
import { dispatchToolCall } from './assistant/toolDispatcher';
import {
  FIREBASE_FUNCTIONS_URL,
  MAX_HISTORY_TURNS,
  LiveAuthError,
  LiveOfflineError,
  LiveQuotaError,
} from './assistant/liveSession';

// Hard cap on tool round-trips per turn — a model that keeps calling tools
// can't spin forever. Real turns settle in 1-3 hops.
const MAX_TOOL_HOPS = 8;

interface GeminiFunctionCall {
  name: string;
  args?: any;
  id?: string;
}
interface GeminiPart {
  text?: string;
  functionCall?: GeminiFunctionCall;
  [k: string]: unknown;
}

interface SendTurnArgs {
  history: ChatMessage[]; // includes the just-appended user turn at the tail
  // Called with each text fragment as it arrives. Use this to stream the
  // assistant bubble; the resolved AssistantChatResponse still has the full
  // text for callers that don't care about deltas.
  onTextDelta?: (delta: string) => void;
}

// functionResponse.response must be a JSON object (a protobuf Struct). Read
// tools already return objects, but guard primitives/arrays just in case.
function asStruct(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { result: value };
}

async function callChat(
  contents: unknown[],
  countTurn: boolean,
): Promise<{ parts: GeminiPart[]; model: string }> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new LiveAuthError('Sign in to use Mate.');

  let response: Response;
  try {
    response = await fetch(`${FIREBASE_FUNCTIONS_URL}/assistantChat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: MATE_SYSTEM_PROMPT }] },
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        countTurn,
      }),
    });
  } catch (err: any) {
    throw new LiveOfflineError(err?.message || 'Network error.');
  }

  if (response.status === 402) {
    const data = await response.json().catch(() => ({}));
    throw new LiveQuotaError(data.error || "You've hit today's Mate limit.");
  }
  if (response.status === 429) {
    throw new LiveOfflineError('Whoa — too many requests. Wait a moment.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new LiveOfflineError(data.error || `Mate is offline (${response.status}).`);
  }

  const data = await response.json();
  if (!Array.isArray(data?.parts)) {
    throw new LiveOfflineError('Mate is offline (bad response).');
  }
  return { parts: data.parts as GeminiPart[], model: String(data.model || 'gemini') };
}

export async function sendAssistantTurn({ history, onTextDelta }: SendTurnArgs): Promise<AssistantChatResponse> {
  // Seed the conversation. Drop empty-text messages (inline quote cards, error
  // bubbles) — Gemini rejects a part whose text is empty.
  const contents: unknown[] = history
    .slice(-MAX_HISTORY_TURNS)
    .filter((m) => m.text?.trim())
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.text }],
    }));

  const proposals: Proposal[] = [];
  // Document ids the model asked to show on screen via show_quote. The chat
  // screen renders each inline once the turn resolves.
  const showQuoteIds: string[] = [];
  let textBuf = '';
  let model = 'gemini';

  for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
    const res = await callChat(contents, hop === 0);
    model = res.model;
    const parts = res.parts;

    // A turn can carry a text preamble alongside its tool calls — surface it.
    for (const part of parts) {
      if (typeof part.text === 'string' && part.text) {
        textBuf += part.text;
        onTextDelta?.(part.text);
      }
    }

    const calls = parts.filter((p): p is GeminiPart & { functionCall: GeminiFunctionCall } => !!p.functionCall);
    if (!calls.length) break; // plain text turn — the reply is complete.

    // Echo the model turn verbatim (keeps thoughtSignature) before the results.
    contents.push({ role: 'model', parts });

    // Dispatch every functionCall in this turn concurrently, then send one
    // user turn carrying all the responses — Gemini expects the responses to
    // match the calls from the immediately preceding model turn.
    const results = await Promise.all(
      calls.map((p) =>
        dispatchToolCall({
          name: String(p.functionCall.name),
          id: String(p.functionCall.id || p.functionCall.name),
          args: p.functionCall.args || {},
        }),
      ),
    );
    for (const r of results) {
      if (r.proposal) proposals.push(r.proposal);
      if (r.view?.kind === 'show_quote') showQuoteIds.push(r.view.quoteId);
    }

    contents.push({
      role: 'user',
      parts: results.map((r) => ({
        functionResponse: { name: r.name, response: asStruct(r.response) },
      })),
    });
  }

  return {
    messageId: generateId(),
    text: textBuf,
    proposals,
    showQuoteIds,
    usage: {
      inputTokens: 0,
      // generateContent reports token counts in usageMetadata, but the quota
      // counter already gated this turn at the proxy — char count is a fine
      // proxy for the per-message display.
      outputTokens: textBuf.length,
      model,
      escalated: false,
    },
  };
}
