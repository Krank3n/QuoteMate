// Turning chat attachments into Gemini request parts — pure, no IO.
//
// Bytes ride ONCE, on the turn they were attached. The tool loop already
// re-POSTs the whole `contents` array up to MAX_TOOL_HOPS times per turn, so
// replaying an image across the 20-message history window would multiply that
// again for a photo the model has already described in text. Older turns carry
// a short "attached earlier" marker instead, so Mate never denies seeing one.

import type { ChatMessage } from '../../types/assistant';

export const ATTACHMENT_LIMITS = {
  /** Photos inlined per message. A hi-res plan counts double. */
  maxPerTurn: 2,
  /** Photos the tradie can attach across one conversation. */
  maxPerChat: 5,
  /** ~2.1 MB of image once decoded — past this the 1st-gen request cap bites. */
  maxBase64CharsEach: 2_800_000,
  /** Whole-request ceiling, shared across every message in the window. */
  maxBase64CharsTotal: 5_600_000,
} as const;

export interface InlineBytes {
  mimeType: string;
  data: string;
}

/** An attachment with its bytes already resolved (null = unreadable). */
export interface ResolvedAttachment {
  id: string;
  isPlan?: boolean;
  bytes: InlineBytes | null;
}

export interface AttachmentBudget {
  /** Slots left on this message. Defaults to maxPerTurn. */
  remainingSlots?: number;
  /** Base64 chars left for the whole request. Defaults to maxBase64CharsTotal. */
  remainingChars?: number;
}

export type SkipReason = 'unreadable' | 'too_big' | 'per_turn_limit' | 'budget_spent';

/**
 * Ids of the attachments whose bytes belong on THIS request: the trailing run
 * of user messages only. Anything the assistant has already replied to is
 * history — the model described it in text and doesn't need the pixels again.
 */
export function inlineAttachmentIds(history: ChatMessage[]): Set<string> {
  const ids = new Set<string>();
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role === 'user') {
      for (const a of m.attachments || []) ids.add(a.id);
      continue;
    }
    // An assistant bubble that never carried a reply — an error placeholder, a
    // working card, an inline quote — is UI, not a turn the model took. It
    // can't have seen the photo, so keep walking back. Without this, a turn
    // that failed (no signal on site, the headline case for photos) leaves the
    // retry claiming a photo the model never received.
    if (!m.text?.trim() && !m.proposals?.length) continue;
    break;
  }
  return ids;
}

/**
 * Build the inlineData parts for one message, spending the per-message slot
 * allowance and the shared request byte budget. Anything that doesn't fit is
 * reported in `skipped` so the caller can count it into the "attached earlier"
 * marker instead of silently losing it.
 */
export function buildAttachmentParts(
  items: ResolvedAttachment[],
  budget: AttachmentBudget = {},
): {
  parts: Array<{ inlineData: InlineBytes }>;
  skipped: Array<{ id: string; reason: SkipReason }>;
  usedChars: number;
} {
  let slots = budget.remainingSlots ?? ATTACHMENT_LIMITS.maxPerTurn;
  let chars = budget.remainingChars ?? ATTACHMENT_LIMITS.maxBase64CharsTotal;
  const parts: Array<{ inlineData: InlineBytes }> = [];
  const skipped: Array<{ id: string; reason: SkipReason }> = [];
  let usedChars = 0;

  for (const item of items) {
    if (!item.bytes) {
      skipped.push({ id: item.id, reason: 'unreadable' });
      continue;
    }
    const size = item.bytes.data.length;
    if (size > ATTACHMENT_LIMITS.maxBase64CharsEach) {
      skipped.push({ id: item.id, reason: 'too_big' });
      continue;
    }
    // A plan is captured at PLAN_MAX_WIDTH, so it costs roughly what two site
    // photos cost — charge it accordingly rather than letting two plans
    // through on the same turn.
    const cost = item.isPlan ? 2 : 1;
    if (cost > slots) {
      skipped.push({ id: item.id, reason: 'per_turn_limit' });
      continue;
    }
    if (size > chars) {
      skipped.push({ id: item.id, reason: 'budget_spent' });
      continue;
    }
    slots -= cost;
    chars -= size;
    usedChars += size;
    parts.push({ inlineData: item.bytes });
  }

  return { parts, skipped, usedChars };
}

/**
 * Assemble one message's parts. Images lead so the model reads the picture
 * before the caption that talks about it. Returns [] when there is nothing to
 * send — Gemini rejects a part whose text is empty.
 *
 * The two markers are deliberately different sentences. "Attached earlier"
 * means the model DID see it, on a previous turn, and must not deny it.
 * "Couldn't be read" means the bytes never made it and the model must say so —
 * conflating the two is how Mate ends up confidently describing a photo it has
 * never seen.
 */
export function buildMessageParts(
  message: ChatMessage,
  inline: Array<{ inlineData: InlineBytes }>,
  droppedCount: number,
  unreadableCount = 0,
): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [...inline];
  const text = message.text?.trim() ? message.text : '';
  if (text) parts.push({ text });
  if (droppedCount > 0) {
    parts.push({
      text: `[${droppedCount} photo(s) attached to this message earlier in the chat]`,
    });
  }
  if (unreadableCount > 0) {
    parts.push({
      text: `[${unreadableCount} photo(s) on this message could not be read — you have NOT seen them. Say the photo didn't come through and ask for a closer shot of the bit that matters.]`,
    });
  }
  return parts;
}
