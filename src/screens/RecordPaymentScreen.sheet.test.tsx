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
import { Alert, Share } from 'react-native';
import { isYesterday, isSameDay } from 'date-fns';

const clipboard = vi.hoisted(() => ({ setStringAsync: vi.fn(async () => {}) }));
vi.mock('expo-clipboard', () => clipboard);

// jsdom reports Platform.OS === 'web' with no Web Share API, which is exactly
// desktop Chrome. Tests that want the native share sheet install one.
function withWebShare<T>(fn: () => Promise<T>): Promise<T> {
  Object.defineProperty(navigator, 'share', { value: vi.fn(), configurable: true });
  return fn().finally(() => {
    delete (navigator as any).share;
  });
}

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

// The calendar is DueDateSheet's problem (it has its own tests); capture its
// props so tests can drive a day pick directly.
const dateSheet = vi.hoisted(() => ({ props: null as any }));
vi.mock('../components/DueDateSheet', () => ({
  DueDateSheet: (props: any) => {
    dateSheet.props = props;
    return null;
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
  businessSettings: { businessName: 'Coastal Air' } as any,
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

  it('offers Send receipt on the success dialog and shares the receipt for the recorded payment', () => withWebShare(async () => {
    const share = vi.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);
    const { baseElement, getByText, getByRole } = render(<RecordPaymentScreen />);

    setAmount(baseElement, '800');
    fireEvent.click(getByText('Cheque'));
    fireEvent.click(getByRole('button', { name: /Record Payment/ }));
    await waitFor(() => expect(lastAlert()).toMatchObject({ type: 'success', title: 'Payment recorded' }));

    const alert = lastAlert();
    expect(alert.secondaryButtonText).toBe('Send receipt');
    // Done stays primary — the receipt is an offer, not a step.
    expect(alert.primaryButtonText).toBe('Done');

    await act(async () => alert.secondaryButtonAction());
    expect(share).toHaveBeenCalledTimes(1);
    const message: string = share.mock.calls[0][0].message;
    expect(message.split('\n')[0]).toBe('Coastal Air');
    expect(message).toContain('For: Invoice INV-005');
    expect(message).toContain('Amount paid: $800.00');
    // From the form's pick, not the ledger vocabulary (which stores cheque as "other").
    expect(message).toContain('Paid by: cheque');
    // 2606.26 − 1303.13 owing − 800 → 503.13 still to come.
    expect(message).toContain('Balance remaining: $503.13');
    expect(message).not.toMatch(/quotemate/i);
    // Sharing a receipt never closes the sheet on its own.
    expect(sheet.props.visible).toBe(true);
  }));

  it('a share-sheet dismissal is not an error', () => withWebShare(async () => {
    vi.spyOn(Share, 'share').mockRejectedValue(new Error('cancelled'));
    const { getByRole } = render(<RecordPaymentScreen />);
    fireEvent.click(getByRole('button', { name: /Record Payment/ }));
    await waitFor(() => expect(lastAlert()).toMatchObject({ type: 'success' }));
    const calls = alertSpy.showAlert.mock.calls.length;
    await act(async () => lastAlert().secondaryButtonAction());
    expect(alertSpy.showAlert.mock.calls.length).toBe(calls);
  }));

  it('copies the receipt to the clipboard on a browser with no share sheet', async () => {
    const share = vi.spyOn(Share, 'share');
    const nativeAlert = vi.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByRole } = render(<RecordPaymentScreen />);
    fireEvent.click(getByRole('button', { name: /Record Payment/ }));
    await waitFor(() => expect(lastAlert()).toMatchObject({ type: 'success' }));
    await act(async () => lastAlert().secondaryButtonAction());
    expect(share).not.toHaveBeenCalled();
    expect(clipboard.setStringAsync).toHaveBeenCalledTimes(1);
    expect(clipboard.setStringAsync.mock.calls[0][0]).toContain('Payment received');
    expect(nativeAlert).toHaveBeenCalledWith('Receipt copied', expect.any(String));
  });

  it('does not offer a receipt when editing an existing payment', async () => {
    routeParams.current = { invoiceId: 'doc-1', paymentId: 'pay-1' };
    const { getByRole } = render(<RecordPaymentScreen />);
    fireEvent.click(getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(lastAlert()).toMatchObject({ type: 'success' }));
    expect(lastAlert().secondaryButtonText).toBeUndefined();
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

  it('opens the shared calendar from the Pick a date chip and applies the picked day', async () => {
    const { getByText, getByRole } = render(<RecordPaymentScreen />);

    expect(dateSheet.props.visible).toBe(false);
    fireEvent.click(getByText('Pick a date'));
    expect(dateSheet.props.visible).toBe(true);

    // Pick the 10th of last month via the captured onChange.
    const picked = new Date();
    picked.setMonth(picked.getMonth() - 1, 10);
    picked.setHours(0, 0, 0, 0);
    await act(async () => dateSheet.props.onChange(picked.getTime()));

    expect(getByText(new RegExp(`10 [A-Z][a-z]{2} ${picked.getFullYear()}`))).toBeTruthy();
    // Off-list date → the Pick a date chip is the selected one (the method
    // chip row keeps its own aria-selected entry, so collect them all).
    const selectedChips = Array.from(
      document.querySelectorAll('[aria-selected="true"]'),
    ).map((el) => el.textContent);
    expect(selectedChips).toContain('Pick a date');

    fireEvent.click(getByRole('button', { name: /Record Payment/ }));
    await waitFor(() => expect(state.recordDocumentPayment).toHaveBeenCalled());
    const recordedDate = state.recordDocumentPayment.mock.calls[0][4] as Date;
    expect(isSameDay(recordedDate, picked)).toBe(true);
  });

  it('clamps a future calendar pick to today', async () => {
    const { getByText } = render(<RecordPaymentScreen />);

    fireEvent.click(getByText('Pick a date'));
    await act(async () =>
      dateSheet.props.onChange(Date.now() + 5 * 24 * 60 * 60 * 1000),
    );

    expect(getByText(/\(Today\)/)).toBeTruthy();
  });

  it('renders the not-found fallback inside the sheet when no invoice resolves', () => {
    routeParams.current = { invoiceId: 'ghost' };
    const { getByText } = render(<RecordPaymentScreen />);

    expect(sheet.props.title).toBe('Record Payment');
    expect(getByText(/couldn't find this invoice/)).toBeTruthy();
  });
});
