// @vitest-environment jsdom
/**
 * The education wrapper exists to make Apple's iOS-18-only API safe to call
 * from anywhere. Two entry points depend on that: the screen shown straight
 * after a merchant accepts Apple's Terms and Conditions (req 4.2), and the
 * Settings row that brings it back later (req 4.3).
 *
 * Neither may throw. A tradie mid-checkout must not have a payment turn into an
 * error because Apple's content server was unreachable, and a device on iOS 17
 * — or any Android device — has to fall through to the same handled branch.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mod = vi.hoisted(() => ({
  native: null as any,
}));

vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () => mod.native,
}));

async function load() {
  vi.resetModules();
  return import('./index');
}

beforeEach(() => {
  mod.native = null;
});

describe('isTapToPayEducationAvailable', () => {
  it('is false where the native module does not exist (Android, web, tests)', async () => {
    const { isTapToPayEducationAvailable } = await load();
    expect(isTapToPayEducationAvailable()).toBe(false);
  });

  it('is false on iOS 17 and earlier, where the native side reports unavailable', async () => {
    mod.native = { isAvailable: () => false, presentHowToTap: vi.fn() };
    const { isTapToPayEducationAvailable } = await load();
    expect(isTapToPayEducationAvailable()).toBe(false);
  });

  it('is true on iOS 18+', async () => {
    mod.native = { isAvailable: () => true, presentHowToTap: vi.fn() };
    const { isTapToPayEducationAvailable } = await load();
    expect(isTapToPayEducationAvailable()).toBe(true);
  });

  it('reports false rather than throwing if the native call blows up', async () => {
    mod.native = {
      isAvailable: () => {
        throw new Error('boom');
      },
      presentHowToTap: vi.fn(),
    };
    const { isTapToPayEducationAvailable } = await load();
    expect(isTapToPayEducationAvailable()).toBe(false);
  });
});

describe('presentTapToPayEducation', () => {
  it('reports shown when Apple presented its content', async () => {
    mod.native = { isAvailable: () => true, presentHowToTap: vi.fn(async () => true) };
    const { presentTapToPayEducation } = await load();
    await expect(presentTapToPayEducation()).resolves.toEqual({ shown: true });
  });

  it('reports unavailable instead of throwing with no native module', async () => {
    const { presentTapToPayEducation } = await load();
    await expect(presentTapToPayEducation()).resolves.toEqual({
      shown: false,
      reason: 'unavailable',
    });
  });

  it.each([
    ['ERR_TTP_EDUCATION_OFFLINE', 'offline'],
    ['ERR_TTP_EDUCATION_BUSY', 'busy'],
    ['ERR_TTP_EDUCATION_UNSUPPORTED', 'unavailable'],
    ['ERR_TTP_EDUCATION_NOT_FOUND', 'failed'],
    ['ERR_TTP_EDUCATION_DISPLAY_FAILED', 'failed'],
  ])('maps %s to reason "%s"', async (code, reason) => {
    mod.native = {
      isAvailable: () => true,
      presentHowToTap: vi.fn(async () => {
        const err: any = new Error(code);
        err.code = code;
        throw err;
      }),
    };
    const { presentTapToPayEducation } = await load();
    await expect(presentTapToPayEducation()).resolves.toEqual({ shown: false, reason });
  });

  it('never throws even on an error carrying no code', async () => {
    mod.native = {
      isAvailable: () => true,
      presentHowToTap: vi.fn(async () => {
        throw new Error('unexpected');
      }),
    };
    const { presentTapToPayEducation } = await load();
    await expect(presentTapToPayEducation()).resolves.toEqual({
      shown: false,
      reason: 'failed',
    });
  });

  it('separates retryable states from permanent ones, so callers can offer a retry', async () => {
    const retryable = new Set(['offline', 'busy']);
    mod.native = {
      isAvailable: () => true,
      presentHowToTap: vi.fn(async () => {
        const err: any = new Error('x');
        err.code = 'ERR_TTP_EDUCATION_OFFLINE';
        throw err;
      }),
    };
    const { presentTapToPayEducation } = await load();
    const result = await presentTapToPayEducation();
    expect(result.shown).toBe(false);
    expect(retryable.has((result as any).reason)).toBe(true);
  });
});
