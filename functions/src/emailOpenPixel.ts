/**
 * Pure helpers for the email-open tracking pixel.
 *
 * The customer-facing quote email carries a 1x1 GIF whose URL is keyed by a
 * random 256-bit token. When the recipient's mail client fetches the pixel,
 * the trackEmailOpen HTTPS function looks up the token, stamps the open on
 * the legacy users/{uid}/quotes/{quoteId} doc (the SAME doc the acceptance
 * page stamps firstViewedAt / lastViewedAt / viewCount on) and always
 * returns the pixel bytes so the mail client never sees an error.
 *
 * Kept pure — no admin, no fetch, no crypto imports beyond node's built-in
 * `crypto` — so the token hashing, the update shape and the pixel response
 * can be tested at the module level. The HTTPS handler in index.ts wires
 * these into admin's serverTimestamp / FieldValue.increment.
 */
import * as crypto from 'crypto';

/**
 * 256-bit random token in hex — mirrors generateQuoteAcceptanceLink so the
 * token distribution and lookup cost stay identical.
 */
export function generateEmailOpenToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * SHA-256 the token before it is used as a Firestore doc id, same shape as
 * hashToken() over acceptance tokens in index.ts. Never store the raw token
 * server-side — a leaked backup then can't be replayed against the pixel.
 */
export function hashEmailOpenToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * The 43-byte 1x1 transparent GIF a tracking pixel is by convention. Kept
 * as a Buffer constant so every request writes the same bytes without
 * re-encoding, and the tests can pin the exact bytes shipped to the mail
 * client.
 */
export const EMAIL_OPEN_PIXEL_GIF: Buffer = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

/**
 * Response headers for every pixel hit — success or miss. The mail client
 * MUST re-fetch on every open (otherwise a second open reads from cache and
 * we never learn about it), and any content-type but image/gif risks the
 * client hiding a broken-image glyph in the customer's inbox.
 */
export const EMAIL_OPEN_PIXEL_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'image/gif',
  'Content-Length': String(EMAIL_OPEN_PIXEL_GIF.length),
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
};

/**
 * Loose sanity check on the token from the query string. 64 hex characters
 * is what generateEmailOpenToken produces; anything else can never resolve
 * and would waste a Firestore read.
 *
 * Not a security boundary — the handler still returns the pixel whether or
 * not the token is well-formed. The check only exists so we skip the lookup
 * on garbage (bots, scrapers, a link the customer edited by hand).
 */
export function isWellFormedEmailOpenToken(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/**
 * The Firestore update to merge onto users/{uid}/quotes/{quoteId} on a
 * pixel hit. `emailFirstOpenedAt` is only set the first time (never
 * overwritten), `emailLastOpenedAt` moves on every hit, `emailOpenCount` is
 * incremented atomically. The caller passes admin's serverTimestamp() and
 * FieldValue.increment(1) so this module stays free of the admin SDK.
 *
 * `hasFirstOpen` is decided by the caller from the quote's current data —
 * true when a prior hit already set emailFirstOpenedAt, so this hit only
 * moves the last-open stamp and bumps the count.
 */
export interface EmailOpenStampInput<TTimestamp, TIncrement> {
  hasFirstOpen: boolean;
  now: TTimestamp;
  increment: TIncrement;
}

export interface EmailOpenStamp<TTimestamp, TIncrement> {
  emailFirstOpenedAt?: TTimestamp;
  emailLastOpenedAt: TTimestamp;
  emailOpenCount: TIncrement;
}

export function buildEmailOpenStamp<TTimestamp, TIncrement>(
  input: EmailOpenStampInput<TTimestamp, TIncrement>,
): EmailOpenStamp<TTimestamp, TIncrement> {
  const stamp: EmailOpenStamp<TTimestamp, TIncrement> = {
    emailLastOpenedAt: input.now,
    emailOpenCount: input.increment,
  };
  if (!input.hasFirstOpen) {
    stamp.emailFirstOpenedAt = input.now;
  }
  return stamp;
}

/**
 * Customer-facing pixel URL for a token. Defaults to the Cloud Function URL
 * so the pixel works out of the box, and QUOTE_EMAIL_OPEN_BASE_URL can point
 * the pixel at a branded subdomain (Brevo's tracking rewrites `href`s but
 * leaves `<img src>` alone, so this URL reaches the customer intact — but
 * the branded-domain path is what avoids the pixel showing an opaque
 * host in the "block remote images" preview). Same base-URL convention as
 * acceptancePageUrlForToken so both URLs can share a subdomain later.
 */
export function emailOpenPixelUrlForToken(token: string): string {
  const base = (
    process.env.QUOTE_EMAIL_OPEN_BASE_URL ||
    'https://us-central1-hansendev.cloudfunctions.net/trackEmailOpen'
  ).replace(/\/$/, '');
  return `${base}?t=${token}`;
}
