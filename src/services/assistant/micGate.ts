// The half-duplex mic gate: may the microphone be streamed to the model right
// now, or is Mate's own voice still coming out of the speaker?
//
// This exists as a pure function because getting it wrong does not look like a
// bug — it looks like the model being manic. With no acoustic echo
// cancellation on the raw-PCM transports, an open mic during playback feeds
// Mate's own speech back into the server-side VAD, which treats it as a new
// user turn and replies to it. That reply is also played, and re-heard. On
// Android it was an infinite loop; the first OpenAI Realtime device test
// produced three assistant turns off a single "Hello", one of them asking for
// the dimensions of a fence nobody had mentioned.

export type VoiceMode = 'speaking' | 'listening';

/**
 * Next value for the "Mate is audible" flag that gates mic capture.
 *
 * `transportOwnsPlayback` is the load-bearing argument:
 *
 * - `false` — the SCREEN plays, via the PCM audio queue (Gemini, OpenAI).
 *   A transport's 'listening' means the model finished GENERATING, which is
 *   seconds before the queued audio finishes PLAYING. It must NOT open the
 *   gate; only the queue draining can do that.
 * - `true` — the SDK plays on its own track (ElevenLabs over WebRTC). There is
 *   no queue to drain and hardware AEC handles the echo, so the transport's
 *   own mode is the only signal available, and it is authoritative.
 *
 * Closing the gate is always safe, so 'speaking' closes it either way — early
 * is fine, late is the failure.
 */
export function nextMatePlaying(
  current: boolean,
  mode: VoiceMode,
  transportOwnsPlayback: boolean,
): boolean {
  if (mode === 'speaking') return true;
  return transportOwnsPlayback ? false : current;
}
