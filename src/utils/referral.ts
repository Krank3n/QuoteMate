/**
 * Referral / affiliate presentation logic for the app.
 *
 * Pure and unit-tested because this screen makes MONEY claims to affiliates and
 * PROGRAM claims to regular users, and both are App Store review surfaces:
 *
 *  - Guideline 2.3.1 (no misleading claims): earnings shown must be derived
 *    from the affiliate's real commission rate and the real store cut for the
 *    platform they're likely to refer on. The old screen multiplied by a flat
 *    0.85 "average platform fee" and defaulted a missing rate to 80%/50%, so a
 *    non-affiliate — and a revoked affiliate on rate 0 — was shown an 80% cut
 *    and a five-figure annual projection they could never earn.
 *  - Guideline 3.1.1 (IAP): a referral code is attribution only. It must never
 *    be described as unlocking, discounting, or extending a subscription, so
 *    the copy here is the single source of that wording.
 *
 * The fee table mirrors functions/src/referralProgram.helpers.ts — see
 * src/config/crossPackageMirrors.guard.test.ts style guards in
 * referral.test.ts.
 */

import type { ReferralInfo } from '../types';

/** Store/processor cut. MIRROR of PLATFORM_FEES in
 *  functions/src/referralProgram.helpers.ts — update both together. */
export const REFERRAL_PLATFORM_FEES: Record<ReferralPlatform, { percentage: number; fixedCents: number }> = {
  ios: { percentage: 0.30, fixedCents: 0 },
  android: { percentage: 0.15, fixedCents: 0 },
  web: { percentage: 0.029, fixedCents: 30 },
};

export type ReferralPlatform = 'ios' | 'android' | 'web';

/** Monthly Pro price in cents (AUD). Mirror of SUB_PRICE_AUD.monthly * 100. */
export const MONTHLY_PRICE_CENTS = 4900;

export const REFERRAL_CODE_REGEX = /^QM-[A-HJ-NP-Z2-9]{6}$/;

/**
 * Normalise typed/pasted input the same way the server does, so the client
 * rejects obvious junk (and path-injection attempts) before spending a call.
 * Mirror of normaliseReferralCode in functions/src/referralProgram.helpers.ts.
 */
export function normaliseReferralCode(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16);
}

export function isValidReferralCode(code: string): boolean {
  return REFERRAL_CODE_REGEX.test(code);
}

/**
 * Accept a full referral link as well as a bare code. Two link shapes carry a
 * code:
 *   - https://quotemateapp.au/ref/QM-AB2CD3        (share links / QR codes)
 *   - https://quotemateapp.au/app?ref=QM-AB2CD3    (the landing page's "try it
 *     on the web" CTA — /app is a static bundle, so a /ref/ path there would
 *     404 on load; the query form survives the redirect)
 */
export function extractReferralCode(input: string | null | undefined): string {
  if (typeof input !== 'string') return '';
  const trimmed = input.trim();
  const fromPath = trimmed.match(/\/ref\/([^/?#\s]+)/i);
  const fromQuery = trimmed.match(/[?&]ref=([^&#\s]+)/i);
  return normaliseReferralCode(fromPath ? fromPath[1] : fromQuery ? fromQuery[1] : trimmed);
}

/**
 * Commission on one monthly payment, after the store's cut.
 * Mirror of calculateCommission in functions/src/referralProgram.helpers.ts.
 */
export function commissionPerUserCents(
  platform: ReferralPlatform,
  commissionRate: number,
  monthlyPriceCents: number = MONTHLY_PRICE_CENTS
): number {
  const fees = REFERRAL_PLATFORM_FEES[platform] ?? REFERRAL_PLATFORM_FEES.web;
  const gross = Number.isFinite(monthlyPriceCents) && monthlyPriceCents > 0 ? Math.round(monthlyPriceCents) : 0;
  const rate = Number.isFinite(commissionRate) && commissionRate > 0 ? Math.min(commissionRate, 1) : 0;
  const platformFee = Math.min(gross, Math.round(gross * fees.percentage + fees.fixedCents));
  const net = Math.max(0, gross - platformFee);
  return Math.max(0, Math.round(net * rate));
}

/**
 * The rate to DISPLAY. Only an enabled affiliate with a real positive rate has
 * a "cut"; everyone else gets null so the UI shows no percentage at all rather
 * than an invented default.
 */
export function displayCommissionRate(info: ReferralInfo | null | undefined): number | null {
  if (!info?.isAffiliate) return null;
  const rate = info.commissionRate;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
  return Math.min(rate, 1);
}

export interface ProjectionRow {
  users: number;
  amountCents: number;
}

/**
 * Earnings projection rows for the affiliate chart.
 *
 * Returns [] when there is no genuine rate to project from — an empty chart is
 * correct; a chart drawn from a default rate is a fabricated income claim.
 * Uses the CONSERVATIVE (highest-fee) platform so the headline number is a
 * floor rather than a best case.
 */
export function earningsProjection(
  info: ReferralInfo | null | undefined,
  userCounts: number[] = [5, 10, 25, 50, 100]
): ProjectionRow[] {
  const rate = displayCommissionRate(info);
  if (rate === null) return [];
  const perUser = commissionPerUserCents('ios', rate);
  if (perUser <= 0) return [];
  return userCounts.map((users) => ({ users, amountCents: users * perUser }));
}

export function referralLink(code: string, baseUrl = 'https://quotemateapp.au/ref/'): string {
  return `${baseUrl}${encodeURIComponent(code)}`;
}

/**
 * Share copy.
 *
 * Deliberately makes NO offer to the recipient: a referral grants nothing, so
 * promising a discount/free month would be both false and an outside-of-IAP
 * inducement (Guideline 3.1.1). Affiliates get the same recipient-facing
 * promise as everyone else — their commission is our cost, not something the
 * recipient pays or receives.
 *
 * The link alone carries attribution (it embeds the code), so no code is
 * spelled out for the recipient to retype — tapping the link is the whole job.
 */
export function buildShareMessage(link: string): string {
  return (
    'I use QuoteMate to write up quotes and invoices on the tools — reckon you\'d get a lot out of it.\n\n' +
    `Grab it here: ${link}`
  );
}

/** iOS puts a `url` field in its own slot; Android only reads `message`. */
export function buildSharePayload(
  link: string,
  platform: string
): { message: string; url?: string; title?: string } {
  const message = buildShareMessage(link);
  if (platform === 'ios') {
    // On iOS a URL inside `message` gets flattened into the text by some
    // targets; passing it separately lets Messages/Mail render a real link.
    return { message, url: link };
  }
  return { message, title: 'QuoteMate' };
}

export function formatCents(cents: number): string {
  const safe = Number.isFinite(cents) ? cents : 0;
  return `$${(safe / 100).toFixed(2)}`;
}
