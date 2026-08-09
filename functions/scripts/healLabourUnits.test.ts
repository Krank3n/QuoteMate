/**
 * Tests for the canonical-hours migration, built from the real production
 * documents the day-rate bug produced (Aug 2026 audit).
 */

import { describe, it, expect } from 'vitest';
import {
  recomputeTotals,
  totalsAreVerifiable,
  rateMultiple,
  repairRate,
  isCustomerFacing,
  syncEstimatedHours,
} from './healLabourUnits';
import { normaliseLabourToHours } from '../src/shared/document/labourUnits';
import { checkDocumentIntegrity } from '../src/shared/document/integrityCheck';

/** Bob's Fencing QU-178621 exactly as stored: $5,440/day, three day sections. */
function bobsFencing() {
  return {
    type: 'quote',
    stage: 'draft',
    number: 'QU-178621',
    laborRate: 5440,
    laborUnit: 'days',
    laborHours: 4.2,
    laborExtraHours: 0.1,
    laborTotal: 23337.6,
    laborMarkup: 0,
    markup: 0,
    markupAmount: 0,
    travelAdjustment: 0,
    materialsSubtotal: 5067.7,
    subtotal: 28405.3,
    gst: 2840.53,
    total: 31245.83,
    gstRegistered: true,
    pricesIncludeGst: false,
    materials: [{ name: 'Fence materials', quantity: 1, unit: 'each', price: 5067.7, totalPrice: 5067.7 }],
    sections: [
      { id: 'a', name: 'Demolition & Disposal', multiplier: 1, laborHours: 0.1, laborHoursTotal: 0.1, laborRate: 5440, laborUnit: 'days', laborTotal: 544 },
      { id: 'b', name: '2.4m Timber Fence Bay', multiplier: 21, laborHours: 0.19, laborHoursTotal: 3.99, laborRate: 5440, laborUnit: 'days', laborTotal: 21705.6 },
      { id: 'c', name: 'Final End Post', multiplier: 1, laborHours: 0.1, laborHoursTotal: 0.1, laborRate: 5440, laborUnit: 'days', laborTotal: 544 },
    ],
    job: { estimatedHours: 34 },
  };
}

/** right roofing QU-178558: same bug wearing hours — $680/hour on real hours. */
function rightRoofing() {
  return {
    type: 'quote',
    stage: 'quote_sent',
    number: 'QU-178558',
    sentAt: 1785596669085,
    laborRate: 680,
    laborUnit: 'hours',
    laborHours: 13.5,
    laborExtraHours: 0,
    laborTotal: 9180,
    laborMarkup: 0,
    markup: 0,
    markupAmount: 0,
    travelAdjustment: 0,
    materialsSubtotal: 21382,
    subtotal: 30562,
    gst: 3056.2,
    total: 33618.2,
    gstRegistered: true,
    pricesIncludeGst: false,
    materials: [{ name: 'Roofing', quantity: 1, unit: 'each', price: 21382, totalPrice: 21382 }],
    sections: [
      { id: 'a', name: 'Roof Tiles & Bedding', multiplier: 1, laborHours: 5, laborRate: 680, laborUnit: 'hours', laborTotal: 3400 },
      { id: 'b', name: 'Sarking & Battens', multiplier: 1, laborHours: 2.5, laborRate: 680, laborUnit: 'hours', laborTotal: 1700 },
      { id: 'c', name: 'Fascia, Gutter & Downpipes', multiplier: 1, laborHours: 2, laborRate: 680, laborUnit: 'hours', laborTotal: 1360 },
      { id: 'd', name: 'Ventilation & Flashing', multiplier: 1, laborHours: 4, laborRate: 680, laborUnit: 'hours', laborTotal: 2720 },
    ],
    job: { estimatedHours: 14 },
  };
}

describe('recomputeTotals — the mirror of calculateDocumentTotals', () => {
  it('reproduces what production actually stored', () => {
    const t = recomputeTotals(bobsFencing());
    expect(t.laborTotal).toBe(23337.6);
    expect(t.subtotal).toBe(28405.3);
    expect(t.gst).toBe(2840.53);
    expect(t.total).toBe(31245.83);
    expect(totalsAreVerifiable(bobsFencing())).toBe(true);
  });

  it('refuses a document whose stored totals it cannot reproduce', () => {
    expect(totalsAreVerifiable({ ...bobsFencing(), total: 99999 })).toBe(false);
    expect(totalsAreVerifiable({ ...bobsFencing(), total: undefined })).toBe(false);
  });

  it('handles the not-registered and GST-inclusive modes', () => {
    const notRegistered = recomputeTotals({ ...bobsFencing(), gstRegistered: false });
    expect(notRegistered.gst).toBe(0);
    expect(notRegistered.total).toBe(28405.3);

    const inclusive = recomputeTotals({ ...bobsFencing(), pricesIncludeGst: true });
    expect(inclusive.total).toBe(28405.3);
    expect(inclusive.gst).toBeCloseTo(2582.3, 2);
  });
});

