// Mate audio output — play back Live API audio chunks as they arrive.
//
// Live streams 16-bit LE PCM at 24 kHz, mono, as base64 chunks inside
// `serverContent.modelTurn.parts[].inlineData`. Two platform-specific
// implementations share the same interface:
//
//   * Web: Web Audio API with `AudioBufferSourceNode` scheduling.
//     Sample-accurate gapless playback — each chunk's start time is
//     pinned to the previous chunk's end time on the audio thread.
//     This is the path that matters today since Mate's voice mode is
//     being smoke-tested in the browser; the expo-av approach below
//     would otherwise leave audible clicks/silences between chunks.
//
//   * Native (iOS/Android): `expo-av` Sound objects played in
//     sequence. expo-av has no streaming PCM API, so we do two things
//     to avoid the choppy/"skippy" playback you'd otherwise get:
//       1. Coalesce many small PCM chunks (the Live API ships ~20–100ms
//          each, hundreds per reply) into ~500ms WAVs before queueing.
//          ~10x fewer Sound load/unload cycles per reply.
//       2. Preload the next Sound while the current one is still
//          playing, so the `didJustFinish` -> next playback hop is just
//          a `playAsync` call (fast) instead of `loadAsync` (~50–150ms
//          on Android, which was the source of the audible gaps).
//     The drain hook (`setOnIdle`) defers session teardown so Mate's
//     reply never gets cut off mid-sentence.

import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import { base64ToBytes, bytesToBase64 } from './audioCodec';

const SAMPLE_RATE = 24000;
const BITS_PER_SAMPLE = 16;
const CHANNELS = 1;

export interface AudioQueue {
  enqueuePcmChunk(base64Pcm: string): void;
  setOnIdle(cb: (() => void) | null): void;
  stop(): Promise<void>;
}

function pcmBytesToFloat32(pcm: Uint8Array): Float32Array {
  // Interpret bytes as little-endian Int16 samples and normalise to [-1, 1].
  // Hand-rolled instead of DataView so the resulting Float32Array's buffer
  // type stays concrete ArrayBuffer (the TS-strict typed-array generics
  // get unhappy otherwise) and copyToChannel accepts it.
  const sampleCount = pcm.length >> 1;
  const out = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    const lo = pcm[i * 2];
    const hi = pcm[i * 2 + 1];
    let s = (hi << 8) | lo;
    if (s >= 0x8000) s -= 0x10000;
    out[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
  }
  return out;
}

// --- Web Audio implementation ----------------------------------------

class WebAudioQueue implements AudioQueue {
  private audioCtx: AudioContext | null = null;
  // currentTime offset where the next chunk must start. Scheduling each
  // BufferSource against this value (clamped to currentTime, never the
  // past) is what makes the playback gapless.
  private nextStartTime = 0;
  private stopped = false;
  private onIdleCb: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  private ensureCtx(): AudioContext | null {
    if (this.stopped) return null;
    if (this.audioCtx) return this.audioCtx;
    const g: any = globalThis as any;
    const Ctor = g.AudioContext || g.webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.audioCtx = new Ctor();
    } catch {
      return null;
    }
    // The context may start suspended if no user gesture has happened
    // yet — the gesture chain that opened the voice session covers this.
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume().catch(() => undefined);
    }
    return this.audioCtx;
  }

  enqueuePcmChunk(base64Pcm: string): void {
    if (this.stopped) return;
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const pcm = base64ToBytes(base64Pcm);
    if (pcm.length === 0) return;
    const samples = pcmBytesToFloat32(pcm);
    if (samples.length === 0) return;

    const buffer = ctx.createBuffer(CHANNELS, samples.length, SAMPLE_RATE);
    // getChannelData + set sidesteps copyToChannel's strict
    // Float32Array<ArrayBuffer> typing.
    buffer.getChannelData(0).set(samples);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const startAt = Math.max(ctx.currentTime, this.nextStartTime);
    try {
      source.start(startAt);
    } catch {
      // Shouldn't happen — start time is in the future and the source is
      // fresh. Swallow so one bad chunk doesn't stall the rest.
      return;
    }
    this.nextStartTime = startAt + buffer.duration;
    this.scheduleIdleCheck();
  }

  setOnIdle(cb: (() => void) | null): void {
    this.onIdleCb = cb;
    if (!cb) {
      if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
      return;
    }
    this.scheduleIdleCheck();
  }

  private scheduleIdleCheck(): void {
    if (!this.onIdleCb) return;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    const ctx = this.audioCtx;
    if (!ctx) {
      // No context yet means nothing to drain.
      const cb = this.onIdleCb;
      this.onIdleCb = null;
      cb();
      return;
    }
    const remaining = this.nextStartTime - ctx.currentTime;
    // Pad the wakeup so we don't fire while the destination is still
    // emptying its mixer buffer.
    const delayMs = Math.max(0, remaining * 1000) + 60;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.stopped) return;
      // If new chunks landed while we were waiting, keep waiting.
      if (this.audioCtx && this.nextStartTime > this.audioCtx.currentTime + 0.01) {
        this.scheduleIdleCheck();
        return;
      }
      const cb = this.onIdleCb;
      this.onIdleCb = null;
      if (cb) cb();
    }, delayMs);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    this.onIdleCb = null;
    const ctx = this.audioCtx;
    this.audioCtx = null;
    if (ctx) {
      try { await ctx.close(); } catch { /* noop */ }
    }
  }
}

