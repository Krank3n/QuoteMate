import { calculateQuote, healBrokenLabourSections, updateQuoteCalculations } from '../quoteCalculator';
import { deriveTotalLabourHours, syncJobEstimatedHours } from '../documentCalculator';
import type { Material, Quote, QuoteSection, JobSpec, LaborUnit } from '../../types';

function section(over: Partial<QuoteSection> = {}): QuoteSection {
  return {
    id: 'sec',
    name: 'Section',
    multiplier: 1,
    laborHours: 0,
    laborRate: 0,
    laborUnit: 'hours',
    laborTotal: 0,
    sortOrder: 0,
    ...over,
  };
}

function job(over: Partial<JobSpec> = {}): JobSpec {
  return {
    id: 'job',
    name: 'Job',
    description: '',
    template: 'custom',
    ...over,
  };
}

describe('healBrokenLabourSections', () => {
  it('redistributes top-level labour when every section is zero', () => {
    const healed = healBrokenLabourSections({
      laborHours: 10,
      laborRate: 100,
      sections: [section({ id: 'a', multiplier: 1 }), section({ id: 'b', multiplier: 3 })],
    });
    expect(healed.sections!.map((s) => s.laborTotal)).toEqual([250, 750]);
    expect(healed.sections!.reduce((s, x) => s + x.laborTotal, 0)).toBe(1000);
  });

  it('redistributes only the gap when some sections are already priced', () => {
    const healed = healBrokenLabourSections({
      laborHours: 11, // top-level 11h × $100 = $1100 total
      laborRate: 100,
      sections: [
        section({ id: 'a', multiplier: 1, laborHours: 8, laborRate: 100, laborTotal: 800 }),
        section({ id: 'b', multiplier: 1 }), // zero
        section({ id: 'c', multiplier: 1 }), // zero
      ],
    });
    // gap = 1100 - 800 = 300, split across 2 zero sections proportional to multiplier (1:1)
    expect(healed.sections![0].laborTotal).toBe(800);
    expect(healed.sections![1].laborTotal).toBe(150);
    expect(healed.sections![2].laborTotal).toBe(150);
    // Healed sections inherit rate/unit from the priced reference section
    expect(healed.sections![1].laborRate).toBe(100);
    expect(healed.sections![1].laborUnit).toBe('hours');
  });

  it('passes through unchanged when every section is already priced', () => {
    const input = {
      laborHours: 8,
      laborRate: 100,
      sections: [
        section({ id: 'a', laborHours: 4, laborRate: 100, laborTotal: 400 }),
        section({ id: 'b', laborHours: 4, laborRate: 100, laborTotal: 400 }),
      ],
    };
    expect(healBrokenLabourSections(input)).toBe(input);
  });

  it('passes through unchanged when top-level labour is zero', () => {
    const input = {
      laborHours: 0,
      laborRate: 100,
      sections: [section()],
    };
    expect(healBrokenLabourSections(input)).toBe(input);
  });

  it('passes through unchanged when sections fully account for top-level', () => {
    const input = {
      laborHours: 8,
      laborRate: 100,
      sections: [
        section({ id: 'a', laborTotal: 800 }),
        section({ id: 'b' }), // zero, but no gap to fill
      ],
    };
    expect(healBrokenLabourSections(input)).toBe(input);
  });
});

