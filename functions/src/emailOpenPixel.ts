/**
 * The email-open tracking pixel: pure helpers plus the handler body.
 *
 * The customer-facing quote email carries a 1x1 GIF whose URL is keyed by a
 * random 256-bit token. When the recipient's mail client fetches the pixel,
 * the trackEmailOpen HTTPS function looks up the token, stamps the open on
 * the legacy users/{uid}/quotes/{quoteId} doc (the SAME doc the acceptance
 * page stamps firstViewedAt / lastViewedAt / viewCount on) and always
 * returns the pixel bytes so the mail client never sees an error.
 *
 * Kept free of the admin SDK — no admin, no fetch, no crypto imports beyond
 * node's built-in `crypto` — so the token hashing, the update shape, the
 * throttle decision AND the whole request flow (`handleEmailOpen`, with its
 * Firestore reads/writes injected) can be tested at the module level. The
 * onRequest in index.ts is a thin wrapper that supplies admin's
 * serverTimestamp / FieldValue.increment and the real reads.
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
 * The 42-byte 1x1 transparent GIF a tracking pixel is by convention. Kept
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
 * Whether THIS send should carry a pixel at all.
 *
 * A test send goes to the tradie's own inbox, so its open is never a
 * customer's. So is the BCC that "Send a copy to myself" adds — and that
 * copy carries the SAME html, so the same token: the tradie opening their
 * own copy would read as the customer opening theirs, which is exactly the
 * signal this instrumentation exists to measure. Losing the pixel on those
 * sends is the cheap, honest trade.
 */
export function shouldEmbedEmailOpenPixel(input: {
  isTestSend?: boolean;
  sendCopyToSelf?: boolean;
}): boolean {
  return !input.isTestSend && !input.sendCopyToSelf;
}

/**
 * How long a write is suppressed after the previous one. The endpoint is
 * public and unauthenticated, and every write re-fires the documents mirror
 * (a full projection rewrite), so a scanner hammering one pixel URL would
 * amplify into unbounded writes. The funnel only reads emailFirstOpenedAt,
 * so coarsening emailLastOpenedAt / emailOpenCount to one write a minute
 * costs nothing it measures.
 */
export const EMAIL_OPEN_WRITE_THROTTLE_MS = 60_000;

/**
 * True when this hit should be persisted. Never opened before ⇒ always
 * write (that hit sets emailFirstOpenedAt, the field the funnel joins on).
 * A stamp in the future (clock skew between the write and this read) reads
 * as "just written" and is skipped — the same conservative side as a burst.
 */
export function shouldWriteEmailOpen(input: {
  now: number;
  lastOpenedAtMs: number | null;
}): boolean {
  if (input.lastOpenedAtMs === null || !Number.isFinite(input.lastOpenedAtMs)) return true;
  return input.now - input.lastOpenedAtMs >= EMAIL_OPEN_WRITE_THROTTLE_MS;
}

/**
 * Milliseconds between the send and the first open, or null when it can't
 * be computed honestly (no readable sentAt, or a negative gap from clock
 * skew). Apple Mail Privacy Protection and corporate link scanners fetch
 * remote images at DELIVERY time, so an "open" seconds after the send is
 * very likely a machine — stamping the gap lets those be separated later
 * without changing what the funnel counts today.
 */
export function emailFirstOpenAfterMs(now: number, sentAtMs: number | null): number | null {
  if (sentAtMs === null || !Number.isFinite(sentAtMs)) return null;
  const delta = now - sentAtMs;
  return delta >= 0 ? delta : null;
}

/**
 * The Firestore update applied to users/{uid}/quotes/{quoteId} on a pixel
 * hit. `emailFirstOpenedAt` is only set the first time (never overwritten),
 * `emailLastOpenedAt` moves on every write, `emailOpenCount` is incremented
 * atomically. The caller passes admin's serverTimestamp() and
 * FieldValue.increment(1) so this module stays free of the admin SDK.
 *
 * `hasFirstOpen` is decided by the caller from the quote's current data —
 * true when a prior hit already set emailFirstOpenedAt, so this hit only
 * moves the last-open stamp and bumps the count.
 *
 * `firstOpenAfterMs` rides along on the first open only (see
 * emailFirstOpenAfterMs) and is dropped when it isn't computable.
 */
export interface EmailOpenStampInput<TTimestamp, TIncrement> {
  hasFirstOpen: boolean;
  now: TTimestamp;
  increment: TIncrement;
  firstOpenAfterMs?: number | null;
}