// --- Native (expo-av) implementation ---------------------------------

function buildWavFromPcm(pcmBytes: Uint8Array): Uint8Array {
  // RIFF header (44 bytes) + PCM data.
  const byteRate = (SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE) / 8;
  const blockAlign = (CHANNELS * BITS_PER_SAMPLE) / 8;
  const dataSize = pcmBytes.length;
  const buf = new Uint8Array(44 + dataSize);
  const view = new DataView(buf.buffer);
  let p = 0;
  const writeStr = (s: string) => {
    for (let i = 0; i < s.length; i += 1) buf[p++] = s.charCodeAt(i);
  };
  writeStr('RIFF');
  view.setUint32(p, 36 + dataSize, true); p += 4;
  writeStr('WAVE');
  writeStr('fmt ');
  view.setUint32(p, 16, true); p += 4;                 // fmt chunk size
  view.setUint16(p, 1, true); p += 2;                  // PCM format
  view.setUint16(p, CHANNELS, true); p += 2;
  view.setUint32(p, SAMPLE_RATE, true); p += 4;
  view.setUint32(p, byteRate, true); p += 4;
  view.setUint16(p, blockAlign, true); p += 2;
  view.setUint16(p, BITS_PER_SAMPLE, true); p += 2;
  writeStr('data');
  view.setUint32(p, dataSize, true); p += 4;
  buf.set(pcmBytes, 44);
  return buf;
}

// Target batch size for coalesced WAVs. 24 kHz * 2 bytes * 0.5 s = 24000
// bytes ≈ 500 ms of audio. Big enough to amortise the per-Sound load cost,
// small enough that the first chunk still starts playing within ~half a
// second of the reply beginning.
const BATCH_BYTES = SAMPLE_RATE * 2 * 0.5;
// If new PCM stops arriving for this long we flush whatever's pending so the
// tail of a sentence isn't held back waiting to fill a batch.
const FLUSH_IDLE_MS = 180;

class NativeAudioQueue implements AudioQueue {
  // Raw PCM chunks waiting to be merged into a WAV. We hold them as a list +
  // running byte count so we can flush by size without re-measuring.
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  // Built WAV data URIs awaiting playback.
  private queue: string[] = [];
  // Currently playing Sound (post `playAsync`).
  private current: Audio.Sound | null = null;
  // Next Sound, preloaded while `current` is still playing so the transition
  // costs ~one playAsync rather than a full loadAsync.
  private prepared: Audio.Sound | null = null;
  private preparing = false;

  private stopped = false;
  private onIdleCb: (() => void) | null = null;

