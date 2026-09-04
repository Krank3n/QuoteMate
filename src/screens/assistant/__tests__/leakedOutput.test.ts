// The real sighting (23 Aug 2026) and the shapes around it. A false NEGATIVE
// puts our own prompt on a tradie's screen; a false POSITIVE silently eats a
// reply — so the genuine-reply cases matter as much as the leak ones.

import { describe, it, expect } from 'vitest';
import { isLeakedModelOutput, narratedToolCall, stripLeakedScaffolding } from '../leakedOutput';
import { ALL_TOOL_DECLARATIONS } from '../../../services/assistant/toolSchemas';

// Verbatim from the screenshot, trimmed to the opening.
const SIGHTED_LEAK = `Thought to self: The user wants me to start the conversation with a short Aussie greeting.
Greeting constraints:
- 1-2 sentences max.
- Dry, warm, slightly cheeky tradie humour.
- No emojis.
- Time of day: late night.

Okay, let's assemble this.
Greeting: "Burning the midnight oil? Should be sorting 'Bathroom retile' instead of scrolling."

Draft 1: "Burning the midnight oil? That`;

describe('isLeakedModelOutput', () => {
  it('catches the greeting chain-of-thought seen in production', () => {
    expect(isLeakedModelOutput(SIGHTED_LEAK)).toBe(true);
  });

  it('catches it from the very first chunk, before the bubble fills', () => {
    expect(isLeakedModelOutput('Thought to self: The user wants me')).toBe(true);
  });

  it('catches every bracketed prompt tag we send, greet included', () => {
    for (const tag of ['greet', 'narrate', 'narrate-done', 'pipeline-done', 'context']) {
      expect(isLeakedModelOutput(`[${tag}] do the thing`)).toBe(true);
    }
  });

  it('catches planning markers wherever they appear', () => {
    expect(isLeakedModelOutput('Constraints:\n- keep it short')).toBe(true);
    expect(isLeakedModelOutput("Okay, let's refine this.")).toBe(true);
    expect(isLeakedModelOutput('Right.\nDraft 2: "G\'day."')).toBe(true);
    expect(isLeakedModelOutput('Thinking: what do they need')).toBe(true);
  });

  it('leaves a genuine greeting alone', () => {
    expect(
      isLeakedModelOutput(
        "Burning the midnight oil? Should be sorting 'Bathroom retile' instead of scrolling. Tell me what you need.",
      ),
    ).toBe(false);
  });

  it('leaves ordinary replies alone', () => {
    const real = [
      "Drafted Dee's bathroom — tap Apply and I'll price it up.",
      'Got that plan. The bathroom is 3.1m x 2.4m and the ensuite is 2m x 1.8m.',
      "Two Hansens — Sister (...7919) or Thomas (...2922)?",
      'Only thing on that job is the invoice — no service report on file.',
      "Righto, that's drafted.",
      'I draft. You tap to confirm.',
    ];
    for (const t of real) expect(isLeakedModelOutput(t)).toBe(false);
  });

  it('does not trip on a quote that merely mentions a draft or a user', () => {
    expect(isLeakedModelOutput('That draft quote is still sitting there.')).toBe(false);
    expect(isLeakedModelOutput('The user manual for the pump is in the shed.')).toBe(false);
  });

  it('treats empty and whitespace as nothing to hide', () => {
    expect(isLeakedModelOutput('')).toBe(false);
    expect(isLeakedModelOutput('   ')).toBe(false);
  });
});

/**
 * 4 Sep 2026, Android, Gemini Live. Mate narrated the tool instead of calling
 * it — twice — so no card ever appeared and no quote was created, while the
 * bubble showed the raw call. The whole-turn filter above never fired because
 * it only looks at the START of the text, and the bracket was in the middle.
 * Verbatim from users/{uid}/assistantConversations/1788491390841-p4xtabhoo.
 */
const NARRATED_DRAFT =
  "Righto, drafting it now, you can put a name on it later.\n\n" +
  '[propose_draft_quote jobName="Install 2 fire alarms" jobDescription="Install two new fire alarms. ' +
  'One will be located in the bedroom and the other in the master bedroom. Access is simple using a ladder." ' +
  'customerDraft={{name: "Unnamed job"}}]\n' +
  "Drafted it for you — hit 'Price it up' when you're ready.";

