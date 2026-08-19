// @vitest-environment jsdom
/**
 * The send flow's shape, post Jul 2026 audit.
 *
 * Sending is the activation event — 4 of the 25 tradies who sent a quote to a
 * real customer pay, and none of the 113 who never sent do. Two things stood
 * between a finished quote and a send: a five-row sheet asking how to deliver
 * a doc we already had an address for, and a pay-link upsell sitting ABOVE
 * Email that dropped the whole send flow when Square wasn't connected.
 *
 * Heavy native/expo dependency graphs are mocked out — same approach as
 * TakePaymentSheet.test.tsx / StickyJobActionBar.test.tsx.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, screen, waitFor, act } from '@testing-library/react';
import { Alert } from 'react-native';

vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
  Share: { share: vi.fn(async () => ({ action: 'sharedAction' })), sharedAction: 'sharedAction' },
  Linking: { openURL: vi.fn(async () => {}) },
  Platform: { OS: 'android', select: (o: any) => o.android ?? o.default },
}));
vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: vi.fn() }) }));

const sms = vi.hoisted(() => ({
  openSmsComposer: vi.fn(async () => 'sent' as const),
}));
vi.mock('../utils/smsComposer', () => ({
  cleanSmsRecipient: (phone: string) => {
    const trimmed = phone.trim();
    return `${trimmed.startsWith('+') ? '+' : ''}${trimmed.replace(/\D/g, '')}`;
  },
  openSmsComposer: sms.openSmsComposer,
}));
const acceptance = vi.hoisted(() => ({
  generateAcceptanceLink: vi.fn(async () => 'https://example.test/quote/secure-token'),
}));
vi.mock('../services/quoteAcceptanceService', () => acceptance);

vi.mock('./ActionSheet', () => ({
  ActionSheet: ({ visible, title, options }: any) =>
    visible
      ? React.createElement(
          'div',
          { 'data-testid': 'sheet' },
          React.createElement('span', null, title),
          options.map((o: any, i: number) =>
            React.createElement('button', { key: i, onClick: o.onPress }, o.label),
          ),
        )
      : null,
}));
vi.mock('./AlertModal', () => ({
  AlertModal: ({ visible, title, primaryButtonText, primaryButtonAction, secondaryButtonText, secondaryButtonAction }: any) =>
    visible
      ? React.createElement(
          'div',
          { 'data-testid': 'alert' },
          React.createElement('span', null, title),
          React.createElement('button', { onClick: primaryButtonAction }, primaryButtonText),
          secondaryButtonText
            ? React.createElement('button', { onClick: secondaryButtonAction }, secondaryButtonText)
            : null,
        )
      : null,
}));
vi.mock('./SendGateModal', () => ({ SendGateModal: () => null }));
// Stub preview: exposes the callbacks the dialog wires into it so the tests
// can drive "sent", "closed" and "more ways to send" without the real modal.
vi.mock('./DocumentEmailPreviewModal', () => ({
  DocumentEmailPreviewModal: ({ visible, onDismiss, onSent, onMoreWaysToSend, onEmailBodyChange, emailBody, isRegenerating }: any) =>
    visible
      ? React.createElement(
          'div',
          { 'data-testid': 'preview' },
          React.createElement('span', null, isRegenerating ? 'generating' : 'ready'),
          React.createElement('span', { 'data-testid': 'preview-body' }, emailBody),
          React.createElement('button', { onClick: onSent }, 'stub-sent'),
          React.createElement('button', { onClick: onDismiss }, 'stub-close'),
          React.createElement('button', { onClick: onMoreWaysToSend }, 'stub-more'),
          React.createElement('button', { onClick: () => onEmailBodyChange('MY HAND EDITS') }, 'stub-edit'),
        )
      : null,
}));

vi.mock('../utils/pdfGenerator', () => ({ exportDocumentPDF: vi.fn(async () => {}) }));
vi.mock('../utils/applyStageChange', () => ({ markDocumentSent: vi.fn(async () => {}) }));
vi.mock('../services/analyticsService', () => ({ trackEvent: vi.fn() }));

const llm = vi.hoisted(() => ({
  generateQuoteEmail: vi.fn(async () => 'Written quote email'),
  generateInvoiceEmail: vi.fn(async () => 'Written invoice email'),
  getDefaultEmailBody: vi.fn(() => 'Template quote email'),
  getDefaultInvoiceEmailBody: vi.fn(() => 'Template invoice email'),
}));
vi.mock('../services/llmService', () => llm);

const guard = vi.hoisted(() => ({
  ensureCanDeliver: vi.fn(async () => ({ ok: true })),
  attachTrialPayLink: vi.fn(async () => ({ status: 'connect_required' })),
}));
vi.mock('../utils/quoteDeliveryGuard', () => ({
  ...guard,
  // Real rule, kept in sync by quoteDeliveryGuard.test.ts.
  shouldOfferTrialPayLink: (plan: string, doc: any) => plan === 'trial' && !doc.squarePaymentLinkUrl,
}));

const store = vi.hoisted(() => ({
  state: {
    subscriptionStatus: { trialStartedAt: 1, trialExpired: false, isPro: false },
    quotes: [] as any[],
    invoices: [] as any[],
    saveDraft: vi.fn(async () => {}),
    saveQuote: vi.fn(async () => {}),
    saveInvoice: vi.fn(async () => {}),
    createInvoiceFromQuote: vi.fn(async () => {}),
    getEffectivePlan: () => 'trial',
  } as any,
}));
vi.mock('../store/useStore', () => {
  const useStore: any = () => store.state;
  useStore.getState = () => store.state;
  return { useStore };
});

import { SendDocumentDialog } from './SendDocumentDialog';
import { resetWarmedEmailDrafts, warmEmailDraft } from '../utils/emailDraft';
import { trackEvent } from '../services/analyticsService';
import type { Document } from '../types/document';

const tracked = vi.mocked(trackEvent);

function doc(overrides: Partial<Document> = {}): Document {
  return {
    id: 'q1',
    type: 'quote',
    stage: 'draft',
    number: 'Q-001',
    createdAt: 0,
    updatedAt: 0,
    customerName: 'Sam',
    customerEmail: 'sam@example.com',
    job: { name: 'Deck restain', description: 'Sand and restain' },
    payments: [],
    // Self-consistent on purpose: the dialog now re-costs a quote before it
    // quotes a figure at a customer, so a fixture whose stored total doesn't
    // match its own line items would trip the settle prompt in every test.
    // 200 materials + 480 labour = 680, +$20 material markup = 700, +GST = 770.
    materials: [{ id: 'm1', name: 'Decking oil', quantity: 4, unit: 'each', price: 50, totalPrice: 200 }],
    laborRate: 80,
    laborHours: 6,
    laborTotal: 480,
    materialsSubtotal: 200,
    markup: 10,
    laborMarkup: 0,
    markupAmount: 20,
    subtotal: 680,
    gst: 70,
    total: 770,
    draftEmailBody: 'Warmed on JobPreview',
    ...overrides,
  } as Document;
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof SendDocumentDialog>> = {}) {
  const props = {
    visible: true,
    onDismiss: vi.fn(),
    doc: doc(),
    businessSettings: { businessName: 'Hansen Decks' } as any,
    ...overrides,
  };
  return { ...render(<SendDocumentDialog {...props} />), props };
}

/** Props of the first matching tracked event. */
function eventProps(name: string) {
  return tracked.mock.calls.find(([event]) => event === name)?.[1] as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetWarmedEmailDrafts();
  guard.ensureCanDeliver.mockResolvedValue({ ok: true } as any);
  guard.attachTrialPayLink.mockResolvedValue({ status: 'connect_required' } as any);
  store.state.getEffectivePlan = () => 'trial';
});

