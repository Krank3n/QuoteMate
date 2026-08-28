/**
 * The half-duplex mic gate.
 *
 * Regression cover for the first OpenAI Realtime device test, where a single
 * "Hello" drew three assistant turns — one of them asking for the length,
 * height and gate count of a fence the tradie had never mentioned. Cause: the
 * transport reports 'listening' when the model stops GENERATING, but the
 * queued audio is still PLAYING. Opening the mic there streams Mate's own
 * voice back into the server-side VAD, which answers it.
 */
import { describe, it, expect } from 'vitest';
import { nextMatePlaying } from '../micGate';

describe('nextMatePlaying', () => {
  describe('screen-owned playback (Gemini, OpenAI over raw PCM)', () => {
    const screenPlays = false;

    it('does NOT open the gate on listening while audio is still queued', () => {
      // The bug, pinned. 'listening' here means generation finished, not
      // playback — the audio queue's drain callback is the only thing allowed
      // to open the gate on this transport.
      expect(nextMatePlaying(true, 'listening', screenPlays)).toBe(true);
    });

    it('closes the gate as soon as speaking starts', () => {
      expect(nextMatePlaying(false, 'speaking', screenPlays)).toBe(true);
    });

    it('leaves an already-open gate open on listening', () => {
      // Nothing to reopen: no reply is playing, so this must not flap the flag.
      expect(nextMatePlaying(false, 'listening', screenPlays)).toBe(false);
    });

    it('never opens the gate on its own, from either starting state', () => {
      for (const current of [true, false]) {
        expect(nextMatePlaying(current, 'listening', screenPlays)).toBe(current);
      }
    });
  });

  describe('transport-owned playback (ElevenLabs over WebRTC)', () => {
    const sdkPlays = true;

    it('opens the gate on listening — there is no queue to wait for', () => {
      expect(nextMatePlaying(true, 'listening', sdkPlays)).toBe(false);
    });

    it('closes the gate on speaking', () => {
      expect(nextMatePlaying(false, 'speaking', sdkPlays)).toBe(true);
    });

    it('tracks the transport exactly, ignoring the previous value', () => {
      for (const current of [true, false]) {
        expect(nextMatePlaying(current, 'speaking', sdkPlays)).toBe(true);
        expect(nextMatePlaying(current, 'listening', sdkPlays)).toBe(false);
      }
    });
  });

  it('closes the gate on speaking regardless of who owns playback', () => {
    // Closing early is always safe; closing late is the failure mode.
    for (const owns of [true, false]) {
      for (const current of [true, false]) {
        expect(nextMatePlaying(current, 'speaking', owns)).toBe(true);
      }
    }
  });
});
