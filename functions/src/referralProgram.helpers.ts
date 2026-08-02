/**
 * Pure, dependency-free helpers for the referral / affiliate program.
 *
 * Extracted from index.ts so the money-touching logic (code validation,
 * commission maths, billing-period bucketing, payout reconciliation) is unit
 * testable without Firestore, and so the same rules apply to every caller.
 *
 * ── Program shape (matters for App Store review) ─────────────────────────
 * Referrals NEVER grant, extend, or discount a subscription. A referral code
 * only records attribution; the referred user pays the same in-app-purchase
 * price as anyone else. Affiliate commission is paid out-of-band (bank
 * transfer) from OUR net revenue AFTER the store's cut, so nothing here is an
 * alternative purchase mechanism or an in-app currency:
 *   - Guideline 3.1.1  — no unlocking of paid features outside IAP.
 *   - Guideline 3.1.3  — no external purchase CTA in the app.
 *   - Guideline 3.2.2  — commission is on real, collected revenue only, so the
 *                        app is not selling an "income opportunity".
 * Commission is only ever recorded from a *settled* payment event (Apple /
 * Google receipt validation, Stripe invoice.payment_succeeded with
 * amount_paid > 0) — never from a trialing/$0 subscription.
 */

/** Store/processor cut per platform. Used to derive NET revenue, which is the
 *  base for commission — affiliates are paid a share of what we actually keep. */
export const PLATFORM_FEES: Record<string, { percentage: number; fixedCents: number }> = {
  ios: { percentage: 0.30, fixedCents: 0 },      // Apple takes 30% (15% after yr 1 / small business)
  android: { percentage: 0.15, fixedCents: 0 },  // Google small-business program
  web: { percentage: 0.029, fixedCents: 30 },    // Stripe 2.9% + $0.30
};

export const DEFAULT_COMMISSION_RATE = 0.50; // 50% of NET revenue
export const MAX_COMMISSION_RATE = 1.0;

/** Referral codes are `QM-` + 6 chars from an unambiguous alphabet. */
export const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
export const REFERRAL_CODE_REGEX = /^QM-[A-HJ-NP-Z2-9]{6}$/;

/**
 * How long after account creation a referral code may still be attached.
 * Without a window, an existing (or churned-and-returning) user could attach
 * an affiliate at any time and hand them a recurring cut of revenue that the
 * affiliate never generated.
 */
export const REFERRAL_ATTRIBUTION_WINDOW_DAYS = 60;
export const REFERRAL_ATTRIBUTION_WINDOW_MS = REFERRAL_ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * Normalise user input into a candidate code. Trims, upper-cases, and strips
 * every character that cannot appear in a real code.
 *
 * SECURITY: the raw value used to be interpolated straight into a Firestore
 * document path (`firestore.doc('referrals/' + code)`). A value containing `/`
 * therefore addressed a different — possibly deeper — document. Stripping
 * everything outside the code alphabet makes path injection impossible; the
 * regex check below then rejects anything still malformed.
 */
export function normaliseReferralCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 16);
}

export function isValidReferralCode(code: string): boolean {
  return REFERRAL_CODE_REGEX.test(code);
}

/**
 * Build one candidate code. `random` is injectable so tests are deterministic.
 */
export function buildReferralCode(random: () => number = Math.random): string {
  let raw = '';
  for (let i = 0; i < 6; i++) {
    raw += REFERRAL_CODE_ALPHABET.charAt(Math.floor(random() * REFERRAL_CODE_ALPHABET.length));
  }
  return `QM-${raw}`;
}

/**
 * Billing-period bucket (`YYYY-MM`) used to make commission recording
 * idempotent — one commission per referred user per period.
 *
 * Must be computed in the billing timezone (Australia/Sydney). Cloud Functions
 * run in UTC, so a payment at 09:00 AEST on the 1st is 23:00 UTC on the LAST
 * day of the previous month — with a UTC bucket that payment lands in the wrong
 * period, and a renewal in the same real month could be recorded twice.
 */
export function billingPeriodFor(date: Date, timeZone = 'Australia/Sydney'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const month = parts.find((p) => p.type === 'month')?.value ?? '00';
  return `${year}-${month}`;
}

/**
 * Deterministic earning document id. Using a derived id (instead of an
 * auto-id plus a read-then-write "does one exist?" check) makes recording
 * idempotent even when two payment webhooks race — the second create fails
 * or no-ops instead of double-paying the affiliate.
 */
export function earningDocId(referredUserId: string, billingPeriod: string): string {
  return `${referredUserId}_${billingPeriod}`;
}

export function clampCommissionRate(rate: unknown): number {
  const value = typeof rate === 'number' && Number.isFinite(rate) ? rate : DEFAULT_COMMISSION_RATE;
  if (value <= 0) return 0;
  return Math.min(value, MAX_COMMISSION_RATE);
}