describe('rateMultiple — spotting the bug through either unit', () => {
  it('reads $5,440/day as 8× an $85/h business', () => {
    expect(rateMultiple(bobsFencing(), 85)).toBeCloseTo(8, 6);
  });

  it('reads $680/hour as 8× the same business', () => {
    expect(rateMultiple(rightRoofing(), 85)).toBeCloseTo(8, 6);
  });

  it('is unchanged by normalising first — the two shapes are one bug', () => {
    expect(rateMultiple(normaliseLabourToHours(bobsFencing()), 85)).toBeCloseTo(8, 6);
  });

  it('leaves a genuine premium rate alone', () => {
    const premium = { ...bobsFencing(), sections: [{ id: 'a', multiplier: 1, laborHours: 2, laborRate: 170, laborUnit: 'hours', laborTotal: 340 }] };
    expect(rateMultiple(premium, 85)).toBe(2);
  });

  it('returns null when the business rate is unknown or the doc has no rate', () => {
    expect(rateMultiple(bobsFencing(), 0)).toBeNull();
    expect(rateMultiple({ laborRate: 0, sections: [] }, 85)).toBeNull();
  });
});

describe('the full heal, end to end', () => {
  it("restores Bob's Fencing to the price the tradie meant", () => {
    const before = bobsFencing();
    const normalised = normaliseLabourToHours(before);

    // Normalisation alone must not move a dollar.
    expect(recomputeTotals(normalised).total).toBe(before.total);
    expect(normalised.laborRate).toBe(680);
    expect(normalised.sections[1].laborHours).toBeCloseTo(1.52, 6);
    expect(normalised.sections[1].laborTotal).toBe(21705.6);

    const repaired = syncEstimatedHours(repairRate(normalised, 8));

    expect(repaired.laborRate).toBe(85);
    expect(repaired.sections.every((s: any) => s.laborRate === 85 && s.laborUnit === 'hours')).toBe(true);
    expect(repaired.laborTotal).toBe(2917.2);
    expect(repaired.subtotal).toBe(7984.9);
    expect(repaired.gst).toBe(798.49);
    expect(repaired.total).toBe(8783.39);
    // 21 bays × 1.52h + 0.8 + 0.8 + 0.8 extra = 34.32h
    expect(repaired.job.estimatedHours).toBe(34);

    // And the result is clean by the shared checker, at the tradie's own rate.
    expect(checkDocumentIntegrity(repaired, { businessHourlyRate: 85 })).toEqual([]);
  });

  it('restores right roofing without touching its materials', () => {
    const repaired = repairRate(normaliseLabourToHours(rightRoofing()), 8);
    expect(repaired.laborRate).toBe(85);
    expect(repaired.laborTotal).toBe(1147.5);
    expect(repaired.materialsSubtotal).toBe(21382);
    expect(repaired.total).toBe(24782.45); // (21,382 + 1,147.50) × 1.1
    expect(checkDocumentIntegrity(repaired, { businessHourlyRate: 85 })).toEqual([]);
  });

  it('recomputes the balance due after a repair', () => {
    const withPayment = { ...bobsFencing(), paidTotal: 1000 };
    const repaired = repairRate(normaliseLabourToHours(withPayment), 8);
    expect(repaired.balanceDue).toBe(7783.39);
  });

  it('never lets a repair produce a negative balance', () => {
    const overpaid = { ...bobsFencing(), paidTotal: 31245.83 };
    const repaired = repairRate(normaliseLabourToHours(overpaid), 8);
    expect(repaired.balanceDue).toBe(0);
  });
});

describe('isCustomerFacing — what the migration must not silently reprice', () => {
  it('catches a sent quote, an accepted one, and a paid one', () => {
    expect(isCustomerFacing(rightRoofing())).toBe(true);
    expect(isCustomerFacing({ stage: 'invoice_sent' })).toBe(true);
    expect(isCustomerFacing({ acceptedAt: 1 })).toBe(true);
    expect(isCustomerFacing({ invoicedAt: 1 })).toBe(true);
    expect(isCustomerFacing({ paidTotal: 50 })).toBe(true);
  });

  it('lets a plain draft through', () => {
    expect(isCustomerFacing(bobsFencing())).toBe(false);
    expect(isCustomerFacing({ stage: 'draft', paidTotal: 0 })).toBe(false);
  });
});
