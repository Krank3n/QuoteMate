// @vitest-environment jsdom
/**
 * The email preview's posture, post Jul 2026 audit.
 *
 * 40 tradies stalled here holding a finished, priced quote with the
 * customer's address on file and no gate in their way. The screen answered
 * "send this" with a writing task: a scripted generating checklist, an
 * editable body with a markdown toolbar, a Test Send button of equal weight
 * to Send (and a dead end — it never records a send), and a $0 warning whose
 * default button was retreat. These tests pin the shape that replaced it.
 *
 * Heavy native/expo dependency graphs are mocked out — same approach as
 * TakePaymentSheet.test.tsx / AuthScreen.forgotPassword.test.tsx.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';

vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: any) => React.createElement('div', null, children),
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  initialWindowMetrics: { insets: { top: 0, bottom: 0, left: 0, right: 0 } },
}));
vi.mock('react-native-paper', () => {
  const TextInput: any = ({ value, onChangeText, multiline, placeholder }: any) =>
    React.createElement(multiline ? 'textarea' : 'input', {
      'data-multiline': multiline ? 'true' : undefined,
      placeholder,
      value: value ?? '',
      onChange: (e: any) => onChangeText?.(e.target.value),
    });
  TextInput.Icon = () => null;
  return {
    // src/theme.ts spreads these at import time.
    DefaultTheme: { colors: {} },
    MD3DarkTheme: { colors: {} },
    Text: ({ children }: any) => React.createElement('span', null, children),
    TextInput,
    Button: ({ children, onPress, disabled }: any) =>
      React.createElement('button', { onClick: onPress, disabled }, children),
    Portal: { Host: ({ children }: any) => React.createElement('div', null, children) },
    Switch: ({ value, onValueChange }: any) =>
      React.createElement('input', {
        type: 'checkbox',
        checked: !!value,
        onChange: (e: any) => onValueChange?.(e.target.checked),
      }),
    ActivityIndicator: () => null,
  };
});
// Renders the two buttons with their hierarchy visible to assertions.
vi.mock('./AlertModal', () => ({
  AlertModal: ({ visible, title, primaryButtonText, primaryButtonAction, secondaryButtonText, secondaryButtonAction }: any) =>
    visible
      ? React.createElement(
          'div',
          { 'data-testid': 'alert' },
          React.createElement('span', null, title),
          React.createElement('button', { 'data-role': 'primary', onClick: primaryButtonAction }, primaryButtonText),
          secondaryButtonText
            ? React.createElement('button', { 'data-role': 'secondary', onClick: secondaryButtonAction }, secondaryButtonText)
            : null,
        )
      : null,
}));
vi.mock('../store/useStore', () => ({ useStore: () => ({ quotes: [] }) }));
vi.mock('../services/analyticsService', () => ({ trackEvent: vi.fn() }));

import { DocumentEmailPreviewModal } from './DocumentEmailPreviewModal';
import { trackEvent } from '../services/analyticsService';
// Resolves to src/test/stubs/firebase.ts via the vitest alias.
import { auth } from '../config/firebase';
import type { Document } from '../types/document';

const tracked = vi.mocked(trackEvent);
const fetchMock = vi.fn();
const OWNER_EMAIL = 'jo@trade.com.au';

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
    job: { name: 'Deck restain' },
    payments: [],
    materials: [{ id: 'm1', name: 'Decking oil', quantity: 2, unit: 'each', price: 60, totalPrice: 120 } as any],
    laborRate: 80,
    laborHours: 6,
    laborTotal: 480,
    materialsSubtotal: 120,
    markup: 10,
    markupAmount: 12,
    subtotal: 612,
    gst: 61,
    total: 673,
    ...overrides,
  } as Document;
}

const EMAIL_BODY = 'Hi Sam,\n\nHere is the quote for the deck restain. Give us a bell if anything needs a tweak.';

function renderModal(overrides: Partial<React.ComponentProps<typeof DocumentEmailPreviewModal>> = {}) {
  const props = {
    visible: true,
    onDismiss: vi.fn(),
    doc: doc(),
    businessSettings: { businessName: 'Hansen Decks' } as any,
    emailBody: EMAIL_BODY,
    onEmailBodyChange: vi.fn(),
    subject: 'Quotation from Hansen Decks - Deck restain',
    onSubjectChange: vi.fn(),
    onRegenerate: vi.fn(),
    onSent: vi.fn(),
    onMoreWaysToSend: vi.fn(),
    isPro: true,
    isRegenerating: false,
    ...overrides,
  };
  return { ...render(<DocumentEmailPreviewModal {...props} />), props };
}

function eventProps(name: string) {
  return tracked.mock.calls.find(([event]) => event === name)?.[1] as any;
}

const bodyEditor = () => document.querySelector('textarea');

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal('fetch', fetchMock);
  (auth as any).currentUser = {
    uid: 'test-uid',
    email: OWNER_EMAIL,
    getIdToken: vi.fn(async () => 'test-token'),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('default posture', () => {
  it('shows the email as a read-only preview, not an editor', () => {
    renderModal();

    expect(screen.getByText(/Here is the quote for the deck restain/)).toBeTruthy();
    expect(bodyEditor()).toBeNull();
  });

  it('keeps the markdown toolbar out of the default view', () => {
    renderModal();

    expect(screen.queryByText(/\*\*bold\*\*/)).toBeNull();
    expect(screen.queryByLabelText('Bold')).toBeNull();
  });

  it('leads with one prominent Send', () => {
    renderModal();

    const send = screen.getByText('Send Quote');
    expect(send.tagName).toBe('BUTTON');
  });
});

