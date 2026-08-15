/**
 * A lump-sum section's price is a number the tradie TYPED. It has no hours and
 * no rate behind it, so every path that normally derives labour dollars from
 * hours × rate × multiplier is a path that can destroy it.
 *
 * The headline case here — ten hydrate→apply cycles leaving the price
 * unchanged to the cent — fails on the pre-guard code, where
 * applyLabourEditor unconditionally recomputed
 * `laborTotal: round2(perUnit * sectionRate * multiplier)` for EVERY section.
 * With rate 0 that is 0, so a $1,200 section was silently zeroed by nothing
 * more than opening the labour screen. This is the same bug class the repo has
 * fought repeatedly (QU-178468, QU-178558), so it gets the same treatment: a
 * property test, not a guard on one call site.
 */

import { describe, it, expect } from 'vitest';
import { hydrateLabourEditor, applyLabourEditor } from '../labourEditor';
import { healBrokenLabourSections } from '../quoteCalculator';
import { calculateDocumentTotals } from '../documentCalculator';
import { checkDocumentIntegrity } from '../../../shared/document/integrityCheck';
import {
  isLumpSumSection,
  lumpSumLabourTotal,
  markupableLabourTotal,
  isWorkItem,
  lineMarkupMultiplier,
  workItemsTotal,
  markupableMaterialsTotal,
} from '../../../shared/document/lumpSum';
import { createSection } from '../sectionsModel';
import { buildQuotePdfHtml, toPdfSections } from '../../../shared/pdf';
import type { QuoteSection, Material } from '../../types';

const HOURLY = 85;

function hourlySection(name: string, hours: number, multiplier = 1): QuoteSection {
  return {
    id: name,
    name,
    multiplier,
    laborHours: hours,
    laborHoursTotal: Math.round(hours * multiplier * 100) / 100,
    laborRate: HOURLY,
    laborUnit: 'hours',
    laborTotal: Math.round(hours * HOURLY * multiplier * 100) / 100,
    sortOrder: 0,
    pricing: 'hourly',
  };
}

/**
 * The invariant, in code: a lump-sum section carries zero hours and a zero
 * rate, so every hours-summing consumer stays correct without knowing the flag
 * exists.
 */
function lumpSumSection(name: string, laborTotal: number, sortOrder = 1): QuoteSection {
  return {
    id: name,
    name,
    multiplier: 1,
    laborHours: 0,
    laborHoursTotal: 0,
    laborRate: 0,
    laborUnit: 'hours',
    laborTotal,
    sortOrder,
    pricing: 'lumpSum',
  };
}

function doc(sections: QuoteSection[], overrides: Record<string, unknown> = {}) {
  return {
    laborHours: 0,
    laborRate: HOURLY,
    laborUnit: 'hours' as const,
    laborExtraHours: 0,
    sections,
    ...overrides,
  };
}

/** Open the labour editor and leave it again, touching nothing. */
function visit<T extends Parameters<typeof hydrateLabourEditor>[0]>(d: T): T {
  const state = hydrateLabourEditor(d);
  return { ...d, ...applyLabourEditor(d, state) };
}

