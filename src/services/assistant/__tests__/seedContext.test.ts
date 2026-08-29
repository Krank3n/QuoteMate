/**
 * ElevenLabs has no way to prefill a transcript, so prior turns ride in as a
 * contextual update instead — which is a better fit than what it replaces: the
 * Gemini path seeded history as a real turn with turnComplete:false purely to
 * stop the model replying to it, and contextual updates are non-reply-
 * triggering by definition.
 */
import { describe, it, expect } from 'vitest';
import { buildSeedContext, MAX_SEED_CHARS } from '../seedContext';
import { MAX_HISTORY_TURNS } from '../liveSession';
import type { ChatMessage } from '../../../types/assistant';

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: 'm', role: 'user', text: 'hello', createdAt: '2026-08-27T00:00:00Z', ...over,
});

describe('buildSeedContext', () => {
  it('returns null for an empty history rather than an empty update', () => {
    expect(buildSeedContext([])).toBeNull();
  });

  it('returns null when every message is blank', () => {
    expect(buildSeedContext([msg({ text: '   ' }), msg({ text: '' })])).toBeNull();
  });

  it('labels who said what', () => {
    const out = buildSeedContext([
      msg({ role: 'user', text: 'quote a fence' }),
      msg({ role: 'assistant', text: 'righto' }),
    ]);
    expect(out).toContain('Tradie: quote a fence');
    expect(out).toContain('You: righto');
  });

  it('tags it so the prompt\'s existing context rules apply', () => {
    // The system prompt already teaches Mate that "[context]" lines are silent
    // system updates, never to be spoken about as if the tradie said them.
    expect(buildSeedContext([msg({ text: 'hi' })])).toMatch(/^\[context\]/);
  });

  it('skips hidden messages', () => {
    // Those are blanked leak-filter bubbles and notes Mate has already been
    // fed — re-seeding them teaches it that bracketed framing is ordinary
    // conversation, which is how prompt tags end up spoken aloud.
    const out = buildSeedContext([
      msg({ text: 'visible' }),
      msg({ text: '[context] a quote was applied', hidden: true }),
    ]);
    expect(out).toContain('visible');
    expect(out).not.toContain('a quote was applied');
  });

  it('carries at most MAX_HISTORY_TURNS turns', () => {
    const many = Array.from({ length: MAX_HISTORY_TURNS + 15 }, (_, i) =>
      msg({ text: `line ${i}` }),
    );
    const out = buildSeedContext(many)!;
    expect(out).not.toContain('line 0');
    expect(out).toContain(`line ${many.length - 1}`);
  });

  it('keeps the most recent exchange when trimming for length', () => {
    const long = Array.from({ length: 20 }, (_, i) =>
      msg({ text: `${i}:${'x'.repeat(300)}` }),
    );
    const out = buildSeedContext(long)!;
    expect(out.length).toBeLessThanOrEqual(MAX_SEED_CHARS + 200);
    expect(out).toContain('19:');
  });

  it('never trims away the last turn, however long it is', () => {
    const huge = msg({ text: 'y'.repeat(MAX_SEED_CHARS * 3) });
    const out = buildSeedContext([huge])!;
    expect(out).toContain('yyy');
  });
});
