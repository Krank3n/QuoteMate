/**
 * Apple's Tap to Pay on iPhone merchant education.
 *
 * Apple review requirement 4.1 makes `ProximityReaderDiscovery` mandatory on
 * iOS 18+, and Apple authoring the content is what clears 4.4, 4.6, 4.7 and 4.8
 * at the same time — including the PIN-entry and accessibility material that
 * Australia requires (4.7), and the localization, which Apple keeps current.
 *
 * The native module is iOS-only and optional: `requireOptionalNativeModule`
 * resolves to null on Android, on web, and in tests, so every caller has to
 * handle the unavailable case anyway. That is deliberate — iOS 17 devices reach
 * the same branch, and requirement 4.3 still expects education to be reachable
 * there by some other means.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

export interface TapToPayEducationContent {
  id: string;
  description: string;
}

interface TapToPayEducationNativeModule {
  isAvailable(): boolean;
  presentHowToTap(): Promise<boolean>;
  listContent(): Promise<TapToPayEducationContent[]>;
}

const native = requireOptionalNativeModule<TapToPayEducationNativeModule>(
  'TapToPayEducation',
);

/**
 * Whether Apple's education can be shown on this device. False on Android, on
 * web, and on iOS 17 and earlier.
 */
export function isTapToPayEducationAvailable(): boolean {
  if (!native) return false;
  try {
    return native.isAvailable();
  } catch {
    return false;
  }
}

export type TapToPayEducationResult =
  | { shown: true }
  | { shown: false; reason: 'unavailable' | 'offline' | 'busy' | 'failed' };

/**
 * Present Apple's "How to Tap" education.
 *
 * Never throws: the caller is either following a merchant who just accepted the
 * T&Cs (req 4.2) or a tap on a Settings row (req 4.3), and neither should turn
 * into a payment-blocking error. `reason` distinguishes the two states worth
 * offering a retry for — offline and busy — from the ones that are permanent
 * on this device.
 */
export async function presentTapToPayEducation(): Promise<TapToPayEducationResult> {
  if (!native) return { shown: false, reason: 'unavailable' };
  try {
    await native.presentHowToTap();
    return { shown: true };
  } catch (err: any) {
    const code = String(err?.code || '');
    if (code === 'ERR_TTP_EDUCATION_OFFLINE') {
      return { shown: false, reason: 'offline' };
    }
    if (code === 'ERR_TTP_EDUCATION_BUSY') {
      return { shown: false, reason: 'busy' };
    }
    if (code === 'ERR_TTP_EDUCATION_UNSUPPORTED') {
      return { shown: false, reason: 'unavailable' };
    }
    return { shown: false, reason: 'failed' };
  }
}

/**
 * Every content item Apple currently serves for Tap to Pay on iPhone.
 *
 * `presentTapToPayEducation` shows the one topic the SDK names. This asks Apple
 * what else exists — the answer is not in the headers, only on the server.
 * Returns an empty array rather than throwing when unavailable.
 */
export async function listTapToPayEducationContent(): Promise<
  TapToPayEducationContent[]
> {
  if (!native?.listContent) return [];
  try {
    return (await native.listContent()) ?? [];
  } catch {
    return [];
  }
}
