import { describe, it, expect } from 'vitest';
import {
  shouldAutoStartMic,
  resolveAutoStartMic,
  AUTO_START_COOLDOWN_MS,
  type ShouldAutoStartParams,
  type VoiceState,
} from '../shouldAutoStartMic';

// All conditions met — the only case that returns true. Each test below
// flips exactly one field off this baseline so we know precisely which
// gate is being exercised.
function allMet(): ShouldAutoStartParams {
  return {
    enabled: true,
    voiceState: 'idle',
    permissionGranted: true,
    isFocused: true,
    appActive: true,
  };
}

describe('shouldAutoStartMic', () => {
  it('returns true when all conditions are met', () => {
    expect(shouldAutoStartMic(allMet())).toBe(true);
  });

  it('returns false when the setting is disabled', () => {
    expect(shouldAutoStartMic({ ...allMet(), enabled: false })).toBe(false);
  });

  it('returns false when a voice session is already active', () => {
    const busyStates: VoiceState[] = ['connecting', 'listening', 'thinking'];
    for (const voiceState of busyStates) {
      expect(shouldAutoStartMic({ ...allMet(), voiceState })).toBe(false);
    }
  });

  it('returns false when mic permission is not granted', () => {
    expect(shouldAutoStartMic({ ...allMet(), permissionGranted: false })).toBe(false);
  });

  it('returns false when the tab is not focused', () => {
    expect(shouldAutoStartMic({ ...allMet(), isFocused: false })).toBe(false);
  });

  it('returns false when the app is backgrounded', () => {
    expect(shouldAutoStartMic({ ...allMet(), appActive: false })).toBe(false);
  });

  describe('mint-storm cooldown', () => {
    it('allows auto-start when no attempt has happened yet (undefined)', () => {
      expect(shouldAutoStartMic({ ...allMet(), sinceLastAttemptMs: undefined })).toBe(true);
    });

    it('blocks a re-mint within the cooldown window', () => {
      expect(shouldAutoStartMic({ ...allMet(), sinceLastAttemptMs: 0 })).toBe(false);
      expect(shouldAutoStartMic({ ...allMet(), sinceLastAttemptMs: AUTO_START_COOLDOWN_MS - 1 })).toBe(false);
    });

    it('allows auto-start once the cooldown has elapsed', () => {
      expect(shouldAutoStartMic({ ...allMet(), sinceLastAttemptMs: AUTO_START_COOLDOWN_MS })).toBe(true);
      expect(shouldAutoStartMic({ ...allMet(), sinceLastAttemptMs: 60_000 })).toBe(true);
    });
  });
});

describe('autoStartMicOnMate default resolution', () => {
  // Auto-start is opt-IN: each auto-start mints a Live token and burns a
  // daily assistant turn, so undefined must resolve OFF.
  it('defaults OFF when the setting is undefined', () => {
    expect(resolveAutoStartMic(undefined)).toBe(false);
  });

  it('ON only when explicitly true', () => {
    expect(resolveAutoStartMic(true)).toBe(true);
  });

  it('OFF when explicitly false', () => {
    expect(resolveAutoStartMic(false)).toBe(false);
  });
});
