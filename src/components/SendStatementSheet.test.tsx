// @vitest-environment jsdom
/**
 * The statement composer. The contracts that matter: the accountant is
 * remembered and offered back, a typo never reaches the endpoint, the period
 * on screen is the period that gets sent, and a successful send writes the
 * address onto the LOCAL business settings — saveBusinessSettings is a
 * whole-document setDoc with no merge, so without that the next Business
 * Profile save would wipe what the server wrote.
 *
 * Heavy native/expo graphs are mocked, same approach as
 * SendReportDialog.test.tsx.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';

vi.mock('react-native', () => ({
  View: 'div',
  StyleSheet: { create: (s: any) => s, absoluteFill: {} },
  ScrollView: 'div',
  Platform: { OS: 'web', select: (o: any) => o.web ?? o.default },
  useWindowDimensions: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }),
}));

vi.mock('react-native-paper', () => ({
  Portal: ({ children }: any) => <>{children}</>,
  Modal: ({ visible, children }: any) => (visible ? <div data-testid="modal">{children}</div> : null),
  Text: ({ children }: any) => <span>{children}</span>,
  TextInput: ({ value, onChangeText, label, placeholder, cursorColor, selectionColor, selectionHandleColor }: any) => (
    <input
      aria-label={label || placeholder}
      value={value}
      onChange={(e) => onChangeText?.(e.target.value)}
      data-cursor-color={cursorColor}
      data-selection-color={selectionColor}
      data-selection-handle-color={selectionHandleColor}
    />
  ),
  Button: ({ children, onPress, disabled }: any) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  Switch: ({ value, onValueChange }: any) => (
    <input
      type="checkbox"
      role="switch"
      checked={!!value}
      onChange={(e) => onValueChange?.(e.target.checked)}
    />
  ),
}));

vi.mock('../theme', async () => await import('../test/stubs/theme'));

const analytics = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock('../services/analyticsService', () => analytics);

const sender = vi.hoisted(() => ({ sendAccountantStatement: vi.fn(async () => ({}) as any) }));
vi.mock('../services/statementSender', () => sender);

vi.mock('../config/firebase', () => ({
  auth: { currentUser: { email: 'leo@example.com.au' } },
}));

/**
 * A small real store rather than a frozen object: `getState()` answers (the
 * sheet reads the remembered address there when it opens) and a write
 * re-renders every subscriber, which is the only way the first-ever-send
 * defect shows up at all.
 */
const store = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const api = {
    state: {} as any,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset(businessSettings: any) {
      api.state = {
        businessSettings,
        setBusinessSettings: vi.fn(async (next: any) => {
          api.state = { ...api.state, businessSettings: next };
          listeners.forEach((listener) => listener());
        }),
      };
    },
  };
  return api;
});
vi.mock('../store/useStore', () => ({
  useStore: Object.assign(
    (selector?: any) =>
      React.useSyncExternalStore(store.subscribe, () =>
        selector ? selector(store.state) : store.state,
      ),
    { getState: () => store.state },
  ),
}));

import { SendStatementSheet } from './SendStatementSheet';

const period = {
  fromMs: new Date(2025, 6, 1).getTime(),
  toMs: new Date(2026, 6, 1).getTime(),
  label: '1 Jul 2025 – 30 Jun 2026',
};

const baseProps = {
  visible: true,
  onDismiss: vi.fn(),
  period,
  preset: 'lastFinancialYear' as const,
  summary: {
    invoicedTotal: 41200,
    receivedTotal: 38150,
    outstandingTotal: 3050,
    invoiceCount: 38,
    paymentCount: 27,
  },
};

