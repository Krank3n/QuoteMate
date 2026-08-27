// How long a voice session actually ran.
//
// Pure, because the arithmetic has two edges that matter and neither is
// observable on a device: a session that never connected must cost nothing,
// and a clock that jumps backwards mid-call must not produce a negative that
// hands the tradie free minutes back.
//
// Measured from CONNECT, not from open. The mint, the WebRTC handshake and the
// mic permission prompt all happen before there is anything to talk to, and
// charging a tradie for a permission dialog they were reading is wrong.

/** Elapsed seconds, floored at zero and rounded. */
export function elapsedVoiceSeconds(connectedAtMs: number | null, nowMs: number): number {
  if (!connectedAtMs) return 0;
  const seconds = Math.round((nowMs - connectedAtMs) / 1000);
  return seconds > 0 ? seconds : 0;
}