describe('editing the body', () => {
  it('opens the editor and the formatting toolbar behind "Edit email"', () => {
    renderModal();

    fireEvent.click(screen.getByText('Edit email'));

    expect(bodyEditor()).toBeTruthy();
    expect(screen.getByText(/\*\*bold\*\*/)).toBeTruthy();
  });

  it('still edits the body for real', () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByText('Edit email'));

    fireEvent.change(bodyEditor()!, { target: { value: 'Rewritten by hand' } });

    expect(props.onEmailBodyChange).toHaveBeenCalledWith('Rewritten by hand');
  });

  it('Done returns to the read-only posture', () => {
    renderModal();
    fireEvent.click(screen.getByText('Edit email'));

    fireEvent.click(screen.getByText('Done'));

    expect(bodyEditor()).toBeNull();
    expect(screen.getByText('Send Quote')).toBeTruthy();
  });

  it('offers Regenerate inside edit mode only', () => {
    renderModal();
    expect(screen.queryByText('Regenerate')).toBeNull();

    fireEvent.click(screen.getByText('Edit email'));

    expect(screen.getByText('Regenerate')).toBeTruthy();
  });
});

describe('waiting for a body', () => {
  it('shows an honest indeterminate state, never a scripted checklist', () => {
    renderModal({ isRegenerating: true });

    expect(screen.getByText('Writing your email…')).toBeTruthy();
    expect(screen.queryByText(/Reading quote details/)).toBeNull();
    expect(screen.queryByText(/Crafting email tone/)).toBeNull();
    expect(screen.queryByText(/Finalizing/)).toBeNull();
  });
});

