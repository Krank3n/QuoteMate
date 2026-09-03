import { describe, it, expect } from 'vitest';
import { isNonRetailTradeRow, tradeFallbackUnitPrice, tradeFallbackUnitPriceWithUnit } from '../../shared/pricing/tradeFallback';

describe('isNonRetailTradeRow — the audit failures it exists to fix', () => {
  it('routes MPa-rated ready-mix concrete away from retail (the umbrella-base bug)', () => {
    expect(isNonRetailTradeRow('25MPa Concrete Plain Grey', 'm³', 20)).toBe(true);
    expect(isNonRetailTradeRow('Plain Grey Concrete (25MPa)', 'kg', 32000)).toBe(true);
  });

  it('routes service and labour rows away from retail', () => {
    // "Licensed Plumber Services" once priced as a $14.90 PVC trap.
    expect(isNonRetailTradeRow('Licensed Plumber Services', 'each', 1)).toBe(true);
    expect(isNonRetailTradeRow('Licensed Electrician Services', 'each', 1)).toBe(true);
    expect(isNonRetailTradeRow('call-out fee', 'each', 1)).toBe(true);
  });

  it('routes allowances away from retail', () => {
    // "Fuel Allowance" once matched a $19.98 bag of BBQ charcoal.
    expect(isNonRetailTradeRow('Fuel Allowance', 'each', 1)).toBe(true);
    expect(isNonRetailTradeRow('Site consumables allowance', 'each', 1)).toBe(true);
  });

  it('routes custom fabrication packages away from retail', () => {
    // "Custom Kitchen Cabinetry Package" once priced as $51.60 of hinges.
    expect(isNonRetailTradeRow('Custom Kitchen Cabinetry Package', 'each', 1)).toBe(true);
    expect(isNonRetailTradeRow('Custom steel fabrication', 'each', 1)).toBe(true);
  });

  it('routes welding gas bottles away from retail', () => {
    expect(isNonRetailTradeRow('Welding Gas (Argon Mix)', 'each', 1)).toBe(true);
    expect(isNonRetailTradeRow('9kg gas bottle swap', 'each', 1)).toBe(true);
  });

  it('keeps ordinary retail materials in the retail path', () => {
    expect(isNonRetailTradeRow('Decking screws 50mm', 'each', 600)).toBe(false);
    expect(isNonRetailTradeRow('90x45mm MGP10 Framing Pine', 'each', 12)).toBe(false);
    expect(isNonRetailTradeRow('Interior wall paint low sheen', 'L', 8)).toBe(false);
    // Bagged rapid-set for fence posts is a genuine retail buy.
    expect(isNonRetailTradeRow('Rapid Set Concrete Mix 20kg', 'kg', 180)).toBe(false);
  });
});

describe('tradeFallbackUnitPrice — new table entries', () => {
  it('prices MPa-rated ready-mix by the cubic metre or kg', () => {
    expect(tradeFallbackUnitPrice('25MPa Concrete Plain Grey', 'm³')).toBe(300);
    expect(tradeFallbackUnitPrice('Plain Grey Concrete (25MPa)', 'kg')).toBe(0.15);
  });

  it('prices welding gas bottles', () => {
    expect(tradeFallbackUnitPrice('Welding Gas (Argon Mix)', 'each')).toBe(120);
  });

  it('returns null for services and packages — no sane generic price exists', () => {
    expect(tradeFallbackUnitPrice('Licensed Plumber Services', 'each')).toBeNull();
    expect(tradeFallbackUnitPrice('Custom Kitchen Cabinetry Package', 'each')).toBeNull();
  });

  it('prices spoil disposal by the disposal rules, not as an $80 oil tin', () => {
    // 'spOIL' substring-matched the liquids rule, which sits earlier in the
    // table than the disposal rates.
    expect(tradeFallbackUnitPrice('Excavation Spoil Disposal', 'm³')).toBe(110);
    expect(tradeFallbackUnitPrice('Spoil Removal & Tipping Fees', 'm³')).toBe(110);
    expect(tradeFallbackUnitPrice('Merbau decking oil', 'L')).toBe(25);
  });

  it('keeps the long-standing entries intact', () => {
    expect(tradeFallbackUnitPrice('2m³ skip bin hire', 'each')).toBe(300);
    expect(tradeFallbackUnitPrice('Fuel Allowance', 'each')).toBe(35);
    expect(tradeFallbackUnitPrice('colorbond fence sheet', 'each')).toBe(38);
    expect(tradeFallbackUnitPrice('something with no rule at all', 'each')).toBeNull();
  });
});

