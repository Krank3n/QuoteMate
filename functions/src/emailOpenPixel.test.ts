/**
 * Pure-helpers tests for the email-open tracking pixel. The HTTPS handler
 * in index.ts is thin around these — token hash, well-formed check, pixel
 * bytes/headers, and the stamp update shape — so pinning each here covers
 * the branches without booting the admin SDK.
 */
import { describe, expect, it } from 'vitest';
import {
  EMAIL_OPEN_PIXEL_GIF,
  EMAIL_OPEN_PIXEL_HEADERS,
  buildEmailOpenStamp,
  emailOpenPixelUrlForToken,
  generateEmailOpenToken,
  hashEmailOpenToken,
  isWellFormedEmailOpenToken,
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
