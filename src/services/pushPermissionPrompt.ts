/**
 * Asks for push permission at the moment it's obviously worth granting.
 *
 * The app used to request it the instant someone signed in, before they'd seen
 * anything work — which spends the one-shot OS prompt on a stranger. On iOS a
 * decline is permanent, so a badly-timed ask doesn't just fail, it closes the
 * channel for good.
 *
 * The ask now happens straight after a quote goes to a real customer, where
 * the payoff is concrete: we can tell you the moment they open it.
 */

import { Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ASKED_KEY = '@quotemate:pushPromptShownAt';

export interface PromptDeps {
  hasPermission: () => Promise<boolean>;
  canAskPermission: () => Promise<boolean>;
  register: () => Promise<string | null>;
  wasAsked: () => Promise<boolean>;
  markAsked: () => Promise<void>;
  confirm: (onAccept: () => void, onDecline: () => void) => void;
}

export type PromptOutcome =
  | 'unsupported'   // web, simulator, or no native module
  | 'already_on'    // permission already granted
  | 'already_asked' // we've used our one ask
  | 'blocked'       // OS won't show a prompt any more
  | 'self_send'     // test send to themselves — not a real activation
  | 'declined'      // tradie said not now
  | 'granted';

/**
 * Decide-and-run, with every dependency injected so the branching is testable
 * without a device.
 */
export async function runPushPermissionPrompt(
  deps: PromptDeps,
  { isSelfSend = false }: { isSelfSend?: boolean } = {}
): Promise<PromptOutcome> {
  // A tradie emailing a test copy to themselves hasn't activated; asking there
  // spends the prompt on the weakest possible moment.
  if (isSelfSend) return 'self_send';

  if (await deps.hasPermission()) return 'already_on';
  if (await deps.wasAsked()) return 'already_asked';
  if (!(await deps.canAskPermission())) return 'blocked';

  // Our own dialog first: if they say no here the OS prompt is never spent, so
  // we can ask again after a future send. Going straight to the OS prompt
  // would burn it permanently on a maybe.
  const decision = await new Promise<boolean>((resolve) => {
    deps.confirm(() => resolve(true), () => resolve(false));
  });

  if (!decision) {
    await deps.markAsked();
    return 'declined';
  }

  const token = await deps.register();
  await deps.markAsked();
  return token ? 'granted' : 'declined';
}

export interface PushDeviceIo {
  hasPermission(): Promise<boolean>;
  canAskPermission(): Promise<boolean>;
  /** Registers for push, showing the OS prompt if needed. Null when refused. */
  register(): Promise<string | null>;
}

/**
 * The device's push surface, or null where there is none (web, or no native
 * module — Expo Go, the simulator). Required lazily so importing this module
 * doesn't drag expo-notifications into every test that touches a send path.
 * If the native module can't be resolved at all, there is nothing to ask for
 * — never let that surface as a rejection in the middle of a send.
 */
export function pushDeviceIo(): PushDeviceIo | null {
  if (Platform.OS === 'web') return null;
  let notificationService: any;
  try {
    ({ notificationService } = require('./notificationService'));
  } catch {
    return null;
  }
  if (!notificationService?.isAvailable?.()) return null;
  return {
    hasPermission: () => notificationService.hasPermission(),
    canAskPermission: () => notificationService.canAskPermission(),
    register: () => notificationService.registerForPushNotifications({ promptIfNeeded: true }),
  };
}

/** Production wiring for the above. Safe to call anywhere; no-ops off-device. */
export async function maybePromptForPushPermission(
  { isSelfSend = false }: { isSelfSend?: boolean } = {}
): Promise<PromptOutcome> {
  const device = pushDeviceIo();
  if (!device) return 'unsupported';

  return runPushPermissionPrompt({
    hasPermission: device.hasPermission,
    canAskPermission: device.canAskPermission,
    register: device.register,
    wasAsked: async () => Boolean(await AsyncStorage.getItem(ASKED_KEY)),
    markAsked: async () => { await AsyncStorage.setItem(ASKED_KEY, new Date().toISOString()); },
    confirm: (onAccept, onDecline) => {
      Alert.alert(
        'Know the moment they open it',
        "We'll let you know when your customer opens the quote, accepts it, or pays — so you can follow up while it's fresh. No daily reminders.",
        [
          { text: 'Not now', style: 'cancel', onPress: onDecline },
          { text: 'Let me know', onPress: onAccept },
        ],
        { cancelable: true, onDismiss: onDecline }
      );
    },
  }, { isSelfSend });
}
