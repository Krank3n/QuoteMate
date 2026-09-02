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

// Aug 2026: a tradie asked how to backdate an invoice and Mate sent him to
// controls that did not exist — "look for Edit Header or Revert to Draft", then
// the three-dots menu. He replied "is grayed out and have tapped on but not
// coming up" and kept hunting for ~8 turns.
//
// Backdating now EXISTS (documentDate + the header date badge on JobPreview),
// so the rule is no longer "you can't" but "here is the one real control" —
// the invented ones stay banned. Literal assertions so a reword can't quietly
// let Mate start map-reading the app again.
describe('never invent app UI', () => {
  const section = promptSection("Being straight about what you can't do");

  it('forbids inventing a control outright', () => {
    expect(section).toContain('NEVER invent a button, menu, tab or screen.');
    expect(section).toContain("You cannot see the tradie's screen");
  });

  it('whitelists the locations it may name, and names the invented ones as off-limits', () => {
    expect(section).toContain('The ONLY app locations you may send someone to are the ones named in this prompt');
    // The ones Mate hallucinated in the sighting that still do not exist.
    expect(section).toContain('an "Edit" or "Revert to Draft" button');
    expect(section).toContain('a three-dots menu');
    expect(section).toContain('do not describe where it "usually" is');
  });

  it('the whitelist includes the date badge now that it is real', () => {
    // JobPreviewScreen renders a TouchableOpacity (accessibilityLabel
    // "Change document date") opening DueDateSheet title="Document date".
    expect(section).toContain('the date badge in the header');
    expect(section).not.toContain('a date field in a header — you do NOT know exists');
  });

  it('requires the no-tool admission in the FIRST reply', () => {
    expect(section).toContain('say so in the FIRST reply');
    expect(section).toContain("I can't change that from here.");
  });

  it('believes the tradie and stops after one pointer', () => {
    expect(section).toContain('BELIEVE THEM');
    expect(section).toContain('Never send them round the app a third time.');
  });

  it('points backdating at the real control instead of denying it', () => {
    expect(section).toContain('Backdating IS possible');
    expect(section).toContain('the document date sits in the header next to the quote/invoice number');
    expect(section).toContain('Reset to today');
    // The old denial must be gone — it became false the moment the feature
    // shipped, and a stale "you can't" is its own wrong answer.
    expect(section).not.toContain('You CANNOT change or backdate');
    expect(section).not.toContain('there is nowhere in the app to tap to do it');
  });

  it('says backdating an invoice moves the due date', () => {
    // handleDocumentDateChange recomputes dueDate off the new issueDate.
    expect(section).toContain('this moves the due date too');
  });

  it('still owns that it has no tool for it, so the tradie does it', () => {
    expect(section).toContain('the tradie does it themselves — you have no tool for it');
    // Match on intent, not the substring "date" — that lives inside
    // "up-date_customer" and every other update tool. If a date tool ever
    // ships, this fails and the prompt should propose it rather than
    // sending the tradie to the header.
    const dateTool = TOOL_DECLARATIONS.find((t) =>
      /backdate|issue date|issueDate|change the date|set the date/i.test(
        `${t.name} ${t.description ?? ''}`,
      ),
    );
    expect(dateTool, 'a date tool now exists — have Mate propose it').toBeUndefined();
  });

  it("doesn't invite a made-up manual path on a repeat failure", () => {
    // The old wording ("offer the manual path in the app instead") was an open
    // invitation to invent one — the exact failure this section now bans.
    expect(section).not.toContain('offer the manual path in the app instead');
    expect(section).toContain('only point at a manual path if it\'s one of the locations named above');
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
    // The cloud copy is pulled once per session, but offline (or before the
    // pull lands) the local cache still reads empty while Firestore holds it.
    expect(section).toContain("I can't see a supplier list on this phone");
    expect(section).toContain('never "you haven\'t got one"');
  });

  it("never claims a supplier-book price it didn't get", () => {
    expect(section).toContain(
      'Never claim a price came off the supplier book unless the pricing engine told you it did.',
    );
  });

  it('can read the book, and says when to', () => {
    // Before search_supplier_book, "why didn't you use my supplier book?"
    // had no honest answer — Mate could only see that a book existed.
    expect(section).toContain('search_supplier_book shows you what\'s IN it');
    expect(section).toContain('asks why a quote didn\'t use their supplier');
    expect(section).toContain("pass the entry's exact name as searchTerm to propose_add_line_item");
    expect(promptSection('Other tools')).toContain('search_supplier_book —');
    expect(TOOL_DECLARATIONS.find((t) => t.name === 'search_supplier_book')).toBeTruthy();
  });

  it('a price the tradie gives Mate is remembered, and Mate says so once', () => {
    expect(section).toContain('saved to the book automatically');
    expect(section).toContain('Say so in a few words the first time it happens in a conversation, then stop mentioning it.');
    expect(promptSection('Other tools')).toContain('saves that price to their supplier book');
  });

  it('a missing price goes to the tradie via propose_update_line_item, never the materials list', () => {
    const fixing = promptSection('Reviewing & fixing quotes');
    expect(fixing).toContain('put their number on the row with propose_update_line_item');
    expect(fixing).not.toContain('set it themselves on the materials list');
    expect(fixing).toContain('you only ever write one the tradie gave you');
  });

  it('Mate never reads prices off the photo itself', () => {
    expect(section).toContain('You do NOT read the prices off it yourself');
    expect(section).toContain('NEVER type a price into their book');
    // Same promise made in the can't-do block, where a tradie's question
    // about it is most likely to land.
    expect(MATE_SYSTEM_PROMPT).toContain(
      "You can't read prices off a photo yourself, and you never type a price into the tradie's supplier book.",
    );
  });

  it('propose_import_supplier_list is described AND declared', () => {
    expect(section).toContain('call propose_import_supplier_list');
    expect(promptSection('Other tools')).toContain('propose_import_supplier_list —');
    const declaration = TOOL_DECLARATIONS.find((t) => t.name === 'propose_import_supplier_list');
    expect(declaration).toBeTruthy();
    expect(declaration?.parameters.required ?? []).toEqual([]);
  });

  it('folds the post-pipeline nudge into one line naming at most two items', () => {
    expect(section).toContain('at most ONE line naming no more than two items');
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

// A tradie was told "tap Apply and I'll get the pipeline to price it up" —
// parroted straight from the prompt's own worked example, on a card whose
// button says "Price it up". The examples are what Mate imitates, so they
// must model the real button labels and keep internal vocabulary internal.
describe('spoken examples match the real UI', () => {
  it('no example reply says "tap Apply"', () => {
    expect(MATE_SYSTEM_PROMPT).not.toContain('tap Apply and');
    expect(MATE_SYSTEM_PROMPT).toContain("hit 'Price it up' when you're ready.");
  });

  it('bans saying "Apply" and "pipeline" to the tradie outright', () => {
    expect(MATE_SYSTEM_PROMPT).toContain('don\'t say "Apply" — no button says that any more');
    expect(MATE_SYSTEM_PROMPT).toContain('"Pipeline" is an internal word — never say it to the tradie');
  });
});

// Tom's own 25 Aug voice session (Katie's deck): asked to list the materials
// — refused; said "weight belt" (STT for "weed mat") — was told to go look
// it up himself; asked for the PDF — told it can't be shown, with the
// Preview PDF button sitting on the card. Three deflections, three rules.
describe('answers instead of deflecting (25 Aug session)', () => {
  it('lists materials when asked instead of pointing at the screen', () => {
    expect(MATE_SYSTEM_PROMPT).toContain(
      'when they ASK you to list or read out the materials, do it — never refuse',
    );
    expect(MATE_SYSTEM_PROMPT).toContain('biggest three or four lines by dollar value');
  });

  it('resolves STT-mangled line names itself, never sends the tradie to look', () => {
    expect(MATE_SYSTEM_PROMPT).toContain('"weight belt" for "weed mat"');
    expect(MATE_SYSTEM_PROMPT).toContain(
      'NEVER ask them to open the quote and find it for you',
    );
    const declaration = TOOL_DECLARATIONS.find((t) => t.name === 'propose_delete_line_item');
    expect(declaration?.description).toContain('speech-to-text slop');
  });

  it('points at the card\'s own Preview PDF button instead of claiming inability', () => {
    expect(MATE_SYSTEM_PROMPT).toContain('tap Preview PDF on the card');
    expect(MATE_SYSTEM_PROMPT).toContain("Never claim you can't show a PDF");
  });
});

describe('pending drafts are not quotes (birdhouse convo, 25 Aug 2026)', () => {
  // The model invented "quote_pending_<ts>" to update the customer on a draft
  // nobody had applied, then told the tradie to fix it manually six times.
  const prompt = MATE_SYSTEM_PROMPT;

  it('bans inventing quote ids', () => {
    expect(prompt).toContain('NEVER invent a quoteId');
  });

  it('routes corrections on an un-applied draft to a fresh propose_draft_quote', () => {
    expect(prompt).toContain('call propose_draft_quote again with the corrected details');
    expect(prompt).toContain('the fresh card replaces the stale one');
  });

  it('makes "open it manually" the last resort, not the first answer', () => {
    expect(prompt).toContain('LAST resort');
    expect(prompt).toContain('never the first answer');
  });
});

describe('typed confirmations (25 Aug 2026)', () => {
  // The control tools now ride both surfaces — a typed "yes" must resolve
  // the waiting card, so the prompt can no longer call them voice-only.
  it('card confirmation is its own BOTH-surfaces section, not a Voice-mode bullet', () => {
    // First live replay: with the rule buried under the "Voice mode" heading,
    // the text model ignored it and re-proposed the draft twice instead of
    // applying — while claiming "pricing's running".
    expect(MATE_SYSTEM_PROMPT).toContain('Confirming cards (typed in the chat or spoken — BOTH surfaces)');
    expect(MATE_SYSTEM_PROMPT).toContain('do NOT call propose_draft_quote (or any propose_*) again for the same thing');
    expect(MATE_SYSTEM_PROMPT).not.toContain('exist only in voice');
    const voiceIdx = MATE_SYSTEM_PROMPT.indexOf('\nVoice mode\n');
    const confirmIdx = MATE_SYSTEM_PROMPT.indexOf('Confirming cards');
    expect(confirmIdx).toBeGreaterThan(-1);
    expect(confirmIdx).toBeLessThan(voiceIdx);
  });
});

describe('mid-pipeline claims (real-device report, 26 Aug 2026)', () => {
  const section = () => promptSection('Pricing narration (after the tradie taps Apply)');

  it('binds the rule to the whole pipeline window, not just the [narrate] turn', () => {
    // The bug: every rule here was scoped to a prompt tag ("On [narrate]:",
    // "On [pipeline-done]:"), so the turns in BETWEEN were unconstrained — and
    // those are exactly the turns the tradie triggers by talking during the
    // 15-40 second run. Mate kept telling them the quote was ready to view.
    expect(section()).toMatch(/every single thing you say in that window/i);
  });

  it('anticipates the tradie talking mid-run rather than treating it as an edge case', () => {
    expect(section()).toMatch(/can talk to you the entire time/i);
  });

  it('gives Mate the answer to give while it waits', () => {
    expect(section()).toMatch(/it's still pricing/i);
  });

  it('names the specific words that were being used wrongly', () => {
    const s = section();
    for (const word of ['ready', 'done', 'finished', 'drafted', 'sorted', 'priced']) {
      expect(s.toLowerCase()).toContain(word);
    }
    expect(s).toMatch(/view it, open it, check it/i);
  });

  it('bans show_quote on a quote that is still pricing', () => {
    expect(section()).toMatch(/don't call show_quote on it/i);
  });

  it('says the [pipeline-done] line is the ONLY signal that it finished', () => {
    // Mate had been inferring completion from elapsed time / conversational feel.
    expect(section()).toMatch(/from nothing else/i);
    expect(section()).toMatch(/cannot tell by how long/i);
  });

  it('states the consequence, so the rule has a reason attached', () => {
    expect(section()).toMatch(/in front of the customer/i);
  });
});

// The smoke-alarm conversation: the tradie asked for a ballpark, was told
// "I still need a customer to attach it to, even for a rough one", gave a name
// under protest, was then asked for a phone number, and left. That account
// still has zero quotes. A reworded prompt that reinstates the gate fails here.
describe('a rough price does not require a customer', () => {
  it('instructs drafting with a placeholder when the tradie asks for a rough price', () => {
    expect(MATE_SYSTEM_PROMPT).toContain('rough price');
    expect(MATE_SYSTEM_PROMPT).toContain('Unnamed job');
    expect(MATE_SYSTEM_PROMPT).toMatch(/never make a price conditional on a customer/i);
  });

  it('keeps the placeholder in step with the pre-send gate', async () => {
    const { isPlaceholderCustomer } = await import('../../../utils/quoteReview');
    const placeholder = MATE_SYSTEM_PROMPT.match(/customerDraft: \{ name: "([^"]+)" \}/)?.[1];
    expect(placeholder).toBeTruthy();
    expect(isPlaceholderCustomer(placeholder)).toBe(true);
  });
});
