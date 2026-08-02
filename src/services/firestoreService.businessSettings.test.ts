/**
 * Regression: saving business settings must survive undefined values nested
 * inside `credentials`.
 *
 * A customer added their company logo plus an ARC accreditation badge and got
 * "Accreditation Logo Upload Failed" every time. The badge had in fact uploaded
 * to Storage — it was the Firestore write that threw. saveBusinessSettings only
 * stripped undefined at the TOP level, and a credential entered without a
 * licence number (or without a badge) carries `number: undefined` /
 * `logoUri: undefined`. Firestore rejects undefined at any depth, so the whole
 * settings write aborted and the user saw an upload error plus a lost logo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, ...segments: string[]) => segments.join('/')),
  setDoc: vi.fn(async () => undefined),
  collection: vi.fn(() => 'collection-ref'),
  getDoc: vi.fn(async () => ({ exists: () => false })),
  getDocs: vi.fn(async () => ({ docs: [] })),
  deleteDoc: vi.fn(async () => undefined),
  onSnapshot: vi.fn(() => () => undefined),
  query: vi.fn(() => 'query-ref'),
  orderBy: vi.fn(() => 'order-by'),
  limit: vi.fn(() => 'limit'),
  runTransaction: vi.fn(async () => undefined),
  increment: vi.fn((n: number) => ({ __increment: n })),
  serverTimestamp: vi.fn(() => 'server-ts'),
  Timestamp: { fromDate: vi.fn((d: Date) => d), now: vi.fn(() => 'now') },
}));

import { setDoc } from 'firebase/firestore';
import { firestoreService } from './firestoreService';
import { auth } from '../config/firebase';

const setDocMock = vi.mocked(setDoc);
const BUSINESS_DOC = 'users/test-uid/settings/business';

/** Firestore throws on undefined anywhere in the payload — assert none remain. */
function findUndefinedPaths(value: unknown, path = '$'): string[] {
  if (value === undefined) return [path];
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => findUndefinedPaths(item, `${path}[${i}]`));
  }
  return Object.entries(value).flatMap(([key, child]) =>
    findUndefinedPaths(child, `${path}.${key}`),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (auth as any).currentUser = { uid: 'test-uid' };
});

function settingsWithCredentials(): any {
  return {
    businessName: 'Coastal HVAC Mechanical Services',
    abn: undefined,
    logoUri: 'https://storage/logo.png',
    defaultLaborRate: 90,
    defaultMarkup: 10,
    credentials: [
      // Badge uploaded, no licence number typed in.
      { id: 'c1', label: 'ARC Authorisation', number: undefined, logoUri: 'https://storage/arc.png' },
      // Licence number typed in, no badge uploaded.
      { id: 'c2', label: 'Electrical licence', number: 'EL-4471', logoUri: undefined },
    ],
  };
}

describe('saveBusinessSettings', () => {
  it('strips undefined nested inside credentials so the write is not rejected', async () => {
    await firestoreService.saveBusinessSettings(settingsWithCredentials());

    expect(setDocMock).toHaveBeenCalledTimes(1);
    const [ref, payload] = setDocMock.mock.calls[0];
    expect(ref).toBe(BUSINESS_DOC);
    expect(findUndefinedPaths(payload)).toEqual([]);
  });

  it('keeps the logo and every credential that the user actually filled in', async () => {
    await firestoreService.saveBusinessSettings(settingsWithCredentials());

    const payload = setDocMock.mock.calls[0][1] as any;
    expect(payload.logoUri).toBe('https://storage/logo.png');
    expect(payload.credentials).toEqual([
      { id: 'c1', label: 'ARC Authorisation', logoUri: 'https://storage/arc.png' },
      { id: 'c2', label: 'Electrical licence', number: 'EL-4471' },
    ]);
  });
});