export interface CommissionBreakdown {
  platformFee: number;
  netRevenue: number;
  commissionAmount: number;
}

/**
 * Commission on one payment. All amounts in cents.
 * Never returns a negative component — a fee larger than the charge (tiny
 * proration on Stripe) yields zero net and zero commission rather than a
 * negative "earning" that would silently reduce the affiliate's balance.
 */
export function calculateCommission(
  platform: string,
  grossAmountCents: number,
  commissionRate: number
): CommissionBreakdown {
  const fees = PLATFORM_FEES[platform] || PLATFORM_FEES.web;
  const gross = Number.isFinite(grossAmountCents) && grossAmountCents > 0 ? Math.round(grossAmountCents) : 0;
  const platformFee = Math.min(gross, Math.round(gross * fees.percentage + fees.fixedCents));
  const netRevenue = Math.max(0, gross - platformFee);
  const commissionAmount = Math.max(0, Math.round(netRevenue * clampCommissionRate(commissionRate)));
  return { platformFee, netRevenue, commissionAmount };
}

export type ApplyCodeRejection =
  | 'invalid_format'
  | 'not_found'
  | 'self_referral'
  | 'already_referred'
  | 'already_subscribed'
  | 'window_expired';

export interface ApplyCodeInput {
  code: string;
  /** Owner of the code, or null when the code doesn't exist. */
  referrerUserId: string | null;
  selfUid: string;
  /** Existing referredBy on the applying user, if any. */
  existingReferredBy: string | null | undefined;
  /** True when the applying user already has a paid entitlement. */
  alreadySubscribed: boolean;
  accountCreatedAtMs: number | null;
  nowMs: number;
}

/**
 * Single decision point for "may this user attach this code?".
 *
 * Ordering matters for the error the user sees: format/existence first, then
 * self-referral, then the states that are about the applying account.
 */
export function evaluateApplyCode(input: ApplyCodeInput): { ok: true } | { ok: false; reason: ApplyCodeRejection } {
  if (!isValidReferralCode(input.code)) return { ok: false, reason: 'invalid_format' };
  if (!input.referrerUserId) return { ok: false, reason: 'not_found' };
  if (input.referrerUserId === input.selfUid) return { ok: false, reason: 'self_referral' };
  if (input.existingReferredBy) return { ok: false, reason: 'already_referred' };
  // A user who is already paying was not acquired by this affiliate. Attaching
  // now would hand over a recurring cut of revenue that already existed.
  if (input.alreadySubscribed) return { ok: false, reason: 'already_subscribed' };
  if (
    input.accountCreatedAtMs !== null &&
    input.nowMs - input.accountCreatedAtMs > REFERRAL_ATTRIBUTION_WINDOW_MS
  ) {
    return { ok: false, reason: 'window_expired' };
  }
  return { ok: true };
}

export const APPLY_CODE_MESSAGES: Record<ApplyCodeRejection, string> = {
  invalid_format: 'That doesn\'t look like a QuoteMate referral code. Codes look like QM-AB2CD3.',
  not_found: 'Referral code not found. Double-check it with your mate.',
  self_referral: 'You can\'t use your own referral code.',
  already_referred: 'You have already applied a referral code.',
  already_subscribed: 'Referral codes can only be applied before you subscribe.',
  window_expired: `Referral codes can only be applied within ${REFERRAL_ATTRIBUTION_WINDOW_DAYS} days of creating your account.`,
};

/**
 * Reconcile a payout from the pending earnings themselves rather than trusting
 * an admin-typed amount.
 *
 * The old flow marked EVERY pending earning as paid, then set
 * `pendingEarnings: 0` and incremented `paidEarnings` by the typed amount — so
 * a typo permanently desynced the ledger from the earning docs (and a partial
 * payout silently wiped the rest of the balance).
 */
export interface PayoutReconciliation {
  earningIds: string[];
  amountCents: number;
}

export function reconcilePayout(
  pending: Array<{ id: string; commissionAmount?: unknown }>
): PayoutReconciliation {
  const earningIds: string[] = [];
  let amountCents = 0;
  for (const earning of pending) {
    const value = earning.commissionAmount;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    earningIds.push(earning.id);
    amountCents += Math.round(value);
  }
  return { earningIds, amountCents };
}

/**
 * Illustrative monthly commission per active Pro user, per platform.
 *
 * Shown in the affiliate UI. Must be derived from the real fee table (not a
 * flat guess) — an iOS-only affiliate earns materially less than a web one
 * because Apple takes 30%, and overstating that is both an inaccurate earnings
 * claim (App Store Guideline 2.3.1) and a support problem.
 */
export function projectedCommissionPerUserCents(
  platform: string,
  monthlyPriceCents: number,
  commissionRate: number
): number {
  return calculateCommission(platform, monthlyPriceCents, commissionRate).commissionAmount;
}
