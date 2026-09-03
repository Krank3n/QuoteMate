import { describe, it, expect } from 'vitest';
import {
  parseJobAreaM2,
  parseBoardWidthMm,
  parseBoardLengthM,
  geometricSanePieceCount,
  geometricMinimumPieceCount,
} from '../../shared/pricing/geometricCoverage';

describe('parseJobAreaM2', () => {
  it('parses "15 metre by 2 metre" (the QU-178020 deck)', () => {
    expect(parseJobAreaM2('Build a 15 metre by 2 metre merbau deck. No handrails required.')).toEqual({
      lengthM: 15,
      widthM: 2,
      areaM2: 30,
    });
  });

  it('parses compact "15m x 2m" and "15m × 2m"', () => {
    expect(parseJobAreaM2('15m x 2m deck')?.areaM2).toBe(30);
    expect(parseJobAreaM2('deck 15m × 2m')?.areaM2).toBe(30);
  });

  it('parses when only one operand carries a unit ("15 x 2m")', () => {
    expect(parseJobAreaM2('a 15 x 2m deck')?.areaM2).toBe(30);
  });

  it('orders length ≥ width regardless of input order', () => {
    expect(parseJobAreaM2('2m by 15m')).toEqual({ lengthM: 15, widthM: 2, areaM2: 30 });
  });

  it('picks the largest-area pair when several appear', () => {
    expect(parseJobAreaM2('main deck 15m x 2m plus a 1m x 1m landing')?.areaM2).toBe(30);
  });

  it('does NOT match millimetre specs ("90x19mm")', () => {
    expect(parseJobAreaM2('Merbau Decking Board 90x19mm')).toBeNull();
  });

  it('does NOT match a bare ratio with no metres unit', () => {
    expect(parseJobAreaM2('a 15 x 2 something')).toBeNull();
  });

  it('returns null for empty/undefined', () => {
    expect(parseJobAreaM2('')).toBeNull();
    expect(parseJobAreaM2(undefined)).toBeNull();
  });
});

describe('parseBoardWidthMm', () => {
  it('reads the face width from "90x19mm"', () => {
    expect(parseBoardWidthMm('Merbau Decking Board 90x19mm')).toBe(90);
  });
  it('reads a bare "137mm"', () => {
    expect(parseBoardWidthMm('137mm Spotted Gum Decking')).toBe(137);
  });
  it('returns null when no width token is present', () => {
    expect(parseBoardWidthMm('Merbau Decking Board')).toBeNull();
  });
});

describe('parseBoardLengthM', () => {
  it('reads "5.4m"', () => {
    expect(parseBoardLengthM('Merbau Decking Board 90x19mm 5.4m')).toBe(5.4);
  });
  it('reads "5400mm"', () => {
    expect(parseBoardLengthM('Merbau Decking 5400mm')).toBe(5.4);
  });
  it('returns null when absent', () => {
    expect(parseBoardLengthM('Merbau Decking Board 90x19mm')).toBeNull();
  });
});

describe('geometricMinimumPieceCount', () => {
  it('catches the Bui deck quote under-buy: 14 boards cannot cover 18m²', () => {
    // 137mm board + 4mm gap × 5.4m = 0.7614m² theoretical coverage.
    // Even with zero cutting waste, 18m² needs at least 24 boards.
    expect(geometricMinimumPieceCount({
      name: 'ModWood Composite Decking Board 137mm x 5.4m',
      requirement: 14,
      areaM2: 18,
    })).toBe(24);
  });

  it('leaves an adequate count alone', () => {
    expect(geometricMinimumPieceCount({
      name: 'ModWood Composite Decking Board 137mm x 5.4m',
      requirement: 26,
      areaM2: 18,
    })).toBeNull();
  });

  it('refuses to invent a floor when width or stock length is unknown', () => {
    expect(geometricMinimumPieceCount({
      name: 'ModWood Composite Decking Board',
      requirement: 14,
      areaM2: 18,
    })).toBeNull();
  });
});

describe('geometricSanePieceCount', () => {
  describe('the QU-178020 failure it exists to fix', () => {
    it('clamps 891 decking boards on a 30 m² deck down to a width-derived ceiling', () => {
      // 30 ÷ 0.094 = 319 lm ÷ 5.4m × 1.3 waste = 77.
      const sane = geometricSanePieceCount({
        name: 'Merbau Decking Board 90x19mm',
        requirement: 891,
        areaM2: 30,
      });
      expect(sane).toBe(77);
    });

    it('a tradie buying 77 boards is ~$4.7k, not $54.5k', () => {
      const sane = geometricSanePieceCount({ name: 'Merbau Decking Board 90x19mm', requirement: 891, areaM2: 30 })!;
      expect(sane * 61.19).toBeLessThan(5000);
    });
  });

  describe('falls back to a generous default width when the spec is absent', () => {
    it('uses a narrow 65mm assumption (higher, safer ceiling)', () => {
      // 30 ÷ 0.069 = 435 lm ÷ 5.4m × 1.3 = 105.
      expect(
        geometricSanePieceCount({ name: 'Spotted Gum Decking Board', requirement: 891, areaM2: 30 }),
      ).toBe(105);
    });
  });

  describe('uses a board length from the name when present (tighter ceiling)', () => {
    it('shorter boards need more pieces → higher ceiling', () => {
      // 319 lm ÷ 3.6m × 1.3 = 116.
      expect(
        geometricSanePieceCount({ name: 'Merbau Decking Board 90x19mm 3.6m', requirement: 891, areaM2: 30 }),
      ).toBe(116);
    });
  });

  describe('does NOT touch legitimate cases (clamp must never over-reduce)', () => {
    it('leaves a reasonable board count alone', () => {
      // ~65 is the right number for this deck — well under the fire threshold.
      expect(
        geometricSanePieceCount({ name: 'Merbau Decking Board 90x19mm', requirement: 65, areaM2: 30 }),
      ).toBeNull();
    });

    it('leaves a borderline-high-but-plausible count alone (≤ 2× ceiling)', () => {
      // 150 boards (e.g. shorter stock) is under 2× the 77 ceiling → untouched.
      expect(
        geometricSanePieceCount({ name: 'Merbau Decking Board 90x19mm', requirement: 150, areaM2: 30 }),
      ).toBeNull();
    });

    it('leaves non-board rows (posts, joists, screws) untouched', () => {
      expect(
        geometricSanePieceCount({ name: 'Treated Pine Post H4 90x90mm', requirement: 70, areaM2: 30 }),
      ).toBeNull();
      expect(
        geometricSanePieceCount({ name: 'Treated Pine Joists H3 90x45mm', requirement: 25, areaM2: 30 }),
      ).toBeNull();
      expect(
        geometricSanePieceCount({ name: 'Stainless Steel Decking Screws 10g x 50mm', requirement: 10, areaM2: 30 }),
      ).toBeNull();
    });
  });

  describe('guards', () => {
    it('returns null without a usable area', () => {
      expect(
        geometricSanePieceCount({ name: 'Merbau Decking Board 90x19mm', requirement: 891, areaM2: 0 }),
      ).toBeNull();
    });
    it('returns null for a non-positive requirement', () => {
      expect(
        geometricSanePieceCount({ name: 'Merbau Decking Board 90x19mm', requirement: 0, areaM2: 30 }),
      ).toBeNull();
    });
  });
});
