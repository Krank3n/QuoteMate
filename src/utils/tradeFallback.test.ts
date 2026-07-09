import { describe, it, expect } from 'vitest';
import { isNonRetailTradeRow, tradeFallbackUnitPrice } from './tradeFallback';

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
