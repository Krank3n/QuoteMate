// Pins the contact-resolution policy in the system prompt + tool schemas.
// Prod transcripts showed conversations dying at the contact gate: the old
// prompt forced "zero matches → ask and wait" before drafting, even though
// the Apply path fully supports customerDraft. Literal assertions on purpose
// — a reworded prompt that quietly reintroduces the ask-first gate should
// fail here, not in a transcript audit.

import { describe, it, expect } from 'vitest';
import { MATE_SYSTEM_PROMPT } from '../systemPrompt';
import { TOOL_DECLARATIONS } from '../toolSchemas';

describe('zero-match contact policy', () => {
  it('zero-match no longer instructs Mate to ask-and-wait before drafting', () => {
    expect(MATE_SYSTEM_PROMPT).not.toContain('Want me to draft a new contact');
    expect(MATE_SYSTEM_PROMPT).not.toContain('before using customerDraft');
    expect(MATE_SYSTEM_PROMPT).toContain(
      'Zero matches → go straight to the draft using customerDraft, and say so in the same turn',
    );
    expect(MATE_SYSTEM_PROMPT).toContain(
      "I'll pop <name> in your contacts along with the quote.",
    );
  });

  it('fuzzy-match confirmation retained', () => {
    // Wrong contact on a quote is worse than asking — the no-wait policy is
    // for ZERO matches only.
    expect(MATE_SYSTEM_PROMPT).toContain(
      "Don't pick silently on a fuzzy hit; wrong contact on a quote is worse than asking.",
    );
    // The one-ask phone/email rule stays word-for-word too.
    expect(MATE_SYSTEM_PROMPT).toContain(
      'One ask only — if they say no / skip / don\'t have it, move on',
    );
  });

  it('toolSchemas customerDraft description matches the no-wait policy', () => {
    const draftQuote = TOOL_DECLARATIONS.find((t) => t.name === 'propose_draft_quote');
    const description = (draftQuote?.parameters as any)?.properties?.customerDraft?.description;
    expect(description).toContain('zero matches');
    expect(description).toContain('rather than waiting for a go-ahead');
    expect(description).not.toContain('confirmed');
  });
});
