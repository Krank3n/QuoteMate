/**
 * Email Service - Client-side integration for email preferences and activity tracking
 */

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

/**
 * Update the user's last activity timestamp for re-engagement email tracking
 */
export async function updateActivityTimestamp(): Promise<void> {
  try {
    const headers = await getAuthHeaders();
    await fetch(`${FIREBASE_FUNCTIONS_URL}/updateActivityTimestamp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
  } catch (error) {
    // Silently fail - this is non-critical
    console.debug('Failed to update activity timestamp:', error);
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
    console.error('Failed to update email preferences:', error);
    return false;
  }
}
