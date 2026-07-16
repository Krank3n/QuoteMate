/**
 * Follow-up nudge — the dashboard's "what should I chase today?" banner.
 *
 * The quick stats report that money is waiting ("Awaiting response") but
 * nothing on the home screen prompts action on it. This picks the single
 * highest-priority item worth chasing:
 *
 *   1. invoice_overdue  — an unpaid invoice past its due date. Real money.
 *   2. self_sent_quote  — a "sent" quote whose recipient is the tradie's
 *                         own email. Trial users often email a quote to
 *                         themselves to see how it looks and never send it
 *                         to the actual customer — the quote then sits in
 *                         "Awaiting response" forever. The nudge is "send
 *                         it to your customer", not "follow up".
 *   3. unsent_quote     — a finished draft (reached the preview step) that
 *                         never went to anyone. The Jul 2026 send-behaviour
 *                         audit found this is the single biggest stall
 *                         bucket (35 of 83 never-senders parked at
 *                         JobPreview) — and no user who never sent to a
 *                         real customer has ever converted to paid.
 *   4. quote_follow_up  — a genuinely sent quote with no response for a
 *                         while. Quotes die from silence, not rejection.
 *
 * One nudge at a time. Dismissing snoozes that item (the caller persists
 * the snooze map); it must nag gently, not constantly.
 */

import type { Quote, Invoice } from '../types';

export type NudgeType = 'invoice_overdue' | 'self_sent_quote' | 'unsent_quote' | 'quote_follow_up';

export interface FollowUpNudge {
  type: NudgeType;
  /** Snooze identity — stable across renders: `${type}:${docId}`. */
  key: string;
  docId: string;
  jobId?: string;
  jobName?: string;
  customerName?: string;
  /** Days past due (invoice), since send (sent quotes), or since last edit (unsent). */
  days: number;
  /** unsent_quote only: a test send already went to the tradie's own inbox. */
  testSent?: boolean;
}

/** Don't suggest following a quote up until it's had a fair chance. */
export const QUOTE_FOLLOW_UP_MIN_DAYS = 4;
/** Give a self-send a day's grace — they may be about to send it on. */
export const SELF_SEND_MIN_MS = 24 * 60 * 60 * 1000;
/** A finished-but-unsent quote gets the same day of grace. */
export const UNSENT_QUOTE_MIN_MS = 24 * 60 * 60 * 1000;
/** How long a dismissed nudge stays hidden. */
export const NUDGE_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeEmail(e: string | undefined | null): string {
  return (e || '').trim().toLowerCase();
}

/**
 * Timestamps reach this util in whatever shape the storage layer left
 * them: epoch-ms (client writes), Date (deserialized), Firestore
 * Timestamp ({toMillis}), a JSON-round-tripped Timestamp
 * ({seconds, nanoseconds} — zustand-persisted docs), or an ISO string.
 * A shape we don't recognise returns null and the doc just isn't nudged.
 */
