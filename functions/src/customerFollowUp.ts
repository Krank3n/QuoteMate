/**
 * Which unanswered quotes get a follow-up email to the customer, and when.
 *
 * The admin funnel measured how fast customers answer quotes: acceptances land
 * in a median of 20 hours, and 9 in 10 arrive within 11 days. A quote still
 * silent at 48 hours is the one worth chasing, so the first reminder goes at
 * 48 hours and the second at 7 days — both measured from the send. After that
 * the quote is treated as dead: never a third reminder, never once the customer
 * has responded, and never once the acceptance link has lapsed.
 *
 * Kept free of firebase-admin so the selection rules can be unit-tested
 * directly — the scheduler normalises Firestore docs into FollowUpQuote and
 * owns the side effects (minting tokens, sending, writing back).
 */

/** Acceptance tokens expire 30 days after they're minted (mirrors index.ts). */
export const TOKEN_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000;

/** First reminder: 48 hours after the send. */
export const FIRST_FOLLOW_UP_MS = 48 * 60 * 60 * 1000;

/** Second reminder: 7 days after the send. */
export const SECOND_FOLLOW_UP_MS = 7 * 24 * 60 * 60 * 1000;

/** Two reminders, then we stop. */
export const MAX_FOLLOW_UPS = 2;

export interface FollowUpQuote {
  /** For logging / mapping back to the Firestore doc. */
  id: string;
  /** Where the reminder would go. No address → no reminder. */
  customerEmail?: string | null;
  /**
   * How the quote first reached the customer. Only email sends carry an
   * inbox we can reliably follow up in; SMS/share/export sends (and a
   * cancelled Android share that marked the quote sent falsely) don't.
   * Legacy docs have no sendMethod and were always email sends.
   */
  sendMethod?: string | null;
  /**
   * Any sign the customer has already answered — respondedAt, or a legacy
   * acceptedAt/declinedAt. Set → never chase again.
   */
  respondedAtMs: number | null;
  /** The tradie muted auto follow-ups for this quote. */
  suppressAutoFollowUp?: boolean;
  /** When the quote was sent, ms epoch. Drives the reminder timing. */
  sentAtMs: number | null;
  /**
   * When the current acceptance token was minted, ms epoch. Its presence
   * proves the quote actually carries an acceptance link, and it anchors the
   * 30-day expiry — past that, the link in the email is dead and there's no
   * point sending.
   */
  acceptanceTokenCreatedAtMs: number | null;
  /** How many reminders have already gone out (0, 1, or more). */
  followUpCount: number;
}

export interface FollowUpSelection {
  quote: FollowUpQuote;
  /** 1 = first reminder (48h), 2 = second reminder (7d). */
  followUpNumber: 1 | 2;
}

/**
 * Decide, for `now`, which quotes are due a customer follow-up and which
 * reminder each one is owed. Pure: same input, same output.
 */
export function selectQuotesForFollowUp(
  quotes: FollowUpQuote[],
  now: number,
): FollowUpSelection[] {
  const out: FollowUpSelection[] = [];

  for (const q of quotes) {
    // No inbox to reach, or the send never went by email — skip.
    if (!q.customerEmail) continue;
    if (q.sendMethod && q.sendMethod !== 'email') continue;

    // Already answered, or the tradie muted this one.
    if (q.respondedAtMs != null) continue;
    if (q.suppressAutoFollowUp) continue;

    // No send stamp, or no acceptance link at all — nothing to chase.
    if (q.sentAtMs == null) continue;
    if (q.acceptanceTokenCreatedAtMs == null) continue;

    // The acceptance link has lapsed: a reminder would carry a dead link.
    if (now - q.acceptanceTokenCreatedAtMs >= TOKEN_EXPIRATION_MS) continue;

    const count = q.followUpCount ?? 0;
    if (count >= MAX_FOLLOW_UPS) continue;

    const age = now - q.sentAtMs;
    if (count === 0 && age >= FIRST_FOLLOW_UP_MS) {
      out.push({ quote: q, followUpNumber: 1 });
    } else if (count === 1 && age >= SECOND_FOLLOW_UP_MS) {
      out.push({ quote: q, followUpNumber: 2 });
    }
  }

  return out;
}