describe('lump-sum sections — the labour editor cannot move the price', () => {
  it('survives ten hydrate → apply cycles with its price unchanged to the cent', () => {
    let d: any = doc([hourlySection('Strip out', 4), lumpSumSection('Bathroom regrout', 1200)]);
    for (let i = 0; i < 10; i++) d = visit(d);

    const lump = d.sections.find((s: QuoteSection) => s.name === 'Bathroom regrout');
    expect(lump.laborTotal).toBe(1200);
    expect(lump.pricing).toBe('lumpSum');
    // The hourly neighbour is untouched too — $340 of real labour.
    expect(d.sections.find((s: QuoteSection) => s.name === 'Strip out').laborTotal).toBe(340);
  });

  it('holds the invariant: no hours and no rate, so hour sums stay honest', () => {
    let d: any = doc([lumpSumSection('Make good', 900)]);
    for (let i = 0; i < 10; i++) d = visit(d);

    const lump = d.sections[0];
    expect(lump.laborHours).toBe(0);
    expect(lump.laborHoursTotal).toBe(0);
    expect(lump.laborRate).toBe(0);
    // A lump-sum-only document reports zero labour HOURS while still carrying
    // $900 of labour dollars — that is the point of the flag.
    expect(d.laborHours).toBe(0);
  });

  it('cannot absorb hours, which is why its row has no stepper', () => {
    // The labour screen's ± bumps the tapped section AND the global total by
    // the same delta, so "extra stays the same". A lump-sum section breaks
    // that: applyLabourEditor passes it through and never counts it in the
    // sections sum, so the whole delta lands in laborExtraHours and quietly
    // adds an hour of General Labour that appears nowhere on the row tapped.
    // LaborMarkupScreen therefore renders these rows without steppers; this
    // pins the underlying asymmetry so the two can't drift apart again.
    const base: any = doc([hourlySection('Strip out', 4), lumpSumSection('Bathroom regrout', 1200)]);
    const state = hydrateLabourEditor(base);
    // The editor reports zero hours for the lump-sum row — there is nothing
    // for a stepper to step.
    expect(state.sectionTotals['Bathroom regrout']).toBe('0');

    // Hand-simulate one "+" tap on that row: total up by 1, section unchanged.
    const tapped = { ...state, totalInput: String(parseFloat(state.totalInput) + 1) };
    const after: any = { ...base, ...applyLabourEditor(base, tapped) };
    expect(after.laborExtraHours).toBe(1);
    expect(after.sections.find((x: QuoteSection) => x.name === 'Bathroom regrout').laborTotal).toBe(1200);
  });

  it('does not let a lump-sum section drag the quote rate to zero', () => {
    // hydrate picks the hourly rate from the first section carrying one; a
    // lump-sum section's rate of 0 must not be mistaken for the answer.
    const d: any = visit(doc([lumpSumSection('Callout', 250, 0), hourlySection('Repairs', 3)]));
    expect(d.laborRate).toBe(HOURLY);
    expect(d.sections.find((s: QuoteSection) => s.name === 'Repairs').laborTotal).toBe(255);
  });
});

describe('lump-sum sections — healBrokenLabourSections', () => {
  it('never redistributes into a lump-sum section', () => {
    // The all-zero branch: hourly sections at $0 with top-level labour set is
    // exactly the legacy shape the healer exists for.
    const quote = {
      laborHours: 10,
      laborRate: HOURLY,
      sections: [
        { ...hourlySection('Framing', 0), laborTotal: 0 },
        lumpSumSection('Site clean', 400),
      ],
    };
    const healed = healBrokenLabourSections(quote);

    const lump = healed.sections!.find((s) => s.name === 'Site clean')!;
    expect(lump.laborTotal).toBe(400);
    expect(lump.laborHours).toBe(0);
    expect(lump.laborRate).toBe(0);
    // The genuinely broken section still gets healed — the healer is taught,
    // not disabled.
    expect(healed.sections!.find((s) => s.name === 'Framing')!.laborTotal).toBe(850);
  });

  it('leaves a lump-sum-only document completely alone', () => {
    const quote = { laborHours: 10, laborRate: HOURLY, sections: [lumpSumSection('Regrout', 1200)] };
    expect(healBrokenLabourSections(quote)).toEqual(quote);
  });

  it('ignores lump-sum dollars when sizing the gap for a partial heal', () => {
    // $1,700 of top-level labour, $850 already in a real section, $400 in a
    // lump sum. The gap belongs entirely to the broken section: $850, not $450.
    const quote = {
      laborHours: 20,
      laborRate: HOURLY,
      sections: [
        hourlySection('Framing', 10),
        { ...hourlySection('Sheeting', 0), laborTotal: 0 },
        lumpSumSection('Site clean', 400),
      ],
    };
    const healed = healBrokenLabourSections(quote);
    expect(healed.sections!.find((s) => s.name === 'Sheeting')!.laborTotal).toBe(850);
    expect(healed.sections!.find((s) => s.name === 'Site clean')!.laborTotal).toBe(400);
  });
});

describe('lump-sum sections — integrity check', () => {
  const base = {
    laborRate: HOURLY,
    laborHours: 0,
    laborUnit: 'hours' as const,
    laborExtraHours: 0,
    laborMarkup: 0,
    markup: 0,
    travelAdjustment: 0,
    materialsSubtotal: 0,
    markupAmount: 0,
    pricesIncludeGst: false,
    materials: [] as any[],
  };

  it('raises no section_total_mismatch or section_zero_labour for a lump sum', () => {
    const d = {
      ...base,
      sections: [lumpSumSection('Bathroom regrout', 1200)],
      laborTotal: 1200,
      subtotal: 1200,
      gst: 120,
      total: 1320,
      job: { estimatedHours: 0 },
    };
    expect(checkDocumentIntegrity(d)).toEqual([]);
  });

  it('still flags a genuinely broken hourly section alongside a lump sum', () => {
    const d = {
      ...base,
      // laborTotal says $500 but 2h × $85 × 1 is $170 — a real mismatch.
      sections: [
        { ...hourlySection('Framing', 2), laborTotal: 500 },
        lumpSumSection('Site clean', 400),
      ],
      laborTotal: 900,
      subtotal: 900,
      gst: 90,
      total: 990,
      job: { estimatedHours: 2 },
    };
    const codes = checkDocumentIntegrity(d).map((i) => i.code);
    expect(codes).toContain('section_total_mismatch');
    expect(codes.filter((c) => c === 'section_total_mismatch')).toHaveLength(1);
  });
});

