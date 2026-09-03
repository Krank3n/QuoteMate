/**
 * Inert stand-in for expo-notifications under vitest.
 *
 * The real package pulls in Expo's ESM-only internals (`./ImportMetaRegistry`),
 * which vite cannot resolve under jsdom — so a single static import of it
 * anywhere in a component's graph fails the whole suite, not just the test that
 * cares. tapToPayOutcomeNotice imports it for Apple req 5.12, and that reaches
 * TakePaymentSheet and everything rendering it.
 *
 * Permission is reported as DENIED by default, so unrelated tests schedule
 * nothing and assert nothing about notifications. Tests that do care mock
 * 'expo-notifications' themselves with the behaviour they need.
 */

export const SchedulableTriggerInputTypes = {
  TIME_INTERVAL: 'timeInterval',
  DATE: 'date',
  DAILY: 'daily',
  WEEKLY: 'weekly',
  YEARLY: 'yearly',
} as const;

export async function getPermissionsAsync() {
  return { status: 'denied' as const };
}

export async function requestPermissionsAsync() {
  return { status: 'denied' as const };
}

export async function scheduleNotificationAsync(): Promise<string> {
  return 'stub-notification-id';
}

export async function cancelScheduledNotificationAsync(): Promise<void> {}

export async function getExpoPushTokenAsync() {
  return { data: '' };
}

export function setNotificationHandler(): void {}
export function addNotificationReceivedListener() {
  return { remove() {} };
}
export function addNotificationResponseReceivedListener() {
  return { remove() {} };
}
export async function setBadgeCountAsync(): Promise<void> {}