describe('SendStatementSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.reset({
      businessName: 'Leo Wright Electrical',
      accountantEmail: 'books@accountant.com.au',
    });
  });

  it('prefills the remembered accountant and recaps the period', () => {
    render(<SendStatementSheet {...baseProps} />);
    expect(screen.getByDisplayValue('books@accountant.com.au')).toBeTruthy();
    expect(
      screen.getByText(
        /1 Jul 2025 – 30 Jun 2026 · 38 invoices · 27 payments\. The PDF and a spreadsheet \(CSV\) go across as attachments\./,
      ),
    ).toBeTruthy();
  });

  it('refuses a bad address without calling the endpoint', async () => {
    store.reset({ businessName: 'Leo Wright Electrical' });
    render(<SendStatementSheet {...baseProps} />);
    fireEvent.change(screen.getByLabelText('To'), { target: { value: 'books@accountant' } });
    fireEvent.click(screen.getByText('Send statement'));
    await waitFor(() => expect(screen.getByText('Enter a valid email address.')).toBeTruthy());
    expect(sender.sendAccountantStatement).not.toHaveBeenCalled();
  });

  it('sends the period on screen, confirms, and remembers the accountant locally', async () => {
    render(<SendStatementSheet {...baseProps} />);
    fireEvent.change(screen.getByLabelText('To'), { target: { value: 'new@accountant.com.au' } });
    fireEvent.change(screen.getByLabelText('Message (optional)'), {
      target: { value: 'Last year, as discussed.' },
    });
    fireEvent.click(screen.getByText('Send statement'));

    await waitFor(() =>
      expect(sender.sendAccountantStatement).toHaveBeenCalledWith({
        fromMs: period.fromMs,
        toMs: period.toMs,
        recipientEmail: 'new@accountant.com.au',
        emailBody: 'Last year, as discussed.',
        sendCopyToSelf: false,
      }),
    );
    await waitFor(() => expect(screen.getByText('Statement sent')).toBeTruthy());
    expect(
      screen.getByText(
        'Your statement for 1 Jul 2025 – 30 Jun 2026 went to new@accountant.com.au, with the PDF and a spreadsheet attached.',
      ),
    ).toBeTruthy();
    expect(store.state.setBusinessSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        businessName: 'Leo Wright Electrical',
        accountantEmail: 'new@accountant.com.au',
      }),
    );
    expect(analytics.trackEvent).toHaveBeenCalledWith('statement_sent', {
      preset: 'lastFinancialYear',
    });
  });

  // The defect this pins: the reset effect used to depend on the remembered
  // address, which the send itself writes. The confirmation vanished, the
  // form came back, and the tradie sent their accountant a second copy.
  it('keeps the confirmation when the first-ever send saves the accountant', async () => {
    store.reset({ businessName: 'Leo Wright Electrical' });
    render(<SendStatementSheet {...baseProps} />);
    fireEvent.change(screen.getByLabelText('To'), {
      target: { value: 'books@accountant.com.au' },
    });
    fireEvent.click(screen.getByText('Send statement'));

    // The store really does change underneath the open sheet.
    await waitFor(() =>
      expect(store.state.businessSettings.accountantEmail).toBe('books@accountant.com.au'),
    );
    expect(screen.getByText('Statement sent')).toBeTruthy();
    expect(screen.queryByText('Send statement')).toBeNull();
  });

  it('repeats back what the server says it emailed', async () => {
    sender.sendAccountantStatement.mockResolvedValueOnce({ invoiceCount: 38, paymentCount: 1 });
    render(<SendStatementSheet {...baseProps} />);
    fireEvent.click(screen.getByText('Send statement'));
    await waitFor(() => expect(screen.getByText('Statement sent')).toBeTruthy());
    expect(screen.getByText(/38 invoices and 1 payment\./)).toBeTruthy();
  });

  it('stays vague when the server did not say', async () => {
    render(<SendStatementSheet {...baseProps} />);
    fireEvent.click(screen.getByText('Send statement'));
    await waitFor(() => expect(screen.getByText('Statement sent')).toBeTruthy());
    expect(screen.queryByText(/invoices and/)).toBeNull();
  });

  it('bccs the tradie when the copy toggle is on', async () => {
    render(<SendStatementSheet {...baseProps} />);
    const toggle = screen.getByRole('switch') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    fireEvent.click(screen.getByText('Send statement'));
    await waitFor(() =>
      expect(sender.sendAccountantStatement).toHaveBeenCalledWith(
        expect.objectContaining({ sendCopyToSelf: true }),
      ),
    );
  });

  it('shows the send failure inline and keeps the form', async () => {
    sender.sendAccountantStatement.mockRejectedValueOnce(
      new Error("You've sent a few statements already this hour. Try again later."),
    );
    render(<SendStatementSheet {...baseProps} />);
    fireEvent.click(screen.getByText('Send statement'));
    await waitFor(() =>
      expect(
        screen.getByText("You've sent a few statements already this hour. Try again later."),
      ).toBeTruthy(),
    );
    expect(screen.queryByText('Statement sent')).toBeNull();
  });

  // Same defect class as the email body editor: an Android caret left to
  // whatever Paper derives. The theme stub returns one colour for every
  // token, so this pins that the props are passed, not which token.
  it('gives the message box its caret and selection colours explicitly', () => {
    render(<SendStatementSheet {...baseProps} />);
    const note = screen.getByLabelText('Message (optional)');
    for (const attr of ['data-cursor-color', 'data-selection-color', 'data-selection-handle-color']) {
      const value = note.getAttribute(attr);
      expect(value, attr).toBeTruthy();
      expect(value, attr).not.toBe('transparent');
    }
  });
});

describe('SendStatementSheet fits the phone', () => {
  // 16 Sep 2026: on an iPhone the sheet rendered ~40pt off the left edge with
  // "Send statement" cut off on the right — the keyboard-avoiding wrapper had
  // no width, so the card's 100% resolved against its widest field.
  it('gives the keyboard-avoiding wrapper the full width so the card cannot overflow', async () => {
    const kav = await import('react-native-keyboard-controller');
    const spy = vi.spyOn(kav, 'KeyboardAvoidingView');
    store.reset({ businessName: 'Leo Wright Electrical', accountantEmail: 'books@accountant.com.au' });
    render(<SendStatementSheet {...baseProps} />);
    const style = spy.mock.calls.at(-1)?.[0]?.style as { width?: string; maxWidth?: number } | undefined;
    expect(style?.width).toBe('100%');
    expect(style?.maxWidth).toBe(520);
    spy.mockRestore();
  });
});
