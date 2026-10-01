// @vitest-environment jsdom
/**
 * The deposit control belongs to quotes only. A deposit is asked for when the
 * customer accepts a quote; an invoice is never accepted, so on an invoice the
 * section was a dead, greyed-out switch that tradies found while trying to
 * change what a part-paid invoice shows. These pin that the invoice variant
 * drops the section (and its Square round-trip) and the quote keeps it.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';

vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('../utils/haptics', () => ({ selectionTap: vi.fn(), lightTap: vi.fn() }));

const square = vi.hoisted(() => ({ checkSquareConnection: vi.fn(async () => ({ connected: true })) }));
vi.mock('../services/squareService', () => square);

// The plan and the payment-methods switch, read through the store.
const storeState = vi.hoisted(() => ({
  plan: 'free' as 'free' | 'trial' | 'pro',
  showOnDocuments: false,
}));
vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: any) => unknown) =>
    selector({
      getEffectivePlan: () => storeState.plan,
      businessSettings: { paymentMethods: { showOnDocuments: storeState.showOnDocuments } },
    }),
}));

const nav = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('@react-navigation/native', async () => {
  const ReactMod = await import('react');
  return {
    useNavigation: () => nav,
    // Run the focus callback once on mount, like a screen gaining focus.
    useFocusEffect: (cb: () => void | (() => void)) => ReactMod.useEffect(cb, []),
  };
});

vi.mock('react-native-paper', async () => {
  const { Text, View, TextInput: RNTextInput } = await import('react-native');
  const TextInput: any = (props: any) => <RNTextInput {...props} />;
  TextInput.Affix = () => null;
  return {
    MD3DarkTheme: { colors: {} },
    Text,
    TextInput,
    Surface: ({ children }: any) => <View>{children}</View>,
    Divider: () => null,
  };
});

import { InvoiceDisplaySettings } from './InvoiceDisplaySettings';

const base = {
  total: 9850.40,
  showMarkup: false,
  priceDetail: 'itemised' as const,
  // A stray 14% left on an invoice with the switch off.
  requireDeposit: true,
  depositPercentage: 14,
  onChange: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  square.checkSquareConnection.mockImplementation(async () => ({ connected: true }));
  storeState.plan = 'free';
  storeState.showOnDocuments = false;
});

describe('InvoiceDisplaySettings deposit section', () => {
  it('omits the deposit section on an invoice and titles the card "Display"', () => {
    const { queryByText, getByText } = render(
      <InvoiceDisplaySettings {...base} mode="invoice" />,
    );
    expect(queryByText('DEPOSIT')).toBeNull();
    expect(queryByText('Require deposit on acceptance')).toBeNull();
    expect(queryByText('Connect Square')).toBeNull();
    expect(getByText('Display')).toBeTruthy();
    expect(queryByText('Display & deposit')).toBeNull();
  });

  it('does not check Square or rewrite deposit fields on an invoice', async () => {
    render(<InvoiceDisplaySettings {...base} mode="invoice" />);
    // Give any focus effect a tick to fire.
    await new Promise((r) => setTimeout(r, 0));
    expect(square.checkSquareConnection).not.toHaveBeenCalled();
    expect(base.onChange).not.toHaveBeenCalled();
  });

  it('leaves the deposit out of the collapsed invoice summary', () => {
    const { getByText, queryByText } = render(
      <InvoiceDisplaySettings {...base} mode="invoice" variant="collapsible" />,
    );
    expect(getByText('Display')).toBeTruthy();
    expect(queryByText(/Deposit 14%/)).toBeNull();
    expect(
      document.querySelector('[aria-label="Show display"]'),
    ).not.toBeNull();
  });

  it('keeps the deposit section and summary on a quote', async () => {
    const { getByText } = render(
      <InvoiceDisplaySettings {...base} mode="quote" variant="collapsible" expanded />,
    );
    expect(getByText('Display & deposit')).toBeTruthy();
    expect(getByText(/Deposit 14%/)).toBeTruthy();
    expect(getByText('DEPOSIT')).toBeTruthy();
    expect(getByText('Require deposit on acceptance')).toBeTruthy();
    await waitFor(() => expect(square.checkSquareConnection).toHaveBeenCalledTimes(1));
  });
});

// A tradie paid by bank transfer can ask for a deposit without Square on a
// paid or trial plan — their bank details print on the quote. The free plan
// keeps today's Square-only switch: its PDF hides bank details and its send
// gate blocks a deposit quote without Square.
describe('InvoiceDisplaySettings deposit without Square', () => {
  const quoteProps = { ...base, mode: 'quote' as const, variant: 'embedded' as const };
  // The deposit switch is the last one in the card (markup comes first).
  const toggle = (baseElement: HTMLElement) => {
    const all = baseElement.querySelectorAll<HTMLInputElement>('input[type="checkbox"], [role="switch"]');
    return all.length ? all[all.length - 1] : null;
  };

  beforeEach(() => {
    square.checkSquareConnection.mockImplementation(async () => ({ connected: false }));
  });

  for (const plan of ['pro', 'trial'] as const) {
    it(`${plan} plan: the switch stays on and enabled, with the bank-transfer wording`, async () => {
      storeState.plan = plan;
      const { getByText, queryByText, baseElement } = render(<InvoiceDisplaySettings {...quoteProps} />);

      await waitFor(() => expect(square.checkSquareConnection).toHaveBeenCalled());
      expect(
        getByText('Customer pays the deposit by bank transfer — your payment details print on the quote.'),
      ).toBeTruthy();
      expect(queryByText('Connect Square')).toBeNull();
      // Not turned off behind the tradie's back on focus.
      expect(base.onChange).not.toHaveBeenCalledWith({ requireDeposit: false, depositAmount: 0 });
      const sw = toggle(baseElement);
      expect(sw).not.toBeNull();
      expect(sw!.disabled).toBe(false);
      expect(sw!.checked).toBe(true);
      expect(getByText('Deposit due on acceptance')).toBeTruthy();
    });
  }

  it('nudges to Payment Methods while the details are not shown on documents', async () => {
    storeState.plan = 'pro';
    const { getByText } = render(<InvoiceDisplaySettings {...quoteProps} />);
    await waitFor(() => expect(square.checkSquareConnection).toHaveBeenCalled());

    fireEvent.click(getByText('Add your payment details'));
    expect(nav.navigate).toHaveBeenCalledWith('PaymentMethods');
  });

  it('no nudge once the details print on documents', async () => {
    storeState.plan = 'pro';
    storeState.showOnDocuments = true;
    const { queryByText } = render(<InvoiceDisplaySettings {...quoteProps} />);
    await waitFor(() => expect(square.checkSquareConnection).toHaveBeenCalled());
    expect(queryByText('Add your payment details')).toBeNull();
  });

  it('turning the deposit on writes requireDeposit without Square', async () => {
    storeState.plan = 'pro';
    const { baseElement } = render(
      <InvoiceDisplaySettings {...quoteProps} requireDeposit={false} depositPercentage={30} total={960} />,
    );
    await waitFor(() => expect(square.checkSquareConnection).toHaveBeenCalled());

    fireEvent.click(toggle(baseElement)!);
    expect(base.onChange).toHaveBeenCalledWith({ requireDeposit: true, depositPercentage: 30, depositAmount: 288 });
  });

  it('free plan without Square: unchanged — cleared on focus, disabled, Connect Square', async () => {
    storeState.plan = 'free';
    const { getByText, baseElement } = render(<InvoiceDisplaySettings {...quoteProps} />);

    await waitFor(() =>
      expect(base.onChange).toHaveBeenCalledWith({ requireDeposit: false, depositAmount: 0 }),
    );
    expect(toggle(baseElement)!.disabled).toBe(true);
    expect(getByText('Connect Square to collect deposits from customers when they accept.')).toBeTruthy();
    expect(getByText('Connect Square')).toBeTruthy();
    expect(() => getByText('Add your payment details')).toThrow();
  });
});
