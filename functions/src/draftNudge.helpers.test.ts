import { describe, it, expect } from 'vitest';
import {
  isReadyToSend,
  shouldReadyToSendNudge,
  toMs,
  READY_TO_SEND_MIN_AGE_MS,
  type NudgeQuote,
} from './draftNudge.helpers';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-07-02T00:00:00.000Z');

// Minimal builder — a finished-but-unsent draft by default, so each fixture
// only states the field it's exercising.
function quote(over: Partial<NudgeQuote>): NudgeQuote {
  return {
    status: 'draft',
    customerName: 'Dawn Reeves',
    materials: [{ name: 'Timber' }],
    draftStep: undefined,
    readyToSendNudgedAt: undefined,
    updatedAt: NOW - 25 * HOUR,
    ...over,
  };
}

describe('shouldReadyToSendNudge — finished, unsent, within the [24h, 30d] window', () => {
  it('finalized-unsent-25h → yes', () => {
    expect(shouldReadyToSendNudge(quote({ updatedAt: NOW - 25 * HOUR }), NOW)).toBe(true);
  });

  it('sent → no', () => {
    expect(shouldReadyToSendNudge(quote({ status: 'sent' }), NOW)).toBe(false);
  });

  it('nudged-already → no', () => {
    expect(shouldReadyToSendNudge(quote({ readyToSendNudgedAt: NOW - 26 * HOUR }), NOW)).toBe(false);
  });

  it("draft mid-wizard (draftStep 'MaterialsList') → no", () => {
    expect(shouldReadyToSendNudge(quote({ draftStep: 'MaterialsList' }), NOW)).toBe(false);
  });

  it('brand-new-3h → no', () => {
    expect(shouldReadyToSendNudge(quote({ updatedAt: NOW - 3 * HOUR }), NOW)).toBe(false);
  });

  it("at-preview-25h (draftStep 'JobPreview') → yes", () => {
    expect(shouldReadyToSendNudge(quote({ draftStep: 'JobPreview', updatedAt: NOW - 25 * HOUR }), NOW)).toBe(true);
  });

  it("legacy 'QuotePreview' → yes", () => {
    expect(shouldReadyToSendNudge(quote({ draftStep: 'QuotePreview' }), NOW)).toBe(true);
  });

  it('no materials → no', () => {
    expect(shouldReadyToSendNudge(quote({ materials: [] }), NOW)).toBe(false);
  });

  it('no customer → no', () => {
    expect(shouldReadyToSendNudge(quote({ customerName: '   ' }), NOW)).toBe(false);
  });

  it('non-string customerName → no, never throws (regression: one malformed doc must not kill the whole run)', () => {
    for (const bad of [123, true, { name: 'x' }, ['x']]) {
      expect(() => isReadyToSend(quote({ customerName: bad as any }))).not.toThrow();
      expect(isReadyToSend(quote({ customerName: bad as any }))).toBe(false);
    }
  });

  it('exactly-24h boundary → yes (inclusive)', () => {
    expect(shouldReadyToSendNudge(quote({ updatedAt: NOW - READY_TO_SEND_MIN_AGE_MS }), NOW)).toBe(true);
  });

  it('older-than-30d → no', () => {
    expect(shouldReadyToSendNudge(quote({ updatedAt: NOW - 31 * DAY }), NOW)).toBe(false);
  });

  it('falls back to createdAt when updatedAt is absent', () => {
    expect(shouldReadyToSendNudge(quote({ updatedAt: undefined, createdAt: NOW - 25 * HOUR }), NOW)).toBe(true);
  });
});

describe('isReadyToSend — draft + customer + materials + at/past preview', () => {
  it('cleared draftStep with customer and materials is ready', () => {
    expect(isReadyToSend(quote({ draftStep: undefined }))).toBe(true);
  });
  it('null quote is not ready', () => {
    expect(isReadyToSend(null)).toBe(false);
  });
  it('mid-wizard step is not ready', () => {
    expect(isReadyToSend(quote({ draftStep: 'LaborMarkup' }))).toBe(false);
  });
});

describe('toMs — parses epoch-ms, Firestore Timestamps, ISO strings defensively', () => {
  it('passes through a finite epoch-ms number', () => {
    expect(toMs(NOW)).toBe(NOW);
  });
  it('parses an ISO string', () => {
    expect(toMs('2026-07-02T00:00:00.000Z')).toBe(NOW);
  });
  it('reads a live Firestore Timestamp via toMillis', () => {
    expect(toMs({ toMillis: () => NOW })).toBe(NOW);
  });
  it('reads a serialized Timestamp shape ({ _seconds, _nanoseconds })', () => {
    expect(toMs({ _seconds: NOW / 1000, _nanoseconds: 0 })).toBe(NOW);
  });
  it('returns null for unusable values', () => {
    expect(toMs(undefined)).toBeNull();
    expect(toMs('not-a-date')).toBeNull();
    expect(toMs({})).toBeNull();
  });
});
