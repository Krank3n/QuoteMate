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
import {
  upsample16kTo24k, toOpenAiTools, openOpenAiVoiceSession, buildTranscriptionPrompt,
} from '../openAiVoiceSession';
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

/**
 * Session behaviour, driven through a fake socket.
 *
 * All three cases here are regressions from one messy device conversation:
 * the greeting printed twice, the pre-tool preamble glued onto the answer that
 * followed it ("...what this job needs first.I need a few details"), and one
 * spoken sentence arriving as three separate turns the model answered one by
 * one.
 */
describe('openOpenAiVoiceSession', () => {
  const MINTED = { provider: 'openai', token: 't', model: 'gpt-realtime-2', voice: 'cedar' } as any;

  class FakeSocket {
    static last: FakeSocket;
    sent: any[] = [];
    onopen?: () => void;
    onmessage?: (e: { data: string }) => void;
    onclose?: () => void;
    onerror?: () => void;
    constructor() {
      FakeSocket.last = this;
      setTimeout(() => this.onopen?.(), 0);
    }
    send(raw: string) { this.sent.push(JSON.parse(raw)); }
    close() { /* noop */ }
    frames(type: string) { return this.sent.filter((f) => f.type === type); }
  }

  const open = async (cb: any = {}) => {
    const prev = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = FakeSocket as any;
    try {
      const session = await openOpenAiVoiceSession(MINTED, [], cb);
      return { session, socket: FakeSocket.last };
    } finally {
      (globalThis as any).WebSocket = prev;
    }
  };

  const deliver = (socket: any, msg: any) => socket.onmessage?.({ data: JSON.stringify(msg) });

  it('gives the tradie 1200ms of silence before taking the turn', async () => {
    // 700ms chopped one utterance into three, and Mate answered each fragment.
    // 1200ms is the value the Gemini path ran in production.
    const { socket } = await open();
    const [update] = socket.frames('session.update');
    expect(update.session.audio.input.turn_detection).toMatchObject({
      type: 'server_vad',
      silence_duration_ms: 1200,
    });
  });

  it('emits spoken text once, from the deltas only', async () => {
    // The screen ACCUMULATES what it is handed, so forwarding the .done
    // event's full transcript as well printed the whole greeting twice inside
    // a single bubble.
    const chunks: string[] = [];
    const { socket } = await open({ onOutputTranscription: (t: string) => { if (t) chunks.push(t); } });
    deliver(socket, { type: 'response.output_audio_transcript.delta', delta: 'Morning. ' });
    deliver(socket, { type: 'response.output_audio_transcript.delta', delta: 'What do you need?' });
    deliver(socket, { type: 'response.output_audio_transcript.done', transcript: 'Morning. What do you need?' });
    expect(chunks.join('')).toBe('Morning. What do you need?');
  });

  it('marks end of turn so the next response starts its own bubble', async () => {
    // OpenAI ends a response at every tool call, so the preamble and the
    // answer after it are two turns. Without this marker they glue together.
    const calls: Array<[string, boolean | undefined]> = [];
    const { socket } = await open({ onOutputTranscription: (t: string, f?: boolean) => calls.push([t, f]) });
    deliver(socket, { type: 'response.output_audio_transcript.delta', delta: 'Got it.' });
    deliver(socket, { type: 'response.output_audio_transcript.done', transcript: 'Got it.' });
    expect(calls).toEqual([['Got it.', false], ['', true]]);
  });

  it('closes the mic gate on the first audio, and reports listening at generation end', async () => {
    const modes: string[] = [];
    const { socket } = await open({ onModeChange: (m: string) => modes.push(m) });
    deliver(socket, { type: 'response.output_audio.delta', delta: 'AAAA' });
    deliver(socket, { type: 'response.done', response: { output: [] } });
    expect(modes).toEqual(['speaking', 'listening']);
  });
});

