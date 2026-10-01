import { describe, it, expect } from 'vitest';
import {
  applyLoggedHours,
  chargeLoggedHoursPlan,
  hourlyRateOf,
  loggedHoursOffer,
  quotedHoursOf,
} from './loggedHours';
import { labourHoursOnDocument } from './labourEditor';
import { updateDocumentCalculations } from './documentCalculator';
import type { Document } from '../types/document';

/** A plain hourly invoice: 10 h at $100, $500 of materials, GST on top. */
function hourlyDoc(over: Partial<Document> = {}): Document {
  return updateDocumentCalculations({
    id: 'inv-1',
    type: 'invoice',
    stage: 'draft',
    jobId: 'job-1',
    materials: [{ id: 'm1', name: 'Timber', quantity: 1, unit: 'each', price: 500, totalPrice: 500 }],
    laborRate: 100,
    laborHours: 10,
    laborUnit: 'hours',
    markup: 0,
    laborMarkup: 0,
    travelAdjustment: 0,
    gstRegistered: true,
    paidTotal: 0,
    ...over,
  } as unknown as Document);
}

const section = (id: string, hours: number, rate: number, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  laborHours: hours,
  multiplier: 1,
  laborHoursTotal: hours,
  laborRate: rate,
  laborUnit: 'hours' as const,
  laborTotal: hours * rate,
  ...extra,
});

/** Two hourly sections at the document rate: 6 h + 4 h at $90. */
function sectionedDoc(over: Partial<Document> = {}): Document {
  return hourlyDoc({
    laborRate: 90,
    laborHours: 10,
    laborExtraHours: 0,
    sections: [section('frame', 6, 90), section('clad', 4, 90)],
    ...over,
  } as Partial<Document>);
}

describe('when to offer charging the logged hours', () => {
  it('offers when logged and invoiced hours differ', () => {
    expect(loggedHoursOffer(hourlyDoc(), 14.5)).toEqual({ quotedHours: 10, loggedHours: 14.5, rate: 100 });
  });

  it('stays quiet with nothing logged, or when they already agree (within six minutes)', () => {
    expect(loggedHoursOffer(hourlyDoc(), 0)).toBeNull();
    expect(loggedHoursOffer(hourlyDoc(), 10)).toBeNull();
    expect(loggedHoursOffer(hourlyDoc(), 10.05)).toBeNull();
  });

  it('never offers when any labour is a set price — the logged time may be inside it', () => {
    const withLumpSum = sectionedDoc({
      sections: [section('frame', 10, 90), section('demo', 0, 0, { pricing: 'lumpSum', laborTotal: 2000 })],
    } as Partial<Document>);
    expect(hourlyRateOf(withLumpSum)).toBe(0);
    expect(loggedHoursOffer(withLumpSum, 30)).toBeNull();
    expect(applyLoggedHours(withLumpSum, 30)).toBeNull();
  });

  it('never offers when a work item carries labour as a price', () => {
    const doc = hourlyDoc({
      materials: [{ id: 'w', name: 'Install', quantity: 1, unit: 'each', price: 800, totalPrice: 800, kind: 'work' } as any],
    });
    expect(loggedHoursOffer(doc, 12)).toBeNull();
  });

  it('never offers when hourly sections are at different rates', () => {
    const mixed = sectionedDoc({ sections: [section('apprentice', 6, 60), section('sparky', 4, 150)] } as Partial<Document>);
    expect(loggedHoursOffer(mixed, 12)).toBeNull();
  });

  it('never offers on a job quoted with no hours (supply-only, rate lines)', () => {
    expect(loggedHoursOffer(hourlyDoc({ laborHours: 0 }), 3)).toBeNull();
  });

  it('never offers without an hourly rate', () => {
    expect(loggedHoursOffer(hourlyDoc({ laborRate: 0 }), 5)).toBeNull();
  });
});

