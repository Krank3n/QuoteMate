import { describe, it, expect } from 'vitest';
import {
  shouldAutoStartMic,
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
});

describe('autoStartMicOnMate default resolution', () => {
  // The screen resolves the setting as `autoStartMicOnMate !== false` so a
  // missing/undefined value defaults the feature ON, and only an explicit
  // false opts out.
  const resolveEnabled = (autoStartMicOnMate?: boolean) => autoStartMicOnMate !== false;

  it('defaults ON when the setting is undefined', () => {
    expect(resolveEnabled(undefined)).toBe(true);
  });

  it('stays ON when explicitly true', () => {
    expect(resolveEnabled(true)).toBe(true);
  });

  it('is OFF only when explicitly false', () => {
    expect(resolveEnabled(false)).toBe(false);
  });
});
