// Did the tradie actually say something, or did the room just make a noise?
//
// Server-side VAD commits a turn on any sound it takes for speech. In a real
// conversation that produced replies to nothing at all: a session ended with
// four unprompted wrap-ups in a row — "All good.", "Yep, it's out of the
// way.", "Sounds like we're done here." — with no tradie turn between them,
// because each phantom turn made Mate restate whatever it was still waiting
// on. From the outside that reads as Mate looping.
//
// Speech-to-text is the tell: a committed turn that transcribes to nothing was
// never a turn. Whisper-family models don't return an empty string for silence
// though — they return a small set of stock phrases, which is what this knows.

/**
 * Stock output Whisper-family models emit for silence or noise.
 *
 * Deliberately short. Every entry costs a real utterance that happens to match
 * it, so this covers only what silence actually produces — never plain words a
 * tradie might say on their own, which is why "yeah", "yep", "no" and "skip"
 * are absent: those are real answers to Mate's questions.
 */
const SILENCE_ARTEFACTS = new Set([
  'you',
  'thank you',
  'thank you.',
  'thanks for watching',
  'thanks for watching!',
  'bye',
  'bye.',
  '[blank_audio]',
  '[silence]',
  '[music]',
]);

/** True when a transcript is worth waking the model for. */
export function isMeaningfulTranscript(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  // Punctuation, musical notes and the like on their own are never speech.
  if (!/[a-z0-9]/i.test(trimmed)) return false;
  return !SILENCE_ARTEFACTS.has(trimmed.toLowerCase());
}

/**
 * Could this partial transcript still turn into one of the stock phrases?
 *
 * The reply gate fires on the first delta that proves speech, which means
 * judging text that is still arriving. "Thank" reads as real speech; "Thank
 * you." is silence. Anything that is still a prefix of an artefact has to wait
 * for the next delta before it can be trusted either way.
 */
export function couldStillBecomeArtefact(raw: string | null | undefined): boolean {
  const t = String(raw || '').trim().toLowerCase();
  if (!t) return true;
  for (const artefact of SILENCE_ARTEFACTS) {
    if (artefact !== t && artefact.startsWith(t)) return true;
  }
  return false;
}

/** Is this partial transcript enough to wake the model? */
export function shouldAnswerYet(partial: string | null | undefined): boolean {
  return isMeaningfulTranscript(partial) && !couldStillBecomeArtefact(partial);
}
