// @vitest-environment jsdom
/**
 * Regression tests for the manual "Record Payment" path in TakePaymentSheet.
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
// The shared sheet chassis has its own lifecycle tests; a shim keeps this
// file on the payment logic (and out of Portal/safe-area dependency graphs).
vi.mock('./BottomSheet', () => ({
  BottomSheet: ({ visible, title, subtitle, children }: any) =>
    visible
      ? React.createElement(
          'div',
          null,
          React.createElement('span', null, title),
          React.createElement('span', null, subtitle),
          children,
        )
      : null,
}));
vi.mock('../utils/haptics', () => ({ selectionTap: () => {} }));
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
// Mutable so individual tests can flip Tap to Pay on and exercise the
// card-payment guard; reset to disabled in beforeEach.
const tapToPay = vi.hoisted(() => ({
  state: { enabled: false, reason: 'pending_apple' } as any,
}));
vi.mock('../hooks/useTapToPayEnabled', () => ({
  useTapToPayEnabled: () => tapToPay.state,
}));
// The sheet writes an edited deposit straight to the document store (every
// entry point gets the behaviour without three call sites wiring a callback),
// so the mock has to carry those two members.
const store = vi.hoisted(() => ({
  businessSettings: null as any,
  getDocumentById: vi.fn((id: string) => ({ id, type: 'quote', total: 1200 })),
  saveDocument: vi.fn(async (_doc: any) => {}),
}));
vi.mock('../store/useStore', () => ({
  useStore: () => store,
}));

import { TakePaymentSheet, type TakePaymentTarget } from './TakePaymentSheet';
import * as squareService from '../services/squareService';
import * as squarePayments from '../services/squarePayments';

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
  tapToPay.state = { enabled: false, reason: 'pending_apple' };
  store.getDocumentById.mockImplementation((id: string) => ({
    id,
    type: 'quote',
    total: 1200,
  }));
  store.saveDocument.mockImplementation(async () => {});
});

/**
 * The deposit field, which only renders for a quote target in deposit mode.
 * Looked up on `baseElement`, not `container` — react-native-web's Modal
 * portals its children onto document.body, so `container` is empty.
 */
function depositField(baseElement: HTMLElement): HTMLInputElement {
  const input = baseElement.querySelector<HTMLInputElement>(
    'input[aria-label="Deposit amount"]',
  );
  if (!input) throw new Error('deposit field not rendered');
  return input;
}

describe('TakePaymentSheet manual "Record Payment" row', () => {
  it('renders for an invoice target and fires onRecordManualPayment with the invoice id', () => {
    const onRecordManualPayment = vi.fn();
    const { getByText, props } = renderSheet({ onRecordManualPayment });

    fireEvent.click(getByText('Record Payment'));

    expect(onRecordManualPayment).toHaveBeenCalledWith('inv-42');
    expect(props.onDismiss).toHaveBeenCalled();
  });

  it('does not render for quote deposit targets (no manual deposit path exists)', () => {
    const { queryByText } = renderSheet({
      target: depositTarget,
      onRecordManualPayment: vi.fn(),
    });
    expect(queryByText('Record Payment')).toBeNull();
  });

  it('does not render when no handler is wired', () => {
    const { queryByText } = renderSheet();
    expect(queryByText('Record Payment')).toBeNull();
  });

  it('works without any Square gate — no ensureSquareConnected prop required', () => {
    const onRecordManualPayment = vi.fn();
    const { getByText } = renderSheet({
      onRecordManualPayment,
      ensureSquareConnected: undefined,
    });
    fireEvent.click(getByText('Record Payment'));
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

  it('Tap to Pay aborts (no charge attempted) when Square is not connected', async () => {
    tapToPay.state = { enabled: true };
    const ensureSquareConnected = vi.fn(async () => false);
    const { getByText, props } = renderSheet({ ensureSquareConnected });

    fireEvent.click(getByText('Tap to Pay / Card Entry'));

    await waitFor(() => expect(ensureSquareConnected).toHaveBeenCalled());
    expect(squarePayments.takeInAppPayment).not.toHaveBeenCalled();
    await waitFor(() => expect(props.onDismiss).toHaveBeenCalled());
  });

  it('Tap to Pay proceeds to charge when Square is connected', async () => {
    tapToPay.state = { enabled: true };
    const ensureSquareConnected = vi.fn(async () => true);
    const { getByText } = renderSheet({ ensureSquareConnected });

    fireEvent.click(getByText('Tap to Pay / Card Entry'));

    await waitFor(() => expect(squarePayments.takeInAppPayment).toHaveBeenCalled());
    expect(squarePayments.takeInAppPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: 'invoice', invoiceId: 'inv-42' },
      }),
    );
  });
});


/**
 * The deposit on the quote is a starting point — on the day the tradie agrees
 * whatever gets the job moving. Before Aug 2026 the sheet showed the quoted
 * deposit as a fixed number with no way to change it, so a different figure
 * meant backing out to the quote editor mid-conversation.
 */
