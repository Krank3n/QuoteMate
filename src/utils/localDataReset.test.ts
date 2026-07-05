import { describe, it, expect } from 'vitest';
import { shouldClearLocalData } from './localDataReset';

describe('shouldClearLocalData — sign-out and fresh devices', () => {
  it('never wipes on sign-out, even with a previous session', () => {
    expect(
      shouldClearLocalData({
        lastUid: 'old1',
        lastEmail: 'a@b.co',
        newUid: null,
        newEmail: null,
      }),
    ).toBe(false);
  });

  it('never wipes a fresh device (no previous session)', () => {
    expect(
      shouldClearLocalData({
        lastUid: null,
        lastEmail: null,
        newUid: 'new1',
        newEmail: 'a@b.co',
      }),
    ).toBe(false);
  });

  it('never wipes when the same account signs back in', () => {
    expect(
      shouldClearLocalData({
        lastUid: 'u1',
        lastEmail: 'a@b.co',
        newUid: 'u1',
        newEmail: 'a@b.co',
      }),
    ).toBe(false);
  });
});

describe('shouldClearLocalData — same-email re-registration (incident recovery)', () => {
  it('preserves local data when the same email returns with a new uid', () => {
    expect(
      shouldClearLocalData({
        lastUid: 'deletedUid',
        lastEmail: 'admin@thieleconstructions.com.au',
        newUid: 'freshUid',
        newEmail: 'admin@thieleconstructions.com.au',
      }),
    ).toBe(false);
  });

  it('matches emails case-insensitively and ignores whitespace', () => {
    expect(
      shouldClearLocalData({
        lastUid: 'deletedUid',
        lastEmail: 'Admin@Thiele.com.au ',
        newUid: 'freshUid',
        newEmail: ' admin@thiele.com.au',
      }),
    ).toBe(false);
  });

  it('preserves via the accountReclaims oldUid when the device has no stored email', () => {
    expect(
      shouldClearLocalData({
        lastUid: 'deletedUid',
        lastEmail: null,
        newUid: 'freshUid',
        newEmail: 'admin@thiele.com.au',
        reclaimOldUid: 'deletedUid',
      }),
    ).toBe(false);
  });
});

describe('shouldClearLocalData — genuinely different identity still wipes', () => {
  it('wipes when a different email signs in with a different uid', () => {
    expect(
      shouldClearLocalData({
        lastUid: 'u1',
        lastEmail: 'tradie1@x.co',
        newUid: 'u2',
        newEmail: 'tradie2@y.co',
      }),
    ).toBe(true);
  });

  it('wipes when the device has no stored email and no reclaim record matches', () => {
    expect(
      shouldClearLocalData({
        lastUid: 'u1',
        lastEmail: null,
        newUid: 'u2',
        newEmail: 'stranger@z.co',
        reclaimOldUid: null,
      }),
    ).toBe(true);
  });

  it('wipes when the reclaim record points at a different old uid than this device held', () => {
    expect(
      shouldClearLocalData({
        lastUid: 'someoneElsesUid',
        lastEmail: null,
        newUid: 'freshUid',
        newEmail: 'admin@thiele.com.au',
        reclaimOldUid: 'deletedUid',
      }),
    ).toBe(true);
  });
});