describe('opening the send flow', () => {
  it('skips the sheet and opens the email preview when we have the address', async () => {
    renderDialog();

    await waitFor(() => expect(screen.getByTestId('preview')).toBeTruthy());
    expect(screen.queryByTestId('sheet')).toBeNull();
  });

  it('shows the sheet when there is no address on file', async () => {
    renderDialog({ doc: doc({ customerEmail: undefined }) });

    await waitFor(() => expect(screen.getByTestId('sheet')).toBeTruthy());
    expect(screen.queryByTestId('preview')).toBeNull();
  });

  it('treats an unusable address as no address', async () => {
    renderDialog({ doc: doc({ customerEmail: 'not-an-email' }) });

    await waitFor(() => expect(screen.getByTestId('sheet')).toBeTruthy());
  });

  it('keeps the sheet for free-plan users, whose gate does a Square round-trip first', async () => {
    store.state.getEffectivePlan = () => 'free';

    renderDialog();

    await waitFor(() => expect(screen.getByTestId('sheet')).toBeTruthy());
    expect(screen.queryByTestId('preview')).toBeNull();
    expect(eventProps('send_sheet_opened')).toEqual({
      doc_type: 'quote',
      has_customer_email: true,
      plan: 'free',
    });
  });

  it('reports the open with doc type, address and plan', async () => {
    renderDialog();

    await waitFor(() => expect(eventProps('send_sheet_opened')).toBeTruthy());
    expect(eventProps('send_sheet_opened')).toEqual({
      doc_type: 'quote',
      has_customer_email: true,
      plan: 'trial',
    });
  });
});

