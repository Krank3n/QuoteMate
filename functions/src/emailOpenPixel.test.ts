/**
 * Pure-helpers tests for the email-open tracking pixel. The HTTPS handler
 * in index.ts is thin around these — token hash, well-formed check, pixel
 * bytes/headers, and the stamp update shape — so pinning each here covers
 * the branches without booting the admin SDK.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  EMAIL_OPEN_PIXEL_GIF,
  EMAIL_OPEN_PIXEL_HEADERS,
  EMAIL_OPEN_WRITE_THROTTLE_MS,
  buildEmailOpenStamp,
  emailFirstOpenAfterMs,
  emailOpenPixelUrlForToken,
  generateEmailOpenToken,
  handleEmailOpen,
  hashEmailOpenToken,
  isWellFormedEmailOpenToken,
  shouldEmbedEmailOpenPixel,
  shouldWriteEmailOpen,
  type EmailOpenQuoteState,
  type EmailOpenTokenRecord,
} from './emailOpenPixel';

describe('generateEmailOpenToken', () => {
  it('produces a 64-hex 256-bit token, unique per call', () => {
    const a = generateEmailOpenToken();
    const b = generateEmailOpenToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe('hashEmailOpenToken', () => {
  it('hashes deterministically to a 64-hex SHA-256 digest', () => {
    // Precomputed: SHA-256("hello") in hex.
    expect(hashEmailOpenToken('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
    expect(hashEmailOpenToken('hello')).toBe(hashEmailOpenToken('hello'));
    expect(hashEmailOpenToken('a')).not.toBe(hashEmailOpenToken('b'));
  });
});

describe('isWellFormedEmailOpenToken', () => {
  it('accepts a 64-hex token and rejects everything else', () => {
    expect(isWellFormedEmailOpenToken('a'.repeat(64))).toBe(true);
    expect(isWellFormedEmailOpenToken('A'.repeat(64))).toBe(false); // must be lowercase hex
    expect(isWellFormedEmailOpenToken('a'.repeat(63))).toBe(false); // wrong length
    expect(isWellFormedEmailOpenToken('a'.repeat(64) + 'a')).toBe(false); // wrong length
    expect(isWellFormedEmailOpenToken('z'.repeat(64))).toBe(false); // non-hex
    expect(isWellFormedEmailOpenToken('')).toBe(false);
    expect(isWellFormedEmailOpenToken(undefined)).toBe(false);
    expect(isWellFormedEmailOpenToken(null)).toBe(false);
    expect(isWellFormedEmailOpenToken(42)).toBe(false);
  });
});

describe('EMAIL_OPEN_PIXEL_GIF + EMAIL_OPEN_PIXEL_HEADERS', () => {
  it('is a 1x1 transparent GIF byte-for-byte', () => {
    // Minimal 1x1 transparent GIF signature: GIF89a header, 1x1 dimensions.
    expect(EMAIL_OPEN_PIXEL_GIF.slice(0, 6).toString('ascii')).toBe('GIF89a');
    // Width/height are little-endian shorts at bytes 6-9 (1x1).
    expect(EMAIL_OPEN_PIXEL_GIF[6]).toBe(1);
    expect(EMAIL_OPEN_PIXEL_GIF[7]).toBe(0);
    expect(EMAIL_OPEN_PIXEL_GIF[8]).toBe(1);
    expect(EMAIL_OPEN_PIXEL_GIF[9]).toBe(0);
    // Trailer byte (0x3B) marks a valid GIF end.
    expect(EMAIL_OPEN_PIXEL_GIF[EMAIL_OPEN_PIXEL_GIF.length - 1]).toBe(0x3b);
    // Length is stable — same bytes go out on every hit, so the mail client
    // can't cache one and refuse to load the next. This 1x1 transparent GIF
    // is 42 bytes (the canonical minimal shape).
    expect(EMAIL_OPEN_PIXEL_GIF.length).toBe(42);
  });

  it('ships as an uncached image/gif so every open re-fetches', () => {
    expect(EMAIL_OPEN_PIXEL_HEADERS['Content-Type']).toBe('image/gif');
    // no-store beats no-cache — some clients ignore no-cache alone.
    expect(EMAIL_OPEN_PIXEL_HEADERS['Cache-Control']).toContain('no-store');
    expect(EMAIL_OPEN_PIXEL_HEADERS['Cache-Control']).toContain('no-cache');
    expect(EMAIL_OPEN_PIXEL_HEADERS.Pragma).toBe('no-cache');
    expect(EMAIL_OPEN_PIXEL_HEADERS.Expires).toBe('0');
    expect(EMAIL_OPEN_PIXEL_HEADERS['Content-Length']).toBe(String(EMAIL_OPEN_PIXEL_GIF.length));
  });
});

describe('buildEmailOpenStamp', () => {
  // Sentinels stand in for admin.firestore.FieldValue.serverTimestamp() and
  // .increment(1) — the handler wires the real ones in. The point of the
  // test is the SHAPE of the update, so any distinguishable values will do.
  const NOW = { __sentinel: 'serverTimestamp' } as const;
  const INC = { __sentinel: 'increment(1)' } as const;

  it('stamps emailFirstOpenedAt on the first hit and counts one', () => {
    const stamp = buildEmailOpenStamp({ hasFirstOpen: false, now: NOW, increment: INC });
    expect(stamp).toEqual({
      emailFirstOpenedAt: NOW,
      emailLastOpenedAt: NOW,
      emailOpenCount: INC,
    });
  });

  it('leaves emailFirstOpenedAt alone on repeat hits and still bumps the count', () => {
    const stamp = buildEmailOpenStamp({ hasFirstOpen: true, now: NOW, increment: INC });
    expect(stamp).toEqual({
      emailLastOpenedAt: NOW,
      emailOpenCount: INC,
    });
    expect(Object.prototype.hasOwnProperty.call(stamp, 'emailFirstOpenedAt')).toBe(false);
  });

  it('carries emailFirstOpenAfterMs on the first hit so a proxy prefetch can be told apart later', () => {
    const stamp = buildEmailOpenStamp({
      hasFirstOpen: false, now: NOW, increment: INC, firstOpenAfterMs: 4_000,
    });
    expect(stamp.emailFirstOpenAfterMs).toBe(4_000);
  });

  it('drops emailFirstOpenAfterMs when it is not computable, and never stamps it on a repeat hit', () => {
    const noAnchor = buildEmailOpenStamp({
      hasFirstOpen: false, now: NOW, increment: INC, firstOpenAfterMs: null,
    });
    expect(Object.prototype.hasOwnProperty.call(noAnchor, 'emailFirstOpenAfterMs')).toBe(false);
    const repeat = buildEmailOpenStamp({
      hasFirstOpen: true, now: NOW, increment: INC, firstOpenAfterMs: 4_000,
    });
    expect(Object.prototype.hasOwnProperty.call(repeat, 'emailFirstOpenAfterMs')).toBe(false);
  });
});

describe('shouldEmbedEmailOpenPixel', () => {
  it('embeds on a plain customer send', () => {
    expect(shouldEmbedEmailOpenPixel({})).toBe(true);
    expect(shouldEmbedEmailOpenPixel({ isTestSend: false, sendCopyToSelf: false })).toBe(true);
  });

  it('never embeds on a test send — that inbox is the tradie\'s own', () => {
    expect(shouldEmbedEmailOpenPixel({ isTestSend: true })).toBe(false);
  });

  it('never embeds when the tradie BCCs a copy to themselves — their open is not the customer\'s', () => {
    // The self-copy is the SAME html, so the same token: the tradie opening
    // their own copy would be indistinguishable from the customer opening
    // theirs. Drop the pixel rather than record a false open.
    expect(shouldEmbedEmailOpenPixel({ sendCopyToSelf: true })).toBe(false);
    expect(shouldEmbedEmailOpenPixel({ isTestSend: false, sendCopyToSelf: true })).toBe(false);
  });
});

describe('shouldWriteEmailOpen', () => {
  const NOW = 1_800_000_000_000;

  it('always writes the first open — that hit is the one the funnel joins on', () => {
    expect(shouldWriteEmailOpen({ now: NOW, lastOpenedAtMs: null })).toBe(true);
  });

  it('skips a repeat inside the throttle window so a scanner can not amplify writes', () => {
    expect(shouldWriteEmailOpen({ now: NOW, lastOpenedAtMs: NOW })).toBe(false);
    expect(shouldWriteEmailOpen({ now: NOW, lastOpenedAtMs: NOW - 1_000 })).toBe(false);
    expect(
      shouldWriteEmailOpen({ now: NOW, lastOpenedAtMs: NOW - (EMAIL_OPEN_WRITE_THROTTLE_MS - 1) }),
    ).toBe(false);
  });

  it('writes again once the window has elapsed', () => {
    expect(
      shouldWriteEmailOpen({ now: NOW, lastOpenedAtMs: NOW - EMAIL_OPEN_WRITE_THROTTLE_MS }),
    ).toBe(true);
    expect(shouldWriteEmailOpen({ now: NOW, lastOpenedAtMs: NOW - 10 * 60_000 })).toBe(true);
  });

  it('treats a future stamp (clock skew) as just-written and skips', () => {
    expect(shouldWriteEmailOpen({ now: NOW, lastOpenedAtMs: NOW + 5_000 })).toBe(false);
  });

  it('writes when the stored stamp is unreadable', () => {
    expect(shouldWriteEmailOpen({ now: NOW, lastOpenedAtMs: NaN })).toBe(true);
  });
});

describe('emailFirstOpenAfterMs', () => {
  const NOW = 1_800_000_000_000;

  it('measures the gap from send to first open', () => {
    expect(emailFirstOpenAfterMs(NOW, NOW - 45_000)).toBe(45_000);
    // The proxy-prefetch shape: opened within a second of the send.
    expect(emailFirstOpenAfterMs(NOW, NOW - 900)).toBe(900);
  });

  it('is null when sentAt is unreadable or the gap would be negative', () => {
    expect(emailFirstOpenAfterMs(NOW, null)).toBeNull();
    expect(emailFirstOpenAfterMs(NOW, NaN)).toBeNull();
    expect(emailFirstOpenAfterMs(NOW, NOW + 1_000)).toBeNull();
  });
});

describe('handleEmailOpen', () => {
  const NOW = 1_800_000_000_000;
  const TOKEN = 'a'.repeat(64);
  const RECORD: EmailOpenTokenRecord = { userId: 'u1', quoteId: 'q1' };
  const STAMP_NOW = { __sentinel: 'serverTimestamp' } as const;
  const INC = { __sentinel: 'increment(1)' } as const;

  /**
   * Wires handleEmailOpen to spies standing in for the two Firestore reads
   * and the write. `quote` is what readQuote resolves to — null means the
   * quote doc is gone.
   */
  function harness(over: {
    token?: unknown;
    record?: EmailOpenTokenRecord | null;
    quote?: EmailOpenQuoteState | null;
    lookupToken?: (hash: string) => Promise<EmailOpenTokenRecord | null>;
  } = {}) {
    const lookupToken = vi.fn(over.lookupToken
      ?? (async () => (over.record === undefined ? RECORD : over.record)));
    const readQuote = vi.fn(async () => (over.quote === undefined ? null : over.quote));
    const writeStamp = vi.fn(async () => undefined);
    const onError = vi.fn();
    return {
      lookupToken,
      readQuote,
      writeStamp,
      onError,
      run: () => handleEmailOpen({
        token: 'token' in over ? over.token : TOKEN,
        now: NOW,
        serverTimestamp: STAMP_NOW,
        increment: INC,
        lookupToken,
        readQuote,
        writeStamp,
        onError,
      }),
    };
  }

  function expectPixel(res: Awaited<ReturnType<typeof handleEmailOpen>>) {
    expect(res.status).toBe(200);
    expect(res.body).toBe(EMAIL_OPEN_PIXEL_GIF);
    expect(res.headers['Content-Type']).toBe('image/gif');
    expect(res.headers['Cache-Control']).toContain('no-store');
  }

  it('returns the GIF with no-store headers and writes nothing for an unknown token', async () => {
    const h = harness({ record: null });
    expectPixel(await h.run());
    expect(h.lookupToken).toHaveBeenCalledWith(hashEmailOpenToken(TOKEN));
    expect(h.readQuote).not.toHaveBeenCalled();
    expect(h.writeStamp).not.toHaveBeenCalled();
  });

  it('returns the GIF and skips the lookup entirely for a malformed token', async () => {
    for (const token of ['', 'nope', 'Z'.repeat(64), undefined, 42, ['a'.repeat(64)]]) {
      const h = harness({ token });
      expectPixel(await h.run());
      expect(h.lookupToken).not.toHaveBeenCalled();
      expect(h.writeStamp).not.toHaveBeenCalled();
    }
  });

  it('returns the GIF when a token doc is missing its userId/quoteId', async () => {
    const h = harness({ record: { userId: '', quoteId: 'q1' } });
    expectPixel(await h.run());
    expect(h.readQuote).not.toHaveBeenCalled();
    expect(h.writeStamp).not.toHaveBeenCalled();
  });

  it('still returns the GIF when the lookup throws — a Firestore hiccup is invisible to the mail client', async () => {
    const boom = new Error('firestore unavailable');
    const h = harness({ lookupToken: async () => { throw boom; } });
    expectPixel(await h.run());
    expect(h.writeStamp).not.toHaveBeenCalled();
    expect(h.onError).toHaveBeenCalledWith(boom);
  });

  it('still returns the GIF when the write throws', async () => {
    const h = harness({ quote: { hasFirstOpen: false, lastOpenedAtMs: null, sentAtMs: null } });
    h.writeStamp.mockRejectedValueOnce(new Error('permission denied') as never);
    expectPixel(await h.run());
    expect(h.onError).toHaveBeenCalled();
  });

  it('writes nothing when the quote doc is gone — a deleted quote is never resurrected', async () => {
    // A merge write here would CREATE users/{uid}/quotes/{quoteId}, putting a
    // blank $0 draft back at the top of the tradie's list.
    const h = harness({ quote: null });
    expectPixel(await h.run());
    expect(h.readQuote).toHaveBeenCalledWith(RECORD);
    expect(h.writeStamp).not.toHaveBeenCalled();
  });

  it('stamps first open, last open and the count on the first hit, with the gap since send', async () => {
    const h = harness({
      quote: { hasFirstOpen: false, lastOpenedAtMs: null, sentAtMs: NOW - 90_000 },
    });
    expectPixel(await h.run());
    expect(h.writeStamp).toHaveBeenCalledTimes(1);
    expect(h.writeStamp).toHaveBeenCalledWith(RECORD, {
      emailFirstOpenedAt: STAMP_NOW,
      emailFirstOpenAfterMs: 90_000,
      emailLastOpenedAt: STAMP_NOW,
      emailOpenCount: INC,
    });
  });

  it('omits emailFirstOpenAfterMs on a first hit when sentAt is unreadable', async () => {
    const h = harness({ quote: { hasFirstOpen: false, lastOpenedAtMs: null, sentAtMs: null } });
    expectPixel(await h.run());
    expect(h.writeStamp).toHaveBeenCalledWith(RECORD, {
      emailFirstOpenedAt: STAMP_NOW,
      emailLastOpenedAt: STAMP_NOW,
      emailOpenCount: INC,
    });
  });

  it('serves the pixel but writes nothing on a repeat hit inside 60 s', async () => {
    const h = harness({
      quote: { hasFirstOpen: true, lastOpenedAtMs: NOW - 30_000, sentAtMs: NOW - 120_000 },
    });
    expectPixel(await h.run());
    expect(h.writeStamp).not.toHaveBeenCalled();
  });

  it('writes a repeat hit after 60 s, without touching emailFirstOpenedAt', async () => {
    const h = harness({
      quote: { hasFirstOpen: true, lastOpenedAtMs: NOW - 61_000, sentAtMs: NOW - 120_000 },
    });
    expectPixel(await h.run());
    expect(h.writeStamp).toHaveBeenCalledWith(RECORD, {
      emailLastOpenedAt: STAMP_NOW,
      emailOpenCount: INC,
    });
  });
});

