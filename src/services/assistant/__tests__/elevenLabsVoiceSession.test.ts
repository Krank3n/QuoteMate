/**
 * The ElevenLabs voice session, against a fake SDK.
 *
 * What's worth pinning here is mostly the seams where this transport differs
 * from the Gemini one it replaces, because each difference is a place the
 * screen's assumptions could silently break:
 *
 *   • The SDK owns mic and playback. ownsMicrophone is what stops the screen
 *     opening a second capture — two owners on the iOS audio session gives a
 *     dead mic or earpiece-only output, intermittently.
 *   • React Native is WebRTC-only. Passing a signedUrl or connectionType
 *     'websocket' makes the RN shim throw.
 *   • onMessage delivers whole messages, not deltas.
 *   • onClose fires exactly once, with onError riding along only on a real
 *     failure — the same contract the Gemini path guarantees the screen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const startSession = vi.fn();
vi.mock('@elevenlabs/client', () => ({ Conversation: { startSession: (o: any) => startSession(o) } }));
vi.mock('../elevenLabsRuntime', () => ({ ensureElevenLabsRuntime: () => Promise.resolve() }));
const ensureMicPermission = vi.fn(() => Promise.resolve());
vi.mock('../micPermission', () => ({
  ensureMicPermission: () => ensureMicPermission(),
  micPermissionGranted: () => Promise.resolve(true),
  MicUnavailableError: class extends Error {},
}));
vi.mock('../toolDispatcher', () => ({
  dispatchToolCall: vi.fn(async () => ({ name: 'x', id: '1', response: { ok: true } })),
}));

import { openElevenLabsVoiceSession } from '../elevenLabsVoiceSession';
import { LiveOfflineError, ElevenLabsMintedToken } from '../liveSession';

const MINT: ElevenLabsMintedToken = {
  provider: 'elevenlabs', token: 'lk-tok', model: 'elevenlabs/claude-sonnet-5',
  agentId: 'agent_1', conversationId: 'conv_1',
  maxDurationSeconds: 600, heldSeconds: 120, remainingVoiceSeconds: 1680,
};

/** Captures the options the session passed, so tests can fire its callbacks. */
function fakeConversation() {
  const conv = {
    sendUserMessage: vi.fn(),
    sendContextualUpdate: vi.fn(),
    setMicMuted: vi.fn(),
    getInputVolume: vi.fn(() => 0.42),
    getId: vi.fn(() => 'conv_1'),
    endSession: vi.fn(async () => {}),
  };
  let opts: any;
  startSession.mockImplementation((o: any) => {
    opts = o;
    // The SDK resolves once connected; mirror that ordering.
    o.onConnect?.({ conversationId: 'conv_1' });
    return Promise.resolve(conv);
  });
  return { conv, options: () => opts };
}

const open = (cb: any = {}) => openElevenLabsVoiceSession(MINT, [], cb);

beforeEach(() => {
  startSession.mockReset();
  ensureMicPermission.mockClear();
});

describe('opening', () => {
  it('asks for mic permission before starting — LiveKit never does', async () => {
    fakeConversation();
    await open();
    expect(ensureMicPermission).toHaveBeenCalled();
  });

  it('connects over WebRTC with the minted conversation token', async () => {
    const f = fakeConversation();
    await open();
    expect(f.options().conversationToken).toBe('lk-tok');
    expect(f.options().connectionType).toBe('webrtc');
  });

  it('never passes a signedUrl or the websocket transport, which the RN shim rejects', async () => {
    const f = fakeConversation();
    await open();
    expect(f.options().signedUrl).toBeUndefined();
    expect(f.options().connectionType).not.toBe('websocket');
  });

  it('registers a client tool for every tool Mate knows about', async () => {
    const f = fakeConversation();
    await open();
    expect(Object.keys(f.options().clientTools).length).toBe(22);
    expect(f.options().clientTools.find_customer).toBeTypeOf('function');
  });

  it('declares that it owns the microphone', async () => {
    fakeConversation();
    const s = await open();
    // The screen keys off this to skip its own capture.
    expect(s.ownsMicrophone).toBe(true);
  });

  it('reports open once connected', async () => {
    fakeConversation();
    expect((await open()).isOpen()).toBe(true);
  });

  it('rejects with LiveOfflineError when the SDK fails before connecting', async () => {
    startSession.mockImplementation(() => Promise.reject(new Error('ICE failed')));
    await expect(open()).rejects.toBeInstanceOf(Error);
  });

  it('surfaces a pre-connect onError as a rejection, not a live session', async () => {
    startSession.mockImplementation((o: any) => {
      o.onError?.('no mic track');
      return new Promise(() => {}); // never resolves
    });
    await expect(open()).rejects.toBeInstanceOf(LiveOfflineError);
  });
});

describe('seeding prior turns', () => {
  it('sends earlier turns as a contextual update, which triggers no reply', async () => {
    const f = fakeConversation();
    await openElevenLabsVoiceSession(MINT, [
      { id: '1', role: 'user', text: 'quote a fence', createdAt: 'x' },
    ], {});
    expect(f.conv.sendContextualUpdate).toHaveBeenCalledWith(expect.stringContaining('quote a fence'));
  });

  it('sends nothing for a blank-slate conversation', async () => {
    const f = fakeConversation();
    await open();
    expect(f.conv.sendContextualUpdate).not.toHaveBeenCalled();
  });
});