describe('Test Send', () => {
  it('is a link, not a button competing with Send', () => {
    renderModal();

    const testSend = screen.getByText('Send a test to myself');
    expect(testSend.closest('button')).toBeNull();
    // Send remains the only real button in the footer.
    expect(screen.getByText('Send Quote').tagName).toBe('BUTTON');
  });

  it('still sends a test to the account email', async () => {
    renderModal();

    fireEvent.click(screen.getByText('Send a test to myself'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.isTestSend).toBe(true);
    expect(body.recipientEmail).toBe(OWNER_EMAIL);
    // A test is not a send: it must never be counted as one.
    expect(tracked.mock.calls.map(([e]) => e)).not.toContain('quote_send_succeeded');
  });
});

describe('the $0 line-item guard', () => {
  const unpricedDoc = () =>
    doc({
      materials: [
        { id: 'm1', name: 'Handrail supply', quantity: 1, unit: 'each', price: 0, totalPrice: 0 } as any,
      ],
    });

  it('still warns before sending', async () => {
    renderModal({ doc: unpricedDoc() });

    fireEvent.click(screen.getByText('Send Quote'));

    await waitFor(() => expect(screen.getByTestId('alert')).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leads with "Send anyway" and demotes "Go back and fix"', async () => {
    renderModal({ doc: unpricedDoc() });

    fireEvent.click(screen.getByText('Send Quote'));

    await waitFor(() => expect(screen.getByText('Send anyway')).toBeTruthy());
    expect(screen.getByText('Send anyway').getAttribute('data-role')).toBe('primary');
    expect(screen.getByText('Go back and fix').getAttribute('data-role')).toBe('secondary');
  });

  it('sends when the warning is accepted', async () => {
    renderModal({ doc: unpricedDoc() });
    fireEvent.click(screen.getByText('Send Quote'));
    await waitFor(() => expect(screen.getByText('Send anyway')).toBeTruthy());

    fireEvent.click(screen.getByText('Send anyway'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).isTestSend).toBeUndefined();
  });
});

describe('a successful send', () => {
  it('reports the send and tells the host', async () => {
    const { props } = renderModal();

    fireEvent.click(screen.getByText('Send Quote'));

    await waitFor(() => expect(props.onSent).toHaveBeenCalledTimes(1));
    expect(eventProps('quote_send_succeeded')).toEqual({
      doc_type: 'quote',
      method: 'email',
      to_self: false,
    });
  });

  it('flags a send to the tradie’s own inbox as a self-send', async () => {
    renderModal({ doc: doc({ customerEmail: OWNER_EMAIL }) });

    fireEvent.click(screen.getByText('Send Quote'));

    await waitFor(() => expect(eventProps('quote_send_succeeded')).toBeTruthy());
    expect(eventProps('quote_send_succeeded').to_self).toBe(true);
  });

  it('does not count as an abandonment when the confirmation is closed', async () => {
    renderModal();
    fireEvent.click(screen.getByText('Send Quote'));
    await waitFor(() => expect(screen.getByText('Quote Sent!')).toBeTruthy());

    fireEvent.click(screen.getByText('Done'));

    expect(tracked.mock.calls.map(([e]) => e)).not.toContain('email_preview_abandoned');
  });
});

describe('abandonment', () => {
  it('reports a close with nothing sent', () => {
    renderModal();

    fireEvent.click(screen.getByText('Back'));

    expect(eventProps('email_preview_abandoned')).toEqual({
      doc_type: 'quote',
      had_recipient: true,
      edited_body: false,
    });
  });

  it('records whether they had an address and touched the body', () => {
    renderModal({ doc: doc({ customerEmail: undefined }) });
    fireEvent.click(screen.getByText('Edit email'));
    fireEvent.change(bodyEditor()!, { target: { value: 'Reworded' } });
    fireEvent.click(screen.getByText('Done'));

    fireEvent.click(screen.getByText('Back'));

    expect(eventProps('email_preview_abandoned')).toEqual({
      doc_type: 'quote',
      had_recipient: false,
      edited_body: true,
    });
  });
});

describe('More ways to send', () => {
  it('hands SMS / Share / Export PDF back to the host', () => {
    const { props } = renderModal();

    fireEvent.click(screen.getByText('More ways to send'));

    expect(props.onMoreWaysToSend).toHaveBeenCalledTimes(1);
  });

  it('is absent when the host offers no other channels', () => {
    renderModal({ onMoreWaysToSend: undefined });

    expect(screen.queryByText('More ways to send')).toBeNull();
  });
});
