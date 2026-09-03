/**
 * Pure Tap to Pay decision logic — no Square SDK, no native module.
 *
 * Split out of squarePayments deliberately. Everything here is a plain
 * function over a version string or an error object, but living beside the SDK
 * import meant every consumer's test had to mock it, and a mocked classifier is
 * no evidence that a declined card reaches the right branch. Here the real
 * implementation runs in the component tests too.
 */

import { Platform } from 'react-native';

/**
 * Apple review requirement 1.4: an iPhone below the Tap to Pay OS floor must be
 * told to update, not shown a payment control that fails at authorize() with a
 * generic error in front of a paying customer.
 *
 * The floor is Apple's, not Square's, and it moves — keep it here so the UI
 * copy and the reactive error mapping can never disagree about the number.
 */
export const MIN_TAP_TO_PAY_IOS_VERSION = '17.6';

/**
 * Segment-wise version compare, because string compare gets "17.10" wrong and
 * parseFloat gets "17.6.1" wrong. Unparseable input fails closed: a device we
 * cannot identify is not a device we let a tradie take money on.
 */
export function meetsTapToPayOsFloor(
  osVersion: string | number,
  floor: string = MIN_TAP_TO_PAY_IOS_VERSION,
): boolean {
  const parse = (v: string | number) =>
    String(v)
      .trim()
      .split('.')
      .map((part) => {
        const n = Number.parseInt(part, 10);
        return Number.isFinite(n) ? n : NaN;
      });

  const got = parse(osVersion);
  if (got.length === 0 || Number.isNaN(got[0])) return false;

  const want = parse(floor);
  for (let i = 0; i < Math.max(got.length, want.length); i += 1) {
    const a = Number.isFinite(got[i]) ? got[i] : 0;
    const b = Number.isFinite(want[i]) ? want[i] : 0;
    if (a !== b) return a > b;
  }
  return true;
}

/** Whether THIS device's OS clears the floor. Non-iOS is never gated by it. */
export function isTapToPayOsSupported(): boolean {
  if (Platform.OS !== 'ios') return true;
  return meetsTapToPayOsFloor(Platform.Version);
}

/**
 * Why an in-person payment ended without money moving.
 *
 * Worth separating because the three deserve different treatment: a tradie who
 * backed out needs no message at all, a declined card needs Apple req 5.10's
 * offer of a digital record for the customer, and an OS that is too old needs
 * req 1.4's "update your iPhone" rather than "payment failed".
 */
export type PaymentFailureKind = 'cancelled' | 'declined' | 'os_too_old' | 'failed';

export function classifyPaymentFailure(error: unknown): PaymentFailureKind {
  const err = error as { code?: unknown; message?: unknown } | null;
  const haystack = `${String(err?.code ?? '')} ${String(err?.message ?? '')}`;

  // Order matters: Square's cancellation messages sometimes carry the word
  // "declined" in a trailing detail string, so cancellation is checked first.
  if (/cancel/i.test(haystack)) return 'cancelled';
  if (/os_?version_?not_?supported|osVersionNotSupported/i.test(haystack)) {
    return 'os_too_old';
  }
  if (
    /declin|do[_ ]?not[_ ]?honou?r|insufficient|expired[_ ]?card|invalid[_ ]?card|card[_ ]?error|cvv|avs/i.test(
      haystack,
    )
  ) {
    return 'declined';
  }
  return 'failed';
}
