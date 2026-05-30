// Client transport for the Mate assistant. Non-streaming JSON for v1 — the
// server already constrains each turn to a few seconds and ≤6 tool rounds.
// SSE drops in behind STREAM_ENABLED once we've proven RN ↔ Functions over
// the wire on real devices.

import { Platform } from 'react-native';
import { auth } from '../config/firebase';
import { AssistantChatResponse, ChatMessage } from '../types/assistant';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const STREAM_ENABLED = false; // flip when SSE is wired

const USE_EMULATOR = process.env.USE_FIREBASE_EMULATOR === 'true';
const FIREBASE_FUNCTIONS_URL = USE_EMULATOR
  ? 'http://127.0.0.1:5001/hansendev/us-central1'
  : 'https://us-central1-hansendev.cloudfunctions.net';

export class AssistantQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssistantQuotaError';
  }
}

export class AssistantOfflineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssistantOfflineError';
  }
}

interface SendTurnArgs {
  history: ChatMessage[]; // includes the just-appended user turn at the tail
}

export async function sendAssistantTurn({ history }: SendTurnArgs): Promise<AssistantChatResponse> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) {
    throw new AssistantOfflineError('Sign in to use Mate.');
  }

  // Server already truncates to MAX_INCOMING_TURNS, but trim here too so we
  // don't push a 5MB body over a flaky mobile connection.
  const messages = history.slice(-20).map((m) => ({ role: m.role, content: m.text }));

  const url = `${FIREBASE_FUNCTIONS_URL}/assistantChat`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ messages, platform: Platform.OS }),
    });
  } catch (err: any) {
    throw new AssistantOfflineError(err?.message || 'Network error.');
  }

  if (response.status === 402) {
    const data = await response.json().catch(() => ({}));
    throw new AssistantQuotaError(data.error || 'You\'ve hit today\'s Mate limit.');
  }
  if (response.status === 429) {
    throw new AssistantOfflineError('Whoa — too many requests. Wait a moment.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new AssistantOfflineError(data.error || `Mate is offline (${response.status}).`);
  }

  const data = (await response.json()) as AssistantChatResponse;
  return data;
}
