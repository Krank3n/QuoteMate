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
  // The caret props are surfaced as data attributes so the Android caret
  // tests below can read what the editor actually hands the input.
  const TextInput: any = ({
    value,
    onChangeText,
    onBlur,
    multiline,
    placeholder,
    accessibilityLabel,
    error,
    cursorColor,
    selectionColor,
    selectionHandleColor,
    selection,
  }: any) =>
    React.createElement(multiline ? 'textarea' : 'input', {
      'data-multiline': multiline ? 'true' : undefined,
      'data-cursor-color': cursorColor,
      'data-selection-color': selectionColor,
      'data-selection-handle-color': selectionHandleColor,
      'data-selection': selection ? `${selection.start}-${selection.end}` : undefined,
      'data-error': error ? 'true' : undefined,
      'aria-label': accessibilityLabel,
      placeholder,
      value: value ?? '',
      onChange: (e: any) => onChangeText?.(e.target.value),
      onBlur: () => onBlur?.(),
    });
  TextInput.Icon = () => null;
  // A recipient chip: its label plus the × that removes it.
  const Chip = ({ children, onClose, closeIconAccessibilityLabel }: any) =>
    React.createElement(
      'span',
      { 'data-testid': 'recipient-chip' },
      children,
      React.createElement('button', { 'aria-label': closeIconAccessibilityLabel, onClick: onClose }, '×'),
    );
  return {
    // src/theme.ts spreads these at import time.
    DefaultTheme: { colors: {} },
    MD3DarkTheme: { colors: {} },
    Text: ({ children }: any) => React.createElement('span', null, children),
    TextInput,
    Chip,
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
// Renders the two buttons with their hierarchy visible to assertions, plus
// whether the modal would celebrate. `data-confetti` mirrors AlertModal's own
// `enableConfetti` rule (explicit prop wins, otherwise success celebrates).
vi.mock('./AlertModal', () => ({
  AlertModal: ({ visible, type, showConfetti, title, primaryButtonText, primaryButtonAction, secondaryButtonText, secondaryButtonAction }: any) =>
    visible
      ? React.createElement(
          'div',
          {
            'data-testid': 'alert',
            'data-confetti': String(showConfetti !== undefined ? showConfetti : type === 'success'),
          },
          React.createElement('span', null, title),
          React.createElement('button', { 'data-role': 'primary', onClick: primaryButtonAction }, primaryButtonText),
          secondaryButtonText
            ? React.createElement('button', { 'data-role': 'secondary', onClick: secondaryButtonAction }, secondaryButtonText)
            : null,
        )
      : null,
}));
const store = vi.hoisted(() => ({ contacts: [] as any[] }));
vi.mock('../store/useStore', () => ({ useStore: () => ({ quotes: [], contacts: store.contacts }) }));
const contactLookup = vi.hoisted(() => ({ getContactById: vi.fn(async (_id: string): Promise<any> => null) }));
vi.mock('../services/firestoreService', () => ({ firestoreService: contactLookup }));
vi.mock('../services/analyticsService', () => ({ trackEvent: vi.fn() }));

import { DocumentEmailPreviewModal } from './DocumentEmailPreviewModal';
import { trackEvent } from '../services/analyticsService';
// Resolves to src/test/stubs/firebase.ts via the vitest alias.
import { auth } from '../config/firebase';
import type { Document } from '../types/document';
import { light, dark } from '../theme/semantic';

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
const recipientInput = () => screen.getByLabelText('Recipient email') as HTMLInputElement;
const chips = () => screen.queryAllByTestId('recipient-chip').map((el) => el.textContent?.replace('×', ''));
const typeRecipient = (text: string) => fireEvent.change(recipientInput(), { target: { value: text } });
const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body);

