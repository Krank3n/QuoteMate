// Serialises voice-session opens against each other and against stops.
//
// Two races this guards (both real on slow networks):
//   * Double open — the auto-start-on-focus path awaits a permission check
//     before calling openVoiceMode; a manual mic tap can land inside that
//     gap. Two concurrent opens each create a mic, an audio queue, and a
//     WebSocket, then overwrite the same refs — the first set is orphaned
//     with the mic left hot.
//   * Stop during open — openVoiceMode awaits the token mint + WS handshake;
//     a stop tapped inside that window tears down and nulls the refs, then
//     the still-running open assigns them again. Result: a live session and
//     hot mic while the UI shows idle.
//
// Pure and stateful-by-closure so the policy is unit testable without the
// screen, timers, or the audio stack.

export interface VoiceOpenGate {
  /**
   * Claim the right to open. Returns a token to check/end with, or null if
   * another open is already in flight (caller should just bail).
   */
  tryBegin(): number | null;
  /** The open finished (success or failure). No-op if a stop superseded it. */
  end(token: number): void;
  /** A stop ran — any in-flight open is cancelled and may begin anew. */
  invalidate(): void;
  /** False once invalidate() ran after this token was issued. */
  isCurrent(token: number): boolean;
}

export function createVoiceOpenGate(): VoiceOpenGate {
  let current = 0;
  let inFlight = false;
  return {
    tryBegin() {
      if (inFlight) return null;
      inFlight = true;
      current += 1;
      return current;
    },
    end(token) {
      // A stale end (the open that a stop already cancelled) must not
      // release the gate a newer open is holding.
      if (token === current) inFlight = false;
    },
    invalidate() {
      current += 1;
      inFlight = false;
    },
    isCurrent(token) {
      return token === current;
    },
  };
}
