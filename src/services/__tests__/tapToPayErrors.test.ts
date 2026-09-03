// @vitest-environment jsdom
/**
 * Apple reqs 1.4 and 5.10 both hinge on telling three failures apart.
 *
 * Getting this wrong is quiet and expensive: a cancellation reported as a
 * failure nags a tradie who did nothing wrong, a decline reported as a generic
 * failure silently skips the customer's record, and an OS below the floor
 * reported as "payment failed" sends someone hunting a bug in the app instead
 * of opening Software Update.
 *
 * These are pure functions, so the real implementations run here — and in the
 * component tests — rather than a mock that can drift from them.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mutable so the OS floor can be exercised on both sides of the line.
const platform = vi.hoisted(() => ({
  os: 'ios' as string,
  version: '18.6.2' as string | number,
}));

vi.mock('react-native', async () => {
  const actual = await vi.importActual<any>('react-native');
  return {
    ...actual,
    Platform: {
      ...actual.Platform,
      get OS() {
        return platform.os;
      },
      get Version() {
        return platform.version;
      },
    },
  };
});

describe('req 1.4 — the OS floor for Tap to Pay', () => {
  beforeEach(() => {
    platform.os = 'ios';
    platform.version = '18.6.2';
  });

  it('accepts the exact floor version', async () => {
    const { meetsTapToPayOsFloor } = await import('../tapToPayErrors');
    expect(meetsTapToPayOsFloor('17.6')).toBe(true);
  });

  it('rejects the version just below the floor', async () => {
    const { meetsTapToPayOsFloor } = await import('../tapToPayErrors');
    expect(meetsTapToPayOsFloor('17.5')).toBe(false);
    expect(meetsTapToPayOsFloor('16.4')).toBe(false);
  });

  it('compares segment-wise, so 17.10 beats 17.6 (string compare gets this wrong)', async () => {
    const { meetsTapToPayOsFloor } = await import('../tapToPayErrors');
    expect(meetsTapToPayOsFloor('17.10')).toBe(true);
  });

  it('handles a three-part version (parseFloat gets this wrong)', async () => {
    const { meetsTapToPayOsFloor } = await import('../tapToPayErrors');
    expect(meetsTapToPayOsFloor('17.6.1')).toBe(true);
    expect(meetsTapToPayOsFloor('17.5.9')).toBe(false);
  });

  it('fails closed on a version it cannot parse', async () => {
    const { meetsTapToPayOsFloor } = await import('../tapToPayErrors');
    expect(meetsTapToPayOsFloor('')).toBe(false);
    expect(meetsTapToPayOsFloor('unknown')).toBe(false);
  });

  it('gates this device on its real OS version', async () => {
    const { isTapToPayOsSupported } = await import('../tapToPayErrors');
    platform.version = '18.6.2';
    expect(isTapToPayOsSupported()).toBe(true);
    platform.version = '16.4';
    expect(isTapToPayOsSupported()).toBe(false);
  });

  it('never gates Android on an Apple OS floor', async () => {
    const { isTapToPayOsSupported } = await import('../tapToPayErrors');
    platform.os = 'android';
    platform.version = 33;
    expect(isTapToPayOsSupported()).toBe(true);
  });
});

describe('classifyPaymentFailure', () => {
  it('reads a tradie backing out as a cancellation, not a failure', async () => {
    const { classifyPaymentFailure } = await import('../tapToPayErrors');
    expect(classifyPaymentFailure(new Error('Payment was cancelled'))).toBe('cancelled');
  });

  it('treats cancellation as cancellation even when the detail mentions a decline', async () => {
    const { classifyPaymentFailure } = await import('../tapToPayErrors');
    expect(
      classifyPaymentFailure(new Error('User cancelled before the card was declined')),
    ).toBe('cancelled');
  });

  it('recognises req 1.4 osVersionNotSupported from either code or message', async () => {
    const { classifyPaymentFailure } = await import('../tapToPayErrors');
    expect(classifyPaymentFailure({ code: 'osVersionNotSupported' })).toBe('os_too_old');
    expect(classifyPaymentFailure({ message: 'os_version_not_supported' })).toBe(
      'os_too_old',
    );
  });

  it.each([
    'Card declined',
    'do_not_honor',
    'INSUFFICIENT_FUNDS',
    'expired_card',
    'CVV mismatch',
  ])('recognises %s as a decline, so req 5.10 can offer a record', async (msg) => {
    const { classifyPaymentFailure } = await import('../tapToPayErrors');
    expect(classifyPaymentFailure(new Error(msg))).toBe('declined');
  });

  it('falls back to a plain failure for anything unrecognised', async () => {
    const { classifyPaymentFailure } = await import('../tapToPayErrors');
    expect(classifyPaymentFailure(new Error('network unreachable'))).toBe('failed');
    expect(classifyPaymentFailure(null)).toBe('failed');
  });
});
