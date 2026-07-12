// Pure decision for what a live voice session should do when the app's
// AppState changes. Kept side-effect free so the policy can be unit tested
// without AppState, timers, or the audio stack.
//
// Two distinct transient signals we must NOT treat as a real backgrounding:
//
//   * iOS 'inactive' — fires for Control Center, the notification shade,
//     Siri, an incoming-call banner, the app-switcher swipe. Can linger for
//     several seconds while the overlay is up. Gets a long grace.
//
//   * A spurious 'background' → 'active' bounce that Android emits the moment
//     we start the audio/mic stack. Left unhandled it tore the session down
//     and the auto-start-on-'active' handler immediately re-opened it —
//     minting a fresh ephemeral token every cycle until the server's
//     10-mints/minute limit tripped and voice died with "too many requests."
//     The bounce returns to 'active' in a few hundred ms, so a SHORT grace
//     absorbs it: the session survives the bounce, so it's never re-opened
//     and never re-mints. A genuine background stays backgrounded and stops
//     once the short grace elapses (mic released promptly).
//
// A real backgrounding always ends in 'background', so 'background' starts
// the short grace even if the long inactive grace is already running
// (replacing it) — that keeps iOS foreground→inactive→background from
// leaving the mic hot for the full inactive window.

import type { AppStateStatus } from 'react-native';

// A genuine background stops the session after this; a spurious audio-start
// bounce returns to 'active' well within it (observed ~400ms) and is absorbed.
export const VOICE_BACKGROUND_GRACE_MS = 1500;

// How long a session may ride out 'inactive' before being stopped. Long
// enough to read a notification banner or flick Control Center on and off.
export const VOICE_INACTIVE_GRACE_MS = 15_000;

export type VoiceAppStateAction =
  /** Stop the session now and cancel any pending grace countdown. */
  | 'stop'
  /** Start (or replace with) the short background grace; stop only if it expires. */
  | 'start-grace-short'
  /** Start the long inactive grace; stop only if it expires. */
  | 'start-grace-long'
  /** Back to foreground — cancel the countdown and re-arm auto-start. */
  | 'cancel-grace'
  /** Nothing to do. */
  | 'ignore';

export interface VoiceAppStateParams {
  nextState: AppStateStatus;
  /** A voice session (sticky or PTT) is currently open. */
  hasVoiceSession: boolean;
  /** A grace countdown is already running. */
  graceRunning: boolean;
}

export function voiceActionForAppState(p: VoiceAppStateParams): VoiceAppStateAction {
  switch (p.nextState) {
    case 'background':
      // No session → nothing to protect. With a session, debounce: the short
      // grace absorbs the audio-start bounce and still stops a real
      // background promptly. Always (re)starts it, overriding a running
      // inactive grace so a true background can't stay hot for the long window.
      return p.hasVoiceSession ? 'start-grace-short' : 'stop';
    case 'inactive':
      // No session → nothing to protect; a grace already running (short bg
      // grace, or a prior inactive) takes precedence — don't extend it.
      return p.hasVoiceSession && !p.graceRunning ? 'start-grace-long' : 'ignore';
    case 'active':
      return 'cancel-grace';
    default:
      // 'unknown' / 'extension' — never tear down on an ambiguous state.
      return 'ignore';
  }
}
