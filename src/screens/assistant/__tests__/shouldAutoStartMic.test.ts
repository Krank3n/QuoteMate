import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  shouldAutoStartMic,
  resolveAutoStartMic,
  withAutoStartMicToggled,
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

describe('withAutoStartMicToggled (Mate tab header switch)', () => {
  it('flips an unset setting ON — unset means off', () => {
    expect(withAutoStartMicToggled({ businessName: 'X' } as any).autoStartMicOnMate).toBe(true);
  });

  it('flips on to off and off to on', () => {
    expect(withAutoStartMicToggled({ autoStartMicOnMate: true }).autoStartMicOnMate).toBe(false);
    expect(withAutoStartMicToggled({ autoStartMicOnMate: false }).autoStartMicOnMate).toBe(true);
  });

  it('keeps every other field and drops the retired surcharge flag', () => {
    const next = withAutoStartMicToggled({
      businessName: 'Lakeside Painting',
      defaultLaborRate: 95,
      surchargePaymentFees: true,
      autoStartMicOnMate: false,
    } as any);
    expect(next).toEqual({ businessName: 'Lakeside Painting', defaultLaborRate: 95, autoStartMicOnMate: true });
  });
});

describe('AssistantScreen wiring (source guard)', () => {
  // No render harness for the 4k-line Mate screen, so pin the two lines that
  // matter by source. The focus effect's cleanup stops the live voice
  // session; with the switch now on this tab, depending on the setting would
  // cut a tradie off mid-conversation the moment they flipped it.
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../AssistantScreen.tsx'), 'utf8');

  it('reads the setting at focus through a ref, not as a focus-effect dependency', () => {
    expect(src).toContain('const enabled = autoStartMicRef.current;');
    expect(src).not.toMatch(/\}, \[businessSettings\?\.autoStartMicOnMate\]\),\s*\);/);
  });

  it('offers the switch from the Mate header', () => {
    expect(src).toContain('accessibilityLabel="Mate voice settings"');
    expect(src).toContain('withAutoStartMicToggled(businessSettings)');
  });
});
