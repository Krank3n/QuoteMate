import { describe, it, expect } from 'vitest';

import { buildSvgPath } from './signaturePath';

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
      [{ x: 9, y: 9 }],
    ]);

    expect((d.match(/M/g) || []).length).toBe(3);
    expect(d).toBe('M 0 0 L 1 1 M 5 5 L 6 6 M 9 9');
  });

  it('skips empty strokes but still joins the populated ones', () => {
    const d = buildSvgPath([
      [{ x: 1, y: 2 }],
      [],
      [{ x: 3, y: 4 }],
    ]);

    expect(d).toBe('M 1 2 M 3 4');
    expect((d.match(/M/g) || []).length).toBe(2);
  });
});
