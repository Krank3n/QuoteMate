// Pins the chat cost arithmetic across the two providers' billing shapes —
// in particular that Claude cache WRITES bill at their premium rate and cache
// READS at the discounted one, instead of everything flattening to inputPerM.

import { describe, it, expect } from 'vitest';
import {
  costMicrosForChat,
  costMicrosForLive,
  platformCostMicros,
  PRICING,
} from './assistantCosts';

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

// ---------------------------------------------------------------------------
// Per-minute voice pricing (ElevenLabs Agents)
// ---------------------------------------------------------------------------

describe('platformCostMicros', () => {
  it('costs 6 minutes at $0.08/min as exactly 480,000 micros', () => {
    // THE unit guard. Every other term in assistantCosts relies on
    // tokens * pricePerM === micros; a per-minute rate is plain USD and needs
    // an explicit * 1e6. A factor-of-a-million slip here looks entirely
    // plausible on the dashboard, which is why it is pinned to a literal.
    expect(platformCostMicros('elevenlabs/claude-sonnet-5', 360)).toBe(480_000);
  });

  it('scales linearly with duration', () => {
    const one = platformCostMicros('elevenlabs/claude-sonnet-5', 60);
    expect(one).toBe(80_000);
    expect(platformCostMicros('elevenlabs/claude-sonnet-5', 120)).toBe(one * 2);
  });

  it('charges part-minutes proportionally rather than rounding up', () => {
    expect(platformCostMicros('elevenlabs/claude-sonnet-5', 30)).toBe(40_000);
  });

  it('doubles at the burst rate when over the concurrency limit', () => {
    const standard = platformCostMicros('elevenlabs/claude-sonnet-5', 360);
    const burst = platformCostMicros('elevenlabs/claude-sonnet-5', 360, { burst: true });
    expect(burst).toBe(standard * 2);
  });

  it('costs nothing for a zero-length or negative duration', () => {
    expect(platformCostMicros('elevenlabs/claude-sonnet-5', 0)).toBe(0);
    expect(platformCostMicros('elevenlabs/claude-sonnet-5', -100)).toBe(0);
  });

  it('costs nothing for a token-billed model, so the Gemini rows are untouched', () => {
    expect(platformCostMicros('gemini-3.1-flash-live-preview', 600)).toBe(0);
    expect(platformCostMicros('claude-sonnet-5', 600)).toBe(0);
  });
});

describe('ElevenLabs pricing row', () => {
  it('exists and carries a per-minute rate', () => {
    expect(PRICING['elevenlabs/claude-sonnet-5'].perMinuteUsd).toBe(0.08);
  });

  it('uses a compound key so voice spend stays separable from text spend', () => {
    // Both run claude-sonnet-5; fusing the keys would make /admin/ai-costs
    // unable to say whether Mate's cost comes from typing or talking.
    expect(PRICING['elevenlabs/claude-sonnet-5']).not.toBe(PRICING['claude-sonnet-5']);
  });

  it('survives sanitiseKey as a legal Firestore field path segment', () => {
    const key = 'elevenlabs/claude-sonnet-5'.replace(/[.#$/[\]]/g, '_');
    expect(key).toBe('elevenlabs_claude-sonnet-5');
    expect(key).not.toMatch(/[.#$/[\]]/);
  });
});

describe('token-cost regression for the pre-existing rows', () => {
  it('costs a Gemini Live session exactly as it did before the voice swap', () => {
    // Guards the additive change: adding perMinuteUsd must not perturb any
    // existing arithmetic. 1M input audio tokens at $0.50/M = $0.50 = 500k micros.
    expect(costMicrosForLive('gemini-3.1-flash-live-preview', {
      inputAudioTokens: 1_000_000,
    })).toBe(500_000);
  });
});
