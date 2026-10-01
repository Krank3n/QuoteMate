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
import { render, waitFor } from '@testing-library/react';

vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('../utils/haptics', () => ({ selectionTap: vi.fn(), lightTap: vi.fn() }));

const square = vi.hoisted(() => ({ checkSquareConnection: vi.fn(async () => ({ connected: true })) }));
vi.mock('../services/squareService', () => square);

vi.mock('@react-navigation/native', async () => {
  const ReactMod = await import('react');
  return {
    useNavigation: () => ({ navigate: vi.fn() }),
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