  enqueuePcmChunk(base64Pcm: string): void {
    if (this.stopped) return;
    const pcm = base64ToBytes(base64Pcm);
    if (pcm.length === 0) return;
    this.pending.push(pcm);
    this.pendingBytes += pcm.length;
    if (this.pendingBytes >= BATCH_BYTES) {
      this.flushPending();
    } else {
      this.scheduleFlush();
    }
  }

  setOnIdle(cb: (() => void) | null): void {
    this.onIdleCb = cb;
    if (!cb) return;
    // End-of-turn: make sure the tail PCM doesn't sit in the batch buffer.
    this.flushPending();
    this.maybeFireOnIdle();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushPending();
    }, FLUSH_IDLE_MS);
  }

  private flushPending(): void {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.pendingBytes === 0) return;
    const merged = new Uint8Array(this.pendingBytes);
    let off = 0;
    for (const c of this.pending) { merged.set(c, off); off += c.length; }
    this.pending = [];
    this.pendingBytes = 0;
    const wav = buildWavFromPcm(merged);
    this.queue.push(`data:audio/wav;base64,${bytesToBase64(wav)}`);
    void this.pump();
  }

  private fireOnIdle(): void {
    if (!this.onIdleCb) return;
    const cb = this.onIdleCb;
    this.onIdleCb = null;
    try { cb(); } catch { /* noop */ }
  }

  private maybeFireOnIdle(): void {
    if (!this.onIdleCb) return;
    if (this.current || this.prepared || this.preparing) return;
    if (this.queue.length > 0 || this.pendingBytes > 0) return;
    this.fireOnIdle();
  }

  private async pump(): Promise<void> {
    if (this.stopped) return;

    // Promote the preloaded Sound to playing as soon as nothing's playing.
    if (!this.current && this.prepared) {
      const sound = this.prepared;
      this.prepared = null;
      this.current = sound;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) return;
        if (status.didJustFinish) {
          if (this.current === sound) this.current = null;
          // Unload off the critical path so the next chunk can start
          // immediately. Fire-and-forget is fine here.
          void (async () => { try { await sound.unloadAsync(); } catch { /* noop */ } })();
          void this.pump();
        }
      });
      try { await sound.playAsync(); } catch { /* noop */ }
    }

    // Keep one Sound preloaded behind the playhead.
    if (!this.prepared && !this.preparing && this.queue.length > 0) {
      this.preparing = true;
      const uri = this.queue.shift()!;
      const s = new Audio.Sound();
      void (async () => {
        try {
          await s.loadAsync({ uri }, { shouldPlay: false });
          if (this.stopped) {
            try { await s.unloadAsync(); } catch { /* noop */ }
            return;
          }
          this.prepared = s;
        } catch {
          try { await s.unloadAsync(); } catch { /* noop */ }
        } finally {
          this.preparing = false;
          void this.pump();
        }
      })();
    }

    this.maybeFireOnIdle();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.pending = [];
    this.pendingBytes = 0;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    this.queue = [];
    this.onIdleCb = null;
    const c = this.current; this.current = null;
    const p = this.prepared; this.prepared = null;
    if (c) {
      try { await c.stopAsync(); } catch { /* noop */ }
      try { await c.unloadAsync(); } catch { /* noop */ }
    }
    if (p) {
      try { await p.unloadAsync(); } catch { /* noop */ }
    }
  }
}

// --- Public API -------------------------------------------------------

/**
 * Create the platform-appropriate output queue. Web gets gapless
 * scheduled playback; native gets sequential expo-av Sounds.
 */
export function createAudioQueue(): AudioQueue {
  if (Platform.OS === 'web') return new WebAudioQueue();
  return new NativeAudioQueue();
}

// Audio mode setup applies to expo-av only; web doesn't need it. One
// call per app lifetime is enough.
let audioModeReady = false;
export async function ensureAudioMode(): Promise<void> {
  if (audioModeReady) return;
  audioModeReady = true;
  if (Platform.OS === 'web') return;
  try {
    await Audio.setAudioModeAsync({
      // playAndRecord so the mic + speaker can run together for realtime
      // voice. allowsRecordingIOS=true is required for capture.
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
  } catch {
    // Non-fatal — playback still works in most cases.
  }
}
