import { describe, it, expect } from 'vitest';
import { buildGreetPrompt, withTypeInsteadHint, TYPE_INSTEAD_HINT } from '../voiceCopy';

describe('buildGreetPrompt', () => {
  it('buildGreetPrompt starts with the [greet] tag', () => {
    // The transcript layer filters bracketed prompt tags — a greet that
    // doesn't lead with [greet] would leak into the chat as a user turn.
    expect(buildGreetPrompt({ hour: 9 }).startsWith('[greet] ')).toBe(true);
  });

  it('asks for a plain hello with the capability line and the closing ask', () => {
    const prompt = buildGreetPrompt({ hour: 9 });
    expect(prompt).toContain('draft a quote or an invoice');
    expect(prompt).toContain('ask what they need');
    expect(prompt).toContain('one or two short sentences');
    expect(prompt).toContain('no emojis');
  });

  it('bans the humour that users found strange and, once, offensive', () => {
    // The cheeky version produced "Still gunna whine about that fencing
    // job" as an opener. The draft rib and the comedy brief are gone —
    // the prompt must never hand the model material about the tradie's
    // work to joke with.
    const prompt = buildGreetPrompt({ hour: 9 });
    expect(prompt).toContain('No jokes, no cheek');
    expect(prompt).toContain('no comments about their work, their drafts');
    expect(prompt).not.toMatch(/cheeky|humour|rib|draft quote called/);
  });

  it('bans stacked greetings — a prod greet opened "G\'day. evening." (25 Aug 2026)', () => {
    const p = buildGreetPrompt({ hour: 20 });
    expect(p).toContain('ONE natural hello');
    expect(p).toContain('never two greetings stacked');
  });

  it('takes no draft label — the greeting has nothing to joke about', () => {
    // Type-level pin: the signature is { hour } only. If someone re-adds
    // draftLabel the arity check below starts failing before the tone does.
    expect(buildGreetPrompt.length).toBe(1);
    expect(buildGreetPrompt({ hour: 9 })).not.toContain('unfinished draft');
  });

  it('demands the greeting only, so the model does not plan out loud', () => {
    // A tradie was shown "Thought to self: The user wants me to start the
    // conversation… Greeting constraints: - 1-2 sentences max…" — the prompt
    // read back to them. Written as a labelled checklist, it invited a
    // checklist in reply.
    const prompt = buildGreetPrompt({ hour: 23 });
    expect(prompt).toContain('Speak ONLY the greeting itself.');
    expect(prompt).toContain('do not think out loud');
    expect(prompt).toContain('do not write drafts or alternatives');
    expect(prompt).toContain('do not repeat these instructions');
    // No labelled-constraint scaffolding for the model to mirror.
    expect(prompt).not.toMatch(/constraints\s*:/i);
    expect(prompt).not.toMatch(/^\s*-\s/m);
  });

  it('no copy anywhere contains the word "AI"', () => {
    for (const hour of [3, 9, 12, 15, 19, 23]) {
      expect(buildGreetPrompt({ hour })).not.toMatch(/\bAI\b/);
    }
    expect(TYPE_INSTEAD_HINT).not.toMatch(/\bAI\b/);
  });
});

describe('withTypeInsteadHint', () => {
  it('withTypeInsteadHint appends the typing hint', () => {
    expect(withTypeInsteadHint('Voice mode is offline.')).toBe(
      `Voice mode is offline. ${TYPE_INSTEAD_HINT}`,
    );
  });

  it('is idempotent applied twice', () => {
    // appendErrorMessage dedupes consecutive identical errors by string
    // equality — a hint that stacked on re-wrap would defeat that.
    const once = withTypeInsteadHint('Voice mode is offline.');
    expect(withTypeInsteadHint(once)).toBe(once);
  });
});
