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
import { Share } from 'react-native';

// Heavy native/expo dependency graphs irrelevant to the sheet's row logic —
// same approach as StickyJobActionBar.test.tsx / JobCard.ghost.test.tsx.
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('react-native-paper', () => ({
  DefaultTheme: { colors: {} },
  MD3DarkTheme: { colors: {} },
  Text: ({ children }: any) => React.createElement('span', null, children),
  Button: ({ children, onPress }: any) =>
    React.createElement('button', { onClick: onPress }, children),
  // The decline offer (req 5.10) goes through the shared AlertModal, which
  // mounts in a Portal. Render children inline — the real Portal needs a
  // provider this file deliberately stays out of.
  Portal: ({ children }: any) => React.createElement(React.Fragment, null, children),
  Modal: ({ visible, children }: any) =>
    visible ? React.createElement('div', null, children) : null,
  IconButton: ({ onPress, icon }: any) =>
    React.createElement('button', { onClick: onPress }, icon),
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
// successTap/errorTap arrive via the AlertModal the decline offer (req 5.10)
// mounts, not the sheet itself.
vi.mock('../utils/haptics', () => ({
  selectionTap: () => {},
  successTap: () => {},
  errorTap: () => {},
}));
// Under jsdom expo-symbols resolves to its web build, which renders the
// fallback — so the SF Symbol name (Apple req 5.5) is only observable here.
const symbols = vi.hoisted(() => ({ rendered: [] as string[] }));
vi.mock('expo-symbols', () => ({
  SymbolView: ({ name, fallback }: any) => {
    symbols.rendered.push(name);
    return fallback ?? null;
  },
}));
// Apple req 5.12 — the sheet's job is to arm before the tap and disarm on every
// outcome. What the notice itself says is covered in its own unit test.
const notice = vi.hoisted(() => ({
  armed: 0,
  disarmed: [] as (string | null)[],
  away: [] as string[],
}));
vi.mock('../services/tapToPayOutcomeNotice', () => ({
  armUnseenOutcomeNotice: vi.fn(async () => {
    notice.armed += 1;
    return 'notice-1';
  }),
  disarmUnseenOutcomeNotice: vi.fn(async (id: string | null) => {
    notice.disarmed.push(id);
  }),
  notifyUnapprovedOutcomeIfAway: vi.fn(async (kind: string) => {
    notice.away.push(kind);
    return true;
  }),
}));
vi.mock('../services/storeReviewService', () => ({
  maybeRequestReview: vi.fn(async () => {}),
}));
vi.mock('../services/squarePayments', () => ({
  takeInAppPayment: vi.fn(async () => {}),
  // The row subscribes to reader readiness while the sheet is open (Apple req
  // 3.9.1). Default to ready so existing cases exercise the charge path; the
  // preparing state has its own cases below.
  observeTapToPayReadiness: vi.fn((cb: (r: string) => void) => {
    cb(readiness.state);
    return () => {};
  }),
}));
const readiness = vi.hoisted(() => ({ state: 'ready' as string }));
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

import {
  TakePaymentSheet,
  tapToPayRowTitle,
  type TakePaymentTarget,
} from './TakePaymentSheet';
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
  symbols.rendered = [];
  notice.armed = 0;
  notice.disarmed = [];
  notice.away = [];
  readiness.state = 'ready';
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


/**
 * Apple's Tap to Pay on iPhone review requirements (App Review Requirements
 * Checklist v1.6) constrain this row directly:
 *
 *  - 5.3 the control must never be greyed out or obscured, even before the
 *        merchant has accepted Apple's Terms and Conditions
 *  - 3.7 pressing it is the in-checkout trigger that opens that acceptance
 *  - 5.4 it must carry Apple's approved name on iOS
 *
 * Before Aug 2026 the row was `disabled` until the tradie ticked the terms
 * acknowledgement, which is exactly the greyed-out control 5.3 rules out. The
 * gate now runs on press instead, so the button stays live and the tradie
 * still cannot charge without confirming the customer saw the terms.
 */
describe('TakePaymentSheet Tap to Pay row meets Apple review requirements', () => {
  const termsTarget: TakePaymentTarget = {
    ...invoiceTarget,
    terms: 'Payment due in 7 days.',
  };
  const ACK = 'Customer has read and agrees to the terms.';

  it('req 5.4: uses Apple\'s approved name on iOS', () => {
    expect(tapToPayRowTitle('ios')).toBe('Tap to Pay on iPhone');
  });

  it('req 5.4: does not claim "on iPhone" on Android, which is a Square reader', () => {
    expect(tapToPayRowTitle('android')).toBe('Tap to Pay / Card Entry');
  });

  it('req 5.3: stays pressable with terms unacknowledged instead of greying out', async () => {
    tapToPay.state = { enabled: true };
    const ensureSquareConnected = vi.fn(async () => true);
    const { getByText, props } = renderSheet({
      target: termsTarget,
      ensureSquareConnected,
    });

    fireEvent.click(getByText('Tap to Pay / Card Entry'));

    // The press registered — a disabled row would have done nothing at all.
    await waitFor(() =>
      expect(props.onError).toHaveBeenCalledWith(
        'Confirm the customer has read the terms before charging.',
      ),
    );
    // ...and it still refused to charge.
    expect(squarePayments.takeInAppPayment).not.toHaveBeenCalled();
  });

  it('charges once the terms are acknowledged', async () => {
    tapToPay.state = { enabled: true };
    const ensureSquareConnected = vi.fn(async () => true);
    const { getByText, props } = renderSheet({
      target: termsTarget,
      ensureSquareConnected,
    });

    fireEvent.click(getByText(ACK));
    fireEvent.click(getByText('Tap to Pay / Card Entry'));

    await waitFor(() => expect(squarePayments.takeInAppPayment).toHaveBeenCalled());
    expect(props.onError).not.toHaveBeenCalled();
  });

  it('leaves a no-terms target chargeable in one press — nothing to confirm', async () => {
    tapToPay.state = { enabled: true };
    const ensureSquareConnected = vi.fn(async () => true);
    const { getByText, props } = renderSheet({ ensureSquareConnected });

    fireEvent.click(getByText('Tap to Pay / Card Entry'));

    await waitFor(() => expect(squarePayments.takeInAppPayment).toHaveBeenCalled());
    expect(props.onError).not.toHaveBeenCalled();
  });
});


/**
 * Apple req 3.9.1 wants a configuration progress indicator while Tap to Pay
 * gets itself ready, and the row must say it is not usable yet — not imply a
 * card can be tapped right now. Req 5.7 wants that same state to read as
 * "initializing" rather than as a failure. Req 5.3 still applies throughout:
 * preparing must not grey the control out.
 */
describe('TakePaymentSheet surfaces Tap to Pay configuration progress', () => {
  it('req 3.9.1: says it is not ready to take a card while configuring', () => {
    tapToPay.state = { enabled: true };
    readiness.state = 'preparing';

    const { getByText } = renderSheet({ ensureSquareConnected: vi.fn(async () => true) });

    expect(
      getByText('Getting Tap to Pay ready — not ready to take a card yet.'),
    ).toBeTruthy();
  });

  it('drops the warning once the reader is ready', () => {
    tapToPay.state = { enabled: true };
    readiness.state = 'ready';

    const { getByText, queryByText } = renderSheet({
      ensureSquareConnected: vi.fn(async () => true),
    });

    expect(queryByText('Getting Tap to Pay ready — not ready to take a card yet.')).toBeNull();
    expect(getByText('Tap a card or phone, or key in details.')).toBeTruthy();
  });

  it('req 5.3: preparing still does not grey the control out', async () => {
    tapToPay.state = { enabled: true };
    readiness.state = 'preparing';

    const { getByText } = renderSheet({ ensureSquareConnected: vi.fn(async () => true) });
    fireEvent.click(getByText('Tap to Pay / Card Entry'));

    // Pressing mid-configuration is accepted, not swallowed by a disabled row.
    await waitFor(() => expect(squarePayments.takeInAppPayment).toHaveBeenCalled());
  });
});

/**
 * Apple reqs 1.4 and 5.10. Both are about what the tradie and the customer are
 * told when no money moves — the cases that only show up in front of a paying
 * customer, which is exactly why they need covering here.
 */
describe('failed card payments', () => {
  it('offers the customer a record when the card is declined (req 5.10)', async () => {
    tapToPay.state = { enabled: true };
    store.businessSettings = { businessName: 'Hansen Plumbing' };
    (squarePayments.takeInAppPayment as any).mockRejectedValueOnce(
      new Error('Card declined'),
    );
    const { getByText, props } = renderSheet({
      ensureSquareConnected: vi.fn(async () => true),
    });

    fireEvent.click(getByText('Tap to Pay / Card Entry'));

    await waitFor(() => expect(getByText('Card declined')).toBeTruthy());
    expect(getByText(/Send the customer a record/i)).toBeTruthy();
    // A decline is not a generic error — it must not surface as raw SDK text.
    expect(props.onError).not.toHaveBeenCalled();
  });

  it('the record it sends says no money was taken, under the tradie business name', async () => {
    tapToPay.state = { enabled: true };
    store.businessSettings = { businessName: 'Hansen Plumbing' };
    const share = vi.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);
    (squarePayments.takeInAppPayment as any).mockRejectedValueOnce(
      new Error('Card declined'),
    );
    const { getByText } = renderSheet({
      ensureSquareConnected: vi.fn(async () => true),
    });

    fireEvent.click(getByText('Tap to Pay / Card Entry'));
    await waitFor(() => expect(getByText('Send record')).toBeTruthy());
    fireEvent.click(getByText('Send record'));

    await waitFor(() => expect(share).toHaveBeenCalled());
    const message = (share.mock.calls[0][0] as any).message as string;
    expect(message).toMatch(/Hansen Plumbing/);
    expect(message).toMatch(/no money was taken/i);
    expect(message).toMatch(/Invoice INV-0042/);
    // Customer-facing: the app never appears on it.
    expect(message).not.toMatch(/quotemate/i);
    share.mockRestore();
  });

  it('a cancellation still offers nothing and says nothing', async () => {
    tapToPay.state = { enabled: true };
    (squarePayments.takeInAppPayment as any).mockRejectedValueOnce(
      new Error('Payment canceled by user'),
    );
    const { queryByText, props } = renderSheet({
      ensureSquareConnected: vi.fn(async () => true),
    });

    fireEvent.click(queryByText('Tap to Pay / Card Entry')!);

    await waitFor(() => expect(squarePayments.takeInAppPayment).toHaveBeenCalled());
    expect(queryByText('Card declined')).toBeNull();
    expect(props.onError).not.toHaveBeenCalled();
  });

  it('tells the tradie to update iOS rather than "payment failed" (req 1.4)', async () => {
    tapToPay.state = { enabled: true };
    (squarePayments.takeInAppPayment as any).mockRejectedValueOnce(
      Object.assign(new Error('unsupported'), { code: 'osVersionNotSupported' }),
    );
    const { getByText, props } = renderSheet({
      ensureSquareConnected: vi.fn(async () => true),
    });

    fireEvent.click(getByText('Tap to Pay / Card Entry'));

    await waitFor(() => expect(props.onError).toHaveBeenCalled());
    expect(props.onError.mock.calls[0][0]).toMatch(/iOS 17\.6/);
    expect(props.onError.mock.calls[0][0]).not.toMatch(/payment failed/i);
  });

  it('an OS below the floor explains itself on the row instead of going quiet', () => {
    tapToPay.state = { enabled: false, reason: 'os_too_old' };
    const { getByText } = renderSheet();

    expect(getByText(/Update to iOS 17\.6 or later/)).toBeTruthy();
  });
});

describe('req 5.5 — the Tap to Pay icon', () => {
  it("uses Apple's wave.3.right.circle symbol on the Tap to Pay row", () => {
    tapToPay.state = { enabled: true };
    renderSheet();

    expect(symbols.rendered).toContain('wave.3.right.circle');
  });

  it('claims no SF Symbol for the rows Apple does not govern', () => {
    tapToPay.state = { enabled: true };
    renderSheet();

    // Share Pay Link and Record Payment are ours, not Apple's. Asserted on the
    // distinct set, not the call list — a re-render legitimately repeats a
    // name, and counting renders would make this fail for the wrong reason.
    expect([...new Set(symbols.rendered)]).toEqual(['wave.3.right.circle']);
  });

  it('still shows the row when the symbol is unavailable, via the fallback icon', () => {
    tapToPay.state = { enabled: true };
    const { getByText } = renderSheet();

    // The mock returns `fallback`, standing in for Android/web and any iOS
    // that lacks the symbol. The row must remain usable either way.
    expect(getByText('Tap to Pay / Card Entry')).toBeTruthy();
  });
});

describe('req 5.12 — finding out about a payment you did not see', () => {
  it('arms the notice before the tap, so it survives the app being killed', async () => {
    tapToPay.state = { enabled: true };
    const { getByText } = renderSheet({ ensureSquareConnected: vi.fn(async () => true) });

    fireEvent.click(getByText('Tap to Pay / Card Entry'));

    await waitFor(() => expect(squarePayments.takeInAppPayment).toHaveBeenCalled());
    expect(notice.armed).toBe(1);
  });

  it('disarms it after an APPROVED payment — the notice is about not seeing a result', async () => {
    tapToPay.state = { enabled: true };
    const { getByText } = renderSheet({ ensureSquareConnected: vi.fn(async () => true) });

    fireEvent.click(getByText('Tap to Pay / Card Entry'));

    await waitFor(() => expect(notice.disarmed).toEqual(['notice-1']));
  });

  it('disarms it after a decline too', async () => {
    tapToPay.state = { enabled: true };
    (squarePayments.takeInAppPayment as any).mockRejectedValueOnce(
      new Error('Card declined'),
    );
    const { getByText } = renderSheet({ ensureSquareConnected: vi.fn(async () => true) });

    fireEvent.click(getByText('Tap to Pay / Card Entry'));

    await waitFor(() => expect(notice.disarmed).toEqual(['notice-1']));
  });

  it('tells the tradie the outcome when they are not watching', async () => {
    tapToPay.state = { enabled: true };
    (squarePayments.takeInAppPayment as any).mockRejectedValueOnce(
      new Error('Card declined'),
    );
    const { getByText } = renderSheet({ ensureSquareConnected: vi.fn(async () => true) });

    fireEvent.click(getByText('Tap to Pay / Card Entry'));

    await waitFor(() => expect(notice.away).toEqual(['declined']));
  });

  it('a cancellation is still routed, so the notice layer decides to stay quiet', async () => {
    tapToPay.state = { enabled: true };
    (squarePayments.takeInAppPayment as any).mockRejectedValueOnce(
      new Error('Payment canceled by user'),
    );
    const { getByText } = renderSheet({ ensureSquareConnected: vi.fn(async () => true) });

    fireEvent.click(getByText('Tap to Pay / Card Entry'));

    await waitFor(() => expect(notice.away).toEqual(['cancelled']));
  });
});
