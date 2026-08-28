/**
 * The 16 kHz -> 24 kHz conversion in front of OpenAI Realtime.
 *
 * Device-found: react-native-audio-record produced empty buffers when asked
 * for 24 kHz, and OpenAI rejected every frame with "Expected base64-encoded
 * audio bytes (mono PCM16 at 24kHz) but got empty bytes" — which tore the
 * session down and surfaced as an error bubble. Capture stays at the rate the
 * recorder actually delivers and the conversion happens here.
 */
import { describe, it, expect } from 'vitest';
import { upsample16kTo24k, toOpenAiTools } from '../openAiVoiceSession';
import { bytesToBase64, base64ToBytes } from '../audioCodec';
import { ALL_TOOL_DECLARATIONS } from '../toolSchemas';

const pcm = (samples: number[]): string => {
  const arr = Int16Array.from(samples);
  return bytesToBase64(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
};
const samplesOf = (b64: string): number[] => {
  const bytes = base64ToBytes(b64);
  return Array.from(new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2)));
};

describe('upsample16kTo24k', () => {
  it('produces exactly 3 output samples for every 2 input samples', () => {
    // 16k -> 24k is a 3:2 ratio. Getting this wrong shifts pitch, which the
    // API accepts silently and a listener hears immediately.
    const out = samplesOf(upsample16kTo24k(pcm(new Array(200).fill(0))));
    expect(out).toHaveLength(300);
  });

  it('keeps a constant signal constant', () => {
    const out = samplesOf(upsample16kTo24k(pcm(new Array(20).fill(1000))));
    expect(new Set(out)).toEqual(new Set([1000]));
  });

  it('interpolates between samples rather than repeating them', () => {
    // A repeat-based "upsample" would emit only 0 and 600; interpolation puts
    // an intermediate value between them.
    const out = samplesOf(upsample16kTo24k(pcm([0, 600, 0, 600, 0, 600])));
    expect(out.some((v) => v > 0 && v < 600)).toBe(true);
  });

  it('preserves the first sample exactly', () => {
    expect(samplesOf(upsample16kTo24k(pcm([1234, 0, 0, 0])))[0]).toBe(1234);
  });

  it('handles full-scale values without wrapping', () => {
    // Int16 overflow turns a loud passage into noise.
    const out = samplesOf(upsample16kTo24k(pcm([32767, 32767, -32768, -32768])));
    expect(Math.max(...out)).toBeLessThanOrEqual(32767);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(-32768);
  });

  it('returns empty for a frame too short to interpolate', () => {
    // The caller drops empty output rather than sending it — an empty frame
    // is rejected by the API and kills the session.
    expect(upsample16kTo24k(pcm([]))).toBe('');
    expect(upsample16kTo24k(pcm([5]))).toBe('');
  });

  it('handles a realistic 100ms frame', () => {
    const frame = Array.from({ length: 1600 }, (_, i) => Math.round(8000 * Math.sin(i / 10)));
    expect(samplesOf(upsample16kTo24k(pcm(frame)))).toHaveLength(2400);
  });
});

describe('toOpenAiTools', () => {
  it('exposes every tool Mate has', () => {
    expect(toOpenAiTools()).toHaveLength(ALL_TOOL_DECLARATIONS.length);
  });

  it('uses the flat function shape the Realtime API expects', () => {
    // Realtime takes { type, name, description, parameters } at the top level,
    // not the nested { type:'function', function:{...} } of chat completions.
    for (const t of toOpenAiTools()) {
      expect(t.type).toBe('function');
      expect(t.name).toBeTruthy();
      expect(t.parameters.type).toBe('object');
      expect((t as any).function).toBeUndefined();
    }
  });
});
