/**
 * The customer-open stamps live on the legacy quote only. The mirror is the
 * main road into the app's `documents`, so this pins that the projection
 * carries them (as epoch ms) together with the derived customerOpenedAt /
 * customerOpenSource, clears the derived pair with explicit nulls when a
 * re-send made the open stale, and that invoices and un-opened quotes carry
 * nothing.
 */
import { describe, expect, it } from 'vitest';

import { invoiceRecordToDocumentRecord, quoteRecordToDocumentRecord } from './adapter';

const T = 1_760_000_000_000;
const SENT = T - 3600_000;
const fs = (ms: number) => ({ toDate: () => new Date(ms), seconds: Math.floor(ms / 1000), nanoseconds: 0 });

const baseQuote = {
  quoteNumber: 'QU-007',
  customerName: 'Jones',
  status: 'sent',
  total: 4200,
  createdAt: T - 7200_000,
  updatedAt: T,
  sentAt: fs(SENT),
};

describe('quoteRecordToDocumentRecord — customer-open projection', () => {
  it('carries a pixel open past the prefetch window as ms numbers plus the derived answer', () => {
    const doc = quoteRecordToDocumentRecord(
      { ...baseQuote, emailFirstOpenedAt: fs(SENT + 1800_000), emailLastOpenedAt: fs(SENT + 3000_000), emailOpenCount: 3, emailFirstOpenAfterMs: 1_800_000 },
      'q1',
    );
    expect(doc).toMatchObject({
      emailFirstOpenedAt: SENT + 1800_000,
      emailLastOpenedAt: SENT + 3000_000,
      emailOpenCount: 3,
      emailFirstOpenAfterMs: 1_800_000,
      customerOpenedAt: SENT + 1800_000,
      customerOpenSource: 'email',
    });
    expect(doc.firstViewedAt).toBeUndefined();
  });

  it('carries a page view and prefers it as the derived open', () => {
    const doc = quoteRecordToDocumentRecord(
      { ...baseQuote, firstViewedAt: fs(SENT + 900_000), lastViewedAt: fs(SENT + 1000_000), viewCount: 2, emailFirstOpenedAt: fs(SENT + 800_000), emailFirstOpenAfterMs: 800_000 },
      'q1',
    );
    expect(doc).toMatchObject({ firstViewedAt: SENT + 900_000, lastViewedAt: SENT + 1000_000, viewCount: 2, customerOpenedAt: SENT + 900_000, customerOpenSource: 'link' });
  });

  it('keeps a prefetch-window pixel hit as raw data and derives an explicit null from it', () => {
    const doc = quoteRecordToDocumentRecord({ ...baseQuote, emailFirstOpenedAt: fs(SENT + 4000), emailFirstOpenAfterMs: 4000 }, 'q1');
    expect(doc.emailFirstOpenedAt).toBe(SENT + 4000);
    expect(doc.customerOpenedAt).toBeNull();
    expect(doc.customerOpenSource).toBeNull();
  });

  it('a re-send makes an earlier open stale: derived pair goes null so a merge clears it', () => {
    const doc = quoteRecordToDocumentRecord(
      { ...baseQuote, sentAt: fs(T), emailFirstOpenedAt: fs(SENT + 600_000), emailFirstOpenAfterMs: 600_000 },
      'q1',
    );
    expect(doc.customerOpenedAt).toBeNull();
    expect(doc.emailFirstOpenedAt).toBe(SENT + 600_000);
  });

  it('projects nothing for an un-opened quote', () => {
    const doc = quoteRecordToDocumentRecord(baseQuote, 'q1');
    for (const k of ['firstViewedAt', 'lastViewedAt', 'viewCount', 'emailFirstOpenedAt', 'emailLastOpenedAt', 'emailOpenCount', 'emailFirstOpenAfterMs', 'customerOpenedAt', 'customerOpenSource']) {
      expect(doc[k]).toBeUndefined();
    }
  });

  it('never projects open fields onto an invoice', () => {
    const doc = invoiceRecordToDocumentRecord(
      { invoiceNumber: 'INV-1', status: 'sent', total: 100, createdAt: T, updatedAt: T, emailFirstOpenedAt: fs(T), emailFirstOpenAfterMs: 999_999 },
      'i1',
    );
    expect(doc.customerOpenedAt).toBeUndefined();
    expect(doc.emailFirstOpenedAt).toBeUndefined();
  });
});