describe('emailOpenPixelUrlForToken', () => {
  it('defaults to the Cloud Function URL', () => {
    delete process.env.QUOTE_EMAIL_OPEN_BASE_URL;
    expect(emailOpenPixelUrlForToken('tok')).toBe(
      'https://us-central1-hansendev.cloudfunctions.net/trackEmailOpen?t=tok',
    );
  });

  it('uses a branded base when configured, and strips a trailing slash', () => {
    process.env.QUOTE_EMAIL_OPEN_BASE_URL = 'https://quotemateapp.au/p/';
    expect(emailOpenPixelUrlForToken('tok')).toBe('https://quotemateapp.au/p?t=tok');
    delete process.env.QUOTE_EMAIL_OPEN_BASE_URL;
  });
});

/**
 * The wrapper in index.ts is where the "never create the quote doc" rule is
 * actually enforced — handleEmailOpen declines to write when readQuote says
 * the doc is gone, but a set({ merge: true }) at the write end would still
 * resurrect a deleted quote as a blank $0 draft (firing the trial bootstrap
 * and the documents mirror with it). Pinned by reading the source, since the
 * endpoint itself needs the admin SDK.
 */
describe('trackEmailOpen wiring (index.ts)', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8');
  // Comments stripped: the rule binds the code, and the code carries a
  // comment that names the very thing it must not do.
  const handler = src
    .slice(
      src.indexOf('export const trackEmailOpen'),
      src.indexOf('export const generateQuoteAcceptanceLink'),
    )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

  it('stamps the open with update(), never a merge set that could create the quote', () => {
    expect(handler).toMatch(/db\.doc\(`users\/\$\{userId\}\/quotes\/\$\{quoteId\}`\)\.update\(/);
    expect(handler).not.toContain('merge: true');
  });

  it('caps a public unauthenticated endpoint with maxInstances', () => {
    expect(handler).toContain('runWith({ maxInstances: 10 })');
  });
});
