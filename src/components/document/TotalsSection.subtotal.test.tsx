// @vitest-environment jsdom
/**
 * The in-app totals card must add up: Subtotal (+ Markup when shown) + GST =
 * Total. With the Markup row hidden it printed the pre-markup subtotal — a job
 * read Subtotal $680, GST $88.40, Total $972.40, the $204 markup nowhere.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('react-native-paper', async () => {
  const { Text, View } = await import('react-native');
  return {
    MD3DarkTheme: { colors: {} },
    Text,
    Surface: ({ children }: any) => <View>{children}</View>,
    Divider: () => <View />,
  };
});

import { TotalsSection } from './TotalsSection';

const base = { subtotal: 680, markup: 30, markupAmount: 204, gst: 88.4, total: 972.4, gstRegistered: true };

describe('TotalsSection subtotal', () => {
  it('REGRESSION: markup hidden — Subtotal carries the markup ($884)', () => {
    const { getByText, queryByText } = render(<TotalsSection {...base} hideMarkup />);
    expect(getByText('$884.00')).toBeTruthy();
    expect(queryByText('$680.00')).toBeNull();
    expect(queryByText('Markup')).toBeNull();
  });

  it('markup shown — Subtotal before markup, then its own Markup row', () => {
    const { getByText } = render(<TotalsSection {...base} />);
    expect(getByText('$680.00')).toBeTruthy();
    expect(getByText('Markup')).toBeTruthy();
    expect(getByText('$204.00')).toBeTruthy();
  });

  it('labour-only markup with the zero-markup row hidden still lands in Subtotal', () => {
    const { getByText } = render(<TotalsSection {...base} markup={0} hideZeroMarkup />);
    expect(getByText('$884.00')).toBeTruthy();
  });

  it('no markup at all — unchanged', () => {
    const { getAllByText } = render(<TotalsSection {...base} markupAmount={0} markup={0} hideZeroMarkup total={748} gst={68} />);
    expect(getAllByText('$680.00').length).toBeGreaterThan(0);
  });
});
