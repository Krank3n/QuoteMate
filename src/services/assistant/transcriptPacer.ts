// Reveal Mate's words at the pace they are actually spoken.
//
// The model generates a whole reply in about a second; the audio for it plays
// over five to eight. Painting transcript deltas as they arrive therefore put
// the full text on screen — and on a tool-calling turn, the NEXT bubble too —
// while Mate was still on the first sentence. Text and voice read as two
// different things happening at once.
//
// So the reveal is driven by the audio clock instead of the generation clock.
// Every PCM chunk we queue for playback is a known number of milliseconds, so
// the total duration of the utterance is known almost immediately, and elapsed
// time since playback began is a good estimate of how far through it the voice
// has got. Reveal that fraction of the text.
//
// Only for transports where WE play the audio. ElevenLabs plays on its own
// WebRTC track and hands us no PCM, so there is no clock here to pace against
// and its transcripts must pass straight through.

/** PCM16 mono at 24 kHz: 48 bytes per millisecond. */
const BYTES_PER_MS = 48;

/** Base64 decodes to 3 bytes per 4 chars; padding costs at most 2 bytes. */
export function pcmDurationMsFromBase64(base64: string): number {
  if (!base64) return 0;
  let padding = 0;
  if (base64.endsWith('==')) padding = 2;
  else if (base64.endsWith('=')) padding = 1;
  const bytes = Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
  return bytes / BYTES_PER_MS;
}

export interface PacerState {
  /** Everything the model has said this turn, whether shown yet or not. */
  fullText: string;
  /** Total milliseconds of audio queued for this turn. */
  totalAudioMs: number;
  /** When playback began, or null before the first chunk. */
  startedAtMs: number | null;
  /** Characters already shown. Never decreases — text must not un-appear. */
  revealed: number;
  /** Set once the turn is done: everything is shown regardless of the clock. */
  flushed: boolean;
}

export function createPacerState(): PacerState {
  return { fullText: '', totalAudioMs: 0, startedAtMs: null, revealed: 0, flushed: false };
}

export function pushText(state: PacerState, delta: string): void {
  if (delta) state.fullText += delta;
}

export function noteAudio(state: PacerState, durationMs: number, nowMs: number): void {
  if (durationMs <= 0) return;
  if (state.startedAtMs === null) state.startedAtMs = nowMs;
  state.totalAudioMs += durationMs;
}

/**
 * How many characters should be on screen at `nowMs`.
 *
 * Reveal stops at a word boundary so words don't appear a letter at a time,
 * except at the very end where the remainder is whatever is left.
 */
export function revealedLength(state: PacerState, nowMs: number): number {
  if (state.flushed) return state.fullText.length;
  if (state.startedAtMs === null || state.totalAudioMs <= 0) return state.revealed;

  const played = Math.max(0, nowMs - state.startedAtMs);
  const fraction = Math.min(1, played / state.totalAudioMs);
  const target = Math.floor(state.fullText.length * fraction);
  if (target <= state.revealed) return state.revealed;
  if (target >= state.fullText.length) return state.fullText.length;

  // Back off to the last word boundary so a half-written word never shows.
  const boundary = state.fullText.lastIndexOf(' ', target);
  return boundary > state.revealed ? boundary : state.revealed;
}

/** The text that should be visible at `nowMs`, advancing the state. */
export function visibleText(state: PacerState, nowMs: number): string {
  state.revealed = revealedLength(state, nowMs);
  return state.fullText.slice(0, state.revealed);
}

/** End of turn — show everything, whatever the clock says. */
export function flush(state: PacerState): string {
  state.flushed = true;
  state.revealed = state.fullText.length;
  return state.fullText;
}

/** True once every character has been shown and no audio is outstanding. */
export function isSettled(state: PacerState): boolean {
  return state.revealed >= state.fullText.length;
}
