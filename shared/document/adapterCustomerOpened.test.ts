/**
 * The customer-open stamps live on the legacy quote only. The mirror is the
 * one road into the app's `documents`, so this pins that the projection
 * carries them (as epoch ms) together with the derived customerOpenedAt /
 * customerOpenSource, and that invoices and un-opened quotes carry nothing.
 */
import { describe, expect, it } from 'vitest';

import { invoiceRecordToDocumentRecord, quoteRecordToDocumentRecord } from './adapter';

const T = 1_760_000_000_000;
const fs = (ms: number) => ({ toDate: () => new Date(ms), seconds: Math.floor(ms / 1000), nanoseconds: 0 });

const baseQuote = {
  quoteNumber: 'QU-007',
  customerName: 'Jones',
  status: 'sent',
  total: 4200,
  createdAt: T - 7200_000,
  updatedAt: T,
  sentAt: T - 3600_000,
};

describe('quoteRecordToDocumentRecord — customer-open projection', () => {
  it('carries a pixel open past the prefetch window as ms numbers plus the derived answer', () => {
    const doc = quoteRecordToDocumentRecord(
      { ...baseQuote, emailFirstOpenedAt: fs(T - 1800_000), emailLastOpenedAt: fs(T - 600_000), emailOpenCount: 3, emailFirstOpenAfterMs: 1_800_000 },
      'q1',
    );
    expect(doc).toMatchObject({
      emailFirstOpenedAt: T - 1800_000,
      emailLastOpenedAt: T - 600_000,
      emailOpenCount: 3,
      emailFirstOpenAfterMs: 1_800_000,
      customerOpenedAt: T - 1800_000,
      customerOpenSource: 'email',
    });
    expect(doc.firstViewedAt).toBeUndefined();
  });

  it('carries a page view and prefers it as the derived open', () => {
    const doc = quoteRecordToDocumentRecord(
      { ...baseQuote, firstViewedAt: fs(T - 900_000), lastViewedAt: fs(T - 100_000), viewCount: 2, emailFirstOpenedAt: fs(T - 1800_000), emailFirstOpenAfterMs: 1_800_000 },
      'q1',
    );
    expect(doc).toMatchObject({ firstViewedAt: T - 900_000, lastViewedAt: T - 100_000, viewCount: 2, customerOpenedAt: T - 900_000, customerOpenSource: 'link' });
  });

  it('keeps a prefetch-window pixel hit as raw data but derives no open from it', () => {
    const doc = quoteRecordToDocumentRecord({ ...baseQuote, emailFirstOpenedAt: fs(T - 100), emailFirstOpenAfterMs: 20_000 }, 'q1');
    expect(doc.emailFirstOpenedAt).toBe(T - 100);
    expect(doc.customerOpenedAt).toBeUndefined();
    expect(doc.customerOpenSource).toBeUndefined();
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
