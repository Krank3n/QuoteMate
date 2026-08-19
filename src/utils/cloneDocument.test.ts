/**
 * What a cloned document must and must not inherit.
 *
 * The reset list is the whole function: everything omitted from it is money or
 * delivery state that would follow a clone into the world claiming to have
 * been sent, viewed, answered or paid. Each field gets its own assertion so a
 * future edit that drops one fails here rather than in front of a customer.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { cloneDocument } from './cloneDocument';
import type { Document } from '../types/document';

let seq = 0;
const nextId = () => `gen-${++seq}`;

function source(over: Partial<Document> = {}): Document {
  return {
    id: 'src-1',
    jobId: 'job-1',
    type: 'quote',
    stage: 'quote_sent',
    number: 'QU-001',
    createdAt: 1000,
    updatedAt: 2000,
    customerName: 'Barb',
    job: { name: 'Aircon replacement', description: 'Like for like' },
    materials: [
      { id: 'm-1', name: 'Multi head unit', quantity: 1, unit: 'each', price: 3723.5, totalPrice: 3723.5 },
      { id: 'm-2', name: 'Consumables', quantity: 1, unit: 'each', price: 250, totalPrice: 250 },
    ],
    sections: [
      { id: 's-1', name: 'Option 1', laborHours: 8, laborRate: 100, laborUnit: 'hours', laborTotal: 800, multiplier: 1, sortOrder: 0 },
    ],
    photos: [{ id: 'p-1', storageUrl: 'https://example.test/a.jpg' }],
    materialsSubtotal: 3973.5,
    laborTotal: 800,
    subtotal: 4773.5,
    markupAmount: 1034.7,
    gst: 580.82,
    total: 6389.02,
    balanceDue: 6389.02,
    payments: [],
    // Delivery + response state from the source's own send.
    sentAt: 5000,
    sendMethod: 'sms',
    acceptanceToken: 'tok-abc',
    acceptanceTokenCreatedAt: 5001,
    respondedAt: 6000,
    respondedBy: 'Barb',
    clientNotes: 'Looks good',
    acceptedAt: 6001,
    // Money + pay-link state.
    depositPaid: 500,
    depositPaidAt: 6100,
    paidTotal: 500,
    depositPaymentLinkUrl: 'https://square.test/deposit',
    squarePaymentLinkUrl: 'https://square.test/full',
    squarePaymentId: 'sq-1',
    draftEmailBody: 'Your quote comes to $6,389.02.',
    draftEmailSubject: 'Quotation',
    ...over,
  } as unknown as Document;
}

const opts = (over: Partial<Parameters<typeof cloneDocument>[1]> = {}) => ({
  kind: 'quote_option' as const,
  jobId: 'job-1',
  id: 'new-1',
  number: 'QU-002',
  now: 9000,
  nextId,
  ...over,
});

beforeEach(() => { seq = 0; });

describe('cloning as a quote option', () => {
  it('lands as a draft on the SAME job, never as accepted work', () => {
    const clone = cloneDocument(source(), opts());

    expect(clone.stage).toBe('draft');
    expect(clone.jobId).toBe('job-1');
    // The repeat-visit path stamps acceptedAt; an option nobody has seen must
    // not walk straight into the won column.
    expect(clone.acceptedAt).toBeUndefined();
  });

  it('takes its own id and number', () => {
    const clone = cloneDocument(source(), opts());

    expect(clone.id).toBe('new-1');
    expect(clone.number).toBe('QU-002');
    expect(clone.createdAt).toBe(9000);
    expect(clone.updatedAt).toBe(9000);
  });

  it('keeps the photos — same site, same day', () => {
    const clone = cloneDocument(source(), opts());

    expect(clone.photos).toHaveLength(1);
  });

  it('carries the priced scope across so the tradie edits rather than retypes', () => {
    const clone = cloneDocument(source(), opts());

    expect(clone.materials.map((m: any) => m.name)).toEqual(['Multi head unit', 'Consumables']);
    expect(clone.sections?.[0].name).toBe('Option 1');
    expect(clone.total).toBe(6389.02);
  });
});

describe('cloning as a repeat visit', () => {
  it('lands accepted on the new job, with the photos dropped', () => {
    const clone = cloneDocument(source(), opts({ kind: 'repeat_visit', jobId: 'job-2' }));

    expect(clone.stage).toBe('quote_accepted');
    expect(clone.acceptedAt).toBe(9000);
    expect(clone.jobId).toBe('job-2');
    // A repeat visit is a different day; the old site photos are not of it.
    expect(clone.photos).toEqual([]);
  });
});

describe('what no clone may ever inherit', () => {
  const kinds = ['quote_option', 'repeat_visit'] as const;

  for (const kind of kinds) {
    describe(kind, () => {
      const clone = () => cloneDocument(source(), opts({ kind, jobId: 'job-x' }));

      it('has never been sent', () => {
        expect(clone().sentAt).toBeUndefined();
        expect(clone().sendMethod).toBeUndefined();
      });

      it('carries no acceptance link from the source', () => {
        // The token maps to the SOURCE quote in quoteAcceptanceTokens, so an
        // inherited one is at best inert and at worst points a customer at
        // the wrong document.
        expect(clone().acceptanceToken).toBeUndefined();
        expect(clone().acceptanceTokenCreatedAt).toBeUndefined();
      });

      it('has not been responded to', () => {
        // Regression: getQuoteForAcceptance short-circuits on respondedAt and
        // reports "already responded to". A clone that inherited it could be
        // sent, but its link was dead before the customer opened it.
        expect(clone().respondedAt).toBeUndefined();
        expect(clone().respondedBy).toBeUndefined();
        expect(clone().clientNotes).toBeUndefined();
      });

      it('starts with no money against it', () => {
        expect(clone().paidTotal).toBe(0);
        expect(clone().depositPaid).toBe(0);
        expect(clone().depositPaidAt).toBeUndefined();
        expect(clone().payments).toEqual([]);
      });

      it('inherits no Square pay links, which carry the source amount', () => {
        expect(clone().depositPaymentLinkUrl).toBeUndefined();
        expect(clone().squarePaymentLinkUrl).toBeUndefined();
        expect(clone().squarePaymentId).toBeUndefined();
      });

      it('drops the drafted email, which names the source total', () => {
        expect(clone().draftEmailBody).toBeUndefined();
        expect(clone().draftEmailSubject).toBeUndefined();
      });

      it('re-ids every nested row so edits cannot splash across documents', () => {
        const c = clone();
        expect(c.materials.map((m: any) => m.id)).toEqual(['gen-1', 'gen-2']);
        expect(c.sections?.map((s: any) => s.id)).toEqual(['gen-3']);
      });

      it('leaves the source untouched', () => {
        const src = source();
        const before = JSON.stringify(src);
        cloneDocument(src, opts({ kind }));
        expect(JSON.stringify(src)).toBe(before);
      });
    });
  }
});

describe('cloning from an invoice', () => {
  it('adds the paid deposit back, so the clone quotes the job not the residual', () => {
    // convertDocumentToInvoice subtracts a paid deposit from the invoice
    // total; cloning that verbatim would quote what was left to pay.
    const invoice = source({
      type: 'invoice',
      total: 5889.02,
      payments: [{ id: 'p1', kind: 'deposit', amount: 500 }],
    } as any);

    const clone = cloneDocument(invoice, opts({ kind: 'repeat_visit', jobId: 'job-2' }));

    expect(clone.total).toBe(6389.02);
    expect(clone.balanceDue).toBe(6389.02);
    expect(clone.type).toBe('quote');
  });

  it('leaves a quote total alone — there is no deposit to restore', () => {
    const clone = cloneDocument(source(), opts());

    expect(clone.total).toBe(6389.02);
  });
});
