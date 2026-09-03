// @vitest-environment jsdom
/**
 * The follow-up nudge copy has to tell the tradie how long a quote has been
 * silent — "Sent 2 days ago, no reply yet" — so the banner reads as an
 * up-to-date prompt rather than a vague reminder. The subtitle is a pure
 * function of the nudge, so assert it directly off the exported meta builder
 * (no render needed).
 */
import { describe, it, expect, vi } from 'vitest';

// The subtitle is a pure string builder; mock the banner's heavy native deps
// so importing the module doesn't drag in untranspilable RN/Expo graphs
// (same approach as JobCard.ghost.test.tsx).
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('react-native-paper', async () => {
  const { Text, View } = await import('react-native');
  return { Text, Surface: View };
});
vi.mock('../utils/haptics', () => ({ lightTap: vi.fn() }));
vi.mock('../services/analyticsService', () => ({ trackEvent: vi.fn() }));

import { nudgeMetaFor } from './FollowUpNudgeBanner';
import type { FollowUpNudge } from '../utils/followUpNudge';
import type { Tokens } from '../theme';

// Colours are irrelevant to the copy under test — a proxy returns a value for
// any token the builder reads.
const palette = new Proxy({}, { get: () => '#000000' }) as unknown as Tokens;

function followUp(days: number): FollowUpNudge {
  return { type: 'quote_follow_up', key: 'quote_follow_up:q1', docId: 'q1', days };
}

describe('quote_follow_up copy', () => {
  const subtitle = (days: number) => nudgeMetaFor(palette).quote_follow_up.subtitle(followUp(days));

  it('says how many days it has been, with no reply yet', () => {
    expect(subtitle(2)).toBe('Sent 2 days ago, no reply yet — worth a follow-up');
  });

  it('pluralises correctly for older quotes', () => {
    expect(subtitle(9)).toBe('Sent 9 days ago, no reply yet — worth a follow-up');
  });

  it('never uses QuoteMate branding or the word AI, stays plain and neutral', () => {
    const text = subtitle(3);
    expect(text).not.toMatch(/QuoteMate/i);
    expect(text).not.toMatch(/\bAI\b/);
    expect(text).not.toMatch(/blokes|guys|folks|mate/i);
  });
});
