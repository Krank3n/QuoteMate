// Pure decision for whether Mate should silently auto-start the mic when
// the tab gains focus. Kept side-effect free so the gating logic can be
// unit tested without React Navigation, AppState, or the audio stack.

export type VoiceState = 'idle' | 'connecting' | 'listening' | 'thinking';

// Backstop against a mint storm: each voice open mints an ephemeral token,
// and the server rate-limits mints to 10 per SLIDING 60s window
// (assistantToken HEAVY). If some AppState/focus churn ever slips past the
// grace debounce and drives repeated auto-starts, this cooldown must keep
// auto-start under that limit on its own: 60000/10 = 6000ms is the ceiling,
// so 7000ms leaves margin. (The debounce is the primary fix; this is the
// belt to its braces.)
export const AUTO_START_COOLDOWN_MS = 7000;

// Single source of truth for the setting's default: auto-start is opt-IN,
// so undefined counts as OFF. Every read of autoStartMicOnMate goes through
// this — a raw `!== false` check silently flips the default back to ON.
export function resolveAutoStartMic(v?: boolean): boolean {
  return v === true;
}

export interface ShouldAutoStartParams {
  // Resolved setting (resolveAutoStartMic — only an explicit true opts in).
  enabled: boolean;
  voiceState: VoiceState;
  // Mic permission already granted — never prompt to auto-start.
  permissionGranted: boolean;
  // Mate tab is the focused screen.
  isFocused: boolean;
  // App is in the foreground.
  appActive: boolean;
  // ms since the last auto-start attempt. The screen seeds the ref at 0, so
  // the first attempt sees a large finite value (Date.now() - 0) and passes;
  // omit (undefined) to skip the cooldown gate entirely. Guards against a
  // churn-driven re-mint loop.
  sinceLastAttemptMs?: number;
}

export function shouldAutoStartMic(p: ShouldAutoStartParams): boolean {
  return (
    p.enabled &&
    p.isFocused &&
    p.appActive &&
    p.permissionGranted &&
    p.voiceState === 'idle' &&
    (p.sinceLastAttemptMs === undefined || p.sinceLastAttemptMs >= AUTO_START_COOLDOWN_MS)
  );
}
