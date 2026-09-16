// @vitest-environment jsdom
/**
 * The store's legacy saves never rewind a document's stage.
 *
 * The bug this pins (16 Sep 2026): after an email send the server stamped
 * status 'sent' on the legacy quote row, but the preview screen was still
 * holding its pre-send copy marked 'draft' — the realtime listener refreshes
 * the quotes list, never `currentQuote`. Its next save wrote 'draft' straight
 * back. The unified row kept `quote_sent` (the mirror refuses downgrades), so
 * the admin said "sent" while anything reading the legacy status — the
 * customer follow-up scheduler included — saw a draft. 60 of 208 sent quotes.
 *
 * Same harness as coldStartHydration.test.ts: the store's import graph reaches
 * most expo-* native modules and Firestore, none of which matter here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { storage, authState, firestoreService } = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  authState: { currentUser: { uid: 'u1' } as { uid: string } | null },
  firestoreService: {
    saveQuote: vi.fn(async () => {}),
    saveInvoice: vi.fn(async () => {}),
    loadOnboardingStatus: vi.fn(async () => null),
    saveOnboardingStatus: vi.fn(async () => {}),
    loadQuotes: vi.fn(async () => null),
    loadBusinessSettings: vi.fn(async () => null),
    saveBusinessSettings: vi.fn(async () => {}),
    loadQuoteCounterFloor: vi.fn(async () => null),
  },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => (storage.has(k) ? storage.get(k)! : null)),
    setItem: vi.fn(async (k: string, v: string) => { storage.set(k, v); }),
    removeItem: vi.fn(async (k: string) => { storage.delete(k); }),
    multiRemove: vi.fn(async (ks: string[]) => { ks.forEach((k) => storage.delete(k)); }),
  },
}));

vi.mock('../config/firebase', () => ({
  auth: authState,
  db: {},
  storage: {},
  functions: {},
  default: {},
}));

vi.mock('../services/firestoreService', () => ({ firestoreService }));

// The saves ensure a Job exists for the record first; that is Firestore work
// with its own tests, and irrelevant to which status reaches the write.
vi.mock('./useJobStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useJobStore')>()),
  ensureJobForQuote: vi.fn(async (record: unknown) => record),
  ensureJobForDocument: vi.fn(async (record: unknown) => record),
}));

vi.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: vi.fn(async () => {}), deactivateKeepAwake: vi.fn(async () => {}) }));
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

import { useStore } from './useStore';

/** The preview screen's copy: everything the server knows, except the send. */
const staleQuote = () => ({
  id: 'q1',
  quoteNumber: 'Q-q1',
  jobId: 'j1',
  createdAt: new Date('2026-09-12T23:00:00Z'),
  updatedAt: new Date('2026-09-12T23:32:00Z'),
  customerName: 'Jodie',
  customerEmail: 'jodie@example.com',
  job: { name: 'Paving removal', description: 'Excavate and remove existing paving', estimatedHours: 2 },
  materials: [],
  sections: [],
  laborRate: 85,
  laborHours: 2,
  laborTotal: 170,
  materialsSubtotal: 0,
  markup: 30,
  laborMarkup: 30,
  markupAmount: 0,
  subtotal: 170,
  gst: 17,
  total: 187,
  status: 'draft',
});

/** The unified row after the server's send. */
const sentDocument = () => ({
  id: 'q1',
  number: 'Q-q1',
  type: 'quote',
  stage: 'quote_sent',
  jobId: 'j1',
  createdAt: Date.parse('2026-09-12T23:00:00Z'),
  updatedAt: Date.parse('2026-09-12T23:32:30Z'),
  sentAt: Date.parse('2026-09-12T23:32:30Z'),
  payments: [],
  paidTotal: 0,
  balanceDue: 221,
  materials: [],
  sections: [],
  total: 221,
});

const staleInvoice = () => ({
  id: 'i1',
  invoiceNumber: 'INV-1',
  jobId: 'j1',
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
  issueDate: new Date('2026-09-01T00:00:00Z'),
  dueDate: new Date('2026-09-15T00:00:00Z'),
  customerName: 'Jodie',
  job: { name: 'Paving removal', description: 'Excavate and remove existing paving', estimatedHours: 2 },
  materials: [],
  sections: [],
  laborRate: 85,
  laborHours: 2,
  laborTotal: 170,
  materialsSubtotal: 0,
  markup: 0,
  markupAmount: 0,
  subtotal: 170,
  gst: 17,
  total: 500,
  paidAmount: 0,
  status: 'draft',
});

