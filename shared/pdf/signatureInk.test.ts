import { describe, it, expect } from 'vitest';

import { pathInkLength, pathHasInk, MIN_SIGNATURE_INK_LENGTH } from './signatureInk';

describe('pathInkLength', () => {
  it('measures 0 for empty / missing / malformed paths', () => {
    expect(pathInkLength('')).toBe(0);
    expect(pathInkLength(undefined)).toBe(0);
    expect(pathInkLength(null)).toBe(0);
    expect(pathInkLength('not a path')).toBe(0);
  });

  it('measures 0 for a bare move-to', () => {
    expect(pathInkLength('M 224 92')).toBe(0);
  });

  it('measures 0 for a zero-length line-to (tap with micro-twitch)', () => {
    // Real capture from RP-001: grant + move event at the identical point.
    expect(pathInkLength('M 400 57.0625 L 400 57.0625 M 369 86.0625')).toBe(0);
  });

  it('sums segment lengths across strokes, ignoring the pen-lift jump', () => {
    // Stroke 1: 3-4-5 triangle → 5. Stroke 2: horizontal 10. M-jump not counted.
    expect(pathInkLength('M 0 0 L 3 4 M 100 100 L 110 100')).toBe(15);
  });
});

describe('pathHasInk', () => {
  it('rejects the real-world ghost signature from RP-001', () => {
    expect(pathHasInk('M 400 57.0625 L 400 57.0625 M 369 86.0625')).toBe(false);
  });

  it('rejects ink below the minimum threshold', () => {
    expect(pathHasInk('M 0 0 L 2 0')).toBe(false);
  });

  it('accepts a real signature stroke', () => {
    expect(pathHasInk('M 10 80 L 60 20 L 110 90 L 160 30')).toBe(true);
  });

  it('threshold is far below any real signature', () => {
    expect(MIN_SIGNATURE_INK_LENGTH).toBeLessThanOrEqual(20);
  });
});
