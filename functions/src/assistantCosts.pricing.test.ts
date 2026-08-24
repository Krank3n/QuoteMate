// Pins the chat cost arithmetic across the two providers' billing shapes —
// in particular that Claude cache WRITES bill at their premium rate and cache
// READS at the discounted one, instead of everything flattening to inputPerM.

import { describe, it, expect } from 'vitest';
import { costMicrosForChat, PRICING } from './assistantCosts';

describe('costMicrosForChat', () => {
  it('bills a claude-sonnet-5 turn with cache reads and writes at their own rates', () => {
    // 1,000 plain input + 8,000 cache-read + 500 cache-write + 300 output.
    const micros = costMicrosForChat('claude-sonnet-5', {
      promptTokenCount: 9500,
      candidatesTokenCount: 300,
      cachedContentTokenCount: 8000,
      cacheWriteTokenCount: 500,
    });
    const expected =
      1000 * 3.0 + // plain input
      8000 * 0.3 + // cache read
      500 * 3.75 + // cache write premium
      300 * 15.0; // output
    expect(micros).toBe(Math.round(expected));
  });

  it('keeps the legacy gemini arithmetic unchanged (no cacheWrite field)', () => {
    const micros = costMicrosForChat('gemini-3-flash-preview', {
      promptTokenCount: 10000,
      candidatesTokenCount: 400,
      cachedContentTokenCount: 6000,
      thoughtsTokenCount: 100,
    });
    const expected = 4000 * 0.3 + 6000 * 0.075 + (400 + 100) * 2.5;
    expect(micros).toBe(Math.round(expected));
  });

  it('has a pricing row for the live chat model', () => {
    expect(PRICING['claude-sonnet-5']).toBeTruthy();
  });
});
