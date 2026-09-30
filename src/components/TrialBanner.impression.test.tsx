// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';

vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('react-native-paper', async () => {
  const { Text, View } = await import('react-native');
  return { Text, Surface: View, Button: View };
});
vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: vi.fn() }) }));
const trackEvent = vi.fn();
vi.mock('../services/analyticsService', () => ({ trackEvent: (...a: unknown[]) => trackEvent(...a) }));

import { TrialBanner } from './TrialBanner';

describe('expired banner impression', () => {
  beforeEach(() => trackEvent.mockClear());
  it('logs trial_expired_banner_shown for a finished trial (liaN shape)', () => {
    const trial = { trialStartedAt: '2026-09-12T14:01:52.265Z', trialExpired: false } as any;
    render(<TrialBanner trial={trial} quoteCount={3} onStayOnFree={() => {}} />);
    expect(trackEvent.mock.calls.map((c) => c[0])).toContain('trial_expired_banner_shown');
  });
});
