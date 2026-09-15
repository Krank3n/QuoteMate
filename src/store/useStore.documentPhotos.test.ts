// @vitest-environment jsdom
/**
 * The job screen's photo strip edits a quote-owned photo (flip, annotate,
 * remove) by handing saveDocument the stored document with a new `photos`
 * array. Pin that this write path changes photos and updatedAt on the
 * record and nothing else — a stage flip must never move a total, a number
 * or a customer field on a quote the customer has already received.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Job } from '../../shared/job/types';
import type { Document } from '../types/document';
import type { QuotePhoto } from '../types';

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

const jobService = vi.hoisted(() => ({ saveJob: vi.fn(async () => {}) }));
vi.mock('../services/jobService', () => ({
  jobService: {
    listenToJobs: vi.fn(),
    loadJobs: vi.fn(async () => []),
    saveJob: jobService.saveJob,
    deleteJob: vi.fn(async () => {}),
  },
}));

import { useStore } from './useStore';
import { useJobStore } from './useJobStore';
import { documentService } from '../services/documentService';

const PHOTOS: QuotePhoto[] = [
  { id: 'a', storageUrl: 'https://storage.example/a.jpg', annotated: false },
  { id: 'b', storageUrl: 'https://storage.example/b.jpg', annotated: false, isPlan: true },
];

// A sent quote with the fields a customer can see, plus the money the
// ledger cares about. None of these may move on a photo edit.
const quoteDoc: Document = {
  id: 'doc-1',
  type: 'quote',
  stage: 'quote_sent',
  number: 'QU-1042',
  jobId: 'job-1',
  customerName: 'Sam Rivers',
  customerEmail: 'sam@example.com',
  jobAddress: '12 Wattle St',
  job: { id: 'job-1', name: 'Back fence', description: 'Replace 22 m of paling fence.' },
  materials: [{ id: 'm1', name: 'Palings', quantity: 200, unitPrice: 2.5, totalPrice: 500 }],
  sections: [],
  subtotal: 500,
  gst: 50,
  total: 550,
  paidTotal: 0,
  balanceDue: 550,
  payments: [],
  acceptanceToken: 'tok-123',
  createdAt: 1_000,
  updatedAt: 1_000,
  photos: PHOTOS,
} as unknown as Document;

// The linked job carries the same customer and job fields, so the sync
// saveDocument runs on the way through has nothing to patch.
const job: Job = {
  id: 'job-1',
  name: 'Back fence',
  description: 'Replace 22 m of paling fence.',
  customerName: 'Sam Rivers',
  customerEmail: 'sam@example.com',
  jobAddress: '12 Wattle St',
  stage: 'quoted',
  documentIds: ['doc-1'],
  createdAt: 1_000,
  updatedAt: 1_000,
} as unknown as Job;

let sent: Document[];

beforeEach(() => {
  vi.clearAllMocks();
  sent = [];
  vi.spyOn(documentService, 'saveDocument').mockImplementation(async (d: Document) => {
    sent.push(d);
  });
  useJobStore.setState({ jobs: [job], jobsLoaded: true });
  useStore.setState({ documents: [quoteDoc], documentsLoaded: true } as any);
});

const splitPhotos = (d: Document) => {
  const { photos, updatedAt, ...rest } = d;
  return { photos, updatedAt, rest };
};

describe('saveDocument with new photos (the job screen write path)', () => {
  it('writes the flipped photo and a fresh updatedAt, changing nothing else on the record', async () => {
    const before = Date.now();
    const flipped: QuotePhoto[] = [{ ...PHOTOS[0], stage: 'after' }, PHOTOS[1]];

    await useStore.getState().saveDocument({ ...quoteDoc, photos: flipped });

    expect(sent).toHaveLength(1);
    const written = splitPhotos(sent[0]);
    expect(written.photos).toEqual(flipped);
    expect(written.updatedAt).toBeGreaterThanOrEqual(before);
    expect(written.rest).toEqual(splitPhotos(quoteDoc).rest);

    const stored = useStore.getState().documents.find((d) => d.id === 'doc-1')!;
    expect(splitPhotos(stored).photos).toEqual(flipped);
    expect(splitPhotos(stored).rest).toEqual(splitPhotos(quoteDoc).rest);
    expect(jobService.saveJob).not.toHaveBeenCalled();
  });

  it('removing a photo writes the shorter array and, for the last one, an empty array', async () => {
    await useStore.getState().saveDocument({ ...quoteDoc, photos: [PHOTOS[1]] });
    expect(sent[0].photos).toEqual([PHOTOS[1]]);
    expect(splitPhotos(sent[0]).rest).toEqual(splitPhotos(quoteDoc).rest);

    await useStore.getState().saveDocument({ ...quoteDoc, photos: [] });
    expect(sent[1].photos).toEqual([]);
    expect(splitPhotos(sent[1]).rest).toEqual(splitPhotos(quoteDoc).rest);
  });

  it('an annotation re-upload replaces the entry in place of the old one', async () => {
    const annotated: QuotePhoto = { id: 'a', storageUrl: 'https://storage.example/a-annotated.jpg', annotated: true };

    await useStore.getState().saveDocument({ ...quoteDoc, photos: [PHOTOS[1], annotated] });

    expect(sent[0].photos).toEqual([PHOTOS[1], annotated]);
    expect(splitPhotos(sent[0]).rest).toEqual(splitPhotos(quoteDoc).rest);
  });
});
