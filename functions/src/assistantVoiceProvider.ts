// Which voice provider a given user gets, and why.
//
// This repo has no feature-flag system — every switch is a hardcoded module
// constant needing a deploy or an app release. That is survivable for a text
// model swap and not survivable for a voice transport that lives behind an
// app-store review queue. So the decision moves server-side: the mint tells the
// client which provider to open, and rolling back to Gemini Live becomes a
// Firestore edit rather than a release.
//
// Pure module — no Firestore, no env reads, no fetch. The caller supplies the
// config document and the env flag; this decides.

import * as crypto from 'crypto';

export type VoiceProvider = 'gemini' | 'elevenlabs';

export interface VoiceConfigDoc {
  provider?: string;
  /** 0-100. Share of users who get `provider`; the rest stay on Gemini. */
  rolloutPercent?: number;
  agentId?: string;
  /** Uids always given the new provider regardless of the percentage. */
  forceUids?: string[];
}

export interface VoiceProviderInput {
  uid: string;
  /** config/assistantVoice, or undefined when missing or unreadable. */
  config: VoiceConfigDoc | undefined;
  /** ELEVENLABS_VOICE_ENABLED — the env kill switch. */
  envEnabled: boolean;
  /** Whether an ELEVENLABS_API_KEY and agent id are actually configured. */
  credentialsPresent: boolean;
  /**
   * Capabilities the CLIENT declared it understands. Shipped 1.55 builds send
   * nothing, so they can never be handed a token they'd jam into the Gemini
   * WebSocket URL. Capability, not version parsing.
   */
  clientSupports: string[] | undefined;
}

export interface VoiceProviderDecision {
  provider: VoiceProvider;
  /** For logging — why this user landed where they did. */
  reason: string;
}

/**
 * Stable 0-99 bucket for a uid.
 *
 * MUST be deterministic: a user who ping-pongs between buckets across
 * reconnects would be handed a different transport mid-conversation.
 */
export function hashUidToPercent(uid: string): number {
  const digest = crypto.createHash('sha1').update(uid).digest();
  return digest.readUInt32BE(0) % 100;
}

/**
 * Fails safe to Gemini in every ambiguous case — missing config, unreadable
 * config, absent credentials, an old client. An unavailable Firestore must
 * never be the thing that moves users onto a new provider.
 */
export function decideVoiceProvider(input: VoiceProviderInput): VoiceProviderDecision {
  if (!input.envEnabled) {
    return { provider: 'gemini', reason: 'env-disabled' };
  }
  if (!input.credentialsPresent) {
    return { provider: 'gemini', reason: 'no-credentials' };
  }
  // A client that never declared support would push an ElevenLabs conversation
  // token into the Gemini WS URL and fail in a way nobody could read.
  if (!Array.isArray(input.clientSupports) || !input.clientSupports.includes('elevenlabs')) {
    return { provider: 'gemini', reason: 'client-unsupported' };
  }
  const config = input.config;
  if (!config || config.provider !== 'elevenlabs') {
    return { provider: 'gemini', reason: 'config-gemini' };
  }
  if (config.forceUids?.includes(input.uid)) {
    return { provider: 'elevenlabs', reason: 'force-listed' };
  }
  const percent = Math.max(0, Math.min(100, Math.round(config.rolloutPercent ?? 0)));
  if (percent <= 0) return { provider: 'gemini', reason: 'rollout-0' };
  if (percent >= 100) return { provider: 'elevenlabs', reason: 'rollout-100' };
  return hashUidToPercent(input.uid) < percent
    ? { provider: 'elevenlabs', reason: `rollout-${percent}` }
    : { provider: 'gemini', reason: `rollout-${percent}-excluded` };
}
