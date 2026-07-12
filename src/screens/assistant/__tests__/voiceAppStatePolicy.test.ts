// The 'background'/'inactive'/'active' policy for a live voice session.
//
// Two bugs this guards against:
//   * Treating iOS 'inactive' (Control Center, notification shade, call
//     banner) like a real backgrounding killed the session every time the
//     tradie peeked at a notification mid-conversation.
//   * The spurious 'background'→'active' bounce Android fires when the
//     audio/mic stack starts used to tear the session down and trigger an
//     immediate re-open, minting a token every cycle until the rate limit
//     tripped ("too many requests"). The short background grace absorbs it.

import { describe, it, expect } from 'vitest';
import { voiceActionForAppState } from '../voiceAppStatePolicy';

describe('voiceActionForAppState', () => {
  describe('background', () => {
    it('starts the short grace (debounced teardown) when a session is live', () => {
      expect(
        voiceActionForAppState({ nextState: 'background', hasVoiceSession: true, graceRunning: false }),
      ).toBe('start-grace-short');
    });

    it('replaces a running (inactive) grace so a real background stops promptly', () => {
      // iOS foreground→inactive→background: the long inactive grace must be
      // superseded by the short one, or the mic stays hot for 15s in the bg.
      expect(
        voiceActionForAppState({ nextState: 'background', hasVoiceSession: true, graceRunning: true }),
      ).toBe('start-grace-short');
    });

    it('stops immediately when there is no session to protect', () => {
      expect(
        voiceActionForAppState({ nextState: 'background', hasVoiceSession: false, graceRunning: false }),
      ).toBe('stop');
    });
  });

  describe('inactive', () => {
    it('starts the long grace when a session is live and none is running', () => {
      expect(
        voiceActionForAppState({ nextState: 'inactive', hasVoiceSession: true, graceRunning: false }),
      ).toBe('start-grace-long');
    });

    it('does not restart or extend a grace already running', () => {
      expect(
        voiceActionForAppState({ nextState: 'inactive', hasVoiceSession: true, graceRunning: true }),
      ).toBe('ignore');
    });

    it('does nothing without a session', () => {
      expect(
        voiceActionForAppState({ nextState: 'inactive', hasVoiceSession: false, graceRunning: false }),
      ).toBe('ignore');
    });
  });

  describe('active', () => {
    it('cancels any grace so the session survives the bounce/peek', () => {
      expect(
        voiceActionForAppState({ nextState: 'active', hasVoiceSession: true, graceRunning: true }),
      ).toBe('cancel-grace');
      expect(
        voiceActionForAppState({ nextState: 'active', hasVoiceSession: false, graceRunning: false }),
      ).toBe('cancel-grace');
    });
  });

  it('never tears down on ambiguous states', () => {
    for (const nextState of ['unknown', 'extension'] as const) {
      expect(
        voiceActionForAppState({ nextState, hasVoiceSession: true, graceRunning: false }),
      ).toBe('ignore');
    }
  });

  it('models the audio-start bounce end to end: bounce is absorbed, real bg stops', () => {
    // Bounce: background (start short grace) → active before it expires (cancel).
    expect(
      voiceActionForAppState({ nextState: 'background', hasVoiceSession: true, graceRunning: false }),
    ).toBe('start-grace-short');
    expect(
      voiceActionForAppState({ nextState: 'active', hasVoiceSession: true, graceRunning: true }),
    ).toBe('cancel-grace');
    // Real background: short grace runs to completion → the screen's timer stops it.
    // (Expiry is exercised in the screen wiring, not the pure policy.)
  });
});
