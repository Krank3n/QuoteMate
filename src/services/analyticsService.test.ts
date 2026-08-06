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

  // The send funnel is assembled downstream from these exact names and prop
  // shapes; a rename on either side silently breaks the join.
  it('writes the send-flow funnel events under their agreed names', async () => {
    trackEvent('send_sheet_opened', { doc_type: 'quote', has_customer_email: true, plan: 'trial' });
    trackEvent('send_method_chosen', { method: 'email', doc_type: 'quote' });
    trackEvent('email_preview_opened', { doc_type: 'quote', prefilled: true, wait_ms: 0 });
    trackEvent('email_preview_abandoned', { doc_type: 'quote', had_recipient: true, edited_body: false });
    trackEvent('quote_send_succeeded', { doc_type: 'quote', method: 'email', to_self: false });
    await flush();

    expect(addDocMock.mock.calls.map(([, payload]: any) => payload.event)).toEqual([
      'send_sheet_opened',
      'send_method_chosen',
      'email_preview_opened',
      'email_preview_abandoned',
      'quote_send_succeeded',
    ]);
  });

  // A store purchase settles exactly one of three ways, and each has to be
  // distinguishable: the Jul–Aug 2026 outage read as three healthy purchases
  // because the unconfirmed branch was silent and purchase_completed fired
  // before validation. "Charged" is the sum of all three, so no case is lost.
  it('writes the purchase funnel events under their agreed names', async () => {
    trackEvent('checkout_started', { plan: 'yearly', platform: 'ios', source: 'send_gate' });
    trackEvent('purchase_completed', { plan: 'yearly', platform: 'ios' });
    trackEvent('purchase_failed', { platform: 'ios', code: 'validation_rejected' });
    trackEvent('purchase_unconfirmed', { plan: 'yearly', platform: 'ios', source: 'send_gate' });
    trackEvent('purchase_recovered_on_launch', { platform: 'ios' });
    await flush();

    expect(addDocMock.mock.calls.map(([, payload]: any) => payload.event)).toEqual([
      'checkout_started',
      'purchase_completed',
      'purchase_failed',
      'purchase_unconfirmed',
      'purchase_recovered_on_launch',
    ]);
  });

  it('never throws (or leaves an unhandled rejection) when the write fails', async () => {
    addDocMock.mockRejectedValueOnce(new Error('client is offline'));

    expect(() => trackEvent('purchase_failed', { code: 'network' })).not.toThrow();
    await flush();

    expect(addDocMock).toHaveBeenCalledTimes(1);
  });
});
