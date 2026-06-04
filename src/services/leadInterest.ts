/**
 * Lead interest (call-answering / "Katie") capture.
 *
 * The real phone integration is done by hand for the first customers, so this
 * module only handles the demand-capture side: submitting an interest form to
 * the `submitLeadInterest` callable (which emails the founder + stores the
 * lead), plus a couple of local flags so the dashboard promo card knows when
 * to step aside.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFunctions, httpsCallable } from 'firebase/functions';

const PROMO_DISMISSED_KEY = '@quotemate/leadsPromoDismissed';
const INTEREST_SUBMITTED_KEY = '@quotemate/leadsInterestSubmitted';

export interface LeadInterestPayload {
  businessName: string;
  contactPhone: string;
  /** Estimate of how many calls they miss a week, e.g. "5 a week". */
  missedCalls?: string;
  /** Typical job value (AUD) from the "missed money" calculator slider. */
  typicalJobValue?: number;
  /** Estimated lost revenue per year (AUD) the calculator showed them. */
  estLostPerYear?: number;
  notes?: string;
}

/** Submit interest. Throws on failure so the caller can show an error. */
export async function submitLeadInterest(payload: LeadInterestPayload): Promise<void> {
  const functions = getFunctions();
  const callable = httpsCallable(functions, 'submitLeadInterest');
  await callable(payload);
  await markInterestSubmitted();
}

export async function markInterestSubmitted(): Promise<void> {
  try {
    await AsyncStorage.setItem(INTEREST_SUBMITTED_KEY, '1');
  } catch {
    // Best-effort — a failed flag only means the promo card lingers.
  }
}

export async function hasSubmittedInterest(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(INTEREST_SUBMITTED_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function dismissPromo(): Promise<void> {
  try {
    await AsyncStorage.setItem(PROMO_DISMISSED_KEY, '1');
  } catch {
    // ignore
  }
}

export async function isPromoDismissed(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PROMO_DISMISSED_KEY)) === '1';
  } catch {
    return false;
  }
}

/** The promo card shows unless the user dismissed it or already signed up. */
export async function shouldShowPromo(): Promise<boolean> {
  const [dismissed, submitted] = await Promise.all([
    isPromoDismissed(),
    hasSubmittedInterest(),
  ]);
  return !dismissed && !submitted;
}
