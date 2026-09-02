/**
 * The quoting profile's pure rules: what a preference or a rate looks like
 * once saved, what Mate's prompt block says, and what a rate line becomes on
 * a document — in the document's GST basis, with no labour charged twice.
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_PREFERENCES,
  MAX_RATES,
  addPreference,
  buildQuotingProfileBlock,
  buildRateWorkItem,
  findRate,
  formatRate,
  normalisePreference,
  normaliseRateUnit,
  rateLineTotal,
  rateLineUnitPrice,
  rateLinesCoverMaterials,
  removePreference,
  removeRate,
  stripLabourFromQuote,
  upsertRate,
} from './quotingProfile';
import type { RateCardEntry } from '../types';

const patio = (): RateCardEntry => ({
  id: 'r1',
  label: 'Patio roof supply and fit',
  unit: 'm²',
  rate: 220,
  pricesIncludeGst: false,
  includesMaterials: true,
  updatedAt: '2026-09-01T00:00:00.000Z',
});

describe('preferences', () => {
  it('folds whitespace and refuses junk or over-long sentences', () => {
    expect(normalisePreference('  labour   separate\nfrom materials ')).toBe('labour separate from materials');
    expect(normalisePreference('')).toBeNull();
    expect(normalisePreference('ok')).toBeNull();
    expect(normalisePreference(42)).toBeNull();
    expect(normalisePreference('x'.repeat(161))).toBeNull();
  });

  it('adds a sentence once, case-insensitively, keeping the newest wording', () => {
    const one = addPreference(undefined, 'Labour separate from materials');
    const twice = addPreference(one, 'labour separate from MATERIALS');
    expect(twice).toEqual(['labour separate from MATERIALS']);
  });

  it('drops the oldest past the cap', () => {
    let list: string[] = [];
    for (let i = 0; i < MAX_PREFERENCES + 3; i += 1) list = addPreference(list, `rule number ${i}`);
    expect(list).toHaveLength(MAX_PREFERENCES);
    expect(list[0]).toBe('rule number 3');
  });

  it('leaves the list alone when the sentence is junk', () => {
    expect(addPreference(['keep me'], '')).toEqual(['keep me']);
  });

  it('removes by sentence, case-insensitively', () => {
    expect(removePreference(['A', 'b'], ' a ')).toEqual(['b']);
  });
});

describe('rate card', () => {
  it('reads units the way tradies say them', () => {
    expect(normaliseRateUnit('sqm')).toBe('m²');
    expect(normaliseRateUnit('per square metre')).toBe('m²');
    expect(normaliseRateUnit('lm')).toBe('m');
    expect(normaliseRateUnit('an hour')).toBeNull();
    expect(normaliseRateUnit('hour')).toBe('hour');
    expect(normaliseRateUnit('per day')).toBe('day');
    expect(normaliseRateUnit('bedroom')).toBe('room');
    expect(normaliseRateUnit('lump sum')).toBe('job');
    expect(normaliseRateUnit('furlong')).toBeNull();
    expect(normaliseRateUnit(undefined)).toBeNull();
  });

  it('upserts by label, keeping the id of the entry it replaces', () => {
    const list = upsertRate([patio()], {
      label: '  patio roof supply and fit ',
      unit: 'm²',
      rate: 240.004,
      pricesIncludeGst: false,
      includesMaterials: true,
    });
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('r1');
    expect(list[0].rate).toBe(240);
    expect(list[0].label).toBe('patio roof supply and fit');
  });

  it('appends a new label with a fresh id, and caps the card', () => {
    const list = upsertRate([patio()], {
      label: 'End of lease clean',
      unit: 'room',
      rate: 90,
      pricesIncludeGst: true,
      includesMaterials: true,
    });
    expect(list).toHaveLength(2);
    expect(list[1].id).toBeTruthy();
    expect(list[1].id).not.toBe('r1');

    let many: RateCardEntry[] = [];
    for (let i = 0; i < MAX_RATES + 2; i += 1) {
      many = upsertRate(many, { label: `Rate ${i}`, unit: 'each', rate: i + 1, pricesIncludeGst: false, includesMaterials: false });
    }
    expect(many).toHaveLength(MAX_RATES);
    expect(many[0].label).toBe('Rate 2');
  });

  it('finds and removes', () => {
    expect(findRate([patio()], 'PATIO ROOF supply and fit')?.id).toBe('r1');
    expect(findRate([patio()], 'deck')).toBeUndefined();
    expect(removeRate([patio()], 'r1')).toEqual([]);
  });

  it('formats a rate the way the card and the prompt show it', () => {
    expect(formatRate(patio())).toBe('Patio roof supply and fit — $220.00 per m² ex GST, materials included');
    expect(
      formatRate({ ...patio(), unit: 'each', rate: 45, pricesIncludeGst: true, includesMaterials: false }),
    ).toBe('Patio roof supply and fit — $45.00 each inc GST, labour only');
  });
});

describe('buildQuotingProfileBlock', () => {
  it('is null when nothing is saved, so a fresh account keeps the static prompt', () => {
    expect(buildQuotingProfileBlock(null)).toBeNull();
    expect(buildQuotingProfileBlock({})).toBeNull();
    expect(buildQuotingProfileBlock({ quotingPreferences: [], rateCard: [] })).toBeNull();
  });

  it('lists preferences and rates, and tells Mate not to recite them', () => {
    const block = buildQuotingProfileBlock({
      quotingPreferences: ['labour separate from materials', '   '],
      rateCard: [patio()],
    })!;
    expect(block).toContain("don't recite them back");
    expect(block).toContain('- labour separate from materials');
    expect(block).not.toContain('-  ');
    expect(block).toContain('- Patio roof supply and fit — $220.00 per m² ex GST, materials included');
    expect(block).toContain('rateLine on propose_draft_quote');
  });
});

describe('rate lines on a document', () => {
  const line = { label: 'Patio roof supply and fit', quantity: 40, unit: 'm²' as const, unitPrice: 220, pricesIncludeGst: false, includesMaterials: true };

  it('keeps the unit price when the line and the document share a basis', () => {
    expect(rateLineUnitPrice(line, false, false)).toBe(220);
    expect(rateLineUnitPrice({ ...line, pricesIncludeGst: true }, true, false)).toBe(220);
  });

  it('converts between bases: ex-GST rate onto an inclusive document, and back', () => {
    expect(rateLineUnitPrice(line, true, false)).toBe(242);
    expect(rateLineUnitPrice({ ...line, pricesIncludeGst: true, unitPrice: 242 }, false, false)).toBe(220);
  });

  it('falls back to the business default basis when the tradie did not say', () => {
    const unsaid = { ...line, pricesIncludeGst: undefined };
    expect(rateLineUnitPrice(unsaid, false, false)).toBe(220);
    expect(rateLineUnitPrice(unsaid, false, true)).toBe(200);
  });

  it('totals rate × quantity to cents', () => {
    expect(rateLineTotal(line, false, false)).toBe(8800);
    expect(rateLineTotal({ ...line, quantity: 30.86, unitPrice: 55 }, false, false)).toBe(1697.3);
  });

  it('mints a lump-sum work item the calculators already understand', () => {
    const item = buildRateWorkItem(line, false, false);
    expect(item).toMatchObject({
      name: 'Patio roof supply and fit',
      kind: 'work',
      quantity: 1,
      unit: 'each',
      price: 8800,
      totalPrice: 8800,
      manualPriceOverride: true,
      pricingSource: 'manual',
      origin: 'manual',
    });
    expect(item.scope).toBe('40 m² @ $220.00 per m² — materials included');
    expect(item.id).toBeTruthy();
  });

  it('describes a labour-only rate and a fixed price honestly', () => {
    expect(buildRateWorkItem({ ...line, includesMaterials: false }, false, false).scope).toBe(
      '40 m² @ $220.00 per m² — labour only, materials listed separately',
    );
    expect(
      buildRateWorkItem({ label: 'Gutter clean', quantity: 1, unit: 'job', unitPrice: 180, includesMaterials: true }, false, false).scope,
    ).toBe('$180.00 fixed price — materials included');
    expect(
      buildRateWorkItem({ label: 'Points', quantity: 6, unit: 'each', unitPrice: 95, includesMaterials: true }, false, false).scope,
    ).toBe('6 items @ $95.00 each — materials included');
  });

  it('knows when the rate lines are the whole price', () => {
    expect(rateLinesCoverMaterials(undefined)).toBe(false);
    expect(rateLinesCoverMaterials([])).toBe(false);
    expect(rateLinesCoverMaterials([line])).toBe(true);
    expect(rateLinesCoverMaterials([line, { ...line, includesMaterials: false }])).toBe(false);
  });

  it('zeroes labour on the quote and every section', () => {
    const stripped = stripLabourFromQuote({
      laborHours: 6,
      sections: [{ id: 's', name: 'Roof', multiplier: 1, laborHours: 3, laborHoursTotal: 3, laborRate: 85, laborTotal: 255, sortOrder: 0 } as any],
    });
    expect(stripped.laborHours).toBe(0);
    expect(stripped.sections[0]).toMatchObject({ laborHours: 0, laborHoursTotal: 0, laborTotal: 0, laborRate: 85 });
  });
});
