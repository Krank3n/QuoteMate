// @vitest-environment jsdom
/**
 * The "job won" sheet.
 *
 * Shown once after a quote is marked accepted — the first moment the app has
 * visibly earned something — to offer Pro to non-Pro users. These hold the
 * wiring: it names the value delivered, routes "See Pro" into the paywall
 * tagged with the job_won source, and reports both taps so take-rate is
 * measurable. The gating (who/when) lives in wonPrompt.test.ts.
 *
 * Heavy native deps are stubbed the same way the other sheet tests do it
 * (ScheduleJobSheet.test.tsx): react-native-paper down to Text/Button, and
 * BottomSheet down to a plain container that renders its children when visible.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';

vi.mock('react-native-paper', async () => {
  const { Text } = await import('react-native');
  return {
    MD3DarkTheme: { colors: {} },
    Text,
    // A real <button> so onPress is a plain click the test can fire.
    Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) => (
      <button onClick={onPress}>{children}</button>
    ),
  };
});
// Same shim as the other sheet tests: the real BottomSheet drags in
// react-native-safe-area-context, which ships untranspiled syntax.
vi.mock('./BottomSheet', async () => {
  const { View, Text } = await import('react-native');
  return {
    BottomSheet: ({ visible, title, subtitle, children }: any) =>
      visible ? (
        <View>
          <Text>{title}</Text>
          {subtitle ? <Text>{subtitle}</Text> : null}
          {children}
        </View>
      ) : null,
  };
});

const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('@react-navigation/native', () => ({ useNavigation: () => nav }));
vi.mock('../utils/haptics', () => ({ selectionTap: vi.fn(), lightTap: vi.fn() }));

const analytics = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock('../services/analyticsService', () => analytics);

import { JobWonSheet } from './JobWonSheet';

const tracked = analytics.trackEvent;

function renderSheet(overrides: Partial<React.ComponentProps<typeof JobWonSheet>> = {}) {
  const props = {
    visible: true,
    onDismiss: vi.fn(),
    name: 'Sam Taylor',
    total: 770,
    trialDaysRemaining: null,
    ...overrides,
  };
  return { ...render(<JobWonSheet {...props} />), props };
}

/** Props of the first matching tracked event. */
function eventProps(name: string) {
  return tracked.mock.calls.find(([event]) => event === name)?.[1] as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('JobWonSheet', () => {
  it('renders the total, the customer name and both buttons', () => {
    renderSheet();

    expect(screen.getByText('$770.00')).toBeTruthy();
    expect(screen.getByText('Sam Taylor')).toBeTruthy();
    expect(screen.getByText('See Pro')).toBeTruthy();
    expect(screen.getByText('Not now')).toBeTruthy();
  });

  it('reports the impression once when shown', () => {
    renderSheet();
    expect(tracked.mock.calls.filter(([e]) => e === 'won_prompt_shown')).toHaveLength(1);
  });

  it('does not render or report when not visible', () => {
    renderSheet({ visible: false });
    expect(screen.queryByText('See Pro')).toBeNull();
    expect(tracked.mock.calls.map(([e]) => e)).not.toContain('won_prompt_shown');
  });

  it('See Pro navigates to the paywall tagged job_won and reports the tap', () => {
    const { props } = renderSheet();

    fireEvent.click(screen.getByText('See Pro'));

    expect(nav.navigate).toHaveBeenCalledWith('Paywall', { source: 'job_won' });
    expect(eventProps('won_prompt_tapped')).toEqual({ outcome: 'see_pro' });
    expect(props.onDismiss).toHaveBeenCalled();
  });

  it('Not now dismisses, reports not_now, and never opens the paywall', () => {
    const { props } = renderSheet();

    fireEvent.click(screen.getByText('Not now'));

    expect(props.onDismiss).toHaveBeenCalled();
    expect(eventProps('won_prompt_tapped')).toEqual({ outcome: 'not_now' });
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  // The sheet stays live through the close animation, so an impatient
  // double-tap must not report the outcome twice or navigate on a dismiss.
  it('ignores a second tap once an outcome is chosen', () => {
    renderSheet();

    const seePro = screen.getByText('See Pro');
    fireEvent.click(seePro);
    fireEvent.click(seePro);
    fireEvent.click(screen.getByText('Not now'));

    expect(tracked.mock.calls.filter(([e]) => e === 'won_prompt_tapped')).toHaveLength(1);
    expect(nav.navigate).toHaveBeenCalledTimes(1);
  });

  it('offers a free user what Pro adds', () => {
    renderSheet({ trialDaysRemaining: null });

    expect(
      screen.getByText(
        'Pro lets you invoice this job and get paid any way — bank, PayID, PayPal or Square.',
      ),
    ).toBeTruthy();
  });

  // A trial user already has invoicing and payments, so the line names what
  // they are about to lose rather than selling them something they have.
  it('tells a trial user their trial is ending instead of selling them Pro', () => {
    renderSheet({ trialDaysRemaining: 2 });

    expect(
      screen.getByText('Your trial ends in 2 days — keep invoicing and getting paid with Pro.'),
    ).toBeTruthy();
  });

  it('counts the last day in the singular, and the final day as today', () => {
    const { unmount } = renderSheet({ trialDaysRemaining: 1 });
    expect(
      screen.getByText('Your trial ends in 1 day — keep invoicing and getting paid with Pro.'),
    ).toBeTruthy();
    unmount();

    renderSheet({ trialDaysRemaining: 0 });
    expect(
      screen.getByText('Your trial ends today — keep invoicing and getting paid with Pro.'),
    ).toBeTruthy();
  });
});
