import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', () => ({
  addDoc: vi.fn(async () => ({ id: 'evt-1' })),
  collection: vi.fn(() => 'events-collection-ref'),
  serverTimestamp: vi.fn(() => 'server-ts'),
}));

import { addDoc, collection } from 'firebase/firestore';
import { trackEvent } from './analyticsService';
// Resolves to src/test/stubs/firebase.ts via the vitest alias; currentUser is
// mutable so each test controls the signed-in state.
import { auth, db } from '../config/firebase';

const addDocMock = vi.mocked(addDoc);
const collectionMock = vi.mocked(collection);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  auth.currentUser = { uid: 'test-uid' };
});

describe('trackEvent', () => {
  it('writes the {event, props, platform, ts} payload under users/{uid}/events', async () => {
    trackEvent('paywall_viewed', { source: 'dashboard', trialExpired: false });
    await flush();

    expect(collectionMock).toHaveBeenCalledWith(db, 'users', 'test-uid', 'events');
    expect(addDocMock).toHaveBeenCalledTimes(1);
    expect(addDocMock).toHaveBeenCalledWith('events-collection-ref', {
      event: 'paywall_viewed',
      props: { source: 'dashboard', trialExpired: false },
      platform: expect.any(String),
      ts: 'server-ts',
    });
  });

  it('defaults props to an empty object', async () => {
    trackEvent('trial_started');
    await flush();

    expect(addDocMock).toHaveBeenCalledWith(
      'events-collection-ref',
      expect.objectContaining({ event: 'trial_started', props: {} })
    );
  });

  it('short-circuits without writing when signed out', async () => {
    auth.currentUser = null;
    trackEvent('checkout_started', { plan: 'yearly' });
    await flush();

    expect(collectionMock).not.toHaveBeenCalled();
    expect(addDocMock).not.toHaveBeenCalled();
  });

  it('never throws (or leaves an unhandled rejection) when the write fails', async () => {
    addDocMock.mockRejectedValueOnce(new Error('client is offline'));

    expect(() => trackEvent('purchase_failed', { code: 'network' })).not.toThrow();
    await flush();

    expect(addDocMock).toHaveBeenCalledTimes(1);
  });
});
