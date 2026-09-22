// @vitest-environment jsdom
/**
 * The expired-trial banner is seen every session from 22 Sep 2026 (it was
 * unreachable before). Its copy is a pure function of the state, so pin it
 * off the exported builder: honest, plain, no guilt, no branding.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('react-native-paper', async () => {
  const { Text, View } = await import('react-native');
  return { Text, Surface: View, Button: View };
});
vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: vi.fn() }) }));
vi.mock('../services/analyticsService', () => ({ trackEvent: vi.fn() }));

import { getTrialMessage } from './TrialBanner';

describe('expired-trial copy', () => {
  it('says the trial is over, that quotes still send, and what Pro keeps', () => {
    const m = getTrialMessage(0, 3, true, false);
    expect(m.title).toBe("Your free trial's finished");
    expect(m.subtitle).toBe('3 quotes on the board. Quotes still send on Free — Pro keeps the full kit');
    expect(getTrialMessage(0, 1, true, false).subtitle).toMatch(/^1 quote on the board/);
    expect(getTrialMessage(0, 0, true, false).subtitle).toBe('Quotes still send on Free — Pro keeps the full kit');
  });

  it('carries no guilt, no threat about their quotes, no branding, no "AI"', () => {
    for (const n of [0, 1, 2, 5]) {
      const text = `${getTrialMessage(0, n, true, false).title} ${getTrialMessage(0, n, true, false).subtitle}`;
      expect(text).not.toMatch(/cooked|cactus|doornail|go home|walkabout|dodo|bail/i);
      expect(text).not.toMatch(/QuoteMate/i);
      expect(text).not.toMatch(/\bAI\b/);
      expect(text).not.toMatch(/blokes|guys|folks|fancy/i);
    }
  });

  it('leaves the return-trial ending alone — that one already says it was the last run', () => {
    expect(getTrialMessage(0, 2, true, true).title).toBe('That was the last free run');
  });
});