describe('the sheet itself', () => {
  it('offers exactly the four delivery channels, Email first', async () => {
    renderDialog({ doc: doc({ customerEmail: undefined }) });

    await waitFor(() => expect(screen.getByTestId('sheet')).toBeTruthy());
    const labels = Array.from(screen.getByTestId('sheet').querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toEqual(['Email', 'SMS', 'Share', 'Export PDF']);
  });

  it('no longer puts the pay-link upsell in front of the send', async () => {
    // Trial user with no pay link — the exact case that used to show it.
    renderDialog({ doc: doc({ customerEmail: undefined, squarePaymentLinkUrl: undefined }) });

    await waitFor(() => expect(screen.getByTestId('sheet')).toBeTruthy());
    expect(screen.queryByText(/Get paid on this/i)).toBeNull();
    expect(tracked.mock.calls.map(([e]) => e)).not.toContain('pay_link_optin_shown');
  });

  it('records the channel chosen from the sheet', async () => {
    renderDialog({ doc: doc({ customerEmail: undefined }) });
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeTruthy());

    fireEvent.click(screen.getByText('Email'));

    await waitFor(() => expect(eventProps('send_method_chosen')).toEqual({ method: 'email', doc_type: 'quote' }));
  });
});

describe('the warmed email body', () => {
  it('opens on a warm body with no generation and no wait', async () => {
    renderDialog();

    await waitFor(() => expect(eventProps('email_preview_opened')).toBeTruthy());
    expect(eventProps('email_preview_opened')).toEqual({ doc_type: 'quote', prefilled: true, wait_ms: 0 });
    expect(llm.generateQuoteEmail).not.toHaveBeenCalled();
    expect(screen.getByText('ready')).toBeTruthy();
  });

  it('generates on the spot when nothing was warmed, and reports the real wait', async () => {
    renderDialog({ doc: doc({ draftEmailBody: undefined }) });

    await waitFor(() => expect(llm.generateQuoteEmail).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(eventProps('email_preview_opened')).toBeTruthy());
    const props = eventProps('email_preview_opened');
    expect(props.prefilled).toBe(false);
    expect(typeof props.wait_ms).toBe('number');
    expect(store.state.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ draftEmailBody: 'Written quote email' }),
    );
  });

  // The warm body lives in memory, not on the doc: draftEmailBody only
  // reaches the unified Document after a Firestore round-trip through the
  // server-side mirror, which routinely hasn't landed by the time a tradie
  // taps Send off JobPreview.
  it('uses a body warmed on JobPreview even though the doc has not caught up', async () => {
    await warmEmailDraft(doc({ draftEmailBody: undefined }), { businessName: 'Hansen Decks' } as any, { isPro: true });
    llm.generateQuoteEmail.mockClear();

    renderDialog({ doc: doc({ draftEmailBody: undefined }) });

    await waitFor(() => expect(screen.getByTestId('preview')).toBeTruthy());
    expect(screen.getByTestId('preview-body').textContent).toBe('Written quote email');
    expect(llm.generateQuoteEmail).not.toHaveBeenCalled();
    expect(eventProps('email_preview_opened')).toEqual({ doc_type: 'quote', prefilled: true, wait_ms: 0 });
    // Persisted on the tradie's own tap, so the next session opens warm too.
    expect(store.state.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ draftEmailBody: 'Written quote email' }),
    );
  });

  it('waits on an in-flight warm-up instead of paying for a second generation', async () => {
    let release: (body: string) => void = () => {};
    llm.generateQuoteEmail.mockImplementationOnce(
      () => new Promise<string>((resolve) => { release = resolve; }),
    );
    const warming = warmEmailDraft(doc({ draftEmailBody: undefined }), { businessName: 'Hansen Decks' } as any, { isPro: true });

    renderDialog({ doc: doc({ draftEmailBody: undefined }) });
    await waitFor(() => expect(screen.getByText('generating')).toBeTruthy());
    release('Written quote email');
    await warming;

    await waitFor(() => expect(screen.getByText('ready')).toBeTruthy());
    expect(llm.generateQuoteEmail).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('preview-body').textContent).toBe('Written quote email');
  });

  it('falls back to the local template for free users', async () => {
    store.state.subscriptionStatus = { trialStartedAt: null, trialExpired: true, isPro: false };
    store.state.getEffectivePlan = () => 'free';
    renderDialog({ doc: doc({ draftEmailBody: undefined }) });
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeTruthy());

    fireEvent.click(screen.getByText('Email'));

    await waitFor(() => expect(llm.getDefaultEmailBody).toHaveBeenCalled());
    expect(llm.generateQuoteEmail).not.toHaveBeenCalled();
    store.state.subscriptionStatus = { trialStartedAt: 1, trialExpired: false, isPro: false };
  });
});

