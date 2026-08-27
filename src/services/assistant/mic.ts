// Streaming mic capture for Mate's voice mode.
//
// Gemini Live consumes 16-bit little-endian PCM at 16 kHz, mono. Two
// platform paths share the same `startMicCapture(onChunk)` surface:
//
//   * Native (iOS/Android): wraps `react-native-audio-record`, which
//     emits base64 PCM chunks directly. Expo's audio APIs only expose
//     finished-file recording, not a per-chunk stream.
//   * Web (react-native-web): captures via `getUserMedia` + an
//     `AudioWorkletProcessor` that downsamples to 16 kHz, encodes to
//     Int16 LE PCM, and posts each chunk back to the main thread as a
//     base64 string.
//
// `startMicCapture` is async because the web path waits on the
// permission prompt and the worklet module load before any audio
// starts flowing.

import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import { bytesToBase64 } from './audioCodec';
import {
  MicUnavailableError,
  ensureMicPermission,
  micPermissionGranted,
} from './micPermission';

// Re-exported so existing importers (AssistantScreen) keep working unchanged
// while the Gemini transport is still around. Both live in micPermission now:
// the ElevenLabs path needs them too, and mic.ts retires with Gemini.
export { MicUnavailableError, micPermissionGranted };

interface AudioRecordOptions {
  sampleRate: number;
  channels: 1 | 2;
  bitsPerSample: 8 | 16;
  audioSource?: number;
  wavFile?: string;
}

interface AudioRecordModule {
  init(options: AudioRecordOptions): void;
  start(): void;
  stop(): Promise<string>;
  on(event: 'data', cb: (data: string) => void): void;
}

function loadNativeModule(): AudioRecordModule | null {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-audio-record');
    return (mod?.default ?? mod) as AudioRecordModule;
  } catch {
    return null;
  }
}

const RECORD_OPTS: AudioRecordOptions = {
  sampleRate: 16000,
  channels: 1,
  bitsPerSample: 16,
  // Android: VOICE_COMMUNICATION (7) — engages the platform's built-in
  // acoustic echo canceller, noise suppression, and AGC pipeline so the
  // loudspeaker playing back Mate's reply doesn't bleed into the mic and
  // get re-transcribed as the tradie talking. Without this (the previous
  // VOICE_RECOGNITION = 6) Gemini's server-side VAD would hear Mate's own
  // voice, treat it as a new user turn, and Mate would talk to itself in
  // an infinite loop. iOS ignores audioSource — the half-duplex mute in
  // AssistantScreen (driven by AudioQueue.setOnActiveChange) covers it.
  audioSource: 7,
  wavFile: 'mate.wav', // throwaway — we only consume the streamed chunks
};

export interface MicCaptureHandle {
  stop: () => Promise<void>;
  isStreaming: () => boolean;
}

// --- Web path ---------------------------------------------------------

// AudioWorkletProcessor source. Lives in a separate JS realm (the audio
// thread) so it must be self-contained — no closures over outer scope.
// `sampleRate` is a global provided by AudioWorkletGlobalScope.
const WORKLET_SOURCE = `
class PCMDownsampler extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.targetRate = opts.targetRate || 16000;
    this.ratio = sampleRate / this.targetRate;
    this.frameSize = opts.frameSize || 2048; // ~128 ms at 16 kHz
    this.buf = [];
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    const ch = input[0];
    if (!ch || !ch.length) return true;
    for (let i = 0; i < ch.length; i++) this.buf.push(ch[i]);

    while (this.buf.length >= Math.ceil(this.frameSize * this.ratio)) {
      const out = new Int16Array(this.frameSize);
      for (let i = 0; i < this.frameSize; i++) {
        const idx = Math.floor(i * this.ratio);
        let s = this.buf[idx];
        if (s > 1) s = 1; else if (s < -1) s = -1;
        out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      this.buf = this.buf.slice(Math.ceil(this.frameSize * this.ratio));
      this.port.postMessage(out.buffer, [out.buffer]);
    }
    return true;
  }
}
registerProcessor('pcm-downsampler', PCMDownsampler);
`;

interface WebCaptureState {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  worklet: AudioWorkletNode;
}

// One AudioContext per page lifetime. Creating a fresh one on each voice
// session start was the cause of the "mic doesn't work the second time"
// bug — the autoplay-policy activation from the first mic-button click
// gets consumed before the second open finishes its async setup, so the
// new context lands in 'suspended' state and never wakes up. By reusing
// a single context (resume on start, suspend on stop) the activation
// from the very first session persists for the page.
let sharedAudioCtx: AudioContext | null = null;
let workletModuleReady = false;

async function getOrCreateAudioCtx(): Promise<AudioContext> {
  const g: any = globalThis as any;
  const AudioCtxCtor = g.AudioContext || g.webkitAudioContext;
  if (!AudioCtxCtor) {
    throw new MicUnavailableError('Web Audio is not supported in this browser.');
  }
  if (sharedAudioCtx && sharedAudioCtx.state !== 'closed') {
    if (sharedAudioCtx.state === 'suspended') {
      try { await sharedAudioCtx.resume(); } catch { /* noop */ }
    }
    return sharedAudioCtx;
  }
  sharedAudioCtx = new AudioCtxCtor();
  workletModuleReady = false;
  if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
    try { await sharedAudioCtx.resume(); } catch { /* noop */ }
  }
  return sharedAudioCtx!;
}

