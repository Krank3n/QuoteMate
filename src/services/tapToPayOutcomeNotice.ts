/**
 * Apple review requirement 5.12: "When a transaction is not approved but the
 * user has already closed the app before seeing the result, ensure they receive
 * a notification indicating this outcome."
 *
 * Two different situations hide inside that sentence, and they need different
 * mechanisms:
 *
 *  1. The app is merely backgrounded. JS is still alive, so we learn the real
 *     outcome from the SDK and can say exactly what happened.
 *  2. The app is killed mid-transaction. JS is gone, no callback will ever
 *     fire, and nothing we do at outcome-time can run.
 *
 * Case 2 is the one that decides the design. A local notification *scheduled*
 * before the tap survives termination — iOS holds it in the notification centre
 * independently of the process — so arming one up front and cancelling it the
 * moment any outcome arrives covers the case that no runtime callback can. That
 * is why this is client-side and needs no server, webhook or sweeper.
 *
 * The armed message deliberately does not claim the payment failed. If it fires
 * we genuinely do not know the outcome, and telling a tradie "declined" when
 * the money actually moved would be worse than saying nothing. It asks them to
 * check — which is exactly the state they are in.
 */

import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';

import type { PaymentFailureKind } from './tapToPayErrors';

// Long enough that a normal tap-approve-receipt round trip finishes first, short
// enough that a tradie who walked away still finds out while the customer is
// standing there. Square's own flow is seconds; the slack is for a slow network.
export const UNSEEN_OUTCOME_DELAY_SECONDS = 90;

export interface OutcomeMessage {
  title: string;
  body: string;
}

/**
 * What to say when the app was gone before the outcome could be shown. States
 * the uncertainty rather than inventing a result.
 */
export function unseenOutcomeMessage(): OutcomeMessage {
  return {
    title: 'Did that payment go through?',
    body: 'QuoteMate closed before the card payment finished. Open the job to check whether it was taken.',
  };
}

/**
 * What to say when we DO know the outcome but the tradie is not looking at the
 * screen. Only non-approved outcomes reach here — an approved payment is not
 * something to interrupt someone about.
 */
export function unapprovedOutcomeMessage(kind: PaymentFailureKind): OutcomeMessage | null {
  switch (kind) {
    case 'declined':
      return {
        title: 'Card declined',
        body: 'No money was taken. Open the job to try another card or send a pay link.',
      };
    case 'os_too_old':
      return {
        title: 'Payment not taken',
        body: 'This iPhone needs a newer version of iOS to take card payments.',
      };
    case 'failed':
      return {
        title: 'Payment not taken',
        body: "That card payment didn't go through. Open the job to try again.",
      };
    // A tradie who backed out already knows why. Nothing to announce.
    case 'cancelled':
      return null;
    default:
      return null;
  }
}

/** Whether the tradie is looking at the app right now. */
export function isForeground(): boolean {
  return AppState.currentState === 'active';
}

/**
 * Statically imported rather than lazily required. notificationService already
 * pulls expo-notifications into the graph at app start, so this adds no new
 * load risk — and a dynamic import() would: Metro rejects those on device
 * (see the contact-picker fix). Every call below is still guarded, because the
 * native side can refuse at runtime even when the module resolves.
 */
async function permitted(): Promise<boolean> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

/**
 * Schedule the fallback before starting a payment. Returns an id to cancel with,
 * or null when nothing was scheduled (no permission, no native module, web).
 *
 * Never throws: failing to arm a safety net must not stop a tradie taking money.
 */
export async function armUnseenOutcomeNotice(): Promise<string | null> {
  try {
    if (!(await permitted())) return null;
    const { title, body } = unseenOutcomeMessage();
    return await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true, data: { kind: 'tap_to_pay_unseen_outcome' } },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: UNSEEN_OUTCOME_DELAY_SECONDS,
      },
    });
  } catch {
    return null;
  }
}

/**
 * Cancel the fallback. Called for EVERY outcome — approved, declined and
 * cancelled alike — because the notice is about not having seen a result, not
 * about which result it was.
 */
export async function disarmUnseenOutcomeNotice(id: string | null): Promise<void> {
  if (!id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    /* Already fired or already gone — nothing to undo. */
  }
}

/**
 * Announce a known non-approved outcome, but only when the tradie is not
 * watching the screen. In the foreground the sheet already says it, and a
 * banner over the top would be noise.
 */
export async function notifyUnapprovedOutcomeIfAway(
  kind: PaymentFailureKind,
): Promise<boolean> {
  if (isForeground()) return false;
  const message = unapprovedOutcomeMessage(kind);
  if (!message) return false;

  try {
    if (!(await permitted())) return false;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: message.title,
        body: message.body,
        sound: true,
        data: { kind: 'tap_to_pay_unapproved' },
      },
      trigger: null, // immediate
    });
    return true;
  } catch {
    return false;
  }
}
