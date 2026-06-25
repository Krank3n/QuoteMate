// Pure decision for whether Mate should silently auto-start the mic when
// the tab gains focus. Kept side-effect free so the gating logic can be
// unit tested without React Navigation, AppState, or the audio stack.

export type VoiceState = 'idle' | 'connecting' | 'listening' | 'thinking';

export interface ShouldAutoStartParams {
  // Resolved setting (autoStartMicOnMate !== false → default ON).
  enabled: boolean;
  voiceState: VoiceState;
  // Mic permission already granted — never prompt to auto-start.
  permissionGranted: boolean;
  // Mate tab is the focused screen.
  isFocused: boolean;
  // App is in the foreground.
  appActive: boolean;
}

export function shouldAutoStartMic(p: ShouldAutoStartParams): boolean {
  return (
    p.enabled &&
    p.isFocused &&
    p.appActive &&
    p.permissionGranted &&
    p.voiceState === 'idle'
  );
}
