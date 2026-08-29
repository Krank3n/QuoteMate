/**
 * Regression cover for a voice failure that logged as "Voice mode is offline:
 * unknown error" — a dead end. Not everything thrown is an Error, and the old
 * `err?.message || 'unknown error'` discarded the only identity a non-Error
 * rejection has.
 */
import { describe, it, expect } from 'vitest';
import { describeThrown } from '../describeThrown';

describe('describeThrown', () => {
  it('prefers a real message', () => {
    expect(describeThrown(new Error('socket closed'))).toBe('socket closed');
  });

  it('names an Error that has no message', () => {
    // `new Error()` has message '' — the exact shape that produced the dead end.
    const err = new Error();
    err.name = 'LiveOfflineError';
    expect(describeThrown(err)).toBe('LiveOfflineError');
  });

  it('keeps a native error code alongside the message', () => {
    expect(describeThrown({ message: 'Mic busy', code: 'E_AUDIO' })).toBe('Mic busy (E_AUDIO)');
  });

  it('falls back to a bridge error code when there is no message', () => {
    // React Native bridge rejections routinely look exactly like this.
    expect(describeThrown({ code: 'EUNSPECIFIED' })).toBe('error code EUNSPECIFIED');
  });

  it('reports a rejection that carried nothing at all', () => {
    expect(describeThrown(undefined)).toBe('nothing thrown (undefined)');
    expect(describeThrown(null)).toBe('null thrown');
  });

  it('passes a thrown string straight through', () => {
    expect(describeThrown('Connection reset')).toBe('Connection reset');
  });

  it('does not render an empty string as blank text', () => {
    expect(describeThrown('   ')).toBe('empty string thrown');
  });

  it('describes a thrown number rather than swallowing it', () => {
    expect(describeThrown(42)).toBe('42 (number)');
  });

  it('still says unknown error when the object is genuinely featureless', () => {
    expect(describeThrown({})).toBe('unknown error');
  });

  it('never leaks a stack into tradie-facing copy', () => {
    const err = new Error('boom');
    expect(describeThrown(err)).not.toContain('at ');
  });
});
