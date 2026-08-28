/**
 * Guard against Mate replying to silence.
 *
 * A real session ended with four unprompted wrap-ups in a row and no tradie
 * turn between them — each phantom VAD turn made Mate restate its outstanding
 * question, which reads as looping.
 */
import { describe, it, expect } from 'vitest';
import { isMeaningfulTranscript } from '../heardSomething';

describe('isMeaningfulTranscript', () => {
  it('accepts a normal utterance', () => {
    expect(isMeaningfulTranscript('quote for Karl, deck replacement')).toBe(true);
  });

  it('rejects nothing at all', () => {
    expect(isMeaningfulTranscript('')).toBe(false);
    expect(isMeaningfulTranscript('   ')).toBe(false);
    expect(isMeaningfulTranscript(null)).toBe(false);
    expect(isMeaningfulTranscript(undefined)).toBe(false);
  });

  it('rejects the stock phrases silence produces', () => {
    for (const s of ['you', 'Thank you.', 'Thanks for watching!', '[BLANK_AUDIO]', 'Bye.']) {
      expect(isMeaningfulTranscript(s)).toBe(false);
    }
  });

  it('rejects punctuation on its own', () => {
    for (const s of ['.', '...', '♪', '?!']) {
      expect(isMeaningfulTranscript(s)).toBe(false);
    }
  });

  it('KEEPS the short words that are real answers', () => {
    // These are exactly what a tradie says to Mate's questions. Filtering them
    // as noise would be far worse than the bug this fixes.
    for (const s of ['yeah', 'yep', 'no', 'skip', 'unspecified', 'go on', '20']) {
      expect(isMeaningfulTranscript(s)).toBe(true);
    }
  });

  it('is case and whitespace insensitive for artefacts', () => {
    expect(isMeaningfulTranscript('  THANK YOU.  ')).toBe(false);
  });

  it('keeps a real sentence that merely contains an artefact word', () => {
    expect(isMeaningfulTranscript('thank you, now price it up')).toBe(true);
  });
});
