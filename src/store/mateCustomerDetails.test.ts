// @vitest-environment jsdom
/**
 * An email handed over mid-pricing has to reach the customer.
 *
 * 23 Sep 2026: Mate asked "got a mobile or email for Wilkens Contracting?"
 * while pricing ran, got "wilkens@outlook.com", said "I'll pop that on" — and
 * put up a customer card re-pointing the quote at the contact it was already
 * for, with no email on it. propose_update_customer could only change WHO a
 * quote is for, never add to that person, so the one thing the contact ask
 * exists to collect was dropped and the quote could not be sent.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) },
}));
vi.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: vi.fn(async () => {}),
  deactivateKeepAwake: vi.fn(async () => {}),
}));
vi.mock('expo-constants', () => ({ default: { expoConfig: {} } }));
vi.mock('expo-haptics', () => ({ impactAsync: vi.fn(), notificationAsync: vi.fn(), selectionAsync: vi.fn(), ImpactFeedbackStyle: {}, NotificationFeedbackType: {} }));
vi.mock('expo-file-system', () => ({ documentDirectory: '/tmp/', cacheDirectory: '/tmp/', writeAsStringAsync: vi.fn(), readAsStringAsync: vi.fn(), getInfoAsync: vi.fn(), EncodingType: { UTF8: 'utf8', Base64: 'base64' } }));
vi.mock('expo-print', () => ({ printToFileAsync: vi.fn() }));
vi.mock('expo-sharing', () => ({ shareAsync: vi.fn(), isAvailableAsync: vi.fn(async () => false) }));
vi.mock('expo-store-review', () => ({ requestReview: vi.fn(), hasAction: vi.fn(async () => false), isAvailableAsync: vi.fn(async () => false) }));
vi.mock('expo-web-browser', () => ({ openBrowserAsync: vi.fn(), openAuthSessionAsync: vi.fn(), maybeCompleteAuthSession: vi.fn() }));
vi.mock('expo-auth-session', () => ({ makeRedirectUri: vi.fn(() => 'redirect://'), useAuthRequest: vi.fn(), AuthRequest: class {}, ResponseType: {} }));
vi.mock('expo-crypto', () => ({ digestStringAsync: vi.fn(async () => 'hash'), CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, randomUUID: vi.fn(() => 'uuid') }));
vi.mock('expo-contacts', () => ({ requestPermissionsAsync: vi.fn(), getContactsAsync: vi.fn() }));
vi.mock('expo-av', () => ({ Audio: { Sound: class {}, setAudioModeAsync: vi.fn() } }));
vi.mock('expo-image-manipulator', () => ({ manipulateAsync: vi.fn(), SaveFormat: {} }));
vi.mock('expo-mail-composer', () => ({ composeAsync: vi.fn(), isAvailableAsync: vi.fn(async () => false) }));
vi.mock('../services/sectionTemplateService', () => ({ loadTemplates: vi.fn(async () => []) }));
vi.mock('../services/documentService', () => ({
  documentService: { getDocumentById: vi.fn(async () => null), saveDocument: vi.fn(async () => {}) },
}));

import { useStore } from './useStore';
import type { Contact } from '../types';
import type { Document } from '../types/document';

const base = { id: 'p1', toolUseId: 't1', createdAt: '2026-09-23T05:04:27Z' };

const wilkens = (extra: Partial<Contact> = {}): Contact => ({
  id: 'c-wilkens',
  name: 'Wilkens Contracting',
  source: 'manual',
  createdAt: '2026-09-23T05:02:25Z',
  updatedAt: '2026-09-23T05:02:25Z',
  ...extra,
} as Contact);

const doc = (extra: Partial<Document> = {}): Document =>
  ({
    id: 'doc-1',
    type: 'quote',
    stage: 'draft',
    number: 'Q-001',
    contactId: 'c-wilkens',
    customerName: 'Wilkens Contracting',
    materials: [],
    total: 3977,
    ...extra,
  }) as unknown as Document;

let saveContact: ReturnType<typeof vi.fn>;
let saveDocument: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  saveContact = vi.fn(async (c: Contact) =>
    useStore.setState((s: any) => ({ contacts: [...s.contacts.filter((x: Contact) => x.id !== c.id), c] })),
  );
  saveDocument = vi.fn(async (d: Document) =>
    useStore.setState((s: any) => ({ documents: [...s.documents.filter((x: Document) => x.id !== d.id), d] })),
  );
  useStore.setState({
    contacts: [wilkens()],
    quotes: [],
    invoices: [],
    documents: [doc()],
    getEffectivePlan: () => 'pro',
    saveContact,
    saveDocument,
  } as any);
});

const addDetails = (extra: Record<string, unknown>) =>
  useStore.getState().applyProposal({ ...base, type: 'propose_update_customer', quoteId: 'doc-1', ...extra } as any);

describe('propose_update_customer with just an email or phone', () => {
  it('puts the email on the contact the quote is already for, and on the quote', async () => {
    const result = await addDetails({ email: 'wilkens@outlook.com' });

    expect(result.ok).toBe(true);
    expect(saveContact).toHaveBeenCalledWith(expect.objectContaining({ id: 'c-wilkens', email: 'wilkens@outlook.com' }));
    const saved = saveDocument.mock.calls.at(-1)![0] as Document;
    expect(saved).toMatchObject({ contactId: 'c-wilkens', customerName: 'Wilkens Contracting', customerEmail: 'wilkens@outlook.com' });
  });

  it('a phone the same way, keeping the email already there', async () => {
    useStore.setState({ contacts: [wilkens({ email: 'office@wilkens.com.au' })] } as any);
    await addDetails({ phone: '0412 345 678' });
    const saved = saveDocument.mock.calls.at(-1)![0] as Document;
    expect(saved).toMatchObject({ customerEmail: 'office@wilkens.com.au', customerPhone: '0412 345 678' });
  });

  it('a different email replaces the primary — and never lingers as a second recipient', async () => {
    useStore.setState({ contacts: [wilkens({ email: 'old@wilkens.com.au', additionalEmails: ['wilkens@outlook.com', 'accounts@wilkens.com.au'] })] } as any);
    await addDetails({ email: 'wilkens@outlook.com' });
    const contact = useStore.getState().contacts.find((c) => c.id === 'c-wilkens')!;
    expect(contact.email).toBe('wilkens@outlook.com');
    expect(contact.additionalEmails).toEqual(['accounts@wilkens.com.au']);
  });

  it('the same email again changes nothing on the contact', async () => {
    useStore.setState({ contacts: [wilkens({ email: 'wilkens@outlook.com' })] } as any);
    await addDetails({ email: 'Wilkens@Outlook.com' });
    expect(saveContact).not.toHaveBeenCalled();
    expect((saveDocument.mock.calls.at(-1)![0] as Document).customerEmail).toBe('wilkens@outlook.com');
  });

  it('no contact linked yet: the quote’s customer name becomes one, carrying the email', async () => {
    useStore.setState({ contacts: [], documents: [doc({ contactId: undefined })] } as any);
    const result = await addDetails({ email: 'wilkens@outlook.com' });
    expect(result.ok).toBe(true);
    const saved = saveDocument.mock.calls.at(-1)![0] as Document;
    expect(saved.customerName).toBe('Wilkens Contracting');
    expect(saved.customerEmail).toBe('wilkens@outlook.com');
    expect(saved.contactId).toBeTruthy();
  });

  it('nobody on the quote at all: asks who it’s for instead of inventing a contact', async () => {
    useStore.setState({ contacts: [], documents: [doc({ contactId: undefined, customerName: '' })] } as any);
    const result = await addDetails({ email: 'someone@example.com' });
    expect(result.ok).toBe(false);
    expect(saveDocument).not.toHaveBeenCalled();
  });

  it('re-pointing at someone else still works, and carries the details onto them', async () => {
    useStore.setState({ contacts: [wilkens(), { ...wilkens(), id: 'c-jane', name: 'Jane Cooper' }] } as any);
    await addDetails({ customerId: 'c-jane', email: 'jane@example.com' });
    const saved = saveDocument.mock.calls.at(-1)![0] as Document;
    expect(saved).toMatchObject({ contactId: 'c-jane', customerName: 'Jane Cooper', customerEmail: 'jane@example.com' });
  });
});
