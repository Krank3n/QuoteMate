/**
 * get_typical_rates — the sourced ranges Mate gives a tradie who asks what to
 * charge (audit 23 Sep 2026: five tradies in a week asked, and got refusals or
 * the app's pre-filled $85 passed off as theirs).
 */
import { describe, it, expect } from 'vitest';
import { TYPICAL_RATES, TYPICAL_RATES_AS_OF, findTradeRates, typicalRatesFor } from '../typicalRates';

describe('the table', () => {
  it('every range is a real range with a source, and says its GST basis', () => {
    expect(TYPICAL_RATES_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const entry of TYPICAL_RATES) {
      expect(entry.sources.length, entry.trade).toBeGreaterThan(0);
      expect(entry.rates.length, entry.trade).toBeGreaterThan(0);
      for (const r of entry.rates) {
        expect(r.low, `${entry.trade} ${r.what}`).toBeGreaterThan(0);
        expect(r.high, `${entry.trade} ${r.what}`).toBeGreaterThan(r.low);
        expect(['inc', 'ex', 'unstated']).toContain(r.gst);
      }
    }
  });

  it('leaves out the trades the sources could not agree on', () => {
    expect(findTradeRates('glazier')).toBeNull();
    expect(findTradeRates('labourer')).toBeNull();
    // Plasterers keep their per-m² figures but no hourly rate (one source only).
    expect(findTradeRates('plasterer')!.rates.some((r) => r.unit === 'hour')).toBe(false);
  });

  it('a trade appears once, and no trade name is claimed by two trades', () => {
    const names = TYPICAL_RATES.flatMap((e) => e.aliases);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(TYPICAL_RATES.map((e) => e.trade)).size).toBe(TYPICAL_RATES.length);
  });
});

describe('finding the trade the way tradies say it', () => {
  it.each([
    ['sparky', 'electrician'],
    ["Don't sparkies charge 150 an hour?", 'electrician'],
    ['Z Spark Electricals', 'electrician'],
    ['chippie', 'carpenter'],
    ['Nova Plastering', 'plasterer'],
    ['MSB Civil — concreting', 'concreter'],
    ['HLH CARPENTRY AND PROPERTY MAINTENANCE', 'carpenter'],
    ['GCB PROPERTY MAINTENANCE AND HANDYMAN', 'handyman'],
    ['Narkiewicz Fencing', 'fencer'],
    ['after hours rate for a commercial auto door', null],
  ])('%s → %s', (said, trade) => {
    expect(findTradeRates(said)?.trade ?? null).toBe(trade);
  });

  it('a trade name beats a job word; the job word said first wins between job words', () => {
    expect(findTradeRates('a painter for the deck')!.trade).toBe('painter');
    expect(findTradeRates('sand and paint the deck')!.trade).toBe('painter');
    expect(findTradeRates('build a deck then paint it')!.trade).toBe('carpenter');
  });
});

describe('typicalRatesFor', () => {
  it('found: the ranges, the sources, the date and the caveat Mate must say', () => {
    const out = typicalRatesFor('electrician') as any;
    expect(out.found).toBe(true);
    expect(out.rates[0]).toMatchObject({ what: 'hourly labour', unit: 'hour' });
    expect(out.afterHours).toMatch(/after-hours/i);
    expect(out.sources.join(' ')).toMatch(/hipages/);
    expect(out.asOf).toBe(TYPICAL_RATES_AS_OF);
    expect(out.caveat).toMatch(/not their price/);
  });

  it('not found: says so, and tells Mate never to make one up', () => {
    const out = typicalRatesFor('glazier') as any;
    expect(out.found).toBe(false);
    expect(out.note).toMatch(/never make one up/);
  });
});
