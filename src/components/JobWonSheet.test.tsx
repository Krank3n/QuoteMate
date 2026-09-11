// @vitest-environment jsdom
/**
 * The "job won" sheet.
 *
 * Shown once after a quote is marked accepted. The primary button is the money
 * step — the deposit the tradie asked for, or the invoice — and it calls back
 * into the job screen rather than navigating itself. Pro is secondary, only
 * offered when it is genuinely the tradie's next problem, and never in front
 * of the collection action. The gating (who/when) lives in wonPrompt.test.ts.
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

import { JobWonSheet, hasNonSquarePaymentMethod, shouldOfferPro } from './JobWonSheet';

const tracked = analytics.trackEvent;

function renderSheet(overrides: Partial<React.ComponentProps<typeof JobWonSheet>> = {}) {
  const props = {
    visible: true,
    onDismiss: vi.fn(),
    name: 'Sam Taylor',
    total: 770,
    trialDaysRemaining: null,
    collect: 'invoice' as const,
    onCollect: vi.fn(),
    hasOtherPaymentMethod: false,
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
  it('renders the total, the customer name and the money step', () => {
    renderSheet();

    expect(screen.getByText('$770.00')).toBeTruthy();
    expect(screen.getByText('Sam Taylor')).toBeTruthy();
    expect(screen.getByText('Create the invoice')).toBeTruthy();
    expect(screen.getByText('Not now')).toBeTruthy();
  });

  it('leads with the deposit when one is owing on the quote', () => {
    renderSheet({ collect: 'deposit' });

    expect(screen.getByText('Take the deposit')).toBeTruthy();
    expect(screen.queryByText('Create the invoice')).toBeNull();
  });

  it('reports the impression once when shown, with what was offered', () => {
    renderSheet();
    expect(tracked.mock.calls.filter(([e]) => e === 'won_prompt_shown')).toHaveLength(1);
    expect(eventProps('won_prompt_shown')).toEqual({ collect: 'invoice', pro_offered: false });
  });

  it('does not render or report when not visible', () => {
    renderSheet({ visible: false });
    expect(screen.queryByText('Create the invoice')).toBeNull();
    expect(tracked.mock.calls.map(([e]) => e)).not.toContain('won_prompt_shown');
  });

  // The whole point of the change: getting paid comes before being sold to.
  it('the primary runs the collection callback and never opens the paywall', () => {
    const { props } = renderSheet({ collect: 'invoice' });

    fireEvent.click(screen.getByText('Create the invoice'));

    expect(props.onCollect).toHaveBeenCalledOnce();
    expect(nav.navigate).not.toHaveBeenCalled();
    expect(eventProps('won_prompt_tapped')).toEqual({ outcome: 'invoice' });
    expect(props.onDismiss).toHaveBeenCalled();
  });

  it('the deposit primary reports its own outcome and stays off the paywall', () => {
    const { props } = renderSheet({ collect: 'deposit', trialDaysRemaining: 1 });

    fireEvent.click(screen.getByText('Take the deposit'));

    expect(props.onCollect).toHaveBeenCalledOnce();
    expect(nav.navigate).not.toHaveBeenCalled();
    expect(eventProps('won_prompt_tapped')).toEqual({ outcome: 'deposit' });
  });

  it('Not now dismisses, reports not_now, and collects nothing', () => {
    const { props } = renderSheet();

    fireEvent.click(screen.getByText('Not now'));

    expect(props.onDismiss).toHaveBeenCalled();
    expect(props.onCollect).not.toHaveBeenCalled();
    expect(eventProps('won_prompt_tapped')).toEqual({ outcome: 'not_now' });
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  // The sheet stays live through the close animation, so an impatient
  // double-tap must not report the outcome twice or collect twice.
  it('ignores a second tap once an outcome is chosen', () => {
    const { props } = renderSheet();

    const primary = screen.getByText('Create the invoice');
    fireEvent.click(primary);
    fireEvent.click(primary);
    fireEvent.click(screen.getByText('Not now'));

    expect(tracked.mock.calls.filter(([e]) => e === 'won_prompt_tapped')).toHaveLength(1);
    expect(props.onCollect).toHaveBeenCalledOnce();
  });
});

describe('the Pro offer', () => {
  it('is absent for a free account with nothing Free is holding back', () => {
    renderSheet({ trialDaysRemaining: null, hasOtherPaymentMethod: false });

    expect(screen.queryByText('See Pro')).toBeNull();
    expect(screen.getByText('Not now')).toBeTruthy();
  });

  it('appears as a text button once the payment-methods line is true', () => {
    renderSheet({ trialDaysRemaining: null, hasOtherPaymentMethod: true });

    expect(screen.getByText('See Pro')).toBeTruthy();
    expect(
      screen.getByText(
        'Pro also puts bank transfer, PayID and PayPal on your quotes and invoices, alongside Square.',
      ),
    ).toBeTruthy();
  });

  // Free keeps unlimited quotes and Square invoicing — nothing here may
  // suggest invoicing is what they are missing.
  it('never claims invoicing is a Pro feature', () => {
    renderSheet({ trialDaysRemaining: 2, hasOtherPaymentMethod: true });

    expect(document.body.textContent).not.toMatch(/Pro lets you invoice/);
    expect(document.body.textContent).not.toMatch(/keep invoicing/);
  });

  it('tells a trial user what is ending rather than selling them what they have', () => {
    renderSheet({ trialDaysRemaining: 2 });

    expect(
      screen.getByText(
        'Your trial ends in 2 days — Pro keeps bank transfer, PayID and PayPal on your documents.',
      ),
    ).toBeTruthy();
  });

  it('counts the last day in the singular, and the final day as today', () => {
    const { unmount } = renderSheet({ trialDaysRemaining: 1 });
    expect(
      screen.getByText(
        'Your trial ends in 1 day — Pro keeps bank transfer, PayID and PayPal on your documents.',
      ),
    ).toBeTruthy();
    unmount();

    renderSheet({ trialDaysRemaining: 0 });
    expect(
      screen.getByText(
        'Your trial ends today — Pro keeps bank transfer, PayID and PayPal on your documents.',
      ),
    ).toBeTruthy();
  });

  it('still puts the money action ahead of Pro when both are shown', () => {
    const { props } = renderSheet({ trialDaysRemaining: 2, collect: 'deposit' });

    const buttons = Array.from(document.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons.indexOf('Take the deposit')).toBeLessThan(buttons.indexOf('See Pro'));

    fireEvent.click(screen.getByText('See Pro'));
    expect(nav.navigate).toHaveBeenCalledWith('Paywall', { source: 'job_won' });
    expect(eventProps('won_prompt_tapped')).toEqual({ outcome: 'see_pro' });
    expect(props.onCollect).not.toHaveBeenCalled();
  });
});

describe('shouldOfferPro', () => {
  it('offers to a trial in its last days whatever they have set up', () => {
    expect(shouldOfferPro({ trialDaysRemaining: 0, hasOtherPaymentMethod: false })).toBe(true);
  });

  it('offers on Free only when a non-Square method is being held back', () => {
    expect(shouldOfferPro({ trialDaysRemaining: null, hasOtherPaymentMethod: false })).toBe(false);
    expect(shouldOfferPro({ trialDaysRemaining: null, hasOtherPaymentMethod: true })).toBe(true);
  });
});

describe('hasNonSquarePaymentMethod', () => {
  it('needs both the switch and something to print', () => {
    expect(hasNonSquarePaymentMethod(undefined)).toBe(false);
    expect(hasNonSquarePaymentMethod({ showOnDocuments: true })).toBe(false);
    expect(
      hasNonSquarePaymentMethod({ showOnDocuments: true, bankAccount: { enabled: true } }),
    ).toBe(false);
    expect(
      hasNonSquarePaymentMethod({
        showOnDocuments: true,
        bankAccount: { enabled: false, bsb: '062-000', accountNumber: '12345678' },
      }),
    ).toBe(false);
  });

  it('is true for each method that is set up', () => {
    expect(
      hasNonSquarePaymentMethod({ showOnDocuments: true, bankAccount: { enabled: true, bsb: '062-000' } }),
    ).toBe(true);
    expect(
      hasNonSquarePaymentMethod({
        showOnDocuments: true,
        payId: { enabled: true, payIdType: 'email', payIdValue: 'a@b.com' },
      }),
    ).toBe(true);
    expect(
      hasNonSquarePaymentMethod({ showOnDocuments: true, bpay: { enabled: true, billerCode: '1234' } }),
    ).toBe(true);
    expect(
      hasNonSquarePaymentMethod({ showOnDocuments: true, paypal: { enabled: true, email: 'a@b.com' } }),
    ).toBe(true);
    expect(
      hasNonSquarePaymentMethod({ showOnDocuments: true, other: { enabled: true, instructions: 'Cash' } }),
    ).toBe(true);
  });
});
