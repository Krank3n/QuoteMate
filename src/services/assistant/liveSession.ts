// Shared Gemini Live transport plumbing.
//
// Both the single-shot text path (assistantService.sendAssistantTurn) and the
// long-lived voice path (voiceSession.openVoiceSession) open the same
// BidiGenerateContent socket off a single-use ephemeral token. The token mint,
// the endpoint constants, and the error trio those paths surface all live here
// so the two transports can't drift on auth, quota, or offline handling.

import { Platform } from 'react-native';
import { auth } from '../../config/firebase';

const USE_EMULATOR = process.env.USE_FIREBASE_EMULATOR === 'true';
export const FIREBASE_FUNCTIONS_URL = USE_EMULATOR
  ? 'http://127.0.0.1:5001/hansendev/us-central1'
  : 'https://us-central1-hansendev.cloudfunctions.net';

export const LIVE_WS_BASE =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained';

// Cap on prior turns seeded into a session — keeps the setup frame small.
export const MAX_HISTORY_TURNS = 20;

/** Not signed in — the mint needs a Firebase ID token. */
export class LiveAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveAuthError';
  }
}

/** Daily Mate quota exhausted (HTTP 402 from assistantToken). */
export class LiveQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveQuotaError';
  }
}

/** Network/transport problem, rate-limit, or a bad token response. */
export class LiveOfflineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveOfflineError';
  }
}

export interface MintedToken {
  token: string;
  model: string;
  expiresAt?: string;
}

// Mint a single-use ephemeral Gemini Live token via the assistantToken
// Function. `mode` distinguishes the voice quota bucket from text; omit it for
// the text path. The Function verifies the ID token, rate-limits, reserves a
// quota turn, and returns the token bound to the Live model.
export async function mintLiveToken(mode?: 'voice'): Promise<MintedToken> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new LiveAuthError('Sign in to use Mate.');

  const url = `${FIREBASE_FUNCTIONS_URL}/assistantToken`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ platform: Platform.OS, mode }),
    });
  } catch (err: any) {
    throw new LiveOfflineError(err?.message || 'Network error.');
  }

  if (response.status === 402) {
    const data = await response.json().catch(() => ({}));
    throw new LiveQuotaError(data.error || "You've hit today's Mate limit.");
  }
  if (response.status === 429) {
    throw new LiveOfflineError('Whoa — too many requests. Wait a moment.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new LiveOfflineError(data.error || `Mate is offline (${response.status}).`);
  }

  const data = (await response.json()) as MintedToken;
  if (!data?.token || !data?.model) {
    throw new LiveOfflineError('Mate is offline (bad token response).');
  }
  return data;
}