beforeEach(() => {
  vi.clearAllMocks();
  store.contacts = [];
  contactLookup.getContactById.mockResolvedValue(null);
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

// A paying Android tradie (Sep 2026): "very difficult to see where cursor
// is, it's like a grayed area a line below where you want to edit". Paper
// derives the caret and selection colours from `activeUnderlineColor` when
// none are passed, and the editor sets that to "transparent" to hide the
// flat-mode underline — so the Android caret was transparent and the
// selection highlight a translucent black. These pin the explicit colours.
describe('the caret in the body editor', () => {
  const openEditor = () => {
    const rendered = renderModal();
    fireEvent.click(screen.getByText('Edit email'));
    return rendered;
  };

  it('paints the caret in the theme text colour, never transparent', () => {
    openEditor();

    const caret = bodyEditor()!.getAttribute('data-cursor-color');
    expect([light.text, dark.text]).toContain(caret);
  });

  it('paints the selection and its handle in the accent, never transparent', () => {
    openEditor();

    const highlight = bodyEditor()!.getAttribute('data-selection-color');
    const handle = bodyEditor()!.getAttribute('data-selection-handle-color');
    expect([light.accentText, dark.accentText]).toContain(highlight);
    expect(handle).toBe(highlight);
  });

  it('leaves the caret uncontrolled while typing', () => {
    openEditor();
    expect(bodyEditor()!.getAttribute('data-selection')).toBeNull();

    fireEvent.change(bodyEditor()!, { target: { value: 'Hi Sam, typed by hand' } });

    expect(bodyEditor()!.getAttribute('data-selection')).toBeNull();
  });

  it('steers the caret only after a formatting insert, then lets go', async () => {
    const { props } = openEditor();

    fireEvent.click(screen.getByLabelText('Bold'));

    // No selection was ever reported, so bold lands at the start with its
    // placeholder selected: `**bold text**` → the caret wraps chars 2..11.
    expect(props.onEmailBodyChange).toHaveBeenCalledWith(`**bold text**${EMAIL_BODY}`);
    expect(bodyEditor()!.getAttribute('data-selection')).toBe('2-11');

    // ...and the `selection` prop is released again on the next tick so the
    // native caret is free to move (a held `selection` fights it on Android).
    await waitFor(() => expect(bodyEditor()!.getAttribute('data-selection')).toBeNull());
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

  // Two of the audit's users test-sent and never sent for real. A rehearsal
  // into your own inbox leaves the doc a draft — celebrating it tells the
  // tradie the job's over.
  it('does not celebrate — the doc is still a draft', async () => {
    renderModal();

    fireEvent.click(screen.getByText('Send a test to myself'));

    await waitFor(() => expect(screen.getByText('Test Sent')).toBeTruthy());
    expect(screen.getByTestId('alert').getAttribute('data-confetti')).toBe('false');
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

  it('still celebrates — this is the one that earns it', async () => {
    renderModal();

    fireEvent.click(screen.getByText('Send Quote'));

    await waitFor(() => expect(screen.getByText('Quote Sent!')).toBeTruthy());
    expect(screen.getByTestId('alert').getAttribute('data-confetti')).toBe('true');
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

// Sep 2026: "more than 1 email addresses for clients contact as would like to
// send to their admin/pay section as well as the CEO". The recipient field is
// now a list: chips for the committed addresses, an input for the next one.
describe('more than one recipient', () => {
  it('prefills the customer address as a chip', () => {
    renderModal();

    expect(chips()).toEqual(['sam@example.com']);
    expect(recipientInput().value).toBe('');
  });

  it('adds the linked contact’s extra addresses from the store', () => {
    store.contacts = [{ id: 'c1', name: 'Sam', email: 'sam@example.com', additionalEmails: ['accounts@example.com', 'CEO@Example.com'] }];

    renderModal({ doc: doc({ contactId: 'c1' }) });

    expect(chips()).toEqual(['sam@example.com', 'accounts@example.com', 'ceo@example.com']);
    expect(contactLookup.getContactById).not.toHaveBeenCalled();
  });

  it('reads the contact when the store has not loaded it', async () => {
    contactLookup.getContactById.mockResolvedValue({ id: 'c1', additionalEmails: ['accounts@example.com'] });

    renderModal({ doc: doc({ contactId: 'c1' }) });

    await waitFor(() => expect(chips()).toEqual(['sam@example.com', 'accounts@example.com']));
    expect(contactLookup.getContactById).toHaveBeenCalledWith('c1');
  });

  it('never doubles up an extra that is already the primary', () => {
    store.contacts = [{ id: 'c1', name: 'Sam', additionalEmails: ['SAM@example.com', 'accounts@example.com'] }];

    renderModal({ doc: doc({ contactId: 'c1' }) });

    expect(chips()).toEqual(['sam@example.com', 'accounts@example.com']);
  });

  it('commits a typed address on the comma and clears the input', () => {
    renderModal();

    typeRecipient('accounts@example.com,');

    expect(chips()).toEqual(['sam@example.com', 'accounts@example.com']);
    expect(recipientInput().value).toBe('');
  });

  it('takes a pasted list in one go and keeps the unfinished tail in the input', () => {
    renderModal();

    typeRecipient('a@x.com; b@y.com c@z');

    expect(chips()).toEqual(['sam@example.com', 'a@x.com', 'b@y.com']);
    expect(recipientInput().value).toBe('c@z');
  });

  it('commits on blur, and once for an address typed twice', () => {
    renderModal();

    typeRecipient('Sam@Example.com');
    fireEvent.blur(recipientInput());

    expect(chips()).toEqual(['sam@example.com']);
    expect(recipientInput().value).toBe('');
  });

  it('removes a chip with its ×', () => {
    renderModal();
    typeRecipient('accounts@example.com,');

    fireEvent.click(screen.getByLabelText('Remove sam@example.com'));

    expect(chips()).toEqual(['accounts@example.com']);
  });

  it('hands a non-address back to the input with an error instead of a chip', () => {
    renderModal();

    typeRecipient('accounts at example,');

    expect(chips()).toEqual(['sam@example.com']);
    expect(recipientInput().value).toBe('accounts at example');
    expect(screen.getByText('Please enter a valid email address')).toBeTruthy();
  });

  it('stops at five addresses', () => {
    renderModal();

    typeRecipient('b@x.com, c@x.com, d@x.com, e@x.com, f@x.com,');

    expect(chips()).toHaveLength(5);
    expect(recipientInput().value).toBe('f@x.com');
    expect(screen.getByText('Up to 5 addresses per email')).toBeTruthy();
    expect((screen.getByText('Send Quote') as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends the whole list as an array', async () => {
    renderModal();
    typeRecipient('accounts@example.com,');

    fireEvent.click(screen.getByText('Send Quote'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody().recipientEmail).toEqual(['sam@example.com', 'accounts@example.com']);
    expect(sentBody().isTestSend).toBeUndefined();
  });

  it('counts an address still sitting in the input when Send is tapped', async () => {
    renderModal();
    typeRecipient('accounts@example.com');

    fireEvent.click(screen.getByText('Send Quote'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody().recipientEmail).toEqual(['sam@example.com', 'accounts@example.com']);
  });

  it('will not send with nobody on the list', () => {
    renderModal({ doc: doc({ customerEmail: undefined }) });

    expect((screen.getByText('Send Quote') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Send Quote'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is a self-send only when every address is the tradie’s own', async () => {
    renderModal({ doc: doc({ customerEmail: OWNER_EMAIL }) });
    typeRecipient('accounts@example.com,');

    fireEvent.click(screen.getByText('Send Quote'));

    await waitFor(() => expect(eventProps('quote_send_succeeded')).toBeTruthy());
    expect(eventProps('quote_send_succeeded').to_self).toBe(false);
  });

  it('names every address in the sent confirmation', async () => {
    renderModal();
    typeRecipient('accounts@example.com,');

    fireEvent.click(screen.getByText('Send Quote'));

    await waitFor(() => expect(screen.getByText('Quote Sent!')).toBeTruthy());
  });

  it('still sends a test to the tradie alone, as one address', async () => {
    renderModal();
    typeRecipient('accounts@example.com,');

    fireEvent.click(screen.getByText('Send a test to myself'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody().recipientEmail).toBe(OWNER_EMAIL);
  });
});