describe('More ways to send', () => {
  it('swaps the preview for the full sheet', async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByTestId('preview')).toBeTruthy());

    fireEvent.click(screen.getByText('stub-more'));

    expect(screen.getByTestId('sheet')).toBeTruthy();
    expect(screen.queryByTestId('preview')).toBeNull();
  });

  // The host holds `doc` in state, so the prop never refreshes mid-session:
  // reseeding the body on the way back would revert the tradie's own words —
  // and send the pre-edit copy, since the save then sees "no change".
  it('keeps hand edits when coming back to Email', async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByTestId('preview')).toBeTruthy());
    fireEvent.click(screen.getByText('stub-edit'));
    fireEvent.click(screen.getByText('stub-more'));

    fireEvent.click(screen.getByText('Email'));

    await waitFor(() => expect(screen.getByTestId('preview')).toBeTruthy());
    expect(screen.getByTestId('preview-body').textContent).toBe('MY HAND EDITS');
  });

  it('does not re-generate a cold body on the way back', async () => {
    renderDialog({ doc: doc({ draftEmailBody: undefined }) });
    await waitFor(() => expect(llm.generateQuoteEmail).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('stub-edit'));
    fireEvent.click(screen.getByText('stub-more'));

    fireEvent.click(screen.getByText('Email'));

    await waitFor(() => expect(screen.getByTestId('preview')).toBeTruthy());
    expect(llm.generateQuoteEmail).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('preview-body').textContent).toBe('MY HAND EDITS');
  });
});

