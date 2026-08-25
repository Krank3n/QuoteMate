// @vitest-environment jsdom
/**
 * RecordPaymentScreen as a sheet-screen (Aug 2026 consistency pass).
 *
 * The route is `transparentModal` and the visible surface is the shared
 * BottomSheet, so the contracts that matter are:
 *  - the form still writes through recordDocumentPayment with the picked
 *    amount / method / date;
 *  - validation failures surface in the themed AlertModal (never the native
 *    OS Alert) and write nothing;
 *  - navigation.goBack() fires only after the sheet's close animation
 *    reports finished (onClosed), and never twice — a hardware back that
 *    already popped the transparent screen must not pop the screen under it;
 *  - edit mode prefills and can remove the ledger entry after a themed
 *    confirm;
 *  - an unresolvable invoice renders a themed fallback inside the sheet.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import { Alert } from 'react-native';
import { isYesterday } from 'date-fns';

vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));

// The sheet chassis has its own lifecycle tests; the shim exposes the
// screen's wiring (visible / onDismiss / onClosed) for direct control.
const sheet = vi.hoisted(() => ({ props: null as any }));
vi.mock('../components/BottomSheet', () => ({
  BottomSheet: (props: any) => {
    sheet.props = props;
    return props.visible
      ? React.createElement(
          'div',
          null,
          React.createElement('span', null, props.title),
          React.createElement('span', null, props.subtitle),
          props.children,
        )
      : null;
  },
}));

// The dialogs are the themed AlertModal's problem; capture what the screen
// asks for and drive the button actions directly.
const alertSpy = vi.hoisted(() => ({ showAlert: vi.fn(), dismissAlert: vi.fn() }));
vi.mock('../hooks/useAlertModal', () => ({
  useAlertModal: () => ({
    showAlert: alertSpy.showAlert,
    dismissAlert: alertSpy.dismissAlert,
    alertNode: null,
  }),
}));

vi.mock('react-native-paper', async () => {
  const { Text, TextInput: RNTextInput } = await import('react-native');
  const TextInput: any = ({ children, ...props }: any) => (
    <RNTextInput {...props}>{children}</RNTextInput>
  );
  TextInput.Affix = () => null;
  return {
    MD3DarkTheme: { colors: {} },
    Text,
    Button: ({ children, onPress, disabled }: any) => (
      <button onClick={onPress} disabled={disabled}>
        {children}
      </button>
    ),
    TextInput,
  };
});

const nav = vi.hoisted(() => ({
  goBack: vi.fn(),
  navigate: vi.fn(),
  isFocused: vi.fn(() => true),
}));
const routeParams = vi.hoisted(() => ({ current: { invoiceId: 'doc-1' } as any }));
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => nav,
  useRoute: () => ({ params: routeParams.current }),
}));

const invoiceDoc = {
  id: 'doc-1',
  type: 'invoice',
  number: 'INV-005',
  total: 2606.26,
  paidTotal: 1303.13,
  customerName: 'Aaron Ngoi',
  payments: [
    { id: 'pay-1', amount: 400, method: 'bank', notes: 'ref 123', paidAt: 1755000000000 },
  ],
};

const state = vi.hoisted(() => ({
  invoices: [] as any[],
  currentInvoice: null as any,
  documents: [] as any[],
  xeroConnection: null as any,
  recordPayment: vi.fn(async () => {}),
  recordDocumentPayment: vi.fn(async () => {}),
  pushPaymentToXero: vi.fn(async () => {}),
  updateDocumentPayment: vi.fn(async () => {}),
  deleteDocumentPayment: vi.fn(async () => {}),
}));
vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: typeof state) => unknown) => selector(state),
  PAYMENT_METHOD_TO_LEDGER: {
    bank_transfer: 'bank',
    card: 'other',
    cash: 'cash',
    cheque: 'other',
    other: 'other',
  },
}));

import { RecordPaymentScreen } from './RecordPaymentScreen';

function amountInput(baseElement: HTMLElement): HTMLInputElement {
  const input = baseElement.querySelector<HTMLInputElement>(
    'input[aria-label="Payment amount"]',
  );
  if (!input) throw new Error('amount field not rendered');
  return input;
}

function setAmount(baseElement: HTMLElement, value: string) {
  const input = amountInput(baseElement);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

function lastAlert() {
  const call = alertSpy.showAlert.mock.calls.at(-1);
  if (!call) throw new Error('no alert shown');
  return call[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  sheet.props = null;
  routeParams.current = { invoiceId: 'doc-1' };
  nav.isFocused.mockReturnValue(true);
  state.documents = [invoiceDoc];
});

describe('RecordPaymentScreen sheet-screen', () => {
  it('records a payment with the entered amount, method and date through recordDocumentPayment', async () => {
    const { baseElement, getByText, getByRole } = render(<RecordPaymentScreen />);

    setAmount(baseElement, '800');
    fireEvent.click(getByText('Cash'));
    fireEvent.click(getByText('Yesterday'));
    fireEvent.click(getByRole('button', { name: /Record Payment/ }));

    await waitFor(() => expect(state.recordDocumentPayment).toHaveBeenCalled());
    const [docId, amount, method, notes, date] =
      state.recordDocumentPayment.mock.calls[0];
    expect(docId).toBe('doc-1');
    expect(amount).toBe(800);
    expect(method).toBe('cash');
    expect(notes).toBeUndefined();
    expect(isYesterday(date)).toBe(true);

    expect(lastAlert()).toMatchObject({ type: 'success', title: 'Payment recorded' });
  });

  it('rejects an amount above the ceiling with the themed dialog and does not write', async () => {
    const nativeAlert = vi.spyOn(Alert, 'alert');
    const { baseElement, getByRole } = render(<RecordPaymentScreen />);

    setAmount(baseElement, '5000');
    fireEvent.click(getByRole('button', { name: /Record Payment/ }));

    await waitFor(() =>
      expect(lastAlert()).toMatchObject({ type: 'warning', title: 'Amount exceeds balance' }),
    );
    expect(state.recordDocumentPayment).not.toHaveBeenCalled();
    expect(nativeAlert).not.toHaveBeenCalled();
  });

  it("success dialog's Done closes the sheet, and goBack fires only after onClosed", async () => {
    const { getByRole } = render(<RecordPaymentScreen />);

    fireEvent.click(getByRole('button', { name: /Record Payment/ }));
    await waitFor(() =>
      expect(lastAlert()).toMatchObject({ type: 'success', title: 'Payment recorded' }),
    );

    // "Done" — the screen's dismiss. Sheet hides, but the navigator must not
    // pop until the close animation has played.
    await act(async () => lastAlert().primaryButtonAction());
    expect(sheet.props.visible).toBe(false);
    expect(nav.goBack).not.toHaveBeenCalled();

    act(() => sheet.props.onClosed());
    expect(nav.goBack).toHaveBeenCalledTimes(1);
  });

  it('does not call goBack when onClosed fires after the screen already lost focus', () => {
    render(<RecordPaymentScreen />);

    nav.isFocused.mockReturnValue(false);
    act(() => sheet.props.onDismiss());
    act(() => sheet.props.onClosed());

    expect(nav.goBack).not.toHaveBeenCalled();
  });

  it('edit mode prefills amount, method and notes, and Remove → confirm deletes the entry', async () => {
    routeParams.current = { invoiceId: 'doc-1', paymentId: 'pay-1' };
    const { baseElement, getByRole } = render(<RecordPaymentScreen />);

    expect(amountInput(baseElement).value).toBe('400.00');
    // Ledger 'bank' prefills the Bank transfer chip.
    const selected = baseElement.querySelector('[aria-selected="true"]');
    expect(selected?.textContent).toContain('Bank transfer');
    expect(
      baseElement.querySelector<HTMLInputElement>('input[aria-label="Payment notes"], textarea[aria-label="Payment notes"]')?.value,
    ).toBe('ref 123');

    fireEvent.click(getByRole('button', { name: /Remove this payment/ }));
    expect(lastAlert()).toMatchObject({ type: 'warning', title: 'Remove this payment?' });
    // AlertModal only renders a Cancel when BOTH text and action are given —
    // a destructive confirm must never ship with "Remove" as its only button.
    expect(lastAlert().secondaryButtonText).toBe('Cancel');
    expect(typeof lastAlert().secondaryButtonAction).toBe('function');

    await act(async () => lastAlert().primaryButtonAction());
    expect(state.deleteDocumentPayment).toHaveBeenCalledWith('doc-1', 'pay-1');
    expect(sheet.props.visible).toBe(false);
  });

  it('cent-rounds the prefilled full-balance amount before writing', async () => {
    // total - paidTotal carries IEEE noise: 999.99 - 333.33 = 666.6600000000001.
    state.documents = [
      { ...invoiceDoc, total: 999.99, paidTotal: 333.33, payments: [] },
    ];
    const { getByRole } = render(<RecordPaymentScreen />);

    fireEvent.click(getByRole('button', { name: /Record Payment/ }));

    await waitFor(() => expect(state.recordDocumentPayment).toHaveBeenCalled());
    expect(state.recordDocumentPayment.mock.calls[0][1]).toBe(666.66);
  });

  it('offers a Cancel escape in the form — the backdrop is unreachable with the keyboard up', () => {
    const { getByRole } = render(<RecordPaymentScreen />);

    fireEvent.click(getByRole('button', { name: /^Cancel$/ }));

    expect(sheet.props.visible).toBe(false);
  });

  it('renders the not-found fallback inside the sheet when no invoice resolves', () => {
    routeParams.current = { invoiceId: 'ghost' };
    const { getByText } = render(<RecordPaymentScreen />);

    expect(sheet.props.title).toBe('Record Payment');
    expect(getByText(/couldn't find this invoice/)).toBeTruthy();
  });
});
