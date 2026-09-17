/**
 * Email Service - Client-side integration for email preferences and activity tracking
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { auth } from '../config/firebase';

const USE_EMULATOR = process.env.USE_FIREBASE_EMULATOR === 'true';
const FIREBASE_FUNCTIONS_URL = USE_EMULATOR
  ? 'http://127.0.0.1:5001/hansendev/us-central1'
  : 'https://us-central1-hansendev.cloudfunctions.net';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await auth.currentUser?.getIdToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export interface ActivityPingResult {
  success: boolean;
  /**
   * Set when the server treated this ping as a return after a month away on
   * a lapsed trial and re-opened the trial for `days` (once per account).
   * See functions/src/returnTrial.ts.
   */
  returnTrial?: { granted: boolean; days?: number; reason?: string };
}

/**
 * Update the user's last activity timestamp for re-engagement email tracking.
 * Resolves to null on any failure — this is non-critical and never throws.
 *
 * `supportsReturnTrial` tells the server this bundle can render a return
 * trial (it reads trialEndsAt). A bundle without that flag is never granted
 * one, so an older client can't burn the account's single re-trial on a
 * screen that would still show it as expired.
 */
export async function updateActivityTimestamp(): Promise<ActivityPingResult | null> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/updateActivityTimestamp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        appVersion: Constants.expoConfig?.version || null,
        appPlatform: Platform.OS,
        supportsReturnTrial: true,
      }),
    });
    if (!response.ok) return null;
    const json = await response.json();
    return json && typeof json === 'object' ? (json as ActivityPingResult) : null;
  } catch (error) {
    // Silently fail - this is non-critical
    console.debug('Failed to update activity timestamp:', error);
    return null;
  }
}

/**
 * Update user's email preferences (marketing opt-in/out)
 */
export async function updateEmailPreferences(marketing: boolean): Promise<boolean> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/updateEmailPreferences`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ marketing }),
    });

    if (!response.ok) {
      throw new Error('Failed to update email preferences');
    }

    return true;
  } catch (error) {
    return false;
  }
}