describe('the pay-link ask, now after the send', () => {
  it('asks once the doc is away, not before', async () => {
    const { props } = renderDialog();
    await waitFor(() => expect(screen.getByTestId('preview')).toBeTruthy());

    fireEvent.click(screen.getByText('stub-sent'));
    fireEvent.click(screen.getByText('stub-close'));

    expect(screen.getByText('Want a Pay Now button?')).toBeTruthy();
    expect(eventProps('pay_link_optin_shown')).toEqual({ doc_type: 'quote' });
    // The flow stays open for the ask instead of closing out from under it.
    expect(props.onDismiss).not.toHaveBeenCalled();
  });

  // The doc snapshot this dialog holds is stamped `draft`; re-writing the
  // legacy quote from it after a send merges that status straight back over
  // the server's sent stamp.
  it('does not re-write the doc once it has gone out', async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByTestId('preview')).toBeTruthy());
    store.state.saveDraft.mockClear();

    fireEvent.click(screen.getByText('stub-sent'));
    fireEvent.click(screen.getByText('stub-close'));

    expect(store.state.saveDraft).not.toHaveBeenCalled();
  });

  it('stays out of the way when the preview is abandoned', async () => {
    const { props } = renderDialog();
    await waitFor(() => expect(screen.getByTestId('preview')).toBeTruthy());

    fireEvent.click(screen.getByText('stub-close'));

    expect(screen.queryByText('Want a Pay Now button?')).toBeNull();
    expect(tracked.mock.calls.map(([e]) => e)).not.toContain('pay_link_optin_shown');
    expect(props.onDismiss).toHaveBeenCalled();
  });

  it('is not offered to a doc that already carries a pay link', async () => {
    renderDialog({ doc: doc({ squarePaymentLinkUrl: 'https://sq.link/x' }) });
    await waitFor(() => expect(screen.getByTestId('preview')).toBeTruthy());

    fireEvent.click(screen.getByText('stub-sent'));
    fireEvent.click(screen.getByText('stub-close'));

    expect(screen.queryByText('Want a Pay Now button?')).toBeNull();
  });

  it('records the opt-in outcome when taken', async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByTestId('preview')).toBeTruthy());
    fireEvent.click(screen.getByText('stub-sent'));
    fireEvent.click(screen.getByText('stub-close'));

    fireEvent.click(screen.getByText('Set it up'));

    await waitFor(() => expect(guard.attachTrialPayLink).toHaveBeenCalledTimes(1));
    expect(eventProps('pay_link_optin_tapped')).toEqual({ doc_type: 'quote', outcome: 'connect_required' });
  });

  it('"Not now" closes the flow without attaching anything', async () => {
    const { props } = renderDialog();
    await waitFor(() => expect(screen.getByTestId('preview')).toBeTruthy());
    fireEvent.click(screen.getByText('stub-sent'));
    fireEvent.click(screen.getByText('stub-close'));

    fireEvent.click(screen.getByText('Not now'));

    expect(guard.attachTrialPayLink).not.toHaveBeenCalled();
    expect(props.onDismiss).toHaveBeenCalled();
  });
});