const sentInvoiceDocument = () => ({
  id: 'i1',
  number: 'INV-1',
  type: 'invoice',
  stage: 'invoice_sent',
  jobId: 'j1',
  createdAt: Date.parse('2026-09-01T00:00:00Z'),
  updatedAt: Date.parse('2026-09-02T00:00:00Z'),
  sentAt: Date.parse('2026-09-02T00:00:00Z'),
  payments: [],
  paidTotal: 0,
  balanceDue: 500,
  materials: [],
  sections: [],
  total: 500,
});

const lastWrittenQuote = () => firestoreService.saveQuote.mock.calls.at(-1)![0] as any;
const lastWrittenInvoice = () => firestoreService.saveInvoice.mock.calls.at(-1)![0] as any;

beforeEach(() => {
  storage.clear();
  vi.clearAllMocks();
  authState.currentUser = { uid: 'u1' };
  useStore.setState({
    quotes: [staleQuote()],
    currentQuote: staleQuote(),
    documents: [sentDocument(), sentInvoiceDocument()],
    invoices: [staleInvoice()],
    pendingQuoteWrites: {},
    pendingInvoiceWrites: {},
    lastSyncError: null,
  } as any);
});

describe('legacy quote saves hold the unified stage', () => {
  it('REGRESSION: saveDraft from the pre-send copy writes sent, not draft', async () => {
    await useStore.getState().saveDraft(staleQuote() as any);

    expect(firestoreService.saveQuote).toHaveBeenCalledTimes(1);
    expect(lastWrittenQuote().status).toBe('sent');
  });

  it('REGRESSION: saveQuote from the pre-send copy writes sent, not draft', async () => {
    await useStore.getState().saveQuote(staleQuote() as any);

    expect(firestoreService.saveQuote).toHaveBeenCalledTimes(1);
    expect(lastWrittenQuote().status).toBe('sent');
  });

  it('the stale copy heals in local state too', async () => {
    await useStore.getState().saveDraft(staleQuote() as any);

    expect(useStore.getState().currentQuote?.status).toBe('sent');
    expect(useStore.getState().quotes.find((q) => q.id === 'q1')?.status).toBe('sent');
  });

  it('the edit itself still lands — only the status is held', async () => {
    await useStore.getState().saveDraft({ ...staleQuote(), notes: 'Gate hinges to be galvanised' } as any);

    expect(lastWrittenQuote().notes).toBe('Gate hinges to be galvanised');
    expect(lastWrittenQuote().status).toBe('sent');
  });

  it('a deliberate rewind (Undo "marked sent", back to draft) still writes draft', async () => {
    await useStore.getState().saveQuote(staleQuote() as any, { stageChange: true });

    expect(lastWrittenQuote().status).toBe('draft');
  });

  it('a forward move is never held back', async () => {
    await useStore.getState().saveQuote({ ...staleQuote(), status: 'accepted' } as any);

    expect(lastWrittenQuote().status).toBe('accepted');
  });

  it('a quote with no unified row yet saves exactly what it was given', async () => {
    useStore.setState({ documents: [] } as any);

    await useStore.getState().saveDraft(staleQuote() as any);

    expect(lastWrittenQuote().status).toBe('draft');
  });
});

describe('legacy invoice saves hold the unified stage', () => {
  it('REGRESSION: saveInvoice from the pre-send copy writes sent, not draft', async () => {
    await useStore.getState().saveInvoice(staleInvoice() as any);

    expect(firestoreService.saveInvoice).toHaveBeenCalledTimes(1);
    expect(lastWrittenInvoice().status).toBe('sent');
  });

  it('a stale sent copy saved after a part payment keeps partial', async () => {
    useStore.setState({
      documents: [{ ...sentInvoiceDocument(), stage: 'partially_paid', paidTotal: 200, balanceDue: 300 }],
    } as any);

    await useStore.getState().saveInvoice({ ...staleInvoice(), status: 'sent' } as any);

    expect(lastWrittenInvoice().status).toBe('partial');
  });

  it('a deliberate rewind still writes draft', async () => {
    await useStore.getState().saveInvoice(staleInvoice() as any, { stageChange: true });

    expect(lastWrittenInvoice().status).toBe('draft');
  });
});