describe('reinforcing steel is a steel-merchant line, not a hardware shelf (QU-178711)', () => {
  it('keeps N-bar / starter bar / dowel rows out of retail search', () => {
    expect(isNonRetailTradeRow('N12 starter bar 600mm dowel N12 Starter Bars 600mm')).toBe(true);
    expect(isNonRetailTradeRow('n16 reo bar 6m')).toBe(true);
    expect(isNonRetailTradeRow('deformed bar 12mm')).toBe(true);
    expect(isNonRetailTradeRow('rebar 500mm')).toBe(true);
  });

  it('keeps slab mesh sheets out of retail search', () => {
    expect(isNonRetailTradeRow('SL72 reinforcing mesh sheet')).toBe(true);
    expect(isNonRetailTradeRow('sl82 mesh sheet 6.0 x 2.4m')).toBe(true);
  });

  it('keeps steel formwork pegs out of retail search', () => {
    expect(isNonRetailTradeRow('steel formwork peg 600mm')).toBe(true);
    expect(isNonRetailTradeRow('galvanised formwork pins 450mm')).toBe(true);
  });

  it('leaves hardwood formwork pegs on the retail path', () => {
    // They are just hardwood stakes, which Bunnings stocks at $2-3; the audit
    // caught them being priced off the steel table at $7.
    expect(isNonRetailTradeRow('hardwood peg 300mm Hardwood Formwork Pegs 300mm')).toBe(false);
    expect(tradeFallbackUnitPrice('hardwood peg 300mm Hardwood Formwork Pegs 300mm', 'each')).not.toBe(7);
  });

  it('prices a split-system wall bracket as a bracket pair, not an angle bracket', () => {
    expect(tradeFallbackUnitPrice('heavy duty air conditioner wall bracket', 'each')).toBe(55);
    expect(tradeFallbackUnitPrice('galvanised angle bracket', 'each')).toBe(3);
  });

  it('leaves the reo lines Bunnings genuinely stocks on the retail path', () => {
    // Both priced correctly by the scraper on QU-178711 — routing them away
    // would swap a real shelf price for a table guess.
    expect(isNonRetailTradeRow('trench mesh 3 bar 6m Trench Mesh 3-Bar')).toBe(false);
    expect(isNonRetailTradeRow('concrete bar chairs 50/65mm Bar Chairs 50/65mm')).toBe(false);
    expect(isNonRetailTradeRow('reinforcing bar chairs 50mm')).toBe(false);
    expect(isNonRetailTradeRow('builders tie wire roll 1.5mm')).toBe(false);
  });

  it('prices a cut starter bar as a cut piece and a stock bar as a length', () => {
    // A 600mm dowel and a 6m stock bar are the same product at very different
    // money; the row name carries the only signal that separates them.
    expect(tradeFallbackUnitPrice('N12 starter bar 600mm dowel', 'each')).toBe(6);
    expect(tradeFallbackUnitPrice('N12 reinforcing bar 6000mm', 'each')).toBe(26);
    expect(tradeFallbackUnitPrice('N12 reinforcing bar', 'each')).toBe(26);
    expect(tradeFallbackUnitPrice('N12 reinforcing bar', 'm')).toBe(4);
  });

  it('prices mesh per sheet or per square metre', () => {
    expect(tradeFallbackUnitPrice('SL72 reinforcing mesh sheet', 'each')).toBe(105);
    expect(tradeFallbackUnitPrice('SL72 reinforcing mesh sheet', 'm²')).toBe(8);
  });

  it('prices steel formwork pegs', () => {
    expect(tradeFallbackUnitPrice('steel formwork peg 600mm', 'each')).toBe(7);
  });

  it('never returns the towel-bar money for a starter bar', () => {
    expect(tradeFallbackUnitPrice('N12 starter bar 600mm dowel', 'each')).toBeLessThan(20);
  });
});