describe('non-email channels', () => {
  it('opens SMS with readable, unencoded text and records the send', async () => {
    renderDialog({ doc: doc({ customerEmail: undefined, customerPhone: '0412 345 678' }) });
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeTruthy());

    fireEvent.click(screen.getByText('SMS'));

    await waitFor(() => expect(sms.openSmsComposer).toHaveBeenCalledTimes(1));
    const [recipient, message] = sms.openSmsComposer.mock.calls[0];
    expect(recipient).toBe('0412345678');
    expect(message).toContain('Hi Sam,\n\nYour quote from Hansen Decks');
    expect(message).toContain('Total: $770.00');
    expect(message).toContain('View and respond to your quote:\nhttps://example.test/quote/secure-token');
    expect(message).not.toContain('%20');
    expect(eventProps('send_method_chosen')).toEqual({ method: 'sms', doc_type: 'quote' });
    expect(eventProps('quote_send_succeeded')).toEqual({ doc_type: 'quote', method: 'sms', to_self: false });
  });

  it('keeps the quote in draft when the SMS composer is cancelled', async () => {
    sms.openSmsComposer.mockResolvedValueOnce('cancelled' as any);
    renderDialog({ doc: doc({ customerEmail: undefined, customerPhone: '0412345678' }) });
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeTruthy());

    fireEvent.click(screen.getByText('SMS'));

    await waitFor(() => expect(sms.openSmsComposer).toHaveBeenCalled());
    expect(eventProps('quote_send_succeeded')).toBeUndefined();
    expect(screen.getByTestId('sheet')).toBeTruthy();
  });

  it('asks Android users to confirm an unknown send result before marking sent', async () => {
    sms.openSmsComposer.mockResolvedValueOnce('unknown' as any);
    const { props } = renderDialog({ doc: doc({ customerEmail: undefined, customerPhone: '0412345678' }) });
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeTruthy());

    fireEvent.click(screen.getByText('SMS'));

    await waitFor(() => expect(vi.mocked(Alert.alert)).toHaveBeenCalledWith(
      'Was the SMS sent?',
      expect.any(String),
      expect.any(Array),
      { cancelable: false },
    ));
    expect(eventProps('quote_send_succeeded')).toBeUndefined();
    expect(props.onDismiss).not.toHaveBeenCalled();

    const buttons = vi.mocked(Alert.alert).mock.calls.find(([title]) => title === 'Was the SMS sent?')?.[2] as any[];
    await buttons[1].onPress();

    expect(eventProps('quote_send_succeeded')).toEqual({ doc_type: 'quote', method: 'sms', to_self: false });
    expect(props.onDismiss).toHaveBeenCalled();
  });

  it('does not mark a web clipboard copy until the user confirms it was sent', async () => {
    sms.openSmsComposer.mockResolvedValueOnce('copied' as any);
    const { props } = renderDialog({ doc: doc({ customerEmail: undefined, customerPhone: '0412345678' }) });
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeTruthy());

    fireEvent.click(screen.getByText('SMS'));

    await waitFor(() => expect(vi.mocked(Alert.alert)).toHaveBeenCalledWith(
      'Message copied',
      expect.any(String),
      expect.any(Array),
      { cancelable: false },
    ));
    expect(eventProps('quote_send_succeeded')).toBeUndefined();
    expect(props.onDismiss).not.toHaveBeenCalled();

    const buttons = vi.mocked(Alert.alert).mock.calls.find(([title]) => title === 'Message copied')?.[2] as any[];
    await buttons[1].onPress();

    expect(eventProps('quote_send_succeeded')).toEqual({ doc_type: 'quote', method: 'sms', to_self: false });
    expect(props.onDismiss).toHaveBeenCalled();
  });

  it('does not open SMS when a secure quote link cannot be created', async () => {
    acceptance.generateAcceptanceLink.mockRejectedValueOnce(new Error('offline'));
    renderDialog({ doc: doc({ customerEmail: undefined, customerPhone: '0412345678' }) });
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeTruthy());

    fireEvent.click(screen.getByText('SMS'));

    await waitFor(() => expect(acceptance.generateAcceptanceLink).toHaveBeenCalledWith('q1'));
    expect(sms.openSmsComposer).not.toHaveBeenCalled();
    expect(eventProps('quote_send_succeeded')).toBeUndefined();
    expect(screen.getByTestId('sheet')).toBeTruthy();
  });

  it('does not attempt SMS when the customer has no phone number', async () => {
    renderDialog({ doc: doc({ customerEmail: undefined, customerPhone: undefined }) });
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeTruthy());

    fireEvent.click(screen.getByText('SMS'));

    expect(sms.openSmsComposer).not.toHaveBeenCalled();
    expect(guard.ensureCanDeliver).not.toHaveBeenCalled();
  });
});

describe('the free-tier send gate', () => {
  it('still opens instead of the preview, and keeps its event', async () => {
    guard.ensureCanDeliver.mockResolvedValue({ ok: false, reason: 'connect_square', message: 'Connect Square' } as any);

    renderDialog();

    await waitFor(() => expect(eventProps('send_gate_shown')).toEqual({ doc_type: 'quote' }));
    expect(screen.queryByTestId('preview')).toBeNull();
  });
});

