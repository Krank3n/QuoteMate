/**
 * The flagged-rows list as the chat bubble shows it.
 *
 * `QuoteReview.summary` is one sentence built to be read ALOUD or dropped into
 * a "[context]" note — "6 rows need a look — 2 carrying money that can't be
 * right, 4 estimated. ($2,386.50 of Paper Joint Tape, $1,200.00 of Merbau
 * decking, +3 more)". On screen that is a wall of commas. The bubble gets the
 * same facts as a list: one row per line, the money first (it is what decides
 * whether the row matters), the name, and a plain reason under it.
 *
 * Pure so the shape can be pinned without rendering.
 */
import type { QuoteIssue, QuoteIssueKind, QuoteReview } from './quoteReview';

export interface ChatReviewRow {
  name: string;
  /** "$2,386.50" — what the row is carrying, price × quantity. */
  amount: string;
  reason: string;
}

export interface ChatReviewBlock {
  /** "6 rows need a look" — the sentence fragment the bubble text leads with. */
  headline: string;
  rows: ChatReviewRow[];
  /** Flagged rows beyond the ones listed. */
  more: number;
}

/** Tradie-readable, one short clause each. */
export const REASON_BY_KIND: Record<QuoteIssueKind, string> = {
  unpriced: 'no price yet',
  estimated: 'estimated, not a supplier price',
  low_confidence: 'low-confidence match',
  inflated_quantity: 'quantity looks inflated',
  weak_match: 'might be the wrong product',
  implausible_cost: "price can't be right",
};

export const CHAT_REVIEW_MAX_ROWS = 5;

function money(n: number): string {
  return `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function headlineFor(review: Pick<QuoteReview, 'issues'>): string {
  const n = review.issues.length;
  return n === 1 ? '1 row needs a look' : `${n} rows need a look`;
}

export function chatReviewRow(issue: QuoteIssue): ChatReviewRow {
  return {
    name: issue.name,
    amount: money((issue.price || 0) * (issue.quantity || 0)),
    reason: REASON_BY_KIND[issue.kind] || 'worth a look',
  };
}

/**
 * Null when there is nothing to show — the caller keeps its "came back clean"
 * line. `issues` arrives sorted by line total, so the first rows are the ones
 * worth the look.
 */
export function reviewBlockForChat(
  review: Pick<QuoteReview, 'issues'> | undefined | null,
  limit: number = CHAT_REVIEW_MAX_ROWS,
): ChatReviewBlock | null {
  if (!review || review.issues.length === 0) return null;
  const rows = review.issues.slice(0, limit).map(chatReviewRow);
  return {
    headline: headlineFor(review),
    rows,
    more: Math.max(0, review.issues.length - rows.length),
  };
}
