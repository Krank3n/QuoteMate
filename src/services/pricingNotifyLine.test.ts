import { describe, expect, it } from 'vitest';
import { acceptNotifyOffer, plainLineCopy, resolveNotifyLineState } from './pricingNotifyLine';

const io = (over: Partial<{ isWeb: boolean; available: boolean; has: boolean; canAsk: boolean }> = {}) => ({
  isWeb: over.isWeb ?? false,
  available: () => over.available ?? true,
  hasPermission: async () => over.has ?? false,
  canAskPermission: async () => over.canAsk ?? true,
});

describe('resolveNotifyLineState', () => {
  it('tells a tradie who already allowed pushes they can lock the phone', async () => {
    expect(await resolveNotifyLineState(io({ has: true }))).toBe('ready');
  });

  it('offers the notification only when the OS prompt can still be shown', async () => {
    expect(await resolveNotifyLineState(io({ has: false, canAsk: true }))).toBe('offer');
  });

  it('still says the run keeps going when no push is possible', async () => {
    // Blocked at the OS level, web, or no native module: no promise of a
    // notification, but the fact that the phone can be locked stays.
    expect(await resolveNotifyLineState(io({ has: false, canAsk: false }))).toBe('plain');
    expect(await resolveNotifyLineState(io({ isWeb: true, has: true }))).toBe('plain');
    expect(await resolveNotifyLineState(io({ available: false, has: true }))).toBe('plain');
    expect(plainLineCopy(true)).toMatch(/switch tabs/);
    expect(plainLineCopy(false)).toMatch(/Lock your phone/);
  });
});

describe('acceptNotifyOffer', () => {
  it('is ready once a token comes back, declined otherwise — and never throws', async () => {
    expect(await acceptNotifyOffer({ register: async () => 'ExponentPushToken[x]' })).toBe('ready');
    expect(await acceptNotifyOffer({ register: async () => null })).toBe('declined');
    expect(await acceptNotifyOffer({ register: async () => { throw new Error('no device'); } })).toBe('declined');
  });
});
