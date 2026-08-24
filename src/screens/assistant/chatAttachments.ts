// Chat attachments <-> quote photos — pure decisions, no store, no IO.
//
// Known edge case: photos attached while talking about job A, followed by an
// unrelated job B drafted in the SAME chat, would see job B inherit them.
// Mitigated two ways — an attachment is stamped consumed the moment a draft
// carries it, and newChat wipes the array entirely. Deliberately not solved by
// asking Mate to tag photos to a job: the model can't be trusted with the
// claim, and getting it wrong puts someone else's site photo on a quote.

import { ATTACHMENT_LIMITS } from '../../services/assistant/attachmentParts';
import type { ChatAttachment, ChatMessage } from '../../types/assistant';
import type { QuotePhoto } from '../../types';

export const ATTACH_LIMIT_COPY = {
  perMessage: "Two photos at a time — send these first and I'll take the next lot.",
  perChat: "That's five photos this chat — plenty to go on. Start a new chat if you've got more.",
  oversize:
    "That one's too big to send. Try a photo of the section you want me to look at instead of the whole sheet.",
  pdf:
    "Can't read a PDF in here — add it on the quote's Job Photos and I'll pick it up from there, or send a screenshot of the page you want me to look at.",
} as const;

export type AttachBlockReason = 'per_message' | 'per_chat';

/** A hi-res plan is roughly two site photos' worth of pixels — charge it as two. */
function slotCost(a: { isPlan?: boolean }): number {
  return a.isPlan ? 2 : 1;
}

/**
 * Whether one more photo fits: the pending tray is capped per message, the
 * whole conversation is capped so a long chat can't quietly build a 20MB
 * request.
 */
export function canAttachMore(args: {
  pending: Array<Pick<ChatAttachment, 'isPlan'>>;
  messages: ChatMessage[];
  isPlan?: boolean;
}): { ok: true } | { ok: false; reason: AttachBlockReason; message: string } {
  const pendingSlots = args.pending.reduce((n, a) => n + slotCost(a), 0);
  if (pendingSlots + slotCost({ isPlan: args.isPlan }) > ATTACHMENT_LIMITS.maxPerTurn) {
    return { ok: false, reason: 'per_message', message: ATTACH_LIMIT_COPY.perMessage };
  }
  // A failed upload never reached Mate, so it must not burn a chat slot —
  // two dropouts on a bad site connection would otherwise cost the tradie
  // the rest of their photos. Plans cost the same two slots here as above.
  const sent = args.messages.reduce(
    (n, m) => n + (m.attachments ?? []).filter((a) => a.status !== 'failed').reduce((s, a) => s + slotCost(a), 0),
    0,
  );
  if (sent + pendingSlots + slotCost({ isPlan: args.isPlan }) > ATTACHMENT_LIMITS.maxPerChat) {
    return { ok: false, reason: 'per_chat', message: ATTACH_LIMIT_COPY.perChat };
  }
  return { ok: true };
}

/** True when this attachment is still free to ride onto a quote. */
function isCarryable(a: ChatAttachment): boolean {
  return (
    a.status === 'ready' &&
    !!a.storageUrl &&
    !a.consumedByQuoteId &&
    a.consumedBy !== 'supplier_import'
  );
}

/**
 * The photos a freshly drafted quote should be seeded with. Storage URLs only —
 * materialsPipeline reads photos[].storageUrl on its first analyse pass, so a
 * local uri here would be invisible to it.
 */
export function collectQuotePhotos(messages: ChatMessage[]): QuotePhoto[] {
  const out: QuotePhoto[] = [];
  const seen = new Set<string>();
  for (const m of messages) {
    for (const a of m.attachments || []) {
      if (!isCarryable(a) || seen.has(a.id)) continue;
      seen.add(a.id);
      out.push({
        id: a.id,
        storageUrl: a.storageUrl!,
        annotated: false,
        ...(a.isPlan ? { isPlan: true } : {}),
      });
      if (out.length >= ATTACHMENT_LIMITS.maxPerChat) return out;
    }
  }
  return out;
}

/**
 * The newest photo nobody has spent yet. Mate never names an attachment id —
 * it only says "the one they just sent", and this is what that means.
 */
export function mostRecentUnconsumedAttachment(messages: ChatMessage[]): ChatAttachment | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const attachments = messages[i].attachments;
    if (!attachments?.length) continue;
    for (let j = attachments.length - 1; j >= 0; j--) {
      const a = attachments[j];
      if (a.status === 'ready' && !a.consumedByQuoteId && !a.consumedBy) return a;
    }
  }
  return null;
}

/** Claim one attachment for a purpose, so nothing else picks it up. */
export function markAttachmentConsumedBy(
  messages: ChatMessage[],
  attachmentId: string,
  consumedBy: NonNullable<ChatAttachment['consumedBy']>,
): Array<{ messageId: string; attachments: ChatAttachment[] }> {
  const patches: Array<{ messageId: string; attachments: ChatAttachment[] }> = [];
  for (const m of messages) {
    if (!m.attachments?.some((a) => a.id === attachmentId)) continue;
    patches.push({
      messageId: m.id,
      attachments: m.attachments.map((a) => (a.id === attachmentId ? { ...a, consumedBy } : a)),
    });
  }
  return patches;
}

/**
 * Patches stamping the attachments a draft actually carried, so a second draft
 * in the same chat can't inherit the first job's photos. Returns one entry per
 * message that changed.
 *
 * Pass `carriedIds` whenever the photos were collected before an await — the
 * pipeline runs for 20-40 s and a photo that finished uploading in that window
 * must not be swept up as though the draft had it.
 */
export function markAttachmentsConsumed(
  messages: ChatMessage[],
  quoteId: string,
  carriedIds?: Iterable<string>,
): Array<{ messageId: string; attachments: ChatAttachment[] }> {
  const carried = carriedIds
    ? new Set(carriedIds)
    : new Set(collectQuotePhotos(messages).map((p) => p.id));
  const patches: Array<{ messageId: string; attachments: ChatAttachment[] }> = [];
  for (const m of messages) {
    if (!m.attachments?.length) continue;
    if (!m.attachments.some((a) => carried.has(a.id))) continue;
    patches.push({
      messageId: m.id,
      attachments: m.attachments.map((a) =>
        carried.has(a.id) ? { ...a, consumedByQuoteId: quoteId, consumedBy: 'job_photo' as const } : a,
      ),
    });
  }
  return patches;
}
