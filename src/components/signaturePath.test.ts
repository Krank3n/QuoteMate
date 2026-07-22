import { describe, it, expect } from 'vitest';

import { buildSvgPath, pathHasInk } from './signaturePath';

describe('buildSvgPath', () => {
  it('returns an empty string for empty input', () => {
    expect(buildSvgPath([])).toBe('');
  });

  it('returns an empty string when strokes contain no points', () => {
    expect(buildSvgPath([[], []])).toBe('');
  });

  it('produces one M and two L commands for a single 3-point stroke', () => {
    const d = buildSvgPath([
      [
        { x: 0, y: 0 },
        { x: 10, y: 5 },
        { x: 20, y: 15 },
      ],
    ]);

    expect(d).toBe('M 0 0 L 10 5 L 20 15');
    expect((d.match(/M/g) || []).length).toBe(1);
    expect((d.match(/L/g) || []).length).toBe(2);
  });

  it('starts a fresh M command for each stroke (lifted pen breaks the ink)', () => {
    const d = buildSvgPath([
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      [
        { x: 5, y: 5 },
        { x: 6, y: 6 },
      ],
    ]);

    expect((d.match(/M/g) || []).length).toBe(2);
    expect(d).toBe('M 0 0 L 1 1 M 5 5 L 6 6');
  });

  // Regression: an accidental tap produced `M x y` with no line — invisible
  // ink that still rendered a "signed" block on the customer PDF.
  it('drops single-point strokes (a tap is not a signature)', () => {
    expect(buildSvgPath([[{ x: 9, y: 9 }]])).toBe('');
    expect(
      buildSvgPath([
        [{ x: 1, y: 2 }],
        [],
        [{ x: 3, y: 4 }],
      ]),
    ).toBe('');
  });

  it('keeps real strokes while dropping taps around them', () => {
    const d = buildSvgPath([
      [{ x: 9, y: 9 }], // tap — dropped
      [
        { x: 0, y: 0 },
        { x: 4, y: 4 },
      ],
    ]);

    expect(d).toBe('M 0 0 L 4 4');
  });
});

describe('pathHasInk', () => {
  it('is false for empty / missing paths', () => {
    expect(pathHasInk('')).toBe(false);
    expect(pathHasInk(undefined)).toBe(false);
    expect(pathHasInk(null)).toBe(false);
  });

  it('is false for a bare move-to (legacy tap capture)', () => {
    expect(pathHasInk('M 10 10')).toBe(false);
  });

  it('is true for a path with a line-to', () => {
    expect(pathHasInk('M 10 10 L 20 20')).toBe(true);
  });
});