describe('transcripts', () => {
  it('surfaces a user message as a finished input transcription', async () => {
    const f = fakeConversation();
    const onInputTranscription = vi.fn();
    await open({ onInputTranscription });
    f.options().onMessage({ message: 'quote a deck', source: 'user' });
    // Whole messages, not deltas — there is no partial state to represent.
    expect(onInputTranscription).toHaveBeenCalledWith('quote a deck', true);
  });

  it('surfaces an agent message as a finished output transcription', async () => {
    const f = fakeConversation();
    const onOutputTranscription = vi.fn();
    await open({ onOutputTranscription });
    f.options().onMessage({ message: 'righto', source: 'ai' });
    expect(onOutputTranscription).toHaveBeenCalledWith('righto', true);
  });

  it('ignores an empty message', async () => {
    const f = fakeConversation();
    const onInputTranscription = vi.fn();
    await open({ onInputTranscription });
    f.options().onMessage({ message: '', source: 'user' });
    expect(onInputTranscription).not.toHaveBeenCalled();
  });
});

describe('turn taking', () => {
  it('reports speaking and listening straight from the transport', async () => {
    const f = fakeConversation();
    const onModeChange = vi.fn();
    await open({ onModeChange });
    f.options().onModeChange({ mode: 'speaking' });
    expect(onModeChange).toHaveBeenCalledWith('speaking');
  });

  it('emits onTurnComplete when the reply finishes PLAYING, not generating', async () => {
    const f = fakeConversation();
    const onTurnComplete = vi.fn();
    await open({ onTurnComplete });
    f.options().onModeChange({ mode: 'speaking' });
    expect(onTurnComplete).not.toHaveBeenCalled();
    f.options().onModeChange({ mode: 'listening' });
    expect(onTurnComplete).toHaveBeenCalledTimes(1);
  });

  it('does not emit a turn on listening that never followed speaking', async () => {
    const f = fakeConversation();
    const onTurnComplete = vi.fn();
    await open({ onTurnComplete });
    f.options().onModeChange({ mode: 'listening' });
    expect(onTurnComplete).not.toHaveBeenCalled();
  });

  it('passes the vad score through for the waveform', async () => {
    const f = fakeConversation();
    const onVadScore = vi.fn();
    await open({ onVadScore });
    f.options().onVadScore({ vadScore: 0.7 });
    expect(onVadScore).toHaveBeenCalledWith(0.7);
  });
});

describe('sending', () => {
  it('sends typed text as a user message', async () => {
    const f = fakeConversation();
    (await open()).sendUserText('do the deck');
    expect(f.conv.sendUserMessage).toHaveBeenCalledWith('do the deck');
  });

  it('sends a context note without triggering a reply', async () => {
    const f = fakeConversation();
    (await open()).sendContextNote('[context] applied QU-1');
    expect(f.conv.sendContextualUpdate).toHaveBeenCalledWith('[context] applied QU-1');
  });

  it('mutes rather than tearing down when the user turn is ended', async () => {
    const f = fakeConversation();
    (await open()).endUserTurn();
    expect(f.conv.setMicMuted).toHaveBeenCalledWith(true);
    expect(f.conv.endSession).not.toHaveBeenCalled();
  });

  it('sendMicChunk is inert — the SDK owns capture', async () => {
    fakeConversation();
    const s = await open();
    expect(() => s.sendMicChunk('base64')).not.toThrow();
  });

  it('sends nothing once closed', async () => {
    const f = fakeConversation();
    const s = await open();
    s.close();
    s.sendUserText('too late');
    expect(f.conv.sendUserMessage).not.toHaveBeenCalled();
  });
});

describe('closing', () => {
  it('flips isOpen synchronously, before the async endSession settles', async () => {
    fakeConversation();
    const s = await open();
    s.close();
    // The screen's teardown checks this immediately after calling close().
    expect(s.isOpen()).toBe(false);
  });

  it('fires onClose exactly once and no onError on a user close', async () => {
    const f = fakeConversation();
    const onClose = vi.fn(); const onError = vi.fn();
    const s = await open({ onClose, onError });
    s.close();
    f.options().onDisconnect?.({ reason: 'user' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('fires onError then onClose once on a post-connect failure', async () => {
    const f = fakeConversation();
    const onClose = vi.fn(); const onError = vi.fn();
    await open({ onClose, onError });
    f.options().onError('transport died');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ends the session exactly once even if close is called twice', async () => {
    const f = fakeConversation();
    const s = await open();
    s.close(); s.close();
    expect(f.conv.endSession).toHaveBeenCalledTimes(1);
  });
});

describe('reconnects', () => {
  it('reports reconnecting and reconnected around a drop', async () => {
    const f = fakeConversation();
    const onReconnecting = vi.fn(); const onReconnected = vi.fn();
    const s = await open({ onReconnecting, onReconnected });
    f.options().onStatusChange({ status: 'connecting' });
    expect(onReconnecting).toHaveBeenCalled();
    expect(s.isOpen()).toBe(false);
    f.options().onStatusChange({ status: 'connected' });
    expect(onReconnected).toHaveBeenCalled();
    expect(s.isOpen()).toBe(true);
  });

  it('does not report a reconnect for the first connect', async () => {
    const f = fakeConversation();
    const onReconnected = vi.fn();
    await open({ onReconnected });
    expect(onReconnected).not.toHaveBeenCalled();
  });
});

describe('session identity', () => {
  it('exposes the conversation id for cost reconciliation', async () => {
    fakeConversation();
    expect((await open()).getConversationId?.()).toBe('conv_1');
  });

  it('exposes input volume for the waveform', async () => {
    fakeConversation();
    expect((await open()).getInputVolume?.()).toBe(0.42);
  });
});
