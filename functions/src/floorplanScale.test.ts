import { describe, it, expect } from 'vitest';
import { applyAnchorScale, FloorplanAnalysis } from './floorplanScale';

function base(overrides: Partial<FloorplanAnalysis>): FloorplanAnalysis {
  return {
    detected: true,
    assumptions: '',
    confidence: 'low',
    ...overrides,
  };
}

describe('applyAnchorScale — post-scale math', () => {
  it('scales total area onto the stated dimension', () => {
    const result = applyAnchorScale(
      base({
        totalAreaM2: 590,
        footprintDims: { lengthM: 25, widthM: 23.6 },
        calibration: { source: 'stated_total', basisMm: 26850, note: '' },
      }),
    );
    const factor = 26.85 / 25; // ≈ 1.074
    const expected = 590 * factor * factor;
    expect(result.totalAreaM2).toBeGreaterThan(expected * 0.99);
    expect(result.totalAreaM2).toBeLessThan(expected * 1.01);
    expect(result.scaledToAnchor).toBe(true);
    expect(result.scaleFactorApplied).toBeCloseTo(1.074, 2);
    expect(['medium', 'high']).toContain(result.confidence);
    expect(result.source).toBe('model');
  });

  it('REGRESSION: a 590 m² read corrects up to ~680 m² under the stated anchor', () => {
    const result = applyAnchorScale(
      base({
        totalAreaM2: 590,
        footprintDims: { lengthM: 25, widthM: 23.6 },
        calibration: { source: 'stated_total', basisMm: 26850, note: '' },
      }),
    );
    // 590 × (26.85/25)² ≈ 680.6
    expect(result.totalAreaM2).toBeCloseTo(680.6, 0);
  });

  it('scales areas by factor², lengths by factor, removalBinM3 by factor²', () => {
    const result = applyAnchorScale(
      base({
        totalAreaM2: 100,
        perimeterM: 40,
        removalAreaM2: 50,
        removalBinM3: 10,
        footprintDims: { lengthM: 12, widthM: 12 },
        calibration: { source: 'stated_total', basisMm: 24000, note: '' },
      }),
    );
    // statedLength = 24m, modelAnchor = 12m → linearFactor = 2, areaFactor = 4
    expect(result.scaleFactorApplied).toBeCloseTo(2, 5);
    expect(result.totalAreaM2).toBeCloseTo(400, 5);
    expect(result.removalAreaM2).toBeCloseTo(200, 5);
    expect(result.removalBinM3).toBeCloseTo(40, 5);
    expect(result.perimeterM).toBeCloseTo(80, 5);
  });

  it('known_dimension is NOT a footprint anchor — returns the analysis unchanged', () => {
    // known_dimension is a labelled sub-footprint dimension (e.g. a grid bay),
    // not the overall footprint length, so it must never drive anchor scaling.
    const input = base({
      totalAreaM2: 590,
      footprintDims: { lengthM: 25, widthM: 23.6 },
      calibration: { source: 'known_dimension', basisMm: 2520, note: '' },
    });
    const result = applyAnchorScale(input);
    expect(result.scaledToAnchor).toBeUndefined();
    expect(result).toBe(input);
  });

  it('sanity clamp: an implausibly large correction (>2×) returns unchanged', () => {
    // statedLength = 30m, modelAnchor = 10m → linearFactor = 3 (out of clamp).
    const input = base({
      totalAreaM2: 100,
      footprintDims: { lengthM: 10, widthM: 10 },
      calibration: { source: 'stated_total', basisMm: 30000, note: '' },
    });
    const result = applyAnchorScale(input);
    expect(result.scaledToAnchor).toBeUndefined();
    expect(result.totalAreaM2).toBe(100);
    expect(result).toBe(input);
  });

  it('sanity clamp: an implausibly small correction (<0.5×) returns unchanged', () => {
    // statedLength = 2m, modelAnchor = 10m → linearFactor = 0.2 (out of clamp).
    const input = base({
      totalAreaM2: 100,
      footprintDims: { lengthM: 10, widthM: 10 },
      calibration: { source: 'stated_total', basisMm: 2000, note: '' },
    });
    const result = applyAnchorScale(input);
    expect(result.scaledToAnchor).toBeUndefined();
    expect(result.totalAreaM2).toBe(100);
    expect(result).toBe(input);
  });

  it('falls back to √totalAreaM2 when footprintDims is absent', () => {
    const result = applyAnchorScale(
      base({
        totalAreaM2: 100, // √100 = 10m model anchor
        calibration: { source: 'stated_total', basisMm: 20000, note: '' },
      }),
    );
    // statedLength = 20m, modelAnchor = 10m → factor 2, areaFactor 4
    expect(result.scaleFactorApplied).toBeCloseTo(2, 5);
    expect(result.totalAreaM2).toBeCloseTo(400, 5);
  });

  it('scales zones (areas, removal, dims) too', () => {
    const result = applyAnchorScale(
      base({
        totalAreaM2: 100,
        footprintDims: { lengthM: 10, widthM: 10 },
        calibration: { source: 'stated_total', basisMm: 20000, note: '' },
        zones: [
          {
            label: 'Room 1',
            code: 'R1',
            areaM2: 40,
            removalAreaM2: 20,
            dims: { lengthM: 8, widthM: 5 },
          },
        ],
      }),
    );
    const zone = result.zones![0];
    expect(zone.areaM2).toBeCloseTo(160, 5); // ×4
    expect(zone.removalAreaM2).toBeCloseTo(80, 5); // ×4
    expect(zone.dims!.lengthM).toBeCloseTo(16, 5); // ×2
    expect(zone.dims!.widthM).toBeCloseTo(10, 5); // ×2
  });

  it('÷0 guard: modelAnchorLengthM of 0 returns the analysis unchanged', () => {
    const input = base({
      totalAreaM2: 0,
      footprintDims: { lengthM: 0, widthM: 0 },
      calibration: { source: 'stated_total', basisMm: 20000, note: '' },
    });
    const result = applyAnchorScale(input);
    expect(result.scaledToAnchor).toBeUndefined();
    expect(result).toBe(input);
  });

  it('no stated dimension returns the analysis unchanged', () => {
    const input = base({
      totalAreaM2: 100,
      footprintDims: { lengthM: 10, widthM: 10 },
      calibration: { source: 'scale_bar', basisMm: 5000, note: '' },
    });
    const result = applyAnchorScale(input);
    expect(result.scaledToAnchor).toBeUndefined();
    expect(result).toBe(input);
  });

  it('no calibration at all returns the analysis unchanged', () => {
    const input = base({ totalAreaM2: 100, footprintDims: { lengthM: 10, widthM: 10 } });
    const result = applyAnchorScale(input);
    expect(result.scaledToAnchor).toBeUndefined();
    expect(result).toBe(input);
  });

  it('is a no-op (returns unchanged) when the factor is ~1', () => {
    const input = base({
      totalAreaM2: 100,
      confidence: 'high',
      footprintDims: { lengthM: 10, widthM: 10 },
      calibration: { source: 'stated_total', basisMm: 10000, note: '' },
    });
    const result = applyAnchorScale(input);
    expect(result.scaledToAnchor).toBeUndefined();
    expect(result.totalAreaM2).toBe(100);
  });

  it('does not downgrade an already-high confidence read', () => {
    const result = applyAnchorScale(
      base({
        totalAreaM2: 100,
        confidence: 'high',
        footprintDims: { lengthM: 10, widthM: 10 },
        calibration: { source: 'stated_total', basisMm: 20000, note: '' },
      }),
    );
    expect(result.confidence).toBe('high');
  });
});