describe('deriveTotalLabourHours + syncJobEstimatedHours', () => {
  const baseSection = (over: Partial<QuoteSection>): QuoteSection => section(over);

  it('sums section hours when sections exist', () => {
    const hours = deriveTotalLabourHours({
      sections: [
        baseSection({ laborHoursTotal: 2.5, laborUnit: 'hours' }),
        baseSection({ laborHoursTotal: 4, laborUnit: 'hours' }),
      ],
      laborHours: 0,
      laborUnit: 'hours' as LaborUnit,
    });
    expect(hours).toBe(6.5);
  });

  it('converts day-unit sections to hours at 8h/day', () => {
    const hours = deriveTotalLabourHours({
      sections: [
        baseSection({ laborHoursTotal: 1, laborUnit: 'days' }),
        baseSection({ laborHoursTotal: 0.5, laborUnit: 'days' }),
      ],
      laborHours: 0,
      laborUnit: 'days' as LaborUnit,
    });
    expect(hours).toBe(12); // 1.5 days × 8
  });

  it('adds laborExtraHours converted from doc unit', () => {
    const hours = deriveTotalLabourHours({
      sections: [baseSection({ laborHoursTotal: 1, laborUnit: 'days' })],
      laborHours: 0,
      laborUnit: 'days' as LaborUnit,
      laborExtraHours: 0.25, // 2 hours of extra at the doc's day unit
    });
    expect(hours).toBe(10); // 8 + 2
  });

  it('falls back to top-level laborHours when no sections', () => {
    const hours = deriveTotalLabourHours({
      sections: [],
      laborHours: 5,
      laborUnit: 'hours' as LaborUnit,
    });
    expect(hours).toBe(5);
  });

  it('derives from laborHours × multiplier when laborHoursTotal missing', () => {
    const hours = deriveTotalLabourHours({
      sections: [baseSection({ laborHours: 2, multiplier: 3, laborUnit: 'hours' })],
      laborHours: 0,
      laborUnit: 'hours' as LaborUnit,
    });
    expect(hours).toBe(6);
  });

  it('returns a new JobSpec only when estimatedHours changes', () => {
    const doc = {
      job: job({ estimatedHours: 10 }),
      sections: [baseSection({ laborHoursTotal: 5, laborUnit: 'hours' })],
      laborHours: 0,
      laborUnit: 'hours' as LaborUnit,
    };
    const updated = syncJobEstimatedHours(doc);
    expect(updated.estimatedHours).toBe(5);
    expect(updated).not.toBe(doc.job);

    const stable = syncJobEstimatedHours({ ...doc, job: { ...doc.job, estimatedHours: 5 } });
    expect(stable.estimatedHours).toBe(5);
  });

  it('rounds fractional hours when writing back to JobSpec', () => {
    const updated = syncJobEstimatedHours({
      job: job({ estimatedHours: 0 }),
      sections: [
        baseSection({ laborHoursTotal: 2.4, laborUnit: 'hours' }),
        baseSection({ laborHoursTotal: 2.4, laborUnit: 'hours' }),
      ],
      laborHours: 0,
      laborUnit: 'hours' as LaborUnit,
    });
    expect(updated.estimatedHours).toBe(5); // 4.8 → 5
  });

  it('handles mixed-unit sections (days + hours)', () => {
    const hours = deriveTotalLabourHours({
      sections: [
        baseSection({ laborHoursTotal: 0.5, laborUnit: 'days' }), // 4h
        baseSection({ laborHoursTotal: 2, laborUnit: 'hours' }),  // 2h
      ],
      laborHours: 0,
      laborUnit: 'hours' as LaborUnit,
    });
    expect(hours).toBe(6);
  });
});

describe('healBrokenLabourSections — diverse cases', () => {
  it('handles the production days-unit case (Tracy QU-177865 shape)', () => {
    // Three sections in days, one zero, top-level 3 days × $1100 = $3300.
    const healed = healBrokenLabourSections({
      laborHours: 3,
      laborRate: 1100,
      sections: [
        section({ id: 'a', multiplier: 12, laborHours: 2.3, laborRate: 1100, laborUnit: 'days', laborTotal: 30360 }),
        section({ id: 'b', multiplier: 1 }), // zero — should NOT be filled because gap is negative
      ],
    });
    // sumNonZero = 30360 >> topLevelTotal = 3300 → gap < 0 → no-op
    expect(healed.sections![1].laborTotal).toBe(0);
  });

  it('distributes proportionally when zero-section multipliers differ', () => {
    // top-level $1000, one section already at $400, gap = $600 split 1:5
    const healed = healBrokenLabourSections({
      laborHours: 10,
      laborRate: 100,
      sections: [
        section({ id: 'a', multiplier: 4, laborHours: 1, laborRate: 100, laborTotal: 400 }),
        section({ id: 'b', multiplier: 1 }), // gets 1/6 of $600 = $100
        section({ id: 'c', multiplier: 5 }), // gets 5/6 of $600 = $500
      ],
    });
    expect(healed.sections![1].laborTotal).toBe(100);
    expect(healed.sections![2].laborTotal).toBe(500);
  });

  it('skips heal when no top-level labour value (laborRate=0)', () => {
    const input = {
      laborHours: 100,
      laborRate: 0, // top-level total = 0
      sections: [section()],
    };
    expect(healBrokenLabourSections(input)).toBe(input);
  });

  it('skips partial heal when reference rate is 0', () => {
    // Non-zero section exists but its laborRate is 0 — we cannot derive units, bail out.
    const input = {
      laborHours: 5,
      laborRate: 100,
      sections: [
        section({ id: 'a', laborTotal: 100, laborRate: 0 }),
        section({ id: 'b' }),
      ],
    };
    expect(healBrokenLabourSections(input)).toBe(input);
  });

  it('returns input unchanged when there are no sections', () => {
    const input = { laborHours: 5, laborRate: 100, sections: [] };
    expect(healBrokenLabourSections(input)).toBe(input);
  });
});