describe('replying only to actual speech', () => {
  const MINTED2 = { provider: 'openai', token: 't', model: 'gpt-realtime-2', voice: 'cedar' } as any;

  class Sock {
    static last: Sock;
    sent: any[] = [];
    onopen?: () => void;
    onmessage?: (e: { data: string }) => void;
    onclose?: () => void;
    onerror?: () => void;
    constructor() { Sock.last = this; setTimeout(() => this.onopen?.(), 0); }
    send(raw: string) { this.sent.push(JSON.parse(raw)); }
    close() { /* noop */ }
    frames(t: string) { return this.sent.filter((f) => f.type === t); }
  }

  const open = async (cb: any = {}, opts: any = {}) => {
    const prev = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = Sock as any;
    try {
      const session = await openOpenAiVoiceSession(MINTED2, [], cb, opts);
      return { session, socket: Sock.last };
    } finally { (globalThis as any).WebSocket = prev; }
  };
  const deliver = (s: any, m: any) => s.onmessage?.({ data: JSON.stringify(m) });

  it('does not auto-reply on turn end — the transcript decides', async () => {
    const { socket } = await open();
    expect(socket.frames('session.update')[0].session.audio.input.turn_detection.create_response)
      .toBe(false);
  });

  it('stays silent when a committed turn transcribes to noise', async () => {
    // The exact failure: four unprompted wrap-ups with no tradie turn between.
    const heard: string[] = [];
    const { socket } = await open({ onInputTranscription: (t: string) => heard.push(t) });
    const before = socket.frames('response.create').length;
    deliver(socket, { type: 'input_audio_buffer.committed' });
    deliver(socket, { type: 'conversation.item.input_audio_transcription.delta', delta: 'Thank' });
    deliver(socket, { type: 'conversation.item.input_audio_transcription.delta', delta: ' you.' });
    deliver(socket, {
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'Thank you.',
    });
    expect(socket.frames('response.create').length).toBe(before);
    expect(heard).toEqual([]);
  });

  it('answers on the first delta that proves speech, not on the full transcript', async () => {
    // Measured: first delta lands ~180ms after turn end, the finished
    // transcript ~780ms. The model reasons from the audio, so waiting for the
    // text would cost half a second a turn for nothing.
    const { socket } = await open();
    const before = socket.frames('response.create').length;
    deliver(socket, { type: 'input_audio_buffer.committed' });
    deliver(socket, { type: 'conversation.item.input_audio_transcription.delta', delta: 'Quote' });
    expect(socket.frames('response.create').length).toBe(before + 1);
  });

  it('answers a turn exactly once, however many deltas arrive', async () => {
    const { socket } = await open();
    const before = socket.frames('response.create').length;
    deliver(socket, { type: 'input_audio_buffer.committed' });
    for (const d of ['Quote', ' for', ' Karl', ' please']) {
      deliver(socket, { type: 'conversation.item.input_audio_transcription.delta', delta: d });
    }
    deliver(socket, {
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'Quote for Karl please',
    });
    expect(socket.frames('response.create').length).toBe(before + 1);
  });

  it('shows the tradie the finished transcript, not the partial one', async () => {
    const heard: string[] = [];
    const { socket } = await open({ onInputTranscription: (t: string) => heard.push(t) });
    deliver(socket, { type: 'input_audio_buffer.committed' });
    deliver(socket, { type: 'conversation.item.input_audio_transcription.delta', delta: 'Quote' });
    deliver(socket, {
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'Quote for Karl van Leishout',
    });
    expect(heard).toEqual(['Quote for Karl van Leishout']);
  });

  it('still answers a turn that produced no deltas at all', async () => {
    const { socket } = await open();
    const before = socket.frames('response.create').length;
    deliver(socket, { type: 'input_audio_buffer.committed' });
    deliver(socket, {
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'quote for Karl, deck replacement',
    });
    expect(socket.frames('response.create').length).toBe(before + 1);
  });

  it('resets the gate between turns', async () => {
    const { socket } = await open();
    const before = socket.frames('response.create').length;
    for (const word of ['Quote', 'Invoice']) {
      deliver(socket, { type: 'input_audio_buffer.committed' });
      deliver(socket, { type: 'conversation.item.input_audio_transcription.delta', delta: word });
    }
    expect(socket.frames('response.create').length).toBe(before + 2);
  });

  it('uses a transcriber that actually accepts a vocabulary prompt', async () => {
    // gpt-realtime-whisper rejects `prompt` outright, which is how this
    // shipped broken: "The 'prompt' parameter is not supported for this model".
    const { socket } = await open({}, { asrKeywordNames: ['Karl van Leishout'] });
    const t = socket.frames('session.update')[0].session.audio.input.transcription;
    expect(t.model).toBe('gpt-4o-transcribe');
    expect(t.prompt).toContain('Karl van Leishout');
  });

  it('feeds the tradie’s own customer names to the transcriber', async () => {
    // "Karl van Leishout" came back as "Calvin Lyshut" then "Karl Ben Lyshut",
    // and Mate made a new contact for each spelling.
    const { socket } = await open({}, { asrKeywordNames: ['Karl van Leishout'] });
    const prompt = socket.frames('session.update')[0].session.audio.input.transcription.prompt;
    expect(prompt).toContain('Karl van Leishout');
  });

  it('still sends trade vocabulary when the tradie has no contacts yet', async () => {
    // Trade words help a general speech model even with an empty contact list.
    const { socket } = await open({}, {});
    const t = socket.frames('session.update')[0].session.audio.input.transcription;
    expect(t.language).toBe('en');
    expect(t.prompt).toContain('Colorbond');
  });
});

describe('buildTranscriptionPrompt', () => {
  it('keeps a full name intact rather than splitting it into tokens', () => {
    // The ElevenLabs path splits names into keywords; a transcription prompt
    // needs the whole name, or "van" leaks in as a word on its own.
    const p = buildTranscriptionPrompt(['Geraldine Luffaga']);
    expect(p).toContain('Geraldine Luffaga');
  });

  it('includes trade vocabulary alongside the names', () => {
    expect(buildTranscriptionPrompt(['Karl van Leishout'])).toContain('Villaboard');
  });

  it('caps how many names it will list', () => {
    const many = Array.from({ length: 200 }, (_, i) => `Customer Number${i}`);
    const p = buildTranscriptionPrompt(many);
    expect(p.split(', ').length).toBeLessThan(200);
  });

  it('skips blank and too-short entries', () => {
    const p = buildTranscriptionPrompt(['', '  ', 'Jo']);
    expect(p).not.toContain('Jo,');
  });
});