describe('settling the total before it reaches a customer', () => {
  /**
   * Aug 2026, QU-178711. A tradie quoted a Daikin multi-head replacement with
   * three sections (8h + 8h + 2h at $100) while the quote's top-level
   * laborHours still read 8. calculateDocumentTotals derives labour from the
   * sections when a quote has them and from laborHours × laborRate when it
   * doesn't — so the screen's copy carried $6,389.02 (labour $800) while
   * saveQuote, which re-costs on the way out, landed on $7,819.02 (labour
   * $1,800). The SMS was composed from the screen's copy and the acceptance
   * link renders the saved one, so the customer was quoted $6,389.02 by text
   * and shown $7,819.02 when they opened it.
   */
  const drifting = (overrides: Partial<Document> = {}) => doc({
    customerEmail: undefined,
    customerPhone: '0421617499',
    job: { name: 'Daikin multi head replacement', description: 'Like-for-like replacement' },
    materials: [
      { id: 'm1', name: 'Daikin multi head', quantity: 1, unit: 'each', price: 3723.5, totalPrice: 3723.5 },
      { id: 'm2', name: 'Decommission old system', quantity: 1, unit: 'each', price: 150, totalPrice: 150 },
      { id: 'm3', name: 'Consumables', quantity: 1, unit: 'each', price: 100, totalPrice: 100 },
    ],
    sections: [
      { id: 's1', name: 'Option 1', laborHours: 8, laborRate: 100, laborUnit: 'hours', multiplier: 1, laborTotal: 800 },
      { id: 's2', name: 'Option 2', laborHours: 4, laborRate: 100, laborUnit: 'hours', multiplier: 2, laborTotal: 800 },
      { id: 's3', name: 'Decommission', laborHours: 2, laborRate: 100, laborUnit: 'hours', multiplier: 1, laborTotal: 200 },
    ],
    laborRate: 100,
    laborHours: 8,
    laborExtraHours: 0,
    markup: 20,
    laborMarkup: 30,
    gstRegistered: true,
    pricesIncludeGst: false,
    // The stale figures the screen was showing — labour costed off the
    // top-level 8 hours instead of the sections' 18.
    laborTotal: 800,
    materialsSubtotal: 3973.5,
    markupAmount: 1034.7,
    subtotal: 4773.5,
    gst: 580.82,
    total: 6389.02,
    draftEmailBody: 'Your quote comes to $6,389.02.',
    ...overrides,
  } as Partial<Document>);

  /** Press a button on the settle-confirm alert. */
  async function answerSettlePrompt(choice: 'send' | 'back') {
    await waitFor(() => expect(
      vi.mocked(Alert.alert).mock.calls.find(([title]) => title === 'Total has changed'),
    ).toBeTruthy());
    const buttons = vi.mocked(Alert.alert).mock.calls
      .find(([title]) => title === 'Total has changed')?.[2] as any[];
    const button = choice === 'send'
      ? buttons.find((b) => String(b.text).startsWith('Send'))
      : buttons.find((b) => b.style === 'cancel');
    await act(async () => { button.onPress(); });
  }

  it('quotes the SMS at the recalculated total, not the stale one on screen', async () => {
    renderDialog({ doc: drifting() });
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeTruthy());

    fireEvent.click(screen.getByText('SMS'));
    await answerSettlePrompt('send');

    await waitFor(() => expect(sms.openSmsComposer).toHaveBeenCalled());
    const message = sms.openSmsComposer.mock.calls[0][1] as string;
    expect(message).toContain('Total: $7,819.02');
    expect(message).not.toContain('6,389.02');
  });

  it('persists the recalculated quote before minting the link the customer opens', async () => {
    renderDialog({ doc: drifting() });
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeTruthy());

    fireEvent.click(screen.getByText('SMS'));
    await answerSettlePrompt('send');
    await waitFor(() => expect(acceptance.generateAcceptanceLink).toHaveBeenCalled());

    // The acceptance page reads the SAVED quote, so the save has to land
    // first or the link still serves the figure the SMS just contradicted.
    const saved = store.state.saveDraft.mock.calls[0][0];
    expect(saved.total).toBe(7819.02);
    expect(saved.laborTotal).toBe(1800);
    expect(store.state.saveDraft.mock.invocationCallOrder[0])
      .toBeLessThan(acceptance.generateAcceptanceLink.mock.invocationCallOrder[0]);
  });

  it('never moves the price silently — backing out sends nothing and saves nothing', async () => {
    renderDialog({ doc: drifting() });
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeTruthy());

    fireEvent.click(screen.getByText('SMS'));
    await answerSettlePrompt('back');

    expect(sms.openSmsComposer).not.toHaveBeenCalled();
    expect(acceptance.generateAcceptanceLink).not.toHaveBeenCalled();
    expect(store.state.saveDraft).not.toHaveBeenCalled();
  });

  it('reports the gap it found so these can be counted', async () => {
    renderDialog({ doc: drifting() });
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeTruthy());

    fireEvent.click(screen.getByText('SMS'));
    await answerSettlePrompt('send');

    expect(eventProps('send_total_recalculated')).toEqual({
      doc_type: 'quote',
      shown_total: 6389.02,
      settled_total: 7819.02,
    });
  });

  it('shares the recalculated total too', async () => {
    renderDialog({ doc: drifting() });
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeTruthy());

    fireEvent.click(screen.getByText('Share'));
    await answerSettlePrompt('send');

    const { Share } = await import('react-native');
    await waitFor(() => expect(vi.mocked(Share.share)).toHaveBeenCalled());
    expect(vi.mocked(Share.share).mock.calls[0][0].message).toContain('$7,819.02');
  });

  it('exports the PDF from the recalculated document', async () => {
    renderDialog({ doc: drifting() });
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeTruthy());

    fireEvent.click(screen.getByText('Export PDF'));
    await answerSettlePrompt('send');

    const { exportDocumentPDF } = await import('../utils/pdfGenerator');
    await waitFor(() => expect(vi.mocked(exportDocumentPDF)).toHaveBeenCalled());
    expect(vi.mocked(exportDocumentPDF).mock.calls[0][0].total).toBe(7819.02);
  });

  it('rewrites an email body that was drafted against the old figure', async () => {
    // A quote email names its total in the prose, so the draft written before
    // the settle is as wrong as the SMS was.
    renderDialog({ doc: drifting({ customerEmail: 'barb@example.com' }) });
    await answerSettlePrompt('send');

    await waitFor(() => expect(screen.getByTestId('preview')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('preview-body').textContent)
      .toBe('Written quote email'));
    expect(llm.generateQuoteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ total: 7819.02 }),
    );
  });

  it('leaves a quote whose figures already agree alone — no prompt, no extra write', async () => {
    renderDialog({ doc: doc({ customerEmail: undefined, customerPhone: '0421617499' }) });
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeTruthy());

    fireEvent.click(screen.getByText('SMS'));

    await waitFor(() => expect(sms.openSmsComposer).toHaveBeenCalled());
    expect(vi.mocked(Alert.alert).mock.calls.find(([title]) => title === 'Total has changed'))
      .toBeUndefined();
    expect(store.state.saveDraft).not.toHaveBeenCalled();
    expect(sms.openSmsComposer.mock.calls[0][1]).toContain('Total: $770.00');
  });

  it('settles an invoice by leaving it alone — saveInvoice does not re-cost', async () => {
    renderDialog({
      doc: drifting({ type: 'invoice', customerPhone: '0421617499', dueDate: 0 } as any),
    });
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeTruthy());

    fireEvent.click(screen.getByText('SMS'));

    await waitFor(() => expect(sms.openSmsComposer).toHaveBeenCalled());
    expect(vi.mocked(Alert.alert).mock.calls.find(([title]) => title === 'Total has changed'))
      .toBeUndefined();
    expect(sms.openSmsComposer.mock.calls[0][1]).toContain('Total: $6,389.02');
  });
});