describe('lump-sum sections — markup', () => {
  const materials: Material[] = [];

  it('applies labour markup to hourly sections only', () => {
    // $850 hourly + $1,200 lump sum, 20% labour markup.
    // Markup base is the $850 alone → $170, not $410.
    const sections = [hourlySection('Framing', 10), lumpSumSection('Regrout', 1200)];
    const calc = calculateDocumentTotals(
      materials, HOURLY, 0, /* markupPercent */ 0, /* travel */ 0, sections,
      /* laborMarkupPercent */ 20, /* laborExtraHours */ 0,
    );
    expect(calc.laborTotal).toBe(2050);
    expect(calc.markupAmount).toBe(170);
    // Subtotal is untouched — markup lands on top of it.
    expect(calc.subtotal).toBe(2050);
    expect(calc.total).toBe(Math.round((2050 + 170) * 1.1 * 100) / 100);
  });

  it('charges nothing extra on a document that is all lump sums', () => {
    const sections = [lumpSumSection('Interior', 22750), lumpSumSection('Exterior', 21200, 2)];
    const calc = calculateDocumentTotals(
      materials, HOURLY, 0, 0, 0, sections, 50 /* an absurd labour markup */, 0,
    );
    expect(calc.laborTotal).toBe(43950);
    expect(calc.markupAmount).toBe(0);
  });

  it('helpers agree on what is markupable', () => {
    const sections = [hourlySection('Framing', 10), lumpSumSection('Regrout', 1200)];
    expect(isLumpSumSection(sections[1])).toBe(true);
    expect(isLumpSumSection(sections[0])).toBe(false);
    expect(lumpSumLabourTotal(sections)).toBe(1200);
    expect(markupableLabourTotal(2050, sections)).toBe(850);
    // Never negative, even on a self-contradicting document.
    expect(markupableLabourTotal(500, sections)).toBe(0);
  });
});

