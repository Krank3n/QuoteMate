// @vitest-environment jsdom
/**
 * PaymentSheet — the payment history. Pins what a tradie sees: payments
 * labelled the way they recorded them (a deposit reads as one), a hint that
 * rows can be changed, and no "Record Payment" on a settled invoice (the form
 * would only refuse with "Amount exceeds balance").
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('../utils/haptics', () => ({ selectionTap: vi.fn() }));
vi.mock('./BottomSheet', () => ({
  BottomSheet: ({ children, visible }: any) => (visible ? <div>{children}</div> : null),
}));
vi.mock('react-native-paper', async () => {
  const { Text, View } = await import('react-native');
  return {
    MD3DarkTheme: { colors: {} },
    Text,
    Divider: () => <View />,
    Button: ({ children, onPress }: any) => <button onClick={onPress}>{children}</button>,
  };
});

import { PaymentSheet } from './PaymentSheet';

const doc = (over: Record<string, any> = {}): any => ({
  id: 'doc-1',
  type: 'invoice',
  total: 9850.40,
  paidTotal: 3500,
  payments: [
    { id: 'p1', kind: 'manual', amount: 3000, method: 'bank', paidAt: 1, isDeposit: true },
    { id: 'p2', kind: 'manual', amount: 500, method: 'cash', paidAt: 2 },
  ],
  ...over,
});

describe('PaymentSheet', () => {
  it('labels a deposit as a deposit and a plain manual payment as a payment', () => {
    const { getByText } = render(
      <PaymentSheet visible onDismiss={() => {}} doc={doc()} onEditPayment={() => {}} />,
    );
    expect(getByText(/Deposit · Bank transfer/)).toBeTruthy();
    expect(getByText(/Payment · Cash/)).toBeTruthy();
    expect(getByText('Tap a payment to change or remove it.')).toBeTruthy();
  });

  it('tapping a row hands that payment to the editor', () => {
    const onEdit = vi.fn();
    const { getByLabelText } = render(
      <PaymentSheet visible onDismiss={() => {}} doc={doc()} onEditPayment={onEdit} />,
    );
    fireEvent.click(getByLabelText('Edit payment of $3,000.00'));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-1' }), expect.objectContaining({ id: 'p1' }));
  });

  it('offers Record Payment while money is owing, not once the invoice is paid', () => {
    const owing = render(
      <PaymentSheet visible onDismiss={() => {}} doc={doc()} onRecordPayment={() => {}} />,
    );
    expect(owing.getByText('Record Payment')).toBeTruthy();
    owing.unmount();

    const paid = render(
      <PaymentSheet visible onDismiss={() => {}} doc={doc({ paidTotal: 9850.40 })} onRecordPayment={() => {}} />,
    );
    expect(paid.queryByText('Record Payment')).toBeNull();
  });

  it('keeps a Square payment read-only, with no edit hint', () => {
    const { queryByText, queryByLabelText } = render(
      <PaymentSheet
        visible
        onDismiss={() => {}}
        onEditPayment={() => {}}
        doc={doc({ payments: [{ id: 's', kind: 'balance', amount: 3500, method: 'square', squarePaymentId: 'sq', paidAt: 1 }] })}
      />,
    );
    expect(queryByLabelText(/Edit payment of/)).toBeNull();
    expect(queryByText('Tap a payment to change or remove it.')).toBeNull();
  });
});

// After a deposit is recorded on a quote, the Payments sheet is where it can
// be corrected — and where a second instalment of the deposit is recorded.
describe('PaymentSheet on a quote', () => {
  const quote = doc({
    id: 'quote-1',
    type: 'quote',
    total: 960,
    paidTotal: 100,
    payments: [{ id: 'dep-1', kind: 'deposit', amount: 100, method: 'bank', paidAt: 1 }],
  });

  it('lists the hand-recorded deposit as editable', () => {
    const onEdit = vi.fn();
    const { getByText, getByLabelText } = render(
      <PaymentSheet visible onDismiss={() => {}} doc={quote} onEditPayment={onEdit} />,
    );
    expect(getByText(/Deposit · Bank transfer/)).toBeTruthy();
    fireEvent.click(getByLabelText('Edit payment of $100.00'));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'quote-1' }), expect.objectContaining({ id: 'dep-1' }));
  });

  it('offers Record Deposit (not Record Payment) while the quote is still owed money', () => {
    const onRecord = vi.fn();
    const { getByText, queryByText } = render(
      <PaymentSheet visible onDismiss={() => {}} doc={quote} onRecordPayment={onRecord} />,
    );
    expect(queryByText('Record Payment')).toBeNull();
    fireEvent.click(getByText('Record Deposit'));
    expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({ id: 'quote-1' }));
  });
});
