/**
 * "Job won" prompt gating.
 *
 * The offer fires at the first moment the app has visibly earned something —
 * a quote marked accepted — so it must be scarce: never to Pro users, at most
 * once per document, and never more than once a week. These pin those caps and
 * the corrupt-state fallback that keeps a bad blob from wedging it on or off.
 */
import { describe, it, expect } from 'vitest';

import {
  shouldShowWonPrompt,
  parseWonPromptState,
  recordWonPromptShown,
} from './wonPrompt';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function decide(overrides: Partial<Parameters<typeof shouldShowWonPrompt>[0]> = {}) {
  return shouldShowWonPrompt({
    plan: 'free',
    docId: 'q1',
    shownDocIds: [],
    lastShownAt: null,
    now: NOW,
    ...overrides,
  });
}

describe('shouldShowWonPrompt', () => {
  it('never shows for Pro users, even on a fresh doc', () => {
    expect(decide({ plan: 'pro' })).toBe(false);
  });

  it('shows for a trial user on their first win', () => {
    expect(decide({ plan: 'trial' })).toBe(true);
  });

  it('shows for a free user on their first win', () => {
    expect(decide({ plan: 'free' })).toBe(true);
  });

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
