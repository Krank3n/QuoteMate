import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', () => ({
  // Join the path segments so assertions can read as a Firestore path.
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
const ONBOARDING_DOC = 'users/test-uid/profile/onboarding';

beforeEach(() => {
  vi.clearAllMocks();
  auth.currentUser = { uid: 'test-uid' };
});

describe('saveOnboardingProgress', () => {
  it('mirrors the current step to profile/onboarding with a server timestamp', async () => {
    await firestoreService.saveOnboardingProgress({
      lastStepKey: 'branding',
      lastStepIndex: 4,
      stepsTotal: 7,
    });

    expect(setDocMock).toHaveBeenCalledTimes(1);
    expect(setDocMock).toHaveBeenCalledWith(
      ONBOARDING_DOC,
      {
        lastStepKey: 'branding',
        lastStepIndex: 4,
        stepsTotal: 7,
        progressUpdatedAt: 'server-ts',
      },
      { merge: true },
    );
  });

  it('merges so it never clobbers an existing isOnboarded flag', async () => {
    await firestoreService.saveOnboardingProgress({
      lastStepKey: 'company',
      lastStepIndex: 1,
      stepsTotal: 7,
    });

    expect(setDocMock.mock.calls[0][2]).toEqual({ merge: true });
  });

  it('writes nothing when signed out', async () => {
    auth.currentUser = null;

    await firestoreService.saveOnboardingProgress({
      lastStepKey: 'company',
      lastStepIndex: 1,
      stepsTotal: 7,
    });

    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('never throws when the write fails — telemetry must not break the flow it measures', async () => {
    setDocMock.mockRejectedValueOnce(new Error('client is offline'));

    await expect(
      firestoreService.saveOnboardingProgress({
        lastStepKey: 'rates',
        lastStepIndex: 5,
        stepsTotal: 7,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('saveOnboardingStatus', () => {
  it('merges rather than replacing, so completing the flow preserves the recorded progress', async () => {
    // Regression: a plain setDoc here would erase lastStepKey/lastStepIndex on
    // completion, destroying the step-level funnel for everyone who finishes.
    await firestoreService.saveOnboardingStatus(true);

    expect(setDocMock).toHaveBeenCalledTimes(1);
    const [path, payload, options] = setDocMock.mock.calls[0];
    expect(path).toBe(ONBOARDING_DOC);
    expect(payload).toEqual({ isOnboarded: true, syncedAt: expect.any(String) });
    expect(options).toEqual({ merge: true });
  });

  it('writes nothing when signed out', async () => {
    auth.currentUser = null;

    await firestoreService.saveOnboardingStatus(true);

    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('still surfaces write failures to the caller (unlike the progress mirror)', async () => {
    setDocMock.mockRejectedValueOnce(new Error('permission-denied'));

    await expect(firestoreService.saveOnboardingStatus(true)).rejects.toThrow('permission-denied');
  });
});
