/**
 * Lead interest (call-answering / "Katie") capture.
 *
 * The real phone integration is done by hand for the first customers, so this
 * module only handles the demand-capture side: submitting an interest form to
 * the `submitLeadInterest` callable (which emails the founder + stores the
 * lead), plus flags so the dashboard promo card knows when to step aside.
 *
 * Dismissed/submitted flags live in two places: AsyncStorage as the fast local
 * path, and `users/{uid}/settings/promos` in Firestore so a dismissal follows
 * the account across reinstalls and devices. `shouldShowPromo` only consults
 * Firestore when the local flags are absent, and backfills them from the
 * account doc so subsequent checks stay local.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';

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

function promosDocRef(uid: string) {
  return doc(db, 'users', uid, 'settings', 'promos');
}

/** Best-effort write of a promo flag to the account-level settings doc. */
async function setAccountFlag(field: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    await setDoc(promosDocRef(uid), { [field]: true }, { merge: true });
  } catch {
    // Best-effort — the local flag still hides the card on this device.
  }
}

export async function markInterestSubmitted(): Promise<void> {
  try {
    await AsyncStorage.setItem(INTEREST_SUBMITTED_KEY, '1');
  } catch {
    // Best-effort — a failed flag only means the promo card lingers.
  }
  await setAccountFlag('leadsInterestSubmitted');
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
  await setAccountFlag('leadsPromoDismissed');
}

export async function isPromoDismissed(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PROMO_DISMISSED_KEY)) === '1';
  } catch {
    return false;
  }
}

// One account-doc read per session per user. The dashboard re-checks promo
// visibility on every focus; without this memo a never-dismissed user would
// pay a Firestore read each time they land on the dashboard.
let accountCheck: { uid: string; promise: Promise<boolean> } | null = null;

/**
 * Whether the account-level promos doc marks the card as hidden. Backfills
 * the local flags when it does, so future checks skip the network entirely.
 * Never throws; an unreadable doc (offline, rules hiccup) counts as
 * "not hidden" and is retried on the next check.
 */
async function isHiddenOnAccount(uid: string): Promise<boolean> {
  try {
    const snapshot = await getDoc(promosDocRef(uid));
    const data = snapshot.data();
    const dismissed = data?.leadsPromoDismissed === true;
    const submitted = data?.leadsInterestSubmitted === true;
    if (dismissed) await AsyncStorage.setItem(PROMO_DISMISSED_KEY, '1').catch(() => {});
    if (submitted) await AsyncStorage.setItem(INTEREST_SUBMITTED_KEY, '1').catch(() => {});
    return dismissed || submitted;
  } catch {
    accountCheck = null; // retry on next check rather than caching a failure
    return false;
  }
}

/** The promo card shows unless the user dismissed it or already signed up. */
export async function shouldShowPromo(): Promise<boolean> {
  const [dismissed, submitted] = await Promise.all([
    isPromoDismissed(),
    hasSubmittedInterest(),
  ]);
  if (dismissed || submitted) return false;

  // No local flags — could be a reinstall or a new device, so defer to the
  // account-level flags before showing the card again.
  const uid = auth.currentUser?.uid;
  if (!uid) return true;
  if (!accountCheck || accountCheck.uid !== uid) {
    accountCheck = { uid, promise: isHiddenOnAccount(uid) };
  }
  return !(await accountCheck.promise);
}
