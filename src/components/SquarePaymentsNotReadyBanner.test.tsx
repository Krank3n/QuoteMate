// @vitest-environment jsdom
/**
 * The banner the Square settings screen shows when the connected account
 * can't take card payments. It has to be silent for a healthy or unknown
 * verdict, name the merchant and the fix when flagged, and let the tradie
 * ask Square again after activating.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';

vi.mock('react-native-paper', async () => {
  const { Text } = await import('react-native');
  return {
    MD3DarkTheme: { colors: {} },
    Text,
    Button: ({ children, onPress, disabled }: { children?: React.ReactNode; onPress?: () => void; disabled?: boolean }) => (
      <button onClick={onPress} disabled={disabled}>{children}</button>
    ),
  };
});

// The icon package ships untranspiled JSX; every component test stubs it.
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));

import { SquarePaymentsNotReadyBanner } from './SquarePaymentsNotReadyBanner';

const flagged = { ready: false, reasons: ['no_card_processing' as const], checkedAt: 1 };

describe('SquarePaymentsNotReadyBanner', () => {
  it('renders nothing for a healthy or not-yet-checked connection', () => {
    const { container: ok } = render(
      <SquarePaymentsNotReadyBanner readiness={{ ready: true, reasons: [], checkedAt: 1 }} onCheckAgain={() => {}} />,
    );
    expect(ok.textContent).toBe('');
    const { container: unknown } = render(<SquarePaymentsNotReadyBanner readiness={null} onCheckAgain={() => {}} />);
    expect(unknown.textContent).toBe('');
  });

  it('names the merchant, says sends go out without a Pay Now button, and points at squareup.com', () => {
    render(<SquarePaymentsNotReadyBanner readiness={flagged} merchantName="Slimjims" onCheckAgain={() => {}} />);
    expect(screen.getByText('Square hasn’t switched on card payments yet')).toBeTruthy();
    expect(screen.getByText(/Slimjims can't take card payments/)).toBeTruthy();
    expect(screen.getByText(/without a Pay Now button/)).toBeTruthy();
    // Body and action line both point at Square's site.
    expect(screen.getAllByText(/squareup\.com/)).toHaveLength(2);
    expect(screen.getByText('Finish activating at squareup.com, then check again')).toBeTruthy();
  });

  it('a non-Australian account gets the currency message instead', () => {
    render(
      <SquarePaymentsNotReadyBanner
        readiness={{ ready: false, reasons: ['currency_mismatch'], checkedAt: 1, currency: 'USD' }}
        merchantName="Bob Builds"
        onCheckAgain={() => {}}
      />,
    );
    expect(screen.getByText('This Square account is not Australian')).toBeTruthy();
    expect(screen.getByText(/\(USD\)/)).toBeTruthy();
  });

  it('"Check again" re-runs the connection check, and is held while one is running', () => {
    const onCheckAgain = vi.fn();
    const { rerender } = render(
      <SquarePaymentsNotReadyBanner readiness={flagged} merchantName="Slimjims" onCheckAgain={onCheckAgain} />,
    );
    fireEvent.click(screen.getByText('Check again'));
    expect(onCheckAgain).toHaveBeenCalledTimes(1);

    rerender(<SquarePaymentsNotReadyBanner readiness={flagged} merchantName="Slimjims" onCheckAgain={onCheckAgain} checking />);
    expect((screen.getByText('Check again') as HTMLButtonElement).disabled).toBe(true);
  });
});
