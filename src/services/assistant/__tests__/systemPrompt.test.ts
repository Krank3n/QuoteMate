// Pins the contact-resolution policy in the system prompt + tool schemas.
// Prod transcripts showed conversations dying at the contact gate: the old
// prompt forced "zero matches → ask and wait" before drafting, even though
// the Apply path fully supports customerDraft. Literal assertions on purpose
// — a reworded prompt that quietly reintroduces the ask-first gate should
// fail here, not in a transcript audit.

import { describe, it, expect } from 'vitest';
import { MATE_SYSTEM_PROMPT } from '../systemPrompt';
import { TOOL_DECLARATIONS } from '../toolSchemas';

/**
 * One prompt block, from its heading to the next blank line. Sections are
 * blank-line separated, so this is exact — and it lets the tone assertions
 * below target only the sections this feature added. A whole-prompt scan for
 * "AI" would fail on the Identity block's "Never say you're an AI".
 */
export function promptSection(heading: string): string {
  const start = MATE_SYSTEM_PROMPT.indexOf(`\n${heading}\n`);
  expect(start, `missing prompt section: ${heading}`).toBeGreaterThan(-1);
  const rest = MATE_SYSTEM_PROMPT.slice(start + heading.length + 2);
  const end = rest.indexOf('\n\n');
  return rest.slice(0, end === -1 ? undefined : end);
}

const BANNED_WORDS = ['guys', 'blokes', 'fellas', 'lads', 'folks', 'fancy'];

export function expectHouseTone(section: string): void {
  for (const word of BANNED_WORDS) {
    expect(section.toLowerCase()).not.toContain(word);
  }
  expect(section).not.toMatch(/\bAI\b/);
}

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

// Photos are the one input Mate can misuse badly: reading a dimension that
// isn't printed, or describing a picture and then handing the pipeline a
// jobDescription that never mentions it. Literal assertions so a reword can't
// quietly drop either guard.
describe('photo policy', () => {
  const section = promptSection('Photos the tradie sends');

  it('tells Mate it can see attached photos', () => {
    expect(section).toContain('You can see photos attached to a message.');
    expect(section).toContain('ONE short line');
  });

  it('treats a site photo as answering the must-ask questions it covers', () => {
    expect(section).toContain("that question is answered — don't ask it");
  });

  it("reads a plan's printed numbers exactly", () => {
    expect(section).toContain('Read the printed numbers and quote them exactly as printed.');
  });

  it('forbids inventing measurements', () => {
    expect(section).toContain(
      "NEVER invent a measurement, area, length or count you can't read off the photo.",
    );
    expect(section).toContain("If it isn't legible, ask.");
  });

  it("requires the photo's content in the jobDescription", () => {
    expect(section).toContain('Put what the photo told you into the jobDescription');
    expect(section).toContain('A photo you never described is a photo the draft never got.');
  });

  it('photos ride onto the quote on Apply', () => {
    expect(section).toContain('Photos ride onto the quote on Apply');
    expect(section).toContain("don't ask them to add photos again in the wizard");
  });

  it('a photo is only visible on the turn it was sent', () => {
    expect(section).toContain("You only see a photo on the turn it's sent.");
    expect(section).toContain("never claim it didn't arrive");
  });

  it('points PDFs at Job Photos instead', () => {
    expect(section).toContain("You can't read a PDF in here.");
  });

  it('stays gender-neutral and never names the technology', () => {
    expectHouseTone(section);
  });
});

// The supplier-book offer is the easiest thing in the app to make annoying:
// repeated every turn, or blocking a draft the tradie could have had.
describe('supplier book policy', () => {
  const section = promptSection('Supplier book');

  it('names both flags together', () => {
    expect(section).toContain('specialistSupply');
    expect(section).toContain('supplierBookPopulated');
    expect(section).toContain('they only mean something together');
  });

  it('says the pipeline checks the book before retail', () => {
    expect(section).toContain('checks it BEFORE Bunnings and Reece');
  });

  it('the offer never blocks the draft', () => {
    expect(section).toContain('keep drafting either way');
    expect(section).toContain('NEVER hold the draft waiting for a price list');
  });

  it('caps at one offer per job', () => {
    expect(section).toContain('ONE offer per job.');
    expect(section).toContain('drop it for the rest of the conversation');
  });

  it("blames the phone, not the tradie, for an empty book", () => {
    // syncFavoritesFromCloud is a no-op, so a reinstall reads empty even
    // though Firestore still holds the import.
    expect(section).toContain("I can't see a supplier list on this phone");
    expect(section).toContain('never "you haven\'t got one"');
  });

  it("never claims a supplier-book price it didn't get", () => {
    expect(section).toContain(
      'Never claim a price came off the supplier book unless the pipeline told you it did.',
    );
  });

  it('get_job_requirements schema documents supplierBookPopulated', () => {
    const declaration = TOOL_DECLARATIONS.find((t) => t.name === 'get_job_requirements');
    expect(declaration?.description).toContain('supplierBookPopulated');
    expect(declaration?.description).toContain('supplierBookCoversTrade');
  });

  it('stays gender-neutral and never names the technology', () => {
    expectHouseTone(section);
  });
});