describe('work items — the typed price is the final price', () => {
  const workItem = (name: string, price: number): Material => ({
    id: `w-${name}`, name, kind: 'work', scope: '',
    quantity: 1, unit: 'each', price, totalPrice: price,
    manualPriceOverride: true, pricingSource: 'manual',
  } as Material);

  const realMaterial = (name: string, price: number, qty: number): Material => ({
    id: `m-${name}`, name, quantity: qty, unit: 'each',
    price, totalPrice: price * qty,
    manualPriceOverride: false, pricingSource: 'scraper',
  } as Material);

  it('adds no markup to a work item, however high the material markup', () => {
    const materials = [workItem('INTERIOR Surfaces to be painted', 22750)];
    const calc = calculateDocumentTotals(
      materials, HOURLY, 0, /* markupPercent */ 15, /* travel */ 0, [], 0, 0,
    );
    expect(calc.materialsSubtotal).toBe(22750);
    // The number the tradie typed is the number that gets charged.
    expect(calc.markupAmount).toBe(0);
    expect(calc.subtotal).toBe(22750);
  });

  it('still marks up real materials sitting alongside a work item', () => {
    // $1,000 of supplier stock + a $2,000 scope line, 10% material markup.
    // Markup base is the $1,000 alone → $100, not $300.
    const materials = [realMaterial('Merbau decking', 100, 10), workItem('Install decking', 2000)];
    const calc = calculateDocumentTotals(
      materials, HOURLY, 0, 10, 0, [], 0, 0,
    );
    expect(calc.materialsSubtotal).toBe(3000);
    expect(calc.markupAmount).toBe(100);
  });

  it('shows the typed price on the customer PDF, not an inflated one', () => {
    const totals = calculateDocumentTotals(
      [workItem('EXTERIOR Surfaces to be painted', 21200)],
      HOURLY, 0, /* markupPercent */ 15, /* travel */ 0, [], 0, 0,
    );
    const html = buildQuotePdfHtml(
      {
        customerName: 'A Customer',
        quoteDate: '10 July 2026',
        job: { name: 'Exterior repaint', description: 'Full exterior' },
        materials: [{
          name: 'EXTERIOR Surfaces to be painted',
          quantity: 1, unit: 'each', price: 21200, totalPrice: 21200,
          kind: 'work', scope: 'Painting of full exterior as per plans provided.',
        }],
        materialsSubtotal: totals.materialsSubtotal,
        laborTotal: 0,
        subtotal: totals.subtotal,
        markup: 15,
        markupAmount: totals.markupAmount,
        showMarkup: false,
        gst: totals.gst,
        total: totals.total,
      },
      { businessName: 'Test Trades', logoHtml: '' },
    );
    expect(html).toContain('$21,200.00');
    // 21200 × 1.15 — the number the old behaviour would have printed.
    expect(html).not.toContain('$24,380.00');
    // And the total is built on the typed price, not the inflated one.
    expect(totals.total).toBe(23320);
  });

  it('helpers agree on what is markupable', () => {
    const materials = [realMaterial('Merbau decking', 100, 10), workItem('Install decking', 2000)];
    expect(isWorkItem(materials[1])).toBe(true);
    expect(isWorkItem(materials[0])).toBe(false);
    expect(workItemsTotal(materials)).toBe(2000);
    expect(markupableMaterialsTotal(3000, materials)).toBe(1000);
    // Never negative, even on a self-contradicting document.
    expect(markupableMaterialsTotal(500, materials)).toBe(0);
    // A real material takes the multiplier; a work item never does.
    expect(lineMarkupMultiplier(materials[0], 1.15)).toBe(1.15);
    expect(lineMarkupMultiplier(materials[1], 1.15)).toBe(1);
  });

  it('passes the integrity check with markup set and work items present', () => {
    const materials = [realMaterial('Merbau decking', 100, 10), workItem('Install decking', 2000)];
    const calc = calculateDocumentTotals(materials, HOURLY, 0, 10, 0, [], 0, 0);
    const issues = checkDocumentIntegrity({
      materials, materialsSubtotal: calc.materialsSubtotal,
      laborTotal: calc.laborTotal, laborHours: 0, laborRate: HOURLY,
      subtotal: calc.subtotal, markup: 10, markupAmount: calc.markupAmount,
      gst: calc.gst, total: calc.total, sections: [],
    } as any);
    expect(issues.filter((i) => i.code === 'markup_amount_mismatch')).toEqual([]);
  });
});

describe('lump-sum sections — end to end, from the section the tradie created', () => {
  it('reaches the customer document at the typed price, with no hours and no markup', () => {
    // Create it exactly the way the New Section modal does.
    const created = createSection(
      { sections: [], materials: [] },
      { name: 'Bathroom regrout', pricing: 'lumpSum', laborTotal: 1200, description: 'Strip and regrout.' },
    );
    const section = created.sections[0];

    const totals = calculateDocumentTotals(
      [], HOURLY, 0, /* markup */ 0, /* travel */ 0, created.sections,
      /* laborMarkupPercent */ 20, /* extra */ 0,
    );
    // 20% labour markup applies to nothing here — the lump sum is exempt.
    expect(totals.laborTotal).toBe(1200);
    expect(totals.markupAmount).toBe(0);
    expect(totals.total).toBe(1320);

    const html = buildQuotePdfHtml(
      {
        customerName: 'A Customer',
        quoteDate: '10 July 2026',
        job: { name: 'Bathroom', description: 'Regrout' },
        materials: [],
        materialsSubtotal: 0,
        laborTotal: totals.laborTotal,
        sections: toPdfSections(created.sections),
        subtotal: totals.subtotal,
        markup: 0,
        markupAmount: totals.markupAmount,
        laborMarkup: 20,
        gst: totals.gst,
        total: totals.total,
        showLaborHours: true,
      },
      { businessName: 'Test Trades', logoHtml: '' },
    );

    expect(html).toContain('Bathroom regrout');
    expect(html).toContain('$1,200.00');
    // No hours, no rate, and nothing inflated by the 20%.
    expect(html).not.toContain('@ $85.00/hr');
    expect(html).not.toContain('$1,440.00');
    expect(html).toContain('$1,320.00');
    expect(section.pricing).toBe('lumpSum');
  });
});
