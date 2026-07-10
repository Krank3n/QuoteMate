// Pure decision for what a live voice session should do when the app's
// AppState changes. Kept side-effect free so the policy can be unit tested
// without AppState, timers, or the audio stack.
//
// The distinction that matters: on iOS, 'inactive' fires for transient
// overlays — Control Center, the notification shade, Siri, an incoming-call
// banner, the app-switcher swipe — as well as on the way to a real
// background. Tearing the session down on 'inactive' means a tradie who
// peeks at a notification mid-conversation loses Mate and has to re-tap.
// So 'inactive' only starts a grace countdown; 'background' (the app is
// actually gone, and iOS will suspend the socket/mic anyway) still stops
// immediately and cancels any pending grace. Android never emits
// 'inactive', so its behaviour is unchanged.

import type { AppStateStatus } from 'react-native';

// How long a session may ride out 'inactive' before being stopped. Long
// enough to read a notification banner or flick Control Center on and off;
// short enough that the mic isn't left hot under an overlay for long. A
// real backgrounding supersedes this instantly via the 'background' event.
export const VOICE_INACTIVE_GRACE_MS = 15_000;

export type VoiceAppStateAction =
  /** Stop the session now and cancel any pending grace countdown. */
  | 'stop'
  /** Begin the inactive grace countdown; stop only if it expires. */
  | 'start-grace'
  /** Back to foreground — cancel the countdown and re-arm auto-start. */
  | 'cancel-grace'
  /** Nothing to do. */
  | 'ignore';

export interface VoiceAppStateParams {
  nextState: AppStateStatus;
  /** A voice session (sticky or PTT) is currently open. */
  hasVoiceSession: boolean;
  /** The inactive grace countdown is already running. */
  graceRunning: boolean;
}

export function voiceActionForAppState(p: VoiceAppStateParams): VoiceAppStateAction {
  switch (p.nextState) {
    case 'background':
      return 'stop';
    case 'inactive':
      // No session → nothing to protect; countdown already running → let it
      // ride (iOS can emit repeated 'inactive' while an overlay is up).
      return p.hasVoiceSession && !p.graceRunning ? 'start-grace' : 'ignore';
    case 'active':
      return 'cancel-grace';
    default:
      // 'unknown' / 'extension' — never tear down on an ambiguous state.
      return 'ignore';
  }
}