async function ensureWorkletLoaded(ctx: AudioContext): Promise<void> {
  if (workletModuleReady) return;
  const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  workletModuleReady = true;
}

async function startWebCapture(onChunk: (b64: string) => void): Promise<WebCaptureState> {
  const g: any = globalThis as any;
  if (!g.navigator?.mediaDevices?.getUserMedia) {
    throw new MicUnavailableError(
      'Microphone access is not available. Use HTTPS (or localhost) and grant mic permission.',
    );
  }

  const audioCtx = await getOrCreateAudioCtx();
  await ensureWorkletLoaded(audioCtx);

  let stream: MediaStream;
  try {
    stream = await g.navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        // Browsers usually ignore sampleRate; the worklet downsamples
        // from whatever the AudioContext gives us.
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      } as MediaTrackConstraints,
    });
  } catch (err: any) {
    // Don't close the shared audioCtx here — we want to reuse it on the
    // next attempt and keep the autoplay-policy activation alive.
    if (err?.name === 'NotAllowedError') {
      throw new MicUnavailableError('Microphone permission denied — allow it in the browser address bar.');
    }
    if (err?.name === 'NotFoundError') {
      throw new MicUnavailableError('No microphone found.');
    }
    throw new MicUnavailableError(err?.message || 'Mic open failed.');
  }

  const source = audioCtx.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(audioCtx, 'pcm-downsampler', {
    processorOptions: { targetRate: 16000, frameSize: 2048 },
  });
  let chunkCount = 0;
  worklet.port.onmessage = (e: MessageEvent) => {
    const buf = e.data as ArrayBuffer;
    if (!buf) return;
    chunkCount += 1;
    onChunk(bytesToBase64(new Uint8Array(buf)));
  };
  source.connect(worklet);
  // Don't connect to destination — we don't want the user hearing their
  // own mic echoed back. The worklet still runs while connected only to
  // the source on the main graph.

  // Watchdog: if nothing arrives in 1.5s, the context is wedged.
  // Surface it loudly so we don't render a silent "Listening" UI.
  setTimeout(() => {
    if (chunkCount > 0) return;
    // eslint-disable-next-line no-console
    console.warn('[Mate mic] No PCM chunks after 1.5s', {
      state: audioCtx.state,
      sampleRate: audioCtx.sampleRate,
      tracks: stream.getTracks().map((t) => ({ kind: t.kind, label: t.label, state: t.readyState, enabled: t.enabled })),
    });
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => undefined);
    }
  }, 1500);

  return { stream, source, worklet };
}

async function stopWebCapture(state: WebCaptureState): Promise<void> {
  try { state.source.disconnect(); } catch { /* noop */ }
  try { state.worklet.disconnect(); } catch { /* noop */ }
  try { state.worklet.port.close(); } catch { /* noop */ }
  for (const track of state.stream.getTracks()) {
    try { track.stop(); } catch { /* noop */ }
  }
  // Keep the shared audioCtx alive — only suspend it so the next session
  // can reuse it without crossing the autoplay-policy boundary again.
  if (sharedAudioCtx && sharedAudioCtx.state === 'running') {
    try { await sharedAudioCtx.suspend(); } catch { /* noop */ }
  }
}

// --- Native path ------------------------------------------------------

// Android treats RECORD_AUDIO as a "dangerous" runtime permission, so the
// manifest entry alone doesn't grant it — it has to be requested at
// runtime *before* the recorder is constructed. Skip that and AudioRecord
// is built in an uninitialised state; the later `startRecording()` throws
// `startRecording() called on an uninitialized AudioRecord` on the native
// modules thread, where a JS try/catch can't catch it — the app crashes
// outright. Requesting here turns a denial into a friendly caught error.


async function startNativeCapture(
  onChunk: (b64: string) => void,
): Promise<{ stop: () => Promise<void> }> {
  const mod = loadNativeModule();
  if (!mod) {
    throw new MicUnavailableError('Mic capture is unavailable on this build.');
  }
  await ensureMicPermission();
  // Re-init on every capture rather than caching a "done" flag.
  // react-native-audio-record releases the underlying AudioRecord on
  // stop(), so reusing it on the next session would call startRecording()
  // on a released recorder — the same uninitialised crash. A fresh init()
  // each time keeps the recorder valid.
  mod.init(RECORD_OPTS);
  // react-native-audio-record's listener is global; re-bind on every
  // capture so the previous closure is replaced rather than queued.
  mod.on('data', onChunk);
  mod.start();

  return {
    stop: async () => {
      try { await mod.stop(); } catch { /* noop */ }
    },
  };
}

// --- Public API -------------------------------------------------------

/**
 * Start streaming PCM chunks. Resolves once the mic is actually live
 * (after the web permission prompt, or immediately on native).
 * `onChunk` fires repeatedly with base64-encoded 16-bit LE PCM at 16 kHz.
 * Call `handle.stop()` to end the capture.
 */
export async function startMicCapture(onChunk: (base64Pcm: string) => void): Promise<MicCaptureHandle> {
  let stopped = false;

  if (Platform.OS === 'web') {
    const state = await startWebCapture(onChunk);
    return {
      stop: async () => {
        if (stopped) return;
        stopped = true;
        await stopWebCapture(state);
      },
      isStreaming: () => !stopped,
    };
  }

  const handle = await startNativeCapture(onChunk);
  return {
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await handle.stop();
    },
    isStreaming: () => !stopped,
  };
}