describe('quotes the settle must not touch', () => {
  /**
   * `recovered-` docs are the 2026-07 account-reclaim reconstructions: the
   * grand total is real (read off the email that went out) but the lines under
   * it are placeholders that were never meant to add up to it. Recomputing one
   * would move a historical record — downwards, in front of a customer.
   */
  it('leaves a recovered- quote on its stored total', async () => {
    renderDialog({
      doc: doc({
        id: 'recovered-QU-177680',
        customerEmail: undefined,
        customerPhone: '0421617499',
        materials: [
          { id: 'r1', name: 'Materials (recovered)', quantity: 1, unit: 'each', price: 3932.37, totalPrice: 3932.37 },
          { id: 'r2', name: 'Labour (recovered)', quantity: 1, unit: 'each', price: 1170, totalPrice: 1170 },
        ],
        laborRate: 0,
        laborHours: 0,
        laborTotal: 0,
        markup: 0,
        laborMarkup: 0,
        materialsSubtotal: 5104.37,
        subtotal: 5104.37,
        gst: 518.09,
        total: 5698.95,
      }),
    });
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeTruthy());

    fireEvent.click(screen.getByText('SMS'));

    await waitFor(() => expect(sms.openSmsComposer).toHaveBeenCalled());
    expect(vi.mocked(Alert.alert).mock.calls.find(([title]) => title === 'Total has changed'))
      .toBeUndefined();
    expect(store.state.saveDraft).not.toHaveBeenCalled();
    // The figure the customer was actually quoted, not the one its placeholder
    // lines recompute to ($5,612.61).
    expect(sms.openSmsComposer.mock.calls[0][1]).toContain('Total: $5,698.95');
  });
});