export interface EmailOpenStamp<TTimestamp, TIncrement> {
  emailFirstOpenedAt?: TTimestamp;
  emailFirstOpenAfterMs?: number;
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
    if (input.firstOpenAfterMs != null) stamp.emailFirstOpenAfterMs = input.firstOpenAfterMs;
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

// ---------------------------------------------------------------------------
// Handler body — pure but for the injected reads/writes
// ---------------------------------------------------------------------------

/** What emailOpenTokens/{hash} points at. */
export interface EmailOpenTokenRecord {
  userId: string;
  quoteId: string;
}

/**
 * The three things the handler needs off the quote doc. The caller reads
 * them through the shared timestamp normaliser, so every Firestore shape
 * (Timestamp, {_seconds}, ISO string, epoch millis) arrives here as millis.
 * A MISSING quote doc is signalled by `readQuote` resolving to null, never
 * by a zeroed state — see handleEmailOpen.
 */
export interface EmailOpenQuoteState {
  /** A prior hit already stamped emailFirstOpenedAt. */
  hasFirstOpen: boolean;
  /** emailLastOpenedAt in millis, null when never opened — drives the throttle. */
  lastOpenedAtMs: number | null;
  /** sentAt in millis, null when unreadable — the proxy-prefetch anchor. */
  sentAtMs: number | null;
}

/** Exactly what the onRequest wrapper writes back to the mail client. */
export interface EmailOpenResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: Buffer;
}

export interface HandleEmailOpenInput<TTimestamp, TIncrement> {
  /** The raw `t` query param — unknown on purpose, it comes off the wire. */
  token: unknown;
  /** Epoch millis, for the throttle window and the first-open delta. */
  now: number;
  /** admin.firestore.FieldValue.serverTimestamp() — what the *OpenedAt fields get. */
  serverTimestamp: TTimestamp;
  /** admin.firestore.FieldValue.increment(1). */
  increment: TIncrement;
  lookupToken: (tokenHash: string) => Promise<EmailOpenTokenRecord | null>;
  readQuote: (record: EmailOpenTokenRecord) => Promise<EmailOpenQuoteState | null>;
  writeStamp: (
    record: EmailOpenTokenRecord,
    stamp: EmailOpenStamp<TTimestamp, TIncrement>,
  ) => Promise<void>;
  /** Called instead of throwing — the mail client still gets its pixel. */
  onError?: (err: unknown) => void;
}

const PIXEL_RESPONSE: EmailOpenResponse = {
  status: 200,
  headers: EMAIL_OPEN_PIXEL_HEADERS,
  body: EMAIL_OPEN_PIXEL_GIF,
};

/**
 * Resolve one pixel hit. ALWAYS resolves to the 1x1 GIF with no-store
 * headers — malformed token, unknown token, deleted quote, Firestore
 * hiccup, all look identical to the mail client. Anything else risks a
 * broken-image icon in the customer's inbox, or the client caching one
 * response and never re-fetching (the count then reads as 1 forever).
 *
 * The write is deliberately conservative:
 *  - the quote doc is READ first and a missing one is left alone. A merge
 *    write here would CREATE the doc, resurrecting a deleted quote as a
 *    blank $0 draft at the top of the tradie's list (and firing the
 *    trial-bootstrap trigger and the documents mirror with it).
 *  - a hit within EMAIL_OPEN_WRITE_THROTTLE_MS of the last one is served
 *    and dropped, so a public unauthenticated endpoint can't be turned into
 *    unbounded writes.
 */
export async function handleEmailOpen<TTimestamp, TIncrement>(
  input: HandleEmailOpenInput<TTimestamp, TIncrement>,
): Promise<EmailOpenResponse> {
  try {
    if (!isWellFormedEmailOpenToken(input.token)) return PIXEL_RESPONSE;
    const record = await input.lookupToken(hashEmailOpenToken(input.token));
    if (!record || !record.userId || !record.quoteId) return PIXEL_RESPONSE;

    const quote = await input.readQuote(record);
    // Quote deleted (or never existed): count nothing, create nothing.
    if (!quote) return PIXEL_RESPONSE;
    if (!shouldWriteEmailOpen({ now: input.now, lastOpenedAtMs: quote.lastOpenedAtMs })) {
      return PIXEL_RESPONSE;
    }

    await input.writeStamp(
      record,
      buildEmailOpenStamp({
        hasFirstOpen: quote.hasFirstOpen,
        now: input.serverTimestamp,
        increment: input.increment,
        firstOpenAfterMs: quote.hasFirstOpen
          ? null
          : emailFirstOpenAfterMs(input.now, quote.sentAtMs),
      }),
    );
    return PIXEL_RESPONSE;
  } catch (err) {
    // Never surface to the mail client. The caller logs for our visibility.
    input.onError?.(err);
    return PIXEL_RESPONSE;
  }
}
