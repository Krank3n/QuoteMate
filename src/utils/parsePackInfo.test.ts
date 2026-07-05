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
