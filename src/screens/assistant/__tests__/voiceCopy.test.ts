import { describe, it, expect } from 'vitest';
import { buildGreetPrompt, withTypeInsteadHint, TYPE_INSTEAD_HINT } from '../voiceCopy';

describe('buildGreetPrompt', () => {
  it('buildGreetPrompt starts with the [greet] tag', () => {
    // The transcript layer filters bracketed prompt tags — a greet that
    // doesn't lead with [greet] would leak into the chat as a user turn.
    expect(buildGreetPrompt({ hour: 9, draftLabel: '' }).startsWith('[greet] ')).toBe(true);
  });

  it('asks for one capability line and no longer bans mentioning features', () => {
    const prompt = buildGreetPrompt({ hour: 9, draftLabel: '' });
    expect(prompt).toContain(
      'Work in ONE quick line on what you can do — draft a quote, price materials, sort an invoice — said like a mate, not a sales pitch.',
    );
    expect(prompt).not.toContain("Don't list options or features");
    // The rest of the contract is unchanged.
    expect(prompt).toContain('1–2 sentences max');
    expect(prompt).toContain('No emojis');
    expect(prompt).toContain('End by inviting them to tell you what they need. Then stop and wait.');
  });

  it('mentions the draft label when provided', () => {
    expect(buildGreetPrompt({ hour: 9, draftLabel: "Sam's bathroom" })).toContain("Sam's bathroom");
    expect(buildGreetPrompt({ hour: 9, draftLabel: '' })).toContain(
      'There are no unfinished drafts right now.',
    );
  });

  it('no copy anywhere contains the word "AI"', () => {
    for (const hour of [3, 9, 12, 15, 19, 23]) {
      expect(buildGreetPrompt({ hour, draftLabel: 'Fence job' })).not.toMatch(/\bAI\b/);
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
