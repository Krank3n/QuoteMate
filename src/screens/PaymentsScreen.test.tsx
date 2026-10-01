// @vitest-environment jsdom
/**
 * PaymentsScreen — the payment history as a sheet-screen route, so the job
 * cards can open it as well as the job screen. Contracts:
 *  - navigation only moves after the sheet's close animation (onClosed);
 *  - Record Payment / edit REPLACE this route, so the stack stays one sheet
 *    deep and Record Payment's own goBack() lands on the screen underneath;
 *  - a plain dismiss goes back, never twice;
 *  - a doc that can't be found leaves quietly.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';

const sheet = vi.hoisted(() => ({ props: null as any }));
vi.mock('../components/PaymentSheet', () => ({
  PaymentSheet: (props: any) => {
    sheet.props = props;
    return null;
  },
}));

const nav = vi.hoisted(() => ({
  goBack: vi.fn(),
  replace: vi.fn(),
  isFocused: vi.fn(() => true),
}));
const routeParams = vi.hoisted(() => ({ current: { docId: 'doc-1' } as any }));
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => nav,
  useRoute: () => ({ params: routeParams.current }),
}));

const state = vi.hoisted(() => ({ documents: [] as any[] }));
vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: typeof state) => unknown) => selector(state),
}));

import { PaymentsScreen } from './PaymentsScreen';

const invoice = {
  id: 'doc-1',
  type: 'invoice',
  total: 9850.40,
  paidTotal: 3000,
  payments: [{ id: 'pay-1', kind: 'manual', amount: 3000, method: 'bank', paidAt: 1 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  sheet.props = null;
  routeParams.current = { docId: 'doc-1' };
  nav.isFocused.mockReturnValue(true);
  state.documents = [invoice];
});

describe('PaymentsScreen', () => {
  it('renders the live document in a visible sheet', () => {
    render(<PaymentsScreen />);
    expect(sheet.props.visible).toBe(true);
    expect(sheet.props.doc).toBe(invoice);
  });

  it('resolves a doc addressed by its legacy invoice id', () => {
    state.documents = [{ ...invoice, id: 'q-1', legacyInvoiceId: 'doc-1' }];
    render(<PaymentsScreen />);
    expect(sheet.props.doc.id).toBe('q-1');
  });

  it('dismiss closes the sheet and goes back only once the slide-out finishes', () => {
    render(<PaymentsScreen />);
    act(() => sheet.props.onDismiss());
    expect(sheet.props.visible).toBe(false);
    expect(nav.goBack).not.toHaveBeenCalled();

    act(() => sheet.props.onClosed());
    expect(nav.goBack).toHaveBeenCalledTimes(1);
    // A second onClosed (re-render mid-animation) must not pop again.
    act(() => sheet.props.onClosed());
    expect(nav.goBack).toHaveBeenCalledTimes(1);
  });

  it('tapping a payment swaps this sheet for Record Payment in edit mode', () => {
    render(<PaymentsScreen />);
    act(() => sheet.props.onEditPayment(invoice, invoice.payments[0]));
    expect(nav.replace).not.toHaveBeenCalled();
    act(() => sheet.props.onClosed());
    expect(nav.replace).toHaveBeenCalledWith('RecordPayment', {
      invoiceId: 'doc-1',
      paymentId: 'pay-1',
    });
    expect(nav.goBack).not.toHaveBeenCalled();
  });

  it('Record Payment swaps this sheet for a new-payment form', () => {
    render(<PaymentsScreen />);
    // PaymentSheet dismisses before handing over — the hand-over must win.
    act(() => {
      sheet.props.onDismiss();
      sheet.props.onRecordPayment(invoice);
    });
    act(() => sheet.props.onClosed());
    expect(nav.replace).toHaveBeenCalledWith('RecordPayment', { invoiceId: 'doc-1' });
    expect(nav.goBack).not.toHaveBeenCalled();
  });

  it('does nothing on close when a hardware back already popped the screen', () => {
    render(<PaymentsScreen />);
    nav.isFocused.mockReturnValue(false);
    act(() => sheet.props.onDismiss());
    act(() => sheet.props.onClosed());
    expect(nav.goBack).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('leaves quietly when the document cannot be found', () => {
    state.documents = [];
    render(<PaymentsScreen />);
    expect(sheet.props).toBeNull();
    expect(nav.goBack).toHaveBeenCalledTimes(1);
  });
});
