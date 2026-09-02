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
  formatRate,
  normalisePreference,
  normaliseRateUnit,
  rateLineUnitPrice,
  rateLinesCoverMaterials,
  rateSummary,
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
  it('accepts the canonical units, a "per" prefix, and the few spellings people type', () => {
    expect(normaliseRateUnit('m²')).toBe('m²');
    expect(normaliseRateUnit('Per M²')).toBe('m²');
    expect(normaliseRateUnit('sqm')).toBe('m²');
    expect(normaliseRateUnit('lm')).toBe('m');
    expect(normaliseRateUnit('hours')).toBe('hour');
    expect(normaliseRateUnit('per day')).toBe('day');
    expect(normaliseRateUnit('job')).toBe('job');
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

  it('removes by id', () => {
    expect(removeRate([patio()], 'r1')).toEqual([]);
    expect(removeRate([patio()], 'nope')).toHaveLength(1);
  });

  it('summarises a rate one way for the prompt, the card and the settings row', () => {
    expect(rateSummary(patio())).toBe('$220.00 per m² ex GST · materials included');
    expect(rateSummary({ unit: 'each', rate: 45, pricesIncludeGst: true, includesMaterials: false, notes: 'min 3' })).toBe(
      '$45.00 each inc GST · labour only · min 3',
    );
    // A card for a rate whose GST basis the tradie never stated says nothing about GST.
    expect(rateSummary({ unit: 'room', rate: 90, includesMaterials: true })).toBe('$90.00 per room · materials included');
    expect(formatRate(patio())).toBe('Patio roof supply and fit — $220.00 per m² ex GST · materials included');
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
    expect(block).toContain('Rate card:');
    expect(block).toContain('- Patio roof supply and fit — $220.00 per m² ex GST · materials included');
  });
});

describe('rate lines on a document', () => {
  const line = { label: 'Patio roof supply and fit', quantity: 40, unit: 'm²' as const, unitPrice: 220, pricesIncludeGst: false, includesMaterials: true };

  it('keeps the unit price when the line and the document share a basis', () => {
    expect(rateLineUnitPrice(line, 'exclusive', false)).toBe(220);
    expect(rateLineUnitPrice({ ...line, pricesIncludeGst: true }, 'inclusive', false)).toBe(220);
  });

  it('converts between bases: ex-GST rate onto an inclusive document, and back', () => {
    expect(rateLineUnitPrice(line, 'inclusive', false)).toBe(242);
    expect(rateLineUnitPrice({ ...line, pricesIncludeGst: true, unitPrice: 242 }, 'exclusive', false)).toBe(220);
  });

  it('falls back to the business default basis when the tradie did not say', () => {
    const unsaid = { ...line, pricesIncludeGst: undefined };
    expect(rateLineUnitPrice(unsaid, 'exclusive', false)).toBe(220);
    expect(rateLineUnitPrice(unsaid, 'exclusive', true)).toBe(200);
  });

  it('never converts for a business not registered for GST — there is no basis to move between', () => {
    // The supplier-catalogue rule reads "not registered" as inclusive; applied
    // to a tradie-stated rate it inflated every line by 10%.
    expect(rateLineUnitPrice(line, 'none', false)).toBe(220);
    expect(rateLineUnitPrice({ ...line, pricesIncludeGst: true }, 'none', false)).toBe(220);
    expect(rateLineUnitPrice({ ...line, pricesIncludeGst: undefined }, 'none', true)).toBe(220);
    expect(buildRateWorkItem(line, 'none', false).price).toBe(8800);
  });

  it('mints a lump-sum work item the calculators already understand, totalled to cents', () => {
    const item = buildRateWorkItem(line, 'exclusive', false);
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
    expect(buildRateWorkItem({ ...line, quantity: 30.86, unitPrice: 55 }, 'exclusive', false).price).toBe(1697.3);
  });

  it('describes a labour-only rate and a fixed price honestly', () => {
    expect(buildRateWorkItem({ ...line, includesMaterials: false }, 'exclusive', false).scope).toBe(
      '40 m² @ $220.00 per m² — labour only, materials listed separately',
    );
    expect(
      buildRateWorkItem({ label: 'Gutter clean', quantity: 1, unit: 'job', unitPrice: 180, includesMaterials: true }, 'exclusive', false).scope,
    ).toBe('$180.00 fixed price — materials included');
    expect(
      buildRateWorkItem({ label: 'Points', quantity: 6, unit: 'each', unitPrice: 95, includesMaterials: true }, 'exclusive', false).scope,
    ).toBe('6 items @ $95.00 each — materials included');
  });

  it('knows when the rate lines are the whole price', () => {
    expect(rateLinesCoverMaterials(undefined)).toBe(false);
    expect(rateLinesCoverMaterials([])).toBe(false);
    expect(rateLinesCoverMaterials([line])).toBe(true);
    expect(rateLinesCoverMaterials([line, { ...line, includesMaterials: false }])).toBe(false);
  });

  it('zeroes labour on the quote and every section, and makes the sections lump sums', () => {
    // An hourly section with no hours is exactly what the integrity check
    // flags as broken; a lump-sum section with none is fine.
    const stripped = stripLabourFromQuote({
      laborHours: 6,
      sections: [{ id: 's', name: 'Roof', multiplier: 1, laborHours: 3, laborHoursTotal: 3, laborRate: 85, laborTotal: 255, sortOrder: 0 } as any],
    });
    expect(stripped.laborHours).toBe(0);
    expect(stripped.sections[0]).toMatchObject({ pricing: 'lumpSum', laborHours: 0, laborHoursTotal: 0, laborTotal: 0, laborRate: 85 });
  });

  it('saves a rate without a GST basis when there is none, and caps a long label', () => {
    const list = upsertRate([], { label: 'x'.repeat(200), unit: 'job', rate: 180, includesMaterials: true });
    expect(list[0].label).toHaveLength(120);
    expect('pricesIncludeGst' in list[0]).toBe(false);
    expect(rateSummary(list[0])).toBe('$180.00 per job · materials included');
  });
});
