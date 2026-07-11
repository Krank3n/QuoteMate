import { describe, it, expect } from 'vitest';
import { normaliseFloorplanAnalysis } from '../floorplanNormalise';

const detected = { detected: true, confidence: 'medium', assumptions: '' };

describe('normaliseFloorplanAnalysis — new fields', () => {
  it('coerces valid footprintDims (both fields finite > 0)', () => {
    const r = normaliseFloorplanAnalysis({
      ...detected,
      footprintDims: { lengthM: 25, widthM: 10 },
    });
    expect(r?.footprintDims).toEqual({ lengthM: 25, widthM: 10 });
  });

  it('drops footprintDims when one field is NaN or ≤ 0', () => {
    expect(
      normaliseFloorplanAnalysis({
        ...detected,
        footprintDims: { lengthM: 25, widthM: 0 },
      })?.footprintDims,
    ).toBeUndefined();
    expect(
      normaliseFloorplanAnalysis({
        ...detected,
        footprintDims: { lengthM: 'abc', widthM: 10 },
      })?.footprintDims,
    ).toBeUndefined();
  });

  it('coerces scaleFactorApplied, dropping non-finite/negative', () => {
    expect(
      normaliseFloorplanAnalysis({ ...detected, scaleFactorApplied: 1.074 })
        ?.scaleFactorApplied,
    ).toBe(1.074);
    expect(
      normaliseFloorplanAnalysis({ ...detected, scaleFactorApplied: -1 })
        ?.scaleFactorApplied,
    ).toBeUndefined();
    expect(
      normaliseFloorplanAnalysis({ ...detected, scaleFactorApplied: 'nope' })
        ?.scaleFactorApplied,
    ).toBeUndefined();
  });

  it('coerces calibration.statedLengthMm, dropping non-finite/≤0', () => {
    const cal = { source: 'known_dimension', basisMm: 2520, note: '' };
    expect(
      normaliseFloorplanAnalysis({
        ...detected,
        calibration: { ...cal, statedLengthMm: 49000 },
      })?.calibration?.statedLengthMm,
    ).toBe(49000);
    expect(
      normaliseFloorplanAnalysis({
        ...detected,
        calibration: { ...cal, statedLengthMm: 0 },
      })?.calibration?.statedLengthMm,
    ).toBeUndefined();
    expect(
      normaliseFloorplanAnalysis({
        ...detected,
        calibration: { ...cal, statedLengthMm: 'tall' },
      })?.calibration?.statedLengthMm,
    ).toBeUndefined();
  });

  it('preserves scaledToAnchor boolean', () => {
    expect(
      normaliseFloorplanAnalysis({ ...detected, scaledToAnchor: true })?.scaledToAnchor,
    ).toBe(true);
    expect(
      normaliseFloorplanAnalysis({ ...detected, scaledToAnchor: 'true' })?.scaledToAnchor,
    ).toBeUndefined();
  });

  it('preserves source when model/user, drops anything else', () => {
    expect(normaliseFloorplanAnalysis({ ...detected, source: 'model' })?.source).toBe(
      'model',
    );
    expect(normaliseFloorplanAnalysis({ ...detected, source: 'user' })?.source).toBe(
      'user',
    );
    expect(
      normaliseFloorplanAnalysis({ ...detected, source: 'bogus' })?.source,
    ).toBeUndefined();
  });
});