const NARRATED_PIPELINE_DONE =
  "Looks like that card's already been resolved, which means the pricing engine was running in the background.\n\n" +
  "[pipeline-done]\nRight, that's drafted. Came together fine — looks like a couple of rows want a look, though.";

describe('stripLeakedScaffolding', () => {
  it('takes the narrated tool call out and keeps the real speech around it', () => {
    const out = stripLeakedScaffolding(NARRATED_DRAFT);
    expect(out).not.toContain('propose_draft_quote');
    expect(out).not.toContain('[');
    expect(out).toContain('Righto, drafting it now');
    expect(out).toContain("hit 'Price it up' when you're ready");
  });

  it('takes a mid-message prompt tag out — the start-anchored filter missed these', () => {
    expect(isLeakedModelOutput(NARRATED_PIPELINE_DONE)).toBe(false);
    const out = stripLeakedScaffolding(NARRATED_PIPELINE_DONE);
    expect(out).not.toContain('[pipeline-done]');
    expect(out).toContain("Right, that's drafted");
  });

  it('holds back a half-streamed call instead of painting it and taking it away', () => {
    expect(stripLeakedScaffolding('Righto, drafting it now.\n\n[propose_dra')).toBe('Righto, drafting it now.');
    expect(stripLeakedScaffolding('Righto.\n\n[')).toBe('Righto.');
    expect(stripLeakedScaffolding('Righto.\n\n[propose_draft_quote jobName="Inst')).toBe('Righto.');
  });

  it('covers every declared tool, not a hand-kept list', () => {
    for (const name of ALL_TOOL_DECLARATIONS.map((d) => d.name)) {
      expect(stripLeakedScaffolding(`Sure thing. [${name} foo="bar"] Done.`)).toBe('Sure thing. Done.');
    }
  });

  it('leaves ordinary speech alone, brackets and all', () => {
    const plain = "That's Slim Jim's smoke alarm install at about $500 — want me to send it?";
    expect(stripLeakedScaffolding(plain)).toBe(plain);
    // Not one of ours, so it is the tradie's words and it stays.
    const aside = 'The invoice [the one from Tuesday] is paid.';
    expect(stripLeakedScaffolding(aside)).toBe(aside);
    expect(stripLeakedScaffolding('')).toBe('');
  });
});

describe('narratedToolCall', () => {
  it('names the tool the fire-alarm turn described instead of calling', () => {
    expect(narratedToolCall(NARRATED_DRAFT)).toBe('propose_draft_quote');
  });

  it('finds a call written mid-sentence, and reports the first one', () => {
    expect(narratedToolCall('Righto. [get_quote quoteId="q1"] Here it is.')).toBe('get_quote');
    expect(narratedToolCall('[show_quote quoteId="q1"] then [propose_send_quote]')).toBe('show_quote');
  });

  it('recognises every declared tool', () => {
    for (const name of ALL_TOOL_DECLARATIONS.map((d) => d.name)) {
      expect(narratedToolCall(`Sure. [${name} foo="bar"]`)).toBe(name);
    }
  });

  it('does not treat an echoed prompt tag as a missed action', () => {
    // Untidy, and stripLeakedScaffolding removes it — but there is no call to
    // recover, so nudging the model here would be noise.
    expect(narratedToolCall(NARRATED_PIPELINE_DONE)).toBeNull();
    expect(narratedToolCall('[narrate] still cooking')).toBeNull();
  });

  it('stays quiet on ordinary speech', () => {
    expect(narratedToolCall("Want me to send it to Slim Jim?")).toBeNull();
    expect(narratedToolCall('The invoice [the one from Tuesday] is paid.')).toBeNull();
    expect(narratedToolCall('')).toBeNull();
    // Named without the bracket syntax is Mate talking about itself, not a call.
    expect(narratedToolCall('I will use propose_draft_quote next.')).toBeNull();
  });
});
