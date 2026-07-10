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

// Per-request ceilings. Without these a half-open connection (walking out of
// coverage mid-request) stalls the whole turn forever — fetch never rejects
// on its own. Chat gets headroom for a long tool-laden reply (the server
// function itself caps at 60s); the token mint is a sub-second endpoint.
export const CHAT_TIMEOUT_MS = 45_000;
export const MINT_TIMEOUT_MS = 15_000;

/** fetch that rejects with LiveOfflineError when timeoutMs elapses. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (controller.signal.aborted) {
      throw new LiveOfflineError('Connection timed out — reception might be patchy.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Mint a single-use ephemeral Gemini Live token via the assistantToken
// Function. `mode` distinguishes the voice quota bucket from text; omit it for
// the text path. The Function verifies the ID token, rate-limits, reserves a
// quota turn, and returns the token bound to the Live model.
export async function mintLiveToken(mode?: 'voice'): Promise<MintedToken> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new LiveAuthError('Sign in to use Mate.');

  // No retry here on purpose: the voice reconnect loop already retries whole
  // connect attempts, and each successful mint reserves a quota turn — a
  // nested retry would multiply mints under the caller's back.
  const url = `${FIREBASE_FUNCTIONS_URL}/assistantToken`;
  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ platform: Platform.OS, mode }),
    }, MINT_TIMEOUT_MS);
  } catch (err: any) {
    if (err instanceof LiveOfflineError) throw err;
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