describe('TakePaymentSheet adjustable deposit', () => {
  it('renders the deposit as an editable field seeded with the quoted amount', () => {
    const { baseElement } = renderSheet({ target: depositTarget });
    expect(depositField(baseElement).value).toBe('300.00');
  });

  it('has no editable field for an invoice — the balance is not negotiable here', () => {
    const { baseElement } = renderSheet({ target: invoiceTarget });
    expect(
      baseElement.querySelector('input[aria-label="Deposit amount"]'),
    ).toBeNull();
  });

  it('writes the edited deposit back to the quote with requireDeposit and a re-derived percentage', async () => {
    const { baseElement } = renderSheet({ target: depositTarget });
    const input = depositField(baseElement);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '500' } });
    fireEvent.blur(input);

    await waitFor(() => expect(store.saveDocument).toHaveBeenCalled());
    expect(store.saveDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'quote-7',
        requireDeposit: true,
        depositAmount: 500,
        // 500 of 1200.
        depositPercentage: 41.67,
      }),
    );
  });

  it('charges the edited deposit, not the quoted one', async () => {
    tapToPay.state = { enabled: true };
    const { baseElement, getByText } = renderSheet({
      target: depositTarget,
      ensureSquareConnected: vi.fn(async () => true),
    });
    const input = depositField(baseElement);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '500' } });
    fireEvent.blur(input);

    fireEvent.click(getByText('Tap to Pay / Card Entry'));

    await waitFor(() => expect(squarePayments.takeInAppPayment).toHaveBeenCalled());
    expect(squarePayments.takeInAppPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 50000 }),
    );
  });

  it('caps the deposit at the quote total — Square must not collect more than the job earns', async () => {
    const { baseElement } = renderSheet({ target: depositTarget });
    const input = depositField(baseElement);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '9999' } });
    fireEvent.blur(input);

    await waitFor(() => expect(store.saveDocument).toHaveBeenCalled());
    expect(store.saveDocument).toHaveBeenCalledWith(
      expect.objectContaining({ depositAmount: 1200 }),
    );
  });

  it('ignores junk and zero rather than storing an uncollectable deposit', async () => {
    const { baseElement } = renderSheet({ target: depositTarget });
    const input = depositField(baseElement);

    for (const value of ['', 'abc', '0']) {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);
    }

    expect(store.saveDocument).not.toHaveBeenCalled();
    expect(depositField(baseElement).value).toBe('300.00');
  });

  it('mints the pay link only after the edit has been written — the link is priced server-side', async () => {
    let releaseSave: () => void = () => {};
    store.saveDocument.mockImplementation(
      () => new Promise<void>((resolve) => { releaseSave = () => resolve(); }),
    );
    const { baseElement, getByText } = renderSheet({
      target: depositTarget,
      ensureSquareConnected: vi.fn(async () => true),
    });
    const input = depositField(baseElement);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '500' } });
    fireEvent.blur(input);

    fireEvent.click(getByText('Share Pay Link'));

    await waitFor(() => expect(store.saveDocument).toHaveBeenCalled());
    expect(squareService.mintQuoteDepositPaymentLink).not.toHaveBeenCalled();

    releaseSave();
    await waitFor(() =>
      expect(squareService.mintQuoteDepositPaymentLink).toHaveBeenCalledWith('quote-7'),
    );
  });

  it('aborts the payment and restores the quoted amount when the write fails', async () => {
    store.saveDocument.mockRejectedValue(new Error('offline'));
    const { baseElement, getByText, props } = renderSheet({
      target: depositTarget,
      ensureSquareConnected: vi.fn(async () => true),
    });
    const input = depositField(baseElement);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '500' } });
    fireEvent.blur(input);

    await waitFor(() => expect(props.onError).toHaveBeenCalled());
    expect(depositField(baseElement).value).toBe('300.00');

    fireEvent.click(getByText('Share Pay Link'));
    await waitFor(() => expect(props.onError).toHaveBeenCalledTimes(1));
    expect(squareService.mintQuoteDepositPaymentLink).not.toHaveBeenCalled();
  });
});

/**
 * Success and dialog conventions (Aug 2026 consistency pass): a completed
 * card charge tells the host so it can show the themed success dialog, a
 * customer backing out stays silent, and the terms dialog carries a single
 * primary action (header X + Android back dismiss it).
 */
describe('TakePaymentSheet success + dialog conventions', () => {
  it('fires onSuccess with the charged amount after a successful card charge, after dismissing', async () => {
    tapToPay.state = { enabled: true };
    const onSuccess = vi.fn();
    const { getByText, props } = renderSheet({
      onSuccess,
      ensureSquareConnected: vi.fn(async () => true),
    });

    fireEvent.click(getByText('Tap to Pay / Card Entry'));

    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith({ kind: 'card_charge', amount: 1200 }),
    );
    // Dismiss first — the host's success dialog opens over the closing sheet.
    expect((props.onDismiss as any).mock.invocationCallOrder[0]).toBeLessThan(
      onSuccess.mock.invocationCallOrder[0],
    );
  });

  it('does not fire onSuccess (or onError) when the customer cancels at the Square sheet', async () => {
    tapToPay.state = { enabled: true };
    (squarePayments.takeInAppPayment as any).mockRejectedValueOnce(
      new Error('Payment canceled by user'),
    );
    const onSuccess = vi.fn();
    const { getByText, props } = renderSheet({
      onSuccess,
      ensureSquareConnected: vi.fn(async () => true),
    });

    fireEvent.click(getByText('Tap to Pay / Card Entry'));

    await waitFor(() => expect(squarePayments.takeInAppPayment).toHaveBeenCalled());
    expect(onSuccess).not.toHaveBeenCalled();
    expect(props.onError).not.toHaveBeenCalled();
  });

  it('terms dialog offers a single primary action and no text Close button', async () => {
    tapToPay.state = { enabled: true };
    const { getByText, queryByText } = renderSheet({
      target: { ...invoiceTarget, terms: 'Payment due in 7 days.' },
    });

    fireEvent.click(getByText('View'));

    await waitFor(() => expect(getByText('Customer agrees')).toBeTruthy());
    expect(queryByText('Close')).toBeNull();
  });
});