// ---------- Integration: updateQuoteCalculations ----------

function buildQuote(over: Partial<Quote> = {}): Quote {
  const base: Quote = {
    id: 'q',
    quoteNumber: 'QU-TEST',
    createdAt: new Date('2026-05-25T00:00:00Z'),
    updatedAt: new Date('2026-05-25T00:00:00Z'),
    customerName: 'Test',
    job: { id: 'j', name: 'Test Job', description: '', template: 'custom', estimatedHours: 0 },
    materials: [],
    laborRate: 100,
    laborHours: 0,
    laborUnit: 'hours',
    laborTotal: 0,
    materialsSubtotal: 0,
    markup: 0,
    laborMarkup: 0,
    markupAmount: 0,
    subtotal: 0,
    gst: 0,
    total: 0,
    status: 'draft',
  };
  return { ...base, ...over };
}

const m = (over: Partial<Material> = {}): Material => ({
  id: 'm', name: 'Item', quantity: 1, unit: 'each', price: 0, totalPrice: 0,
  manualPriceOverride: false, ...over,
});

const s = (over: Partial<QuoteSection> = {}): QuoteSection => ({
  id: 'sec', name: 'Section', multiplier: 1,
  laborHours: 0, laborRate: 0, laborUnit: 'hours', laborTotal: 0,
  sortOrder: 0, ...over,
});

describe('updateQuoteCalculations integration', () => {
  it('recomputes totals + syncs estimatedHours in one pass', () => {
    const quote = buildQuote({
      materials: [m({ quantity: 2, price: 50, totalPrice: 100 })],
      sections: [
        s({ id: 'a', laborHours: 4, laborRate: 100, laborTotal: 400 }),
        s({ id: 'b', laborHours: 2, laborRate: 100, laborTotal: 200 }),
      ],
      laborExtraHours: 0,
      job: { id: 'j', name: 'J', description: '', template: 'custom', estimatedHours: 999 },
    });
    const updated = updateQuoteCalculations(quote);
    expect(updated.laborTotal).toBe(600);
    expect(updated.materialsSubtotal).toBe(100);
    expect(updated.subtotal).toBe(700);
    expect(updated.total).toBeCloseTo(770, 2);
    // estimatedHours synced from sections (4 + 2 = 6h, no extra)
    expect(updated.job.estimatedHours).toBe(6);
  });

  it('heals partial-zero sections before computing totals', () => {
    // Top-level says 11h × $100 = $1100. One section at $800, two zero.
    // After heal the two zero sections should fill the $300 gap.
    const quote = buildQuote({
      laborHours: 11,
      laborRate: 100,
      sections: [
        s({ id: 'a', laborHours: 8, laborRate: 100, laborTotal: 800 }),
        s({ id: 'b' }),
        s({ id: 'c' }),
      ],
    });
    const updated = updateQuoteCalculations(quote);
    expect(updated.laborTotal).toBe(1100);
    expect(updated.sections!.map((x) => x.laborTotal)).toEqual([800, 150, 150]);
  });

  it('preserves estimatedHours when no sections (legacy fallback)', () => {
    const quote = buildQuote({
      laborHours: 8,
      laborUnit: 'hours',
      sections: undefined,
      job: { id: 'j', name: 'J', description: '', template: 'custom', estimatedHours: 999 },
    });
    const updated = updateQuoteCalculations(quote);
    expect(updated.job.estimatedHours).toBe(8);
  });
});

describe('calculateQuote (legacy wrapper)', () => {
  it('returns the same shape as calculateDocumentTotals minus travel', () => {
    const out = calculateQuote(
      [m({ totalPrice: 100 })],
      85, 4, // labour
      10,    // markup
    );
    expect(out.materialsSubtotal).toBe(100);
    expect(out.laborTotal).toBe(340);
    expect(out.markupAmount).toBe(10); // 10% × $100 materials only (laborMarkup defaults to 0)
    expect(out.total).toBeCloseTo(495, 2); // (100 + 340 + 10) × 1.1
  });
});
