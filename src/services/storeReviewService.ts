/**
 * Store review prompt.
 *
 * Asks the user for an App Store / Play Store rating at a genuine high-
 * satisfaction moment (payment received, quote accepted) — but heavily rate-
 * limited so we never nag:
 *   - no-op on web and on devices where the native sheet isn't available;
 *   - at most once per app session (in-memory flag, resets on app restart);
 *   - only after the user has had at least one PRIOR happy moment;
 *   - not within ~90 days of the last prompt;
 *   - the OS additionally caps how often its native sheet actually appears
 *     (~3/yr on iOS), so requestReview() may silently do nothing — which is
 *     fine, we still back off;
 *   - and the whole thing is time-boxed, because the caller awaits it.
 *
 * Persistent state lives in Firestore at users/{uid}/settings/appReview.
 * Every path is fire-and-forget and swallows errors: review logic must never
 * affect the surrounding payment / quote flow.
 */
import { Platform } from 'react-native';
import * as StoreReview from 'expo-store-review';
import { doc, getDoc, setDoc, serverTimestamp, increment, type DocumentReference } from 'firebase/firestore';
import { auth, db } from '../config/firebase';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

// How long the caller will wait on the gates before moving on. The Firestore
// read/write below hangs indefinitely offline, and the quote-accept flow awaits
// this behind a spinner.
const REVIEW_TIMEOUT_MS = 2500;

// Once-per-app-session guard. Intentionally in-memory (not persisted) so it
// resets when the app process restarts — the 90-day cooldown below is what
// enforces the long-term cap.
let promptedThisSession = false;

export type HappyEvent = 'payment_success' | 'quote_accepted' | 'invoice_paid';

interface AppReviewState {
  lastPromptedAt?: number;
  promptCount?: number;
  happyEvents?: number;
}

function reviewDocRef(): DocumentReference | null {
  const uid = auth.currentUser?.uid;
  return uid ? doc(db, `users/${uid}/settings/appReview`) : null;
}

async function readState(ref: DocumentReference | null): Promise<AppReviewState> {
  if (!ref) return {};
  try {
    const snap = await getDoc(ref);
    return snap.exists() ? (snap.data() as AppReviewState) : {};
  } catch {
    return {};
  }
}

/**
 * Run the gates and, if they all pass, ask the OS for its review prompt.
 * Returns whether we asked. Never throws.
 */
async function runReviewGates(): Promise<boolean> {
  try {
    const ref = reviewDocRef();
    const state = await readState(ref);
    const priorHappyEvents = state.happyEvents || 0;
    // Record this happy moment atomically. increment() avoids the lost-update
    // race when two happy moments land close together (e.g. quote accepted then
    // a deposit shared seconds later) — a plain read-+1-write would drop one.
    if (ref) {
      await setDoc(ref, { happyEvents: increment(1), updatedAt: serverTimestamp() }, { merge: true });
    }

    if (promptedThisSession) return false;
    if (priorHappyEvents < 1) return false; // require at least one EARLIER happy moment
    if (state.lastPromptedAt && Date.now() - state.lastPromptedAt < NINETY_DAYS_MS) return false;
    if (!(await StoreReview.isAvailableAsync())) return false;
    if (!(await StoreReview.hasAction())) return false;

    await StoreReview.requestReview();

    // Back off whether or not the OS actually showed the sheet.
    promptedThisSession = true;
    if (ref) {
      await setDoc(
        ref,
        { lastPromptedAt: Date.now(), promptCount: increment(1), updatedAt: serverTimestamp() },
        { merge: true },
      );
    }
    return true;
  } catch {
    // Swallow — a failed review prompt must never disrupt the caller.
    return false;
  }
}

/**
 * Call from a genuine happy moment. Records the event and, if every gate
 * passes, asks the OS to show its review prompt. Never throws.
 *
 * Returns true only when we actually invoked the OS review prompt for this
 * call — the OS decides whether it draws anything — so a caller sharing the
 * same happy moment (the "job won" sheet) can stand aside rather than stack a
 * second sheet on top of it. Every early return — web, already-prompted,
 * cooling off — reports false.
 *
 * The gates read and write Firestore, and callers now await this while holding
 * a spinner on the accept it follows — offline that never resolves. So the
 * whole thing is capped: past REVIEW_TIMEOUT_MS we report "not shown" and let
 * the caller move on while the write finishes (or doesn't) on its own.
 */
export async function maybeRequestReview(_event: HappyEvent): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      runReviewGates(),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), REVIEW_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
