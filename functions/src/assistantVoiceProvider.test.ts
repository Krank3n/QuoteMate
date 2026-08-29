/**
 * The rollback switch.
 *
 * Voice lives behind an app-store review queue, so the ability to move users
 * back to Gemini Live with a Firestore edit — no deploy, no release — is the
 * only fast remedy available if the ElevenLabs path misbehaves in the wild.
 * Everything here is about failing toward Gemini: the safe direction is always
 * "keep them on the transport that has been in production for months".
 */
import { describe, it, expect } from 'vitest';
import { decideVoiceProvider, hashUidToPercent, VoiceProviderInput } from './assistantVoiceProvider';

const base = (over: Partial<VoiceProviderInput> = {}): VoiceProviderInput => ({
  uid: 'user-1',
  config: { provider: 'elevenlabs', rolloutPercent: 100 },
  envEnabled: true,
  credentialsPresent: true,
  clientSupports: ['elevenlabs'],
  ...over,
});

describe('decideVoiceProvider', () => {
  it('routes a fully enabled, fully rolled-out, capable client to ElevenLabs', () => {
    expect(decideVoiceProvider(base()).provider).toBe('elevenlabs');
  });

  it('falls back to Gemini when the config doc is missing entirely', () => {
    // An unreadable or absent Firestore must never MOVE users to a new provider.
    expect(decideVoiceProvider(base({ config: undefined }))).toEqual({
      provider: 'gemini', reason: 'config-gemini',
    });
  });

  it('falls back to Gemini when the config names gemini', () => {
    expect(decideVoiceProvider(base({ config: { provider: 'gemini', rolloutPercent: 100 } })).provider)
      .toBe('gemini');
  });

  it('lets the env kill switch beat a config that says elevenlabs', () => {
    expect(decideVoiceProvider(base({ envEnabled: false }))).toEqual({
      provider: 'gemini', reason: 'env-disabled',
    });
  });

  it('falls back to Gemini when the API key or agent id is not configured', () => {
    expect(decideVoiceProvider(base({ credentialsPresent: false })).provider).toBe('gemini');
  });

  it('never hands an ElevenLabs token to a client that did not declare support', () => {
    // Shipped 1.55 builds send no `supports` array. They would jam the token
    // into the Gemini WebSocket URL and fail unreadably.
    expect(decideVoiceProvider(base({ clientSupports: undefined })).provider).toBe('gemini');
    expect(decideVoiceProvider(base({ clientSupports: [] })).provider).toBe('gemini');
    expect(decideVoiceProvider(base({ clientSupports: ['something-else'] })).provider).toBe('gemini');
  });

  it('selects nobody at 0 percent', () => {
    const cfg = { provider: 'elevenlabs', rolloutPercent: 0 };
    for (let i = 0; i < 50; i++) {
      expect(decideVoiceProvider(base({ uid: `u${i}`, config: cfg })).provider).toBe('gemini');
    }
  });

  it('selects everybody at 100 percent', () => {
    const cfg = { provider: 'elevenlabs', rolloutPercent: 100 };
    for (let i = 0; i < 50; i++) {
      expect(decideVoiceProvider(base({ uid: `u${i}`, config: cfg })).provider).toBe('elevenlabs');
    }
  });

  it('treats an absent rolloutPercent as 0, not as unlimited', () => {
    expect(decideVoiceProvider(base({ config: { provider: 'elevenlabs' } })).provider).toBe('gemini');
  });

  it('clamps a nonsense percentage instead of trusting it', () => {
    expect(decideVoiceProvider(base({ config: { provider: 'elevenlabs', rolloutPercent: 999 } })).provider)
      .toBe('elevenlabs');
    expect(decideVoiceProvider(base({ config: { provider: 'elevenlabs', rolloutPercent: -50 } })).provider)
      .toBe('gemini');
  });

  it('always includes a force-listed uid, whatever the percentage', () => {
    const cfg = { provider: 'elevenlabs', rolloutPercent: 0, forceUids: ['me'] };
    expect(decideVoiceProvider(base({ uid: 'me', config: cfg })).provider).toBe('elevenlabs');
    expect(decideVoiceProvider(base({ uid: 'someone-else', config: cfg })).provider).toBe('gemini');
  });

  it('gives the same user the same answer every time', () => {
    // A user who flipped buckets between reconnects would be handed a different
    // transport mid-conversation.
    const cfg = { provider: 'elevenlabs', rolloutPercent: 50 };
    const first = decideVoiceProvider(base({ uid: 'sticky-user', config: cfg })).provider;
    for (let i = 0; i < 20; i++) {
      expect(decideVoiceProvider(base({ uid: 'sticky-user', config: cfg })).provider).toBe(first);
    }
  });

  it('reports a reason for every decision, so logs can explain a user', () => {
    expect(decideVoiceProvider(base()).reason).toBeTruthy();
    expect(decideVoiceProvider(base({ envEnabled: false })).reason).toBe('env-disabled');
  });
});

describe('hashUidToPercent', () => {
  it('is stable across calls', () => {
    expect(hashUidToPercent('abc')).toBe(hashUidToPercent('abc'));
  });

  it('always lands inside 0..99', () => {
    for (let i = 0; i < 500; i++) {
      const p = hashUidToPercent(`uid-${i}`);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(100);
    }
  });

  it('distributes close enough to uniform that a percentage means something', () => {
    const N = 10_000;
    let under10 = 0;
    for (let i = 0; i < N; i++) if (hashUidToPercent(`user-${i}`) < 10) under10++;
    const pct = (under10 / N) * 100;
    expect(pct).toBeGreaterThan(7);
    expect(pct).toBeLessThan(13);
  });

  it('spreads different uids across buckets rather than clustering', () => {
    const seen = new Set(Array.from({ length: 200 }, (_, i) => hashUidToPercent(`u${i}`)));
    expect(seen.size).toBeGreaterThan(50);
  });
});
