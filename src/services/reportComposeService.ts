/**
 * Service Report write-up compose — client helper.
 *
 * Posts the tradie's rough notes to the `composeServiceReport` Firebase
 * Function, which proxies the text model server-side (the master key never
 * touches the device) and returns the three cleaned write-up fields. Mirrors
 * emailService.ts for the auth header + functions URL so we stay on one auth
 * path.
 *
 * Strictly a rewrite of what the tradie typed — the server prompt forbids
 * invented detail — so an empty source field always comes back empty.
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

export interface ComposeNotes {
  natureOfProblem?: string;
  workCarriedOut?: string;
  recommendedWork?: string;
}

export interface ComposeContext {
  businessName?: string;
  tradeCategory?: string;
}

export interface ComposedReport {
  natureOfProblem: string;
  workCarriedOut: string;
  recommendedWork: string;
}

/**
 * Send the rough notes off for a clean write-up. Throws on a non-2xx reply so
 * the caller can surface a retry; the returned object always carries all three
 * keys (blank where the source note was blank).
 */
export async function composeServiceReport(
  notes: ComposeNotes,
  context?: ComposeContext,
): Promise<ComposedReport> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/composeServiceReport`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ notes, context }),
  });

  if (!response.ok) {
    let message = 'Could not write up the notes. Please try again.';
    try {
      const body = await response.json();
      if (body?.error) message = String(body.error);
    } catch {
      /* keep the default message */
    }
    throw new Error(message);
  }

  const data = (await response.json()) as Partial<ComposedReport>;
  return {
    natureOfProblem: data.natureOfProblem || '',
    workCarriedOut: data.workCarriedOut || '',
    recommendedWork: data.recommendedWork || '',
  };
}
