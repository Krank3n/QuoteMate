/**
 * Pure transcript-folding helpers for dictation.
 *
 * Extracted from the voice-capture logic in JobDetailsScreen so the segment
 * accumulation / refinement / restart handling can be unit tested in
 * isolation and reused by DictationButton. Mirrors the behaviour of the
 * original 'result' / 'end' / stop handlers:
 *
 *  - `accumulated` is the text banked before the in-flight segment (seeded
 *    from whatever the tradie had already typed when recording started).
 *  - `lastSegment` is the latest interim/final transcript for the segment
 *    the recogniser is currently working on. Each result frame carries the
 *    FULL transcript for that segment, not incremental text, so the display
 *    is always accumulated + latest segment.
 */

export interface DictationSegmentState {
  /** Text committed before the in-flight segment. */
  accumulated: string;
  /** Latest interim/final transcript for the in-flight segment. */
  lastSegment: string;
}

export const emptyDictationState = (): DictationSegmentState => ({
  accumulated: '',
  lastSegment: '',
});

/**
 * Join dictated text onto existing text with sensible spacing: exactly one
 * space between them, no trailing-whitespace doubling, and no stray space
 * when either side is empty.
 */
export function appendTranscript(base: string, addition: string): string {
  const trimmedAddition = addition.trim();
  if (!trimmedAddition) return base;
  const trimmedBase = base.replace(/\s+$/, '');
  return trimmedBase ? `${trimmedBase} ${trimmedAddition}` : trimmedAddition;
}

/**
 * Fold one recognition result frame into the segment state.
 *
 * `isFinal` comes directly from expo-speech-recognition. Interim frames are
 * volatile revisions of the SAME utterance and must replace `lastSegment`,
 * even when the recogniser changes the opening words ("I wanna" → "I want").
 * Guessing from word similarity previously banked both revisions and produced
 * duplicated phrases in customer scopes. Only an explicit final frame commits
 * a segment; the native `end` handler commits any remaining interim segment.
 *
 * Returns null when the frame carries no usable transcript.
 */
export function foldDictationResult(
  state: DictationSegmentState,
  transcript: string,
  isFinal: boolean,
): { state: DictationSegmentState; display: string } | null {
  const current = transcript.trim();
  if (!current) return null;

  if (isFinal) {
    const accumulated = appendTranscript(state.accumulated, current);
    return {
      state: { accumulated, lastSegment: '' },
      display: accumulated,
    };
  }

  return {
    state: { ...state, lastSegment: current },
    display: appendTranscript(state.accumulated, current),
  };
}

/**
 * Bank the in-flight segment into the accumulated text. Used when the
 * recogniser fires 'end' mid-recording and is about to be restarted.
 * No-op when there is nothing in flight.
 */
export function commitSegment(state: DictationSegmentState): DictationSegmentState {
  if (!state.lastSegment) return state;
  return {
    accumulated: appendTranscript(state.accumulated, state.lastSegment),
    lastSegment: '',
  };
}

/**
 * Compose the final text when the tradie taps stop. Falls back to the
 * field's existing text when nothing was captured (so stopping immediately
 * never wipes what was already typed).
 */
export function finalizeDictation(state: DictationSegmentState, fallback: string): string {
  const joined = appendTranscript(state.accumulated, state.lastSegment);
  return joined || fallback;
}
