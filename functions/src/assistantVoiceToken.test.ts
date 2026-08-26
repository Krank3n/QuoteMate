/**
 * The ElevenLabs mint contract.
 *
 * Two things here are security-shaped rather than merely functional: the API
 * key must travel as a header (query strings reach access logs and proxy
 * caches), and the participant label handed to a third party must not be the
 * user's Firebase uid.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildConversationTokenUrl,
  mintElevenLabsConversationToken,
  participantNameForUid,
  ElevenLabsMintError,
  EL_VOICE_MODEL_LABEL,
} from './assistantVoiceToken';

const ok = (body: unknown) => ({
  ok: true, status: 200, text: async () => JSON.stringify(body),
});
const fail = (status: number, body: string) => ({
  ok: false, status, text: async () => body,
});

describe('buildConversationTokenUrl', () => {
  it('targets the documented WebRTC token endpoint', () => {
    expect(buildConversationTokenUrl('agent_123'))
      .toBe('https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=agent_123');
  });

  it('url-encodes an agent id rather than splicing it raw', () => {
    expect(buildConversationTokenUrl('a b&c=d')).toContain('agent_id=a+b%26c%3Dd');
  });

  it('includes participant_name only when given one', () => {
    expect(buildConversationTokenUrl('agent_1')).not.toContain('participant_name');
    expect(buildConversationTokenUrl('agent_1', 'qm_abc')).toContain('participant_name=qm_abc');
  });
});

describe('participantNameForUid', () => {
  it('never leaks the uid to the third party', () => {
    const uid = 'firebase-uid-abc123';
    expect(participantNameForUid(uid)).not.toContain(uid);
  });

  it('is stable, so one user is one identity in their dashboard', () => {
    expect(participantNameForUid('u1')).toBe(participantNameForUid('u1'));
  });

  it('separates different users', () => {
    expect(participantNameForUid('u1')).not.toBe(participantNameForUid('u2'));
  });

  it('is prefixed and short enough to read in a dashboard row', () => {
    const name = participantNameForUid('u1');
    expect(name.startsWith('qm_')).toBe(true);
    expect(name.length).toBeLessThanOrEqual(16);
  });
});

describe('mintElevenLabsConversationToken', () => {
  it('sends the API key as a header and never in the URL', async () => {
    const fetchImpl = vi.fn(async () => ok({ token: 't', conversation_id: 'c' })) as any;
    await mintElevenLabsConversationToken({ apiKey: 'sk_secret', agentId: 'agent_1', fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).not.toContain('sk_secret');
    expect(init.headers['xi-api-key']).toBe('sk_secret');
    expect(init.method).toBe('GET');
  });

  it('returns the token and the conversation id', async () => {
    const fetchImpl = vi.fn(async () => ok({ token: 'tok', conversation_id: 'conv_9' })) as any;
    const out = await mintElevenLabsConversationToken({ apiKey: 'k', agentId: 'a', fetchImpl });
    expect(out).toEqual({ token: 'tok', conversationId: 'conv_9' });
  });

  it('tolerates a response with no conversation id rather than throwing', async () => {
    const fetchImpl = vi.fn(async () => ok({ token: 'tok' })) as any;
    const out = await mintElevenLabsConversationToken({ apiKey: 'k', agentId: 'a', fetchImpl });
    expect(out.conversationId).toBe('');
  });

  it('puts the status in the error so the 502 detail is diagnosable', async () => {
    const fetchImpl = vi.fn(async () => fail(401, 'invalid api key')) as any;
    await expect(mintElevenLabsConversationToken({ apiKey: 'k', agentId: 'a', fetchImpl }))
      .rejects.toThrow(/401/);
  });

  it('exposes the upstream status on the error object', async () => {
    const fetchImpl = vi.fn(async () => fail(429, 'slow down')) as any;
    try {
      await mintElevenLabsConversationToken({ apiKey: 'k', agentId: 'a', fetchImpl });
      throw new Error('should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ElevenLabsMintError);
      expect(err.status).toBe(429);
    }
  });

  it('throws rather than returning a tokenless success', async () => {
    const fetchImpl = vi.fn(async () => ok({ conversation_id: 'c' })) as any;
    await expect(mintElevenLabsConversationToken({ apiKey: 'k', agentId: 'a', fetchImpl }))
      .rejects.toThrow(/no token/);
  });

  it('reports non-JSON (an HTML error page) as such', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 200, text: async () => '<html>502 Bad Gateway</html>',
    })) as any;
    await expect(mintElevenLabsConversationToken({ apiKey: 'k', agentId: 'a', fetchImpl }))
      .rejects.toThrow(/non-JSON/);
  });

  it('surfaces a network failure as a mint error, not a raw fetch error', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNRESET'); }) as any;
    await expect(mintElevenLabsConversationToken({ apiKey: 'k', agentId: 'a', fetchImpl }))
      .rejects.toBeInstanceOf(ElevenLabsMintError);
  });
});

describe('EL_VOICE_MODEL_LABEL', () => {
  it('stays distinct from the text path label so cost stays separable', () => {
    expect(EL_VOICE_MODEL_LABEL).toBe('elevenlabs/claude-sonnet-5');
    expect(EL_VOICE_MODEL_LABEL).not.toBe('claude-sonnet-5');
  });
});
