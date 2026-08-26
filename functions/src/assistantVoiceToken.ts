// ElevenLabs Agents conversation-token mint.
//
// Deliberately NOT a deployed function. assistantToken stays the single client
// entry point for voice auth — if the client had to try one endpoint and fall
// back to another, a rollback would cost two mints and the first would already
// have reserved a quota turn. This module is helpers only; assistantToken calls
// them from its `mode === 'voice'` branch.
//
// It also keeps vendor code out of assistantToken.ts, which exports the auth,
// rate-limit and quota helpers that assistantChat imports. A runtime error in
// an ElevenLabs branch there would take text chat down with it.

import * as crypto from 'crypto';
import fetch from 'node-fetch';

/**
 * How the model is labelled in cost records and in the UI. Compound so voice
 * spend stays separable from the text path's `claude-sonnet-5` on the same
 * daily doc — see the PRICING comment in assistantCosts.ts.
 */
export const EL_VOICE_MODEL_LABEL = 'elevenlabs/claude-sonnet-5';

const EL_API_BASE = 'https://api.elevenlabs.io';

/** Mint requests are sub-second; this only exists so a hung socket can't stall a turn. */
export const EL_MINT_TIMEOUT_MS = 10_000;

/**
 * A stable, non-reversible label for the ElevenLabs dashboard.
 *
 * Sessions need to be identifiable when debugging in their Conversations view,
 * but the Firebase uid is the user's identity in our system and this is a third
 * party's log. A truncated hash is enough to correlate and useless to anyone
 * who obtains it. Never bill off this — the webhook resolves the real uid via
 * our own voiceSessions mapping.
 */
export function participantNameForUid(uid: string): string {
  return `qm_${crypto.createHash('sha256').update(uid).digest('hex').slice(0, 12)}`;
}

/** GET /v1/convai/conversation/token?agent_id=… — the WebRTC token endpoint. */
export function buildConversationTokenUrl(agentId: string, participantName?: string): string {
  const params = new URLSearchParams({ agent_id: agentId });
  if (participantName) params.set('participant_name', participantName);
  return `${EL_API_BASE}/v1/convai/conversation/token?${params.toString()}`;
}

export interface MintedConversationToken {
  token: string;
  conversationId: string;
}

export class ElevenLabsMintError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ElevenLabsMintError';
    this.status = status;
  }
}

/**
 * Mint a single conversation token for the WebRTC transport.
 *
 * The API key travels in the `xi-api-key` HEADER, never the URL — query strings
 * end up in access logs and proxy caches.
 *
 * `fetchImpl` is injectable so the URL and header contract can be tested
 * without the network.
 */
export async function mintElevenLabsConversationToken(args: {
  apiKey: string;
  agentId: string;
  participantName?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<MintedConversationToken> {
  const doFetch = args.fetchImpl || fetch;
  const url = buildConversationTokenUrl(args.agentId, args.participantName);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? EL_MINT_TIMEOUT_MS);

  let res: any;
  try {
    res = await doFetch(url, {
      method: 'GET',
      headers: { 'xi-api-key': args.apiKey, Accept: 'application/json' },
      signal: controller.signal as any,
    } as any);
  } catch (err: any) {
    if (controller.signal.aborted) {
      throw new ElevenLabsMintError('conversation token request timed out');
    }
    throw new ElevenLabsMintError(err?.message || 'conversation token request failed');
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    // Status goes in the message so the 502's `detail` is actually diagnosable.
    throw new ElevenLabsMintError(`conversation/token ${res.status}: ${text}`, res.status);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ElevenLabsMintError(`conversation/token returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (!parsed?.token) {
    throw new ElevenLabsMintError(`conversation/token returned no token: ${text.slice(0, 200)}`);
  }
  return {
    token: parsed.token,
    // Present in the documented response; without it the post-call webhook has
    // nothing to reconcile the session against.
    conversationId: parsed.conversation_id || '',
  };
}
