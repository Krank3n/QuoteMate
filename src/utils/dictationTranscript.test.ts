import { describe, it, expect } from 'vitest';

import {
  appendTranscript,
  commitSegment,
  emptyDictationState,
  finalizeDictation,
  foldDictationResult,
  type DictationSegmentState,
} from './dictationTranscript';

const state = (accumulated: string, lastSegment: string): DictationSegmentState => ({
  accumulated,
  lastSegment,
});

describe('appendTranscript', () => {
  it('joins base and addition with a single space', () => {
    expect(appendTranscript('replace downpipe', 'and clean gutters')).toBe(
      'replace downpipe and clean gutters',
    );
  });

  it('returns the addition alone when base is empty', () => {
    expect(appendTranscript('', 'flush the system')).toBe('flush the system');
  });

  it('returns base untouched when the addition is blank or whitespace', () => {
    expect(appendTranscript('serviced the unit', '')).toBe('serviced the unit');
    expect(appendTranscript('serviced the unit', '   ')).toBe('serviced the unit');
  });

  it('does not double spaces when base has trailing whitespace or newlines', () => {
    expect(appendTranscript('checked seals ', 'replaced filter')).toBe(
      'checked seals replaced filter',
    );
    expect(appendTranscript('checked seals\n', 'replaced filter')).toBe(
      'checked seals replaced filter',
    );
  });

  it('trims the addition before joining', () => {
    expect(appendTranscript('base', '  extra  ')).toBe('base extra');
  });
});

describe('foldDictationResult', () => {
  it('returns null for a blank transcript', () => {
    expect(foldDictationResult(state('notes', 'seg'), '   ', 2)).toBeNull();
  });

  it('displays accumulated + current segment on a normal interim update', () => {
    const folded = foldDictationResult(state('existing notes', ''), 'replaced the valve', 1);
    expect(folded).not.toBeNull();
    expect(folded!.display).toBe('existing notes replaced the valve');
    expect(folded!.state).toEqual(state('existing notes', 'replaced the valve'));
  });

  it('replaces the in-flight segment when a growing transcript arrives (multi-result frame)', () => {
    const folded = foldDictationResult(
      state('existing', 'replaced the'),
      'replaced the valve',
      2,
    );
    expect(folded!.display).toBe('existing replaced the valve');
    expect(folded!.state.lastSegment).toBe('replaced the valve');
    expect(folded!.state.accumulated).toBe('existing');
  });

  it('treats a single-result frame with matching first words as a refinement', () => {
    const folded = foldDictationResult(
      state('existing', 'replaced the valve today'),
      'replaced the valve on Tuesday',
      1,
    );
    expect(folded!.display).toBe('existing replaced the valve on Tuesday');
    expect(folded!.state).toEqual(state('existing', 'replaced the valve on Tuesday'));
  });

  it('banks the previous segment when a single-result frame is a new utterance', () => {
    const folded = foldDictationResult(
      state('existing', 'replaced the valve'),
      'also flushed the lines',
      1,
    );
    // Display shows accumulated only for this frame; next frame re-adds current.
    expect(folded!.display).toBe('existing replaced the valve');
    expect(folded!.state).toEqual(
      state('existing replaced the valve', 'also flushed the lines'),
    );
  });

  it('falls through to the default update when transcripts contain each other', () => {
    const folded = foldDictationResult(
      state('existing', 'the valve'),
      'checked the valve',
      1,
    );
    expect(folded!.display).toBe('existing checked the valve');
    expect(folded!.state.accumulated).toBe('existing');
    expect(folded!.state.lastSegment).toBe('checked the valve');
  });

  it('works with no pre-existing text', () => {
    const folded = foldDictationResult(emptyDictationState(), 'first words', 1);
    expect(folded!.display).toBe('first words');
    expect(folded!.state).toEqual(state('', 'first words'));
  });
});

describe('commitSegment', () => {
  it('banks the in-flight segment into accumulated and clears it', () => {
    expect(commitSegment(state('done first bit', 'then this'))).toEqual(
      state('done first bit then this', ''),
    );
  });

  it('is a no-op when nothing is in flight', () => {
    const s = state('all committed', '');
    expect(commitSegment(s)).toBe(s);
  });
});

describe('finalizeDictation', () => {
  it('joins accumulated and in-flight segment', () => {
    expect(finalizeDictation(state('first half', 'second half'), 'fallback')).toBe(
      'first half second half',
    );
  });

  it('returns accumulated alone when nothing is in flight', () => {
    expect(finalizeDictation(state('just this', ''), 'fallback')).toBe('just this');
  });

  it('returns the in-flight segment alone when nothing was banked', () => {
    expect(finalizeDictation(state('', 'only segment'), 'fallback')).toBe('only segment');
  });

  it('falls back to the existing field text when nothing was captured', () => {
    expect(finalizeDictation(emptyDictationState(), 'typed earlier')).toBe('typed earlier');
  });
});