export function toMs(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof (v as any).toMillis === 'function') {
    const t = (v as any).toMillis();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof (v as any).seconds === 'number') {
    return (v as any).seconds * 1000;
  }
  if (typeof v === 'string') {
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function isSnoozed(key: string, snoozed: Record<string, number>, now: number): boolean {
  const until = snoozed[key];
  return typeof until === 'number' && until > now;
}

interface PickInput {
  quotes: Quote[];
  invoices: Invoice[];
  /** The tradie's own addresses (account email, business email). */
  ownEmails: Array<string | undefined | null>;
  /** nudge key → snoozed-until epoch-ms. */
  snoozed?: Record<string, number>;
  now?: number;
}

export function pickFollowUpNudge({
  quotes,
  invoices,
  ownEmails,
  snoozed = {},
  now = Date.now(),
}: PickInput): FollowUpNudge | null {
  const own = new Set(ownEmails.map(normalizeEmail).filter(Boolean));

  // --- 1. Overdue invoices — most-overdue first. -------------------------
  // (A self-sent invoice is still surfaced here: overdue is overdue, and
  // the fix — get it in front of the customer — starts at the same job.)
  const overdue = invoices
    .filter((inv) => inv.status === 'sent' || inv.status === 'partial' || inv.status === 'overdue')
    .map((inv) => ({ inv, due: toMs(inv.dueDate) }))
    .filter((x): x is { inv: Invoice; due: number } => x.due !== null && x.due < now)
    .sort((a, b) => a.due - b.due);
  for (const { inv, due } of overdue) {
    const key = `invoice_overdue:${inv.id}`;
    if (isSnoozed(key, snoozed, now)) continue;
    return {
      type: 'invoice_overdue',
      key,
      docId: inv.id,
      jobId: inv.jobId,
      jobName: inv.job?.name,
      customerName: inv.customerName,
      days: Math.floor((now - due) / DAY_MS),
    };
  }

  // sentAt reaches us as a serverTimestamp echo or an epoch number
  // depending on which path wrote it — toMs handles every shape. Legacy
  // sent quotes with no sentAt at all are skipped (no false nudges).
  const sentQuotes = quotes
    .filter((q) => q.status === 'sent')
    .map((q) => ({ q, sentMs: toMs(q.sentAt) }))
    .filter((x): x is { q: Quote; sentMs: number } => x.sentMs !== null && x.sentMs <= now)
    .sort((a, b) => a.sentMs - b.sentMs); // oldest first

  // --- 2. Self-sent quotes — the customer never saw this one. ------------
  if (own.size > 0) {
    for (const { q, sentMs } of sentQuotes) {
      if (!own.has(normalizeEmail(q.customerEmail))) continue;
      if (now - sentMs < SELF_SEND_MIN_MS) continue;
      const key = `self_sent_quote:${q.id}`;
      if (isSnoozed(key, snoozed, now)) continue;
      return {
        type: 'self_sent_quote',
        key,
        docId: q.id,
        jobId: q.jobId,
        jobName: q.job?.name,
        customerName: q.customerName,
        days: Math.floor((now - sentMs) / DAY_MS),
      };
    }
  }

  // --- 3. Finished drafts never sent to anyone — newest first (the -------
  // newest is the one they still remember; snooze surfaces older ones).
  // The dashboard's draft banner owns drafts fresher than its own window;
  // the caller only renders a nudge when that banner is hidden.
  const unsent = quotes
    .filter((q) => q.status === 'draft' && q.draftStep === 'JobPreview')
    .map((q) => ({ q, edited: toMs(q.updatedAt) }))
    .filter((x): x is { q: Quote; edited: number } => x.edited !== null && now - x.edited >= UNSENT_QUOTE_MIN_MS)
    .sort((a, b) => b.edited - a.edited);
  for (const { q, edited } of unsent) {
    const key = `unsent_quote:${q.id}`;
    if (isSnoozed(key, snoozed, now)) continue;
    return {
      type: 'unsent_quote',
      key,
      docId: q.id,
      jobId: q.jobId,
      jobName: q.job?.name,
      customerName: q.customerName,
      days: Math.floor((now - edited) / DAY_MS),
      testSent: !!q.acceptanceTokenCreatedAt,
    };
  }

  // --- 4. Aging sent quotes — oldest unanswered first. -------------------
  for (const { q, sentMs } of sentQuotes) {
    if (own.has(normalizeEmail(q.customerEmail))) continue; // handled above
    const days = Math.floor((now - sentMs) / DAY_MS);
    if (days < QUOTE_FOLLOW_UP_MIN_DAYS) continue;
    const key = `quote_follow_up:${q.id}`;
    if (isSnoozed(key, snoozed, now)) continue;
    return {
      type: 'quote_follow_up',
      key,
      docId: q.id,
      jobId: q.jobId,
      jobName: q.job?.name,
      customerName: q.customerName,
      days,
    };
  }

  return null;
}

/** Drop expired snoozes so the persisted map can't grow forever. */
export function pruneSnoozes(
  snoozed: Record<string, number>,
  now: number = Date.now(),
): Record<string, number> {
  const pruned: Record<string, number> = {};
  for (const [key, until] of Object.entries(snoozed)) {
    if (typeof until === 'number' && until > now) pruned[key] = until;
  }
  return pruned;
}
