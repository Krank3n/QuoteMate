/**
 * Pacing Mate's transcript against the audio clock.
 *
 * The model finishes generating in about a second while the voice takes five
 * to eight to say it, so painting deltas on arrival put whole replies — and on
 * tool-calling turns, the following reply too — on screen while Mate was still
 * mid-sentence.
 */
import { describe, it, expect } from 'vitest';
import {
  createPacerState, pushText, noteAudio, visibleText, flush, isSettled,
  revealedLength, pcmDurationMsFromBase64,
} from '../transcriptPacer';

// 1000ms of PCM16 @24kHz = 48000 bytes = 64000 base64 chars.
const audioOf = (ms: number) => 'A'.repeat(Math.round(ms * 48 * 4 / 3));

describe('pcmDurationMsFromBase64', () => {
  it('converts a one-second chunk', () => {
    expect(Math.round(pcmDurationMsFromBase64(audioOf(1000)))).toBe(1000);
  });

  it('accounts for base64 padding', () => {
    const unpadded = pcmDurationMsFromBase64('AAAA');
    expect(pcmDurationMsFromBase64('AA==')).toBeLessThan(unpadded);
  });

  it('treats empty input as no audio', () => {
    expect(pcmDurationMsFromBase64('')).toBe(0);
  });
});

describe('transcript pacer', () => {
  it('shows nothing before any audio is queued', () => {
    // Text routinely arrives before the first PCM chunk. Showing it then is
    // exactly the bug: the words beat the voice to the screen.
    const s = createPacerState();
    pushText(s, 'Morning, what do you need?');
    expect(visibleText(s, 1000)).toBe('');
  });

  it('reveals roughly half the text at the halfway point', () => {
    const s = createPacerState();
    pushText(s, 'one two three four five six seven eight');
    noteAudio(s, 1000, 0);
    const shown = visibleText(s, 500);
    expect(shown.length).toBeGreaterThan(10);
    expect(shown.length).toBeLessThan(30);
  });

  it('reveals everything once the audio has played out', () => {
    const s = createPacerState();
    pushText(s, 'all of it now');
    noteAudio(s, 1000, 0);
    expect(visibleText(s, 1000)).toBe('all of it now');
  });

  it('never reveals a partial word', () => {
    const s = createPacerState();
    pushText(s, 'balustrades and steps');
    noteAudio(s, 1000, 0);
    for (let t = 0; t <= 900; t += 50) {
      const shown = visibleText(s, t);
      // Whatever is shown must end at a boundary, never mid-word.
      if (shown.length && shown.length < s.fullText.length) {
        expect(s.fullText[shown.length]).toBe(' ');
      }
    }
  });

  it('never goes backwards', () => {
    // A late audio chunk lengthens the utterance, which lowers the computed
    // fraction. Text that has been read must not vanish.
    const s = createPacerState();
    pushText(s, 'one two three four five six');
    noteAudio(s, 1000, 0);
    const early = visibleText(s, 900).length;
    noteAudio(s, 4000, 900);
    expect(visibleText(s, 950).length).toBeGreaterThanOrEqual(early);
  });

  it('paces against total audio, so a long reply reveals slowly', () => {
    const s = createPacerState();
    pushText(s, 'a b c d e f g h i j k l m n o p');
    noteAudio(s, 8000, 0);
    // One second into an eight-second utterance: only a sliver.
    expect(visibleText(s, 1000).length).toBeLessThan(s.fullText.length / 4);
  });

  it('flush shows everything regardless of the clock', () => {
    // End of turn must not leave words stranded if playback under-ran.
    const s = createPacerState();
    pushText(s, 'the whole thing');
    noteAudio(s, 10_000, 0);
    expect(flush(s)).toBe('the whole thing');
    expect(visibleText(s, 0)).toBe('the whole thing');
  });

  it('stays settled once flushed even as more time passes', () => {
    const s = createPacerState();
    pushText(s, 'done');
    noteAudio(s, 100, 0);
    flush(s);
    expect(isSettled(s)).toBe(true);
    expect(visibleText(s, 99_999)).toBe('done');
  });

  it('handles text arriving after audio has started', () => {
    // Deltas and PCM interleave; text can lag the first chunk.
    const s = createPacerState();
    noteAudio(s, 1000, 0);
    pushText(s, 'later words arrive');
    expect(visibleText(s, 1000)).toBe('later words arrive');
  });

  it('reports unsettled while text is still hidden', () => {
    const s = createPacerState();
    pushText(s, 'one two three four');
    noteAudio(s, 1000, 0);
    visibleText(s, 100);
    expect(isSettled(s)).toBe(false);
  });

  it('does not divide by zero when audio duration is zero', () => {
    const s = createPacerState();
    pushText(s, 'text');
    noteAudio(s, 0, 0);
    expect(revealedLength(s, 500)).toBe(0);
  });
});
