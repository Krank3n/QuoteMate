/**
 * The brain behind Mate is chosen server-side and moves — text falls back from
 * Claude to Gemini when a key is unfunded, and the voice provider is an A/B by
 * uid bucket. So "was that Gemini or Claude?" cannot be read off a transcript,
 * and the admin panel was being asked exactly that.
 */
import { describe, expect, it } from 'vitest';
import { summariseModels } from './modelsUsed';

const a = (model?: string | null) => ({ role: 'assistant', model });
const user = { role: 'user', text: 'quote for Dave' } as const;

describe('summariseModels', () => {
  it('names the single model a normal conversation ran on', () => {
    expect(summariseModels([user, a('claude-sonnet-5'), user, a('claude-sonnet-5')])).toEqual({
      all: ['claude-sonnet-5'],
      primary: 'claude-sonnet-5',
      mixed: false,
      stampedTurns: 2,
    });
  });

  it('keeps both models, in order, when a turn falls back mid-conversation', () => {
    const summary = summariseModels([a('claude-sonnet-5'), a('gemini-3.7-flash'), a('gemini-3.7-flash')]);
    expect(summary.all).toEqual(['claude-sonnet-5', 'gemini-3.7-flash']);
    expect(summary.mixed).toBe(true);
    expect(summary.primary).toBe('gemini-3.7-flash');
  });

  it('reports a voice + text conversation as mixed', () => {
    const summary = summariseModels([a('claude-sonnet-5'), a('gemini-live-2.5-flash-preview')]);
    expect(summary.mixed).toBe(true);
    expect(summary.all).toHaveLength(2);
  });

  it('breaks a tie towards the model that answered first', () => {
    expect(summariseModels([a('openai/gpt-realtime-2'), a('gemini-live')]).primary).toBe('openai/gpt-realtime-2');
  });

  it('ignores user turns, so a stray stamp upstream cannot skew the summary', () => {
    expect(summariseModels([{ role: 'user', model: 'claude-sonnet-5' }, a('gemini-live')]).primary).toBe('gemini-live');
  });

  it('is empty for an old conversation logged before stamping existed', () => {
    expect(summariseModels([user, { role: 'assistant', text: 'righto' } as never])).toEqual({
      all: [],
      primary: null,
      mixed: false,
      stampedTurns: 0,
    });
  });

  it('survives junk rather than breaking a chat sync', () => {
    expect(summariseModels(undefined).all).toEqual([]);
    expect(summariseModels(null).all).toEqual([]);
    expect(summariseModels([]).primary).toBeNull();
    expect(summariseModels([a(''), a('   '), a(null), a(undefined)]).stampedTurns).toBe(0);
  });

  it('trims a stamp rather than treating spacing as a different model', () => {
    expect(summariseModels([a(' claude-sonnet-5 '), a('claude-sonnet-5')]).all).toEqual(['claude-sonnet-5']);
  });
});
