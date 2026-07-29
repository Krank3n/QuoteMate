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
import { render, fireEvent, screen, waitFor } from '@testing-library/react';

vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
  Share: { share: vi.fn(async () => ({ action: 'sharedAction' })), sharedAction: 'sharedAction' },
  Linking: { openURL: vi.fn(async () => {}) },
  Platform: { OS: 'android', select: (o: any) => o.android ?? o.default },
}));
vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: vi.fn() }) }));

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
    materials: [],
    laborRate: 80,
    laborHours: 6,
    laborTotal: 480,
    materialsSubtotal: 200,
    markup: 10,
    markupAmount: 20,
    subtotal: 700,
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
  it('records the method and the send for SMS', async () => {
    renderDialog({ doc: doc({ customerEmail: undefined, customerPhone: '0412345678' }) });
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeTruthy());

    fireEvent.click(screen.getByText('SMS'));

    await waitFor(() => expect(eventProps('quote_send_succeeded')).toBeTruthy());
    expect(eventProps('send_method_chosen')).toEqual({ method: 'sms', doc_type: 'quote' });
    expect(eventProps('quote_send_succeeded')).toEqual({ doc_type: 'quote', method: 'sms', to_self: false });
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
