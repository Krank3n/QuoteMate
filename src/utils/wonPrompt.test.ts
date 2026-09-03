/**
 * "Job won" prompt gating.
 *
 * The offer fires at the first moment the app has visibly earned something —
 * a quote marked accepted — so it must be scarce and honest: never to someone
 * who already has Pro (including a trial that still has days to run), never on
 * an unpriced quote, at most once per document, and never more than once a
 * week. These pin those caps, the clock-skew clamp, and the persist-before-show
 * contract that keeps the weekly cap from failing open.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  shouldShowWonPrompt,
  parseWonPromptState,
  recordWonPromptShown,
  maybeShowWonPrompt,
  WON_PROMPT_KEY,
} from './wonPrompt';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function decide(overrides: Partial<Parameters<typeof shouldShowWonPrompt>[0]> = {}) {
  return shouldShowWonPrompt({
    plan: 'free',
    trialDaysRemaining: null,
    docId: 'q1',
    total: 770,
    shownDocIds: [],
    lastShownAt: null,
    now: NOW,
    ...overrides,
  });
}

describe('shouldShowWonPrompt audience', () => {
  it('never shows for Pro users, even on a fresh doc', () => {
    expect(decide({ plan: 'pro' })).toBe(false);
  });

  it('shows for a free user on their first win', () => {
    expect(decide({ plan: 'free' })).toBe(true);
  });

  it('stays quiet mid-trial, when they already have everything it offers', () => {
    expect(decide({ plan: 'trial', trialDaysRemaining: 5 })).toBe(false);
  });

  it('shows in the last 3 days of a trial', () => {
    expect(decide({ plan: 'trial', trialDaysRemaining: 3 })).toBe(true);
  });

  it('shows on the day a trial runs out', () => {
    expect(decide({ plan: 'trial', trialDaysRemaining: 0 })).toBe(true);
  });

  it('stays quiet for a trial with no countdown to stand on', () => {
    expect(decide({ plan: 'trial', trialDaysRemaining: null })).toBe(false);
  });
});

describe('shouldShowWonPrompt money guard', () => {
  it('does not celebrate an unpriced quote', () => {
    expect(decide({ total: 0 })).toBe(false);
  });

  it('does not show for a broken total', () => {
    expect(decide({ total: Number.NaN })).toBe(false);
    expect(decide({ total: Number.POSITIVE_INFINITY })).toBe(false);
    expect(decide({ total: -100 })).toBe(false);
  });
});

describe('shouldShowWonPrompt frequency', () => {
  it('does not show twice for the same document', () => {
    expect(decide({ shownDocIds: ['q1'] })).toBe(false);
  });

  it('does not show a second doc within 7 days of the last one', () => {
    expect(
      decide({
        docId: 'q2',
        shownDocIds: ['q1'],
        lastShownAt: NOW - (SEVEN_DAYS_MS - 1),
      }),
    ).toBe(false);
  });

  it('shows a second doc once 7 days have passed', () => {
    expect(
      decide({
        docId: 'q2',
        shownDocIds: ['q1'],
        lastShownAt: NOW - SEVEN_DAYS_MS,
      }),
    ).toBe(true);
  });

  it('treats a lastShownAt in the future as never shown, so clock skew cannot disable it', () => {
    expect(decide({ docId: 'q2', lastShownAt: NOW + SEVEN_DAYS_MS })).toBe(true);
  });

  it('treats malformed stored state as empty, so a fresh win still shows', () => {
    const state = parseWonPromptState('{not valid json');
    expect(state).toEqual({ shownDocIds: [], lastShownAt: null });
    expect(
      decide({ shownDocIds: state.shownDocIds, lastShownAt: state.lastShownAt }),
    ).toBe(true);
  });
});

describe('parseWonPromptState', () => {
  it('reads a well-formed blob back', () => {
    const raw = JSON.stringify({ shownDocIds: ['a', 'b'], lastShownAt: 42 });
    expect(parseWonPromptState(raw)).toEqual({ shownDocIds: ['a', 'b'], lastShownAt: 42 });
  });

  it('falls back to empty for null, wrong-shape, and non-string ids', () => {
    expect(parseWonPromptState(null)).toEqual({ shownDocIds: [], lastShownAt: null });
    expect(parseWonPromptState('[]')).toEqual({ shownDocIds: [], lastShownAt: null });
    expect(parseWonPromptState(JSON.stringify({ shownDocIds: [1, 'ok', null], lastShownAt: 'x' })))
      .toEqual({ shownDocIds: ['ok'], lastShownAt: null });
  });
});

describe('recordWonPromptShown', () => {
  it('appends the doc id and stamps the time', () => {
    expect(recordWonPromptShown({ shownDocIds: ['a'], lastShownAt: 1 }, 'b', NOW))
      .toEqual({ shownDocIds: ['a', 'b'], lastShownAt: NOW });
  });

  it('does not duplicate a doc id already recorded', () => {
    expect(recordWonPromptShown({ shownDocIds: ['a'], lastShownAt: 1 }, 'a', NOW))
      .toEqual({ shownDocIds: ['a'], lastShownAt: NOW });
  });
});

describe('maybeShowWonPrompt', () => {
  /** An in-memory AsyncStorage, optionally one that fails every write. */
  function storage(stored: string | null = null, { failWrites = false } = {}) {
    const writes: Array<{ key: string; value: string }> = [];
    return {
      writes,
      getItem: vi.fn(async () => stored),
      setItem: vi.fn(async (key: string, value: string) => {
        if (failWrites) throw new Error('storage full');
        writes.push({ key, value });
      }),
    };
  }

  function offer(
    store: ReturnType<typeof storage>,
    overrides: Partial<Parameters<typeof maybeShowWonPrompt>[0]> = {},
  ) {
    return maybeShowWonPrompt({
      doc: { id: 'q1', total: 770 },
      plan: 'free',
      trialDaysRemaining: null,
      reviewShown: false,
      now: NOW,
      getItem: store.getItem,
      setItem: store.setItem,
      ...overrides,
    });
  }

  it('stands down when the store-review prompt was asked for on this same win', async () => {
    const store = storage();
    await expect(offer(store, { reviewShown: true })).resolves.toBe(false);
    expect(store.getItem).not.toHaveBeenCalled();
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it('does not show when the cap could not be written down', async () => {
    const store = storage(null, { failWrites: true });
    await expect(offer(store)).resolves.toBe(false);
  });

  it('does not show again for a document already offered', async () => {
    const store = storage(JSON.stringify({ shownDocIds: ['q1'], lastShownAt: null }));
    await expect(offer(store)).resolves.toBe(false);
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it('does not let an unpriced quote burn the weekly cap', async () => {
    const store = storage();
    await expect(offer(store, { doc: { id: 'q1', total: 0 } })).resolves.toBe(false);
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it('treats malformed stored state as empty and still shows', async () => {
    const store = storage('{not valid json');
    await expect(offer(store)).resolves.toBe(true);
  });

  it('shows and records the doc id and the time before it does', async () => {
    const store = storage();
    await expect(offer(store)).resolves.toBe(true);
    expect(store.writes).toEqual([
      {
        key: WON_PROMPT_KEY,
        value: JSON.stringify({ shownDocIds: ['q1'], lastShownAt: NOW }),
      },
    ]);
  });
});
