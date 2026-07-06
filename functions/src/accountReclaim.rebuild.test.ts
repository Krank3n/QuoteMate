import { describe, it, expect } from 'vitest';
import {
  buildRecoveredQuoteDoc,
  buildRecoveredContactDoc,
  shouldInjectRecoveredDocs,
} from './accountReclaim.rebuild';

const HAYDEN_REC = {
  quoteNumber: 'QU-177696',
  customerName: 'Tina Upton',
  customerEmail: 'tina@example.com',
  sentDate: '2026-04-23',
  jobTitle: 'Fencing, Garden Beds and Concrete Works',
  description: 'Supply and install of fencing plus garden beds.',
  materialsTotal: 2127.01,
  labourTotal: 6912.0,
  subtotal: 9039.01,
  gst: 903.9,
  total: 9942.91,
};

describe('buildRecoveredQuoteDoc', () => {
  it('builds a schema-complete quote with stored totals and recompute-safe lines', () => {
    const doc = buildRecoveredQuoteDoc(HAYDEN_REC, 3, 'admin@thieleconstructions.com.au')!;
    expect(doc).toMatchObject({
      id: 'recovered-QU-177696',
      quoteNumber: 'QU-177696',
      customerName: 'Tina Upton',
      customerEmail: 'tina@example.com',
      status: 'sent',
      subtotal: 9039.01,
      gst: 903.9,
      total: 9942.91,
      pricesIncludeGst: false,
      laborTotal: 0,
      markup: 0,
      restoredFromIncident: 'incident-2026-07',
    });
    const mats = doc.materials as Array<Record<string, unknown>>;
    expect(mats).toHaveLength(2);
    // dollar breakdown encoded as lines so a user edit's recompute
    // (Σ totalPrice + labour 0 + markup 0) reproduces the subtotal
    expect(mats.map(m => m.totalPrice)).toEqual([2127.01, 6912.0]);
    // priced + unlocked → the pricing pipeline gate always skips them
    expect(mats.every(m => m.manualPriceOverride === false && (m.price as number) > 0)).toBe(true);
    expect((doc.createdAt as Date).toISOString()).toBe('2026-04-23T00:00:00.000Z');
  });

  it('drops a self-addressed customer email (tradie sent the quote to themselves)', () => {
    const doc = buildRecoveredQuoteDoc(
      { ...HAYDEN_REC, customerEmail: 'Admin@ThieleConstructions.com.au' },
      0,
      'admin@thieleconstructions.com.au',
    )!;
    expect(doc.customerEmail).toBeUndefined();
  });

  it('handles total-only records as GST-inclusive single-line quotes', () => {
    const doc = buildRecoveredQuoteDoc(
      { customerName: 'George', sentDate: '2026-06-17', total: 1100 },
      7,
      't@t.co',
    )!;
    expect(doc.pricesIncludeGst).toBe(true);
    expect(doc.subtotal).toBe(1100);
    expect(doc.total).toBe(1100);
    expect(doc.gst).toBe(100); // extracted 1/11th
    const mats = doc.materials as Array<Record<string, unknown>>;
    expect(mats).toHaveLength(1);
    expect(mats[0].totalPrice).toBe(1100);
  });

  it('returns null for records without a usable total', () => {
    expect(buildRecoveredQuoteDoc({ customerName: 'X' }, 0, 't@t.co')).toBeNull();
    expect(buildRecoveredQuoteDoc({ total: 0 }, 0, 't@t.co')).toBeNull();
  });
});

describe('buildRecoveredContactDoc', () => {
  it('builds a Contact-schema doc', () => {
    expect(
      buildRecoveredContactDoc({ name: 'Tina Upton', email: 'tina@example.com' }, 2, '2026-07-06T00:00:00.000Z'),
    ).toEqual({
      id: 'recovered-contact-2',
      name: 'Tina Upton',
      email: 'tina@example.com',
      source: 'quote',
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
    });
  });

  it('rejects blank names', () => {
    expect(buildRecoveredContactDoc({ name: ' ' }, 0, 'x')).toBeNull();
  });
});

describe('shouldInjectRecoveredDocs — device-restore protection', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.parse('2026-07-08T00:00:00Z');

  it('injects for a mature claim with no history', () => {
    expect(shouldInjectRecoveredDocs({
      claimedAtMs: now - 2 * DAY, alreadyRestored: false, hasPreIncidentQuotes: false, nowMs: now,
    })).toBe(true);
  });

  it('waits out the 24h device-restore window', () => {
    expect(shouldInjectRecoveredDocs({
      claimedAtMs: now - DAY / 2, alreadyRestored: false, hasPreIncidentQuotes: false, nowMs: now,
    })).toBe(false);
  });

  it('never duplicates a device restore (pre-incident history present)', () => {
    expect(shouldInjectRecoveredDocs({
      claimedAtMs: now - 2 * DAY, alreadyRestored: false, hasPreIncidentQuotes: true, nowMs: now,
    })).toBe(false);
  });

  it('never runs twice and never without a claim', () => {
    expect(shouldInjectRecoveredDocs({
      claimedAtMs: now - 2 * DAY, alreadyRestored: true, hasPreIncidentQuotes: false, nowMs: now,
    })).toBe(false);
    expect(shouldInjectRecoveredDocs({
      claimedAtMs: null, alreadyRestored: false, hasPreIncidentQuotes: false, nowMs: now,
    })).toBe(false);
  });
});
