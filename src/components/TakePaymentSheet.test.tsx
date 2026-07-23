// @vitest-environment jsdom
/**
 * Regression tests for the manual "Record a payment" path in TakePaymentSheet.
 *
 * Before Jul 2026 the sheet offered Square methods only, and its entry
 * points were gated on a Square connection — so a tradie who never
 * connected Square (or whose customer paid by bank transfer / cash) had no
 * reachable way to log a payment on an unpaid invoice. The manual row must
 * render for invoices, route with the right invoice id, and work with zero
 * Square setup; the Square rows now gate themselves instead.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

// Heavy native/expo dependency graphs irrelevant to the sheet's row logic —
// same approach as StickyJobActionBar.test.tsx / JobCard.ghost.test.tsx.
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('react-native-paper', () => ({
  DefaultTheme: { colors: {} },
  MD3DarkTheme: { colors: {} },
  Text: ({ children }: any) => React.createElement('span', null, children),
  Button: ({ children, onPress }: any) =>
    React.createElement('button', { onClick: onPress }, children),
}));
vi.mock('../services/storeReviewService', () => ({
  maybeRequestReview: vi.fn(async () => {}),
}));
vi.mock('../services/squarePayments', () => ({
  takeInAppPayment: vi.fn(async () => {}),
}));
vi.mock('../services/squareService', () => ({
  mintInvoicePaymentLink: vi.fn(async () => ({ paymentLinkUrl: 'https://sq.link/x' })),
  mintQuoteFullPaymentLink: vi.fn(async () => ({ paymentLinkUrl: 'https://sq.link/x' })),
  mintQuoteDepositPaymentLink: vi.fn(async () => ({ paymentLinkUrl: 'https://sq.link/x' })),
}));
vi.mock('../hooks/useTapToPayEnabled', () => ({
  useTapToPayEnabled: () => ({ enabled: false, reason: 'pending_apple' }),
}));
vi.mock('../store/useStore', () => ({
  useStore: () => ({ businessSettings: null }),
}));

import { TakePaymentSheet, type TakePaymentTarget } from './TakePaymentSheet';
import * as squareService from '../services/squareService';

const invoiceTarget: TakePaymentTarget = {
  kind: 'invoice',
  invoiceId: 'inv-42',
  total: 1200,
  paidAmount: 0,
  jobName: 'Kitchen cabinets',
  invoiceNumber: 'INV-0042',
};

const depositTarget: TakePaymentTarget = {
  kind: 'quote_deposit',
  quoteId: 'quote-7',
  depositAmount: 300,
  depositPaid: 0,
  total: 1200,
  jobName: 'Kitchen cabinets',
};

function renderSheet(overrides: Partial<React.ComponentProps<typeof TakePaymentSheet>> = {}) {
  const props = {
    visible: true,
    target: invoiceTarget,
    onDismiss: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
  return { ...render(<TakePaymentSheet {...props} />), props };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TakePaymentSheet manual "Record a payment" row', () => {
  it('renders for an invoice target and fires onRecordManualPayment with the invoice id', () => {
    const onRecordManualPayment = vi.fn();
    const { getByText, props } = renderSheet({ onRecordManualPayment });

    fireEvent.click(getByText('Record a payment'));

    expect(onRecordManualPayment).toHaveBeenCalledWith('inv-42');
    expect(props.onDismiss).toHaveBeenCalled();
  });

  it('does not render for quote deposit targets (no manual deposit path exists)', () => {
    const { queryByText } = renderSheet({
      target: depositTarget,
      onRecordManualPayment: vi.fn(),
    });
    expect(queryByText('Record a payment')).toBeNull();
  });

  it('does not render when no handler is wired', () => {
    const { queryByText } = renderSheet();
    expect(queryByText('Record a payment')).toBeNull();
  });

  it('works without any Square gate — no ensureSquareConnected prop required', () => {
    const onRecordManualPayment = vi.fn();
    const { getByText } = renderSheet({
      onRecordManualPayment,
      ensureSquareConnected: undefined,
    });
    fireEvent.click(getByText('Record a payment'));
    expect(onRecordManualPayment).toHaveBeenCalledWith('inv-42');
  });
});

describe('TakePaymentSheet Square rows gate themselves', () => {
  it('Share Pay Link aborts (no link minted) when Square is not connected', async () => {
    const ensureSquareConnected = vi.fn(async () => false);
    const { getByText, props } = renderSheet({ ensureSquareConnected });

    fireEvent.click(getByText('Share Pay Link'));

    await waitFor(() => expect(ensureSquareConnected).toHaveBeenCalled());
    expect(squareService.mintInvoicePaymentLink).not.toHaveBeenCalled();
    // The guard has already routed to Square settings; the sheet must close
    // so the tradie isn't stranded behind a modal.
    await waitFor(() => expect(props.onDismiss).toHaveBeenCalled());
  });

  it('Share Pay Link proceeds to mint a link when Square is connected', async () => {
    const ensureSquareConnected = vi.fn(async () => true);
    const { getByText } = renderSheet({ ensureSquareConnected });

    fireEvent.click(getByText('Share Pay Link'));

    await waitFor(() =>
      expect(squareService.mintInvoicePaymentLink).toHaveBeenCalledWith('inv-42'),
    );
  });
});
