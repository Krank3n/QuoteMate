import { describe, expect, it } from 'vitest';
import { parsePackInfo } from './parsePackInfo';

describe('parsePackInfo', () => {
  it('parses leading count box products', () => {
    expect(parsePackInfo('45mm Galvanised Ring Shank Coil Nails 2400 Box')).toEqual({ packSize: 2400, packUnit: 'each' });
  });

  it('parses millilitre products as litres', () => {
    expect(parsePackInfo('Sugar Soap Spray 750ml')).toEqual({ packSize: 0.75, packUnit: 'L' });
  });

  it('still parses litre products as litres', () => {
    expect(parsePackInfo('Decking Oil Natural 4L')).toEqual({ packSize: 4, packUnit: 'L' });
  });

  it('prefers concrete bag weight over wet yield litres', () => {
    expect(parsePackInfo('Dingo 10kg Fast Set Hi-Strength Concrete yields 1.1L')).toEqual({ packSize: 10, packUnit: 'kg' });
  });

  it('parses cable roll lengths even when the brand runs into the number', () => {
    expect(parsePackInfo('Deta10 m 2.5mm² 2-Core + Earth Power Cable')).toEqual({ packSize: 10, packUnit: 'm' });
  });

  it('does not misread cable gauge as square metres', () => {
    expect(parsePackInfo('1.5mm² Twin and Earth TPS Cable')).toBeNull();
  });

  it('parses roll dimensions into area coverage', () => {
    expect(parsePackInfo('Geotextile Filter Fabric 2m x 20m Roll')).toEqual({ packSize: 40, packUnit: 'm²' });
    expect(parsePackInfo('Pre-taped Masking Film 2700mm x 17m Roll')).toEqual({ packSize: 45.9, packUnit: 'm²' });
    expect(parsePackInfo('Vapour Barrier Polyethylene Sheeting 2m x 20m')).toEqual({ packSize: 40, packUnit: 'm²' });
    expect(parsePackInfo('Thermafoil Roof Sarking 1350mm x 30m')).toEqual({ packSize: 40.5, packUnit: 'm²' });
  });

  it('converts gram pack weights to kg', () => {
    expect(parsePackInfo('Mineral Oil Absorbent 900g')).toEqual({ packSize: 0.9, packUnit: 'kg' });
  });
});

describe('parsePackInfo — unit preference and superscript units', () => {
  it('parses the m² spelling, not just m2', () => {
    // The trailing \b after `²` never matched, so this returned the piece count.
    expect(parsePackInfo('Earthwool R2.0 Wall Batt 1160mm 16.0m² 32 Pack', { preferUnit: 'm²' }))
      .toEqual({ packSize: 16, packUnit: 'm²' });
  });

  it('parses the m³ spelling', () => {
    expect(parsePackInfo('Bulk Bag Garden Mix 0.5m³')).toEqual({ packSize: 0.5, packUnit: 'm³' });
  });

  it('prefers a stated coverage over a piece count when the caller needs area', () => {
    const title = 'Earthwool R2.0 Wall Batt 90mm x 430mm x 1160mm 16.0m² 32 Pack';
    expect(parsePackInfo(title)).toEqual({ packSize: 32, packUnit: 'each' });
    expect(parsePackInfo(title, { preferUnit: 'm²' })).toEqual({ packSize: 16, packUnit: 'm²' });
  });

  it('reads a plywood sheet as its face area', () => {
    expect(parsePackInfo('Customply 2400 x 1200 x 12mm Non Structural Plywood', { preferUnit: 'm²' }))
      .toEqual({ packSize: 2.88, packUnit: 'm²' });
  });

  it('does not read a board face dimension as a pack area', () => {
    // 137 x 23mm is one board's profile, not a pack of coverage.
    expect(parsePackInfo('Ekodeck 137 x 23mm 5.4m Composite Decking', { preferUnit: 'm²' })?.packUnit).not.toBe('m²');
  });

  it('keeps the roll-area reading when no unit is preferred', () => {
    expect(parsePackInfo('Coolaroo 2m x 20m Weedmat Roll')).toEqual({ packSize: 40, packUnit: 'm²' });
  });
});