describe('charging the logged hours', () => {
  it('without sections, moves the hours and every total follows', () => {
    const before = hourlyDoc();
    const after = applyLoggedHours(before, 14.5)!;
    expect(after.laborHours).toBe(14.5);
    expect(after.laborTotal).toBe(1450);
    expect(after.subtotal).toBe(1950);
    expect(after.total).toBeCloseTo(2145, 2);
    expect(after.materials).toEqual(before.materials);
    expect(after.laborRate).toBe(100);
  });

  it('with sections, writes only laborExtraHours — every section keeps its quoted hours', () => {
    const before = sectionedDoc();
    const after = applyLoggedHours(before, 13)!;
    expect(after.sections).toEqual(before.sections);
    expect(after.laborExtraHours).toBe(3);
    expect(after.laborTotal).toBe(900 + 270);
    expect(labourHoursOnDocument(after)).toBe(13);
  });

  it('keeps the document rate, so existing extra labour is not repriced', () => {
    const before = sectionedDoc({ laborExtraHours: 2 } as Partial<Document>);
    const after = applyLoggedHours(before, 15)!;
    expect(after.laborRate).toBe(90);
    // 900 of sections + 5 h × $90: the 3 new hours cost exactly 3 × $90 more.
    expect(after.laborTotal - before.laborTotal).toBe(270);
  });

  it('stamps the quoted hours once, so "quoted vs logged" still means something after', () => {
    const once = applyLoggedHours(hourlyDoc(), 14)!;
    expect(once.quotedLaborHours).toBe(10);
    expect(quotedHoursOf(once)).toBe(10);
    const twice = applyLoggedHours(once, 16)!;
    expect(twice.quotedLaborHours).toBe(10);
  });

  it('keeps the undo in step — revert restores the new total, not the old price', () => {
    const converted = hourlyDoc({ convertedFromQuote: { total: 1650, stage: 'quote_accepted', at: 1 } } as Partial<Document>);
    const after = applyLoggedHours(converted, 12)!;
    expect(after.convertedFromQuote!.total).toBe(after.total);
  });

  it('survives a later recalculation — the send path recomputes totals', () => {
    const after = applyLoggedHours(sectionedDoc(), 13)!;
    const again = updateDocumentCalculations(after);
    expect(again.total).toBe(after.total);
    expect(again.laborTotal).toBe(after.laborTotal);
  });

  it('reads a legacy days-based document in hours', () => {
    const legacy = hourlyDoc({ laborUnit: 'days' as any, laborHours: 2, laborRate: 640 });
    expect(labourHoursOnDocument(legacy)).toBe(16);
    const after = applyLoggedHours(legacy, 18)!;
    expect(after.laborHours).toBe(18);
    expect(after.laborTotal).toBe(1440);
  });
});

describe('the invoice offer', () => {
  it('reports the real before and after totals, markup and GST included', () => {
    const doc = hourlyDoc({ laborMarkup: 20, pricesIncludeGst: true } as Partial<Document>);
    const plan = chargeLoggedHoursPlan(doc, 12)!;
    expect(plan.fromTotal).toBe(doc.total);
    expect(plan.toTotal).toBe(plan.next.total);
    // 2 more hours at $100 with 20% labour markup = $240, GST already inside.
    expect(plan.toTotal - plan.fromTotal).toBeCloseTo(240, 2);
    expect(plan.raises).toBe(true);
  });

  it('is never made once money has been taken — a deposit would be charged twice', () => {
    expect(chargeLoggedHoursPlan(hourlyDoc({ depositPaid: 300 } as Partial<Document>), 12)).toBeNull();
    expect(chargeLoggedHoursPlan(hourlyDoc({ paidTotal: 100 } as Partial<Document>), 12)).toBeNull();
    expect(chargeLoggedHoursPlan(hourlyDoc({ stage: 'partially_paid' } as Partial<Document>), 12)).toBeNull();
    expect(chargeLoggedHoursPlan(hourlyDoc({ stage: 'paid' } as Partial<Document>), 12)).toBeNull();
  });

  it('is never made on a quote, a cancelled invoice, or one pushed to Xero', () => {
    expect(chargeLoggedHoursPlan(hourlyDoc({ type: 'quote' } as Partial<Document>), 12)).toBeNull();
    expect(chargeLoggedHoursPlan(hourlyDoc({ stage: 'cancelled' } as Partial<Document>), 12)).toBeNull();
    expect(chargeLoggedHoursPlan(hourlyDoc({ xeroInvoiceId: 'x1' } as Partial<Document>), 12)).toBeNull();
  });

  it('flags a sent invoice so the tradie knows to send the new one', () => {
    expect(chargeLoggedHoursPlan(hourlyDoc(), 12)!.alreadySent).toBe(false);
    expect(chargeLoggedHoursPlan(hourlyDoc({ stage: 'invoice_sent' } as Partial<Document>), 12)!.alreadySent).toBe(true);
  });
});
