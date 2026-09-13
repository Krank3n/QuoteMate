// @vitest-environment jsdom
/**
 * Every delete of a quote or invoice writes one `quote_deleted` row naming
 * the screen that did it. 13 Sep 2026: a new tradie's first two Mate quotes
 * were deleted 11 s after a foreground and the data could not say which of
 * the four delete paths did it, because none of them tracked anything.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) },
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
vi.mock('../services/sectionTemplateService', () => ({ loadTemplates: vi.fn(async () => []) }));
vi.mock('../services/analyticsService', () => ({ trackEvent: vi.fn() }));
vi.mock('../config/firebase', () => ({ auth: { currentUser: { uid: 'u1' } }, db: {} }));
vi.mock('../services/firestoreService', () => ({
  firestoreService: {
    deleteQuote: vi.fn(async () => { throw new Error('offline'); }),
    deleteInvoice: vi.fn(async () => {}),
  },
}));

import { useStore } from './useStore';
import { trackEvent } from '../services/analyticsService';
import { firestoreService } from '../services/firestoreService';
import type { Invoice, Quote } from '../types';

const tracked = vi.mocked(trackEvent);
const HOURS_AGO_3 = new Date(Date.now() - 3 * 3600e3);

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({
    quotes: [
      { id: 'q-brian', status: 'draft', draftStep: 'JobPreview', createdAt: HOURS_AGO_3, total: 23100, materials: [{}, {}], customerEmail: '', job: { id: 'j1', name: 'Exposed aggregate', description: '' } } as unknown as Quote,
    ],
    invoices: [
      { id: 'inv-1', status: 'sent', createdAt: HOURS_AGO_3, total: 960, customerEmail: 'x@y.z', sentAt: Date.now() - 60e3 } as unknown as Invoice,
    ],
    documents: [],
  } as any);
});

describe('quote_deleted', () => {
  it('a job-cascade delete of a Mate draft writes one row naming the source and what died', async () => {
    await useStore.getState().deleteQuote('q-brian', 'job_cascade');
    expect(tracked).toHaveBeenCalledTimes(1);
    const [event, props] = tracked.mock.calls[0];
    expect(event).toBe('quote_deleted');
    expect(props).toMatchObject({
      doc_type: 'quote',
      doc_id: 'q-brian',
      source: 'job_cascade',
      stage: 'draft',
      draft_step: 'JobPreview',
      was_sent: false,
      total: 23100,
      material_count: 2,
      has_customer_email: false,
      record_found: true,
    });
    expect(props?.age_hours).toBeCloseTo(3, 0);
    expect(useStore.getState().quotes).toHaveLength(0);
  });

  it('the row is written before the cloud delete, so an offline delete still shows up', async () => {
    const order: string[] = [];
    tracked.mockImplementation(() => { order.push('tracked'); });
    vi.mocked(firestoreService.deleteQuote).mockImplementation(async () => { order.push('cloud'); throw new Error('offline'); });
    await useStore.getState().deleteQuote('q-brian', 'dashboard_quote_card');
    expect(order).toEqual(['tracked', 'cloud']);
  });

  it('an invoice delete is the same event with doc_type invoice and was_sent from its history', async () => {
    await useStore.getState().deleteInvoice('inv-1', 'mate_proposal');
    expect(tracked).toHaveBeenCalledWith('quote_deleted', expect.objectContaining({
      doc_type: 'invoice', doc_id: 'inv-1', source: 'mate_proposal', was_sent: true, has_customer_email: true,
    }));
  });

  it('a caller that does not name itself is recorded as unknown, and an id with no local record still gets a row', async () => {
    await useStore.getState().deleteQuote('never-seen');
    expect(tracked).toHaveBeenCalledWith('quote_deleted', expect.objectContaining({
      doc_id: 'never-seen', source: 'unknown', record_found: false,
    }));
  });
});