describe('tradeFallbackUnitPriceWithUnit — a price must say what it is per', () => {
  it('reports a per-m2 price as per m2 and a per-sheet price as per each', () => {
    expect(tradeFallbackUnitPriceWithUnit('plasterboard 10mm sheet', 'm²')).toEqual({ price: 12, per: 'm²' });
    expect(tradeFallbackUnitPriceWithUnit('plasterboard 10mm sheet', 'each')).toEqual({ price: 35, per: 'each' });
  });

  it('reports the per-item branch as per each even when the row counts metres', () => {
    // The row asks in metres; the table only knows a per-pack price. Saying so
    // is what stops the caller multiplying it by 75.
    const hit = tradeFallbackUnitPriceWithUnit('galvanised decking screws', 'm');
    expect(hit).toEqual({ price: 18, per: 'each' });
  });

  it('does not give plasterboard consumables the sheet price', () => {
    // "plasterboard paper joint tape" billed 75 m at $35/m = $2,386.50.
    expect(tradeFallbackUnitPrice('plasterboard paper joint tape', 'm')).toBeNull();
    expect(tradeFallbackUnitPrice('plasterboard jointing compound base top coat', 'kg')).toBeNull();
    // The sheet itself still prices.
    expect(tradeFallbackUnitPrice('plasterboard recessed edge 10mm 2400x1200', 'each')).toBe(35);
  });

  it('keeps answering in the row unit where the table branches on it', () => {
    expect(tradeFallbackUnitPriceWithUnit('ready mix concrete 25mpa', 'm³')).toEqual({ price: 300, per: 'm³' });
    expect(tradeFallbackUnitPriceWithUnit('road base crusher dust bulk', 'kg')).toEqual({ price: 0.08, per: 'kg' });
    expect(tradeFallbackUnitPriceWithUnit('wall grout', 'kg')).toEqual({ price: 4, per: 'kg' });
  });
});

describe('ordinary Bunnings stock reaches supplier search', () => {
  // A row routed here never gets a real price — it takes a flat table figure.
  // Measured over 24 real quotes: scraped lines land at a 0.93x median of true
  // cost (69% inside 1.5x) against 26% for estimated ones, so routing a
  // stocked item away trades the best mechanism for the worst.
  it.each([
    ['flexible floor grout light grey', 'kg'],
    ['rubber grout float', 'each'],
    ['tiling grout sponge', 'each'],
    ['floor tiles 600x600 matt', 'each'],
    ['wall tiles 300x600 white gloss', 'each'],
    ['basin mixer tap chrome', 'each'],
  ])('searches for %s', (name, unit) => {
    expect(isNonRetailTradeRow(name, unit as never, 10)).toBe(false);
  });

  it('still routes work with no shelf price away from search', () => {
    for (const [name, unit] of [
      ['concrete pump hire', 'each'],
      ['skip bin 6m3', 'each'],
      ['tip fees green waste disposal', 'each'],
      ['ready mix concrete 25mpa delivered', 'm³'],
      ['N16 starter bars', 'each'],
      ['road base 20mm', 'kg'],
      ['10mm plasterboard sheet', 'each'],
    ] as const) {
      expect(isNonRetailTradeRow(name, unit as never, 10)).toBe(true);
    }
  });

  it('keeps a price in the table for grout — routing and pricing are separate', () => {
    // Removing the routing rule must not remove the fallback value: a grout row
    // whose search comes back empty still needs something to fall back to.
    expect(tradeFallbackUnitPriceWithUnit('wall grout', 'kg')).toEqual({ price: 4, per: 'kg' });
  });
});
