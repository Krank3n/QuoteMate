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
import { AssistantChatResponse, ChatAttachment, ChatMessage, Proposal } from '../types/assistant';
import { generateId } from '../utils/generateId';
import {
  ATTACHMENT_LIMITS,
  InlineBytes,
  buildAttachmentParts,
  buildMessageParts,
  inlineAttachmentIds,
} from './assistant/attachmentParts';
import { resolveInlineBytes } from './assistant/attachmentBytes';
import { MATE_SYSTEM_PROMPT } from './assistant/systemPrompt';
import { TOOL_DECLARATIONS } from './assistant/toolSchemas';
import { dispatchToolCall } from './assistant/toolDispatcher';
import {
  CHAT_TIMEOUT_MS,
  FIREBASE_FUNCTIONS_URL,
  MAX_HISTORY_TURNS,
  LiveAuthError,
  LiveOfflineError,
  LiveQuotaError,
  LiveRateLimitError,
  fetchWithTimeout,
} from './assistant/liveSession';

// Hard cap on tool round-trips per turn — a model that keeps calling tools
// can't spin forever. Real turns settle in 1-3 hops.
const MAX_TOOL_HOPS = 8;

// One automatic retry on transient transport failures (network drop, timeout,
// 502/503/504) before surfacing an error bubble — a single blip on site
// shouldn't cost the tradie their typed message. 4xx (quota, rate limit, bad
// request) never retries. Known trade-off: if the first attempt reached the
// server but the response was lost, the retry can reserve a second quota
// turn; bounded at one, and server-side refund-on-failure is tracked
// separately.
const TRANSIENT_STATUSES = new Set([502, 503, 504]);
const CHAT_RETRY_DELAY_MS = 800;

async function postChatWithRetry(idToken: string, body: string): Promise<Response> {
  let lastErr: any;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, CHAT_RETRY_DELAY_MS));
    try {
      const response = await fetchWithTimeout(`${FIREBASE_FUNCTIONS_URL}/assistantChat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body,
      }, CHAT_TIMEOUT_MS);
      if (TRANSIENT_STATUSES.has(response.status) && attempt === 0) continue;
      return response;
    } catch (err: any) {
      lastErr = err;
    }
  }
  if (lastErr instanceof LiveOfflineError) throw lastErr;
  throw new LiveOfflineError(lastErr?.message || 'Network error.');
}

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
  // Seam for tests: the default reads bytes through expo-file-system, which
  // can't load under vitest.
  resolveAttachment?: (a: ChatAttachment) => Promise<InlineBytes | null>;
}

// Function-calling models occasionally *write* a tool call instead of emitting
// one — the reply comes back as a fenced JSON blob of the arguments with no
// functionCall part. It reached at least one tradie as a chat bubble reading
// ```json { "query": "Hansen" } ```, which is gibberish to them. There's no
// tool name in the blob so it can't be re-dispatched; drop it rather than
// render it. Only strips when the WHOLE reply is that blob — a JSON snippet
// alongside real prose is left alone.
export function stripLeakedToolJson(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return text;
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  if (!candidate.startsWith('{') || !candidate.endsWith('}')) return text;
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return '';
  } catch {
    // Not valid JSON — it's prose that happens to start with a brace.
  }
  return text;
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

  const response = await postChatWithRetry(idToken, JSON.stringify({
    contents,
    systemInstruction: { parts: [{ text: MATE_SYSTEM_PROMPT }] },
    tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
    countTurn,
  }));

  if (response.status === 402) {
    const data = await response.json().catch(() => ({}));
    throw new LiveQuotaError(data.error || "You've hit today's Mate limit.");
  }
  // Subclass of LiveOfflineError, so generic offline handlers still surface
  // the message while rate-limit-aware callers (voice reconnect loop) can
  // single it out and stop retrying into the limit.
  if (response.status === 429) {
    throw new LiveRateLimitError('Whoa — too many requests. Wait a moment.');
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

export async function sendAssistantTurn({
  history,
  onTextDelta,
  resolveAttachment = resolveInlineBytes,
}: SendTurnArgs): Promise<AssistantChatResponse> {
  // Seed the conversation. Drop empty-text messages (inline quote cards, error
  // bubbles) — Gemini rejects a part whose text is empty — unless they carry
  // photos. Hidden "[context]" notes DO carry text and are deliberately kept:
  // they're how the model learns what an Apply actually did.
  //
  // Consecutive same-role turns get merged into one. A hidden note is written
  // as a user turn, so an apply-failed note immediately followed by the
  // tradie's next message would otherwise send two user turns back to back.
  const window = history.slice(-MAX_HISTORY_TURNS);
  // Photo bytes ride only on the turn they were attached — see attachmentParts.
  const inlineIds = inlineAttachmentIds(window);
  let remainingChars = ATTACHMENT_LIMITS.maxBase64CharsTotal;
  let remainingSlots = ATTACHMENT_LIMITS.maxPerTurn;

  const contents: unknown[] = [];
  for (const m of window) {
    const atts = m.attachments || [];
    if (!m.text?.trim() && atts.length === 0) continue;

    // A failed upload never reached Mate and never will — leave it out of both
    // counts, or the model is told about a photo that does not exist.
    const carried = atts.filter((a) => a.status !== 'failed');
    const candidates = carried.filter((a) => inlineIds.has(a.id));
    const resolved = await Promise.all(
      candidates.map(async (a) => ({
        id: a.id,
        isPlan: a.isPlan,
        bytes: await resolveAttachment(a),
      })),
    );
    // Slots are threaded like chars: the trailing run can span several user
    // messages (a hidden [context] note splits one), and a per-message reset
    // would let 2 photos through per message instead of 2 per request.
    const built = buildAttachmentParts(resolved, { remainingChars, remainingSlots });
    remainingChars -= built.usedChars;
    remainingSlots -= built.usedSlots;
    // Two different failures, two different sentences: photos from an older
    // turn the model has already described, versus photos on THIS turn whose
    // bytes didn't make it (too big, unreadable, budget spent).
    const attachedEarlier = carried.length - candidates.length;
    const unreadable = candidates.length - built.parts.length;
    const parts = buildMessageParts(m, built.parts, attachedEarlier, unreadable);
    if (!parts.length) continue;

    const role = m.role === 'assistant' ? 'model' : 'user';
    const prev = contents[contents.length - 1] as { role: string; parts: unknown[] } | undefined;
    if (prev?.role === role) {
      prev.parts.push(...parts);
      continue;
    }
    contents.push({ role, parts });
  }

  // Everything in the window was skippable (a caption-less bubble whose only
  // photo failed to upload). Posting an empty contents array gets a raw
  // "contents required." 400 rendered straight into the chat.
  if (!contents.length) {
    throw new LiveOfflineError("That didn't come through — give me a line to go on.");
  }

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

  const text = stripLeakedToolJson(textBuf);

  return {
    messageId: generateId(),
    text,
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
