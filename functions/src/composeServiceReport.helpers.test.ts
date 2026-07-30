import { describe, it, expect } from 'vitest';
import {
  buildComposePrompt,
  sanitizeComposed,
  ComposeNotes,
  MAX_ADDITIONS,
  MAX_PREVIOUS_WRITE_UP,
  MAX_SUGGESTIONS,
} from './composeServiceReport.helpers';

describe('buildComposePrompt — factual, Aussie, no forbidden term', () => {
  const notes: ComposeNotes = {
    natureOfProblem: 'no hot water, tripped rcd',
    workCarriedOut: 'replaced split flex on hws iso',
    recommendedWork: 'suggest rcd upgrade next visit',
  };

  it('instructs the model not to invent facts', () => {
    const prompt = buildComposePrompt(notes).toLowerCase();
    expect(prompt).toContain('factual');
    // Names the categories of invention that are forbidden.
    expect(prompt).toContain('measurements');
    expect(prompt).toContain('equipment');
    expect(prompt).toMatch(/never add|do not add|nothing may be added|not already present/);
  });

  it('allows redistribution — facts may move to the field where they belong', () => {
    const prompt = buildComposePrompt(notes);
    expect(prompt).toMatch(/may move a fact/i);
    // Spells out the canonical example: a recommendation typed elsewhere
    // belongs in recommendedWork.
    expect(prompt).toContain(
      '"recommend" or "should be done later" statement belongs in "recommendedWork"',
    );
    // And makes clear moving is not licence to add.
    expect(prompt).toMatch(/facts may move between fields, but no new fact may be added/i);
  });

  it('permits filling a field whose own note was blank from other notes', () => {
    const prompt = buildComposePrompt({ workCarriedOut: 'cleaned filters, recommend replacing the belt' });
    expect(prompt).toMatch(/filled even though its own note was blank/i);
    expect(prompt).toMatch(/every fact in it came from one of the supplied notes/i);
  });

  it('always requests all three write-up keys, even for partial notes', () => {
    const prompt = buildComposePrompt({ workCarriedOut: 'swapped the tap washer' });
    expect(prompt).toContain('"natureOfProblem"');
    expect(prompt).toContain('"workCarriedOut"');
    expect(prompt).toContain('"recommendedWork"');
  });

  it('only includes the supplied notes in the source block', () => {
    const prompt = buildComposePrompt({ workCarriedOut: 'swapped the tap washer' });
    const sourceBlock = prompt.split('NOTES TO REWRITE:')[1];
    expect(sourceBlock).toContain('Work carried out');
    expect(sourceBlock).not.toContain('Nature of the problem');
    expect(sourceBlock).not.toContain('Recommended work');
  });

  it('asks for both suggestion lists as optional, review-only extras', () => {
    const prompt = buildComposePrompt(notes);
    expect(prompt).toContain('"suggestedEquipment"');
    expect(prompt).toContain('"suggestedChecklist"');
    expect(prompt).toMatch(/optional extras/i);
    expect(prompt).toMatch(/review/i);
    expect(prompt).toMatch(/nothing is added to the report automatically/i);
    expect(prompt).toContain(`at most ${MAX_SUGGESTIONS}`);
    // Suggestions come strictly from the notes.
    expect(prompt).toMatch(/strictly from the notes/i);
  });

  it('demands Australian English and gender-neutral tone', () => {
    const prompt = buildComposePrompt(notes).toLowerCase();
    expect(prompt).toContain('australian english');
    expect(prompt).toContain('gender-neutral');
  });

  it('forbids a greeting', () => {
    const prompt = buildComposePrompt(notes).toLowerCase();
    expect(prompt).toMatch(/greeting|salutation/);
  });

  it('never contains the two-letter machine-intelligence term', () => {
    const prompt = buildComposePrompt(notes);
    // Word-boundary match so "maintain"/"claims" etc. don't trip it.
    expect(prompt).not.toMatch(/\bAI\b/);
    expect(prompt).not.toMatch(/\bai\b/i);
  });
});

describe('sanitizeComposed — cleans model output', () => {
  it('strips a leading greeting the model added', () => {
    const raw = JSON.stringify({
      natureOfProblem: 'Hi there, the customer reported no hot water and a tripped safety switch.',
      workCarriedOut: 'Replaced the damaged flexible connection on the hot water isolation valve.',
      recommendedWork: 'Upgrade the safety switch on a future visit.',
    });
    const out = sanitizeComposed(raw, {
      natureOfProblem: 'no hot water, tripped rcd',
      workCarriedOut: 'replaced split flex on hws iso',
      recommendedWork: 'suggest rcd upgrade next visit',
    });
    expect(out.natureOfProblem).toBe(
      'the customer reported no hot water and a tripped safety switch.',
    );
    expect(out.natureOfProblem).not.toMatch(/^hi/i);
    // Non-greeting fields pass through untouched.
    expect(out.workCarriedOut).toContain('Replaced the damaged flexible connection');
  });

  it('allows redistribution — a field can be filled although its own note was empty', () => {
    // Tradie typed a recommendation under workCarriedOut; the model moved it
    // to recommendedWork. The sanitiser must keep the moved fact, not blank it.
    const raw = JSON.stringify({
      natureOfProblem: '',
      workCarriedOut: 'Cleaned the filters on both split systems.',
      recommendedWork: 'Replace the outdoor unit fan belt on a future visit.',
    });
    const out = sanitizeComposed(raw, {
      workCarriedOut:
        'cleaned filters both splits, outdoor unit fan belt needs replacing later',
      // natureOfProblem and recommendedWork were never entered by the tradie.
    });
    expect(out.recommendedWork).toBe('Replace the outdoor unit fan belt on a future visit.');
    expect(out.workCarriedOut).toBe('Cleaned the filters on both split systems.');
    expect(out.natureOfProblem).toBe('');
  });

  it('returns all-empty output when ALL source notes were empty', () => {
    const raw = JSON.stringify({
      natureOfProblem: 'Invented problem.',
      workCarriedOut: 'Invented work.',
      recommendedWork: 'Invented recommendation.',
      suggestedEquipment: ['Invented unit'],
      suggestedChecklist: ['Invented task'],
      suggestedAdditions: [{ text: 'Invented claim.', field: 'workCarriedOut' }],
    });
    const out = sanitizeComposed(raw, {});
    expect(out).toEqual({
      natureOfProblem: '',
      workCarriedOut: '',
      recommendedWork: '',
      suggestedEquipment: [],
      suggestedChecklist: [],
      suggestedAdditions: [],
    });
  });

  it('clamps suggestion lists: strings only, trimmed, deduped, max 8', () => {
    const raw = JSON.stringify({
      workCarriedOut: 'Serviced all split systems.',
      suggestedEquipment: [
        '  Split system ×2 ',
        'split system ×2', // case-insensitive duplicate
        42, // non-string dropped
        null,
        '', // blank dropped
        'Ducted unit',
        'Unit A',
        'Unit B',
        'Unit C',
        'Unit D',
        'Unit E',
        'Unit F',
        'Unit G', // 9th unique — over the cap
      ],
      suggestedChecklist: 'not an array',
    });
    const out = sanitizeComposed(raw, { workCarriedOut: 'serviced all splits' });
    expect(out.suggestedEquipment[0]).toBe('Split system ×2');
    expect(out.suggestedEquipment).toHaveLength(8);
    expect(out.suggestedEquipment).not.toContain('Unit G');
    expect(out.suggestedEquipment.every((s) => typeof s === 'string')).toBe(true);
    expect(out.suggestedChecklist).toEqual([]);
  });

  it('keeps the tradie notes when the reply is not JSON at all', () => {
    const out = sanitizeComposed('sorry, I cannot do that', {
      natureOfProblem: 'blocked drain',
      workCarriedOut: 'cleared the blockage with the eel',
    });
    expect(out.natureOfProblem).toBe('blocked drain');
    expect(out.workCarriedOut).toBe('cleared the blockage with the eel');
    expect(out.recommendedWork).toBe('');
    expect(out.suggestedEquipment).toEqual([]);
    expect(out.suggestedChecklist).toEqual([]);
  });

  it('keeps the tradie notes when the model returned no write-up text', () => {
    const raw = JSON.stringify({
      natureOfProblem: '',
      workCarriedOut: '',
      recommendedWork: '',
      suggestedEquipment: ['Split system'],
    });
    const out = sanitizeComposed(raw, {
      natureOfProblem: 'blocked drain',
      workCarriedOut: 'cleared the blockage',
    });
    expect(out.natureOfProblem).toBe('blocked drain');
    expect(out.workCarriedOut).toBe('cleared the blockage');
  });

  it('tolerates a code-fenced JSON reply', () => {
    const raw = '```json\n{"natureOfProblem":"Faulty powerpoint in the garage."}\n```';
    const out = sanitizeComposed(raw, { natureOfProblem: 'dead powerpoint garage' });
    expect(out.natureOfProblem).toBe('Faulty powerpoint in the garage.');
  });

  it('returns the all-empty shape when source notes are empty and the reply is unusable', () => {
    const out = sanitizeComposed('not json at all', {});
    expect(out).toEqual({
      natureOfProblem: '',
      workCarriedOut: '',
      recommendedWork: '',
      suggestedEquipment: [],
      suggestedChecklist: [],
      suggestedAdditions: [],
    });
  });
});

/*
 * Fuller prose without fuller claims.
 *
 * The trigger for this was a real tradie comparing our write-up to a
 * general-purpose chatbot's. Given "cleaned filters condenser coils checked
 * electrical components", the chatbot produced a solid paragraph — and closed
 * it with "Unit was tested after servicing and found to be operating normally
 * at the time of inspection." Nothing in the notes says the unit was tested,
 * or that it was normal. On a document a customer keeps, that sentence is the
 * whole liability.
 *
 * So the prompt buys length in two currencies it can afford — the recognised
 * purpose of a stated action, and the sub-parts a stated action covers — and
 * refuses to buy it with outcomes. The closing statement doesn't vanish; it
 * comes back in suggestedAdditions for the tradie to confirm.
 */
describe('buildComposePrompt — fuller prose, same factual line', () => {
  const notes = { workCarriedOut: 'cleaned filters condenser coils checked electrical components' };

  it('asks for several sentences per field instead of one or two', () => {
    const prompt = buildComposePrompt(notes);
    expect(prompt).toMatch(/two to five sentences/i);
    // The old ceiling is gone.
    expect(prompt).not.toMatch(/keep each field to a sentence or two/i);
  });

  it('refuses to pad a thin note to reach the length', () => {
    expect(buildComposePrompt(notes)).toMatch(/never pad with filler/i);
  });

  // Observed against the live model once the prose was widened: given only
  // "completed a service on the package unit", it filled the empty
  // natureOfProblem with "a scheduled service was required" — a claim about
  // the visit the tradesperson never made.
  it('tells the model an empty field is a correct answer', () => {
    const prompt = buildComposePrompt(notes);
    expect(prompt).toMatch(/AN EMPTY FIELD IS A CORRECT ANSWER/);
    expect(prompt).toMatch(/return "natureOfProblem" as an empty string/i);
    expect(prompt).toMatch(/do NOT manufacture one by restating that a service took place/i);
  });

  it('bans characterising the visit type when the notes do not', () => {
    const prompt = buildComposePrompt(notes);
    expect(prompt).toMatch(
      /scheduled, routine, preventative, an emergency, or a breakdown unless the notes say so/i,
    );
  });

  it('permits the recognised purpose and sub-parts of a stated action', () => {
    const prompt = buildComposePrompt(notes);
    expect(prompt).toMatch(/recognised, standard purpose of an action the notes say was performed/i);
    expect(prompt).toMatch(/sub-parts a stated action inherently covers/i);
    expect(prompt).toMatch(/describing work already in the notes, not adding work/i);
  });

  it('bans the exact class of claim that started this — tested, operating normally', () => {
    const prompt = buildComposePrompt(notes);
    expect(prompt).toMatch(/may NOT state any OUTCOME, RESULT, TEST, READING, or CONDITION/i);
    expect(prompt).toMatch(/was tested/i);
    expect(prompt).toMatch(/was operating normally/i);
    expect(prompt).toMatch(/only the tradesperson can make them/i);
  });

  it('routes those claims to suggestedAdditions as confirmable sentences', () => {
    const prompt = buildComposePrompt(notes);
    expect(prompt).toContain('"suggestedAdditions"');
    expect(prompt).toMatch(/do NOT write that statement into the write-up/i);
    expect(prompt).toMatch(/confirm with one tap/i);
    expect(prompt).toContain(`At most ${MAX_ADDITIONS} entries`);
    // And the reply contract names the object shape.
    expect(prompt).toContain('{"text","field"}');
  });

  it('still never contains the two-letter machine-intelligence term', () => {
    const prompt = buildComposePrompt(notes, {
      businessName: 'Coastal Air',
      tradeCategory: 'HVAC',
      previousWriteUp: 'Serviced the package unit.',
    });
    expect(prompt).not.toMatch(/\bAI\b/);
  });
});

describe('buildComposePrompt — previous write-up is vocabulary, not facts', () => {
  const notes = { workCarriedOut: 'serviced the unit' };

  it('includes the previous write-up when one is supplied', () => {
    const prompt = buildComposePrompt(notes, {
      previousWriteUp: 'Serviced the package unit and the high wall split.',
    });
    expect(prompt).toContain('Serviced the package unit and the high wall split.');
  });

  it('fences it to vocabulary and forbids carrying its facts across', () => {
    const prompt = buildComposePrompt(notes, {
      previousWriteUp: 'Replaced the contactor; gas charge low.',
    });
    expect(prompt).toMatch(/WORDING REFERENCE/);
    expect(prompt).toMatch(/ONLY to match the tradesperson's vocabulary/i);
    expect(prompt).toMatch(
      /do not carry any fact, finding, measurement or recommendation from it/i,
    );
    expect(prompt).toMatch(/describes a DIFFERENT visit/i);
  });

  it('keeps it out of the notes-to-rewrite block so it is never a source', () => {
    const prompt = buildComposePrompt(notes, {
      previousWriteUp: 'Replaced the contactor.',
    });
    const sourceBlock = prompt.split('NOTES TO REWRITE:')[1].split('WORDING REFERENCE')[0];
    expect(sourceBlock).toContain('serviced the unit');
    expect(sourceBlock).not.toContain('Replaced the contactor.');
  });

  it('adds no reference block at all when there is no previous visit', () => {
    const prompt = buildComposePrompt(notes, { businessName: 'Coastal Air' });
    expect(prompt).not.toMatch(/WORDING REFERENCE/);
  });

  it('ignores a blank previous write-up', () => {
    expect(buildComposePrompt(notes, { previousWriteUp: '   ' })).not.toMatch(
      /WORDING REFERENCE/,
    );
  });

  it('caps an oversized previous write-up so it cannot blow out the prompt', () => {
    const essay = 'x'.repeat(MAX_PREVIOUS_WRITE_UP + 500);
    const prompt = buildComposePrompt(notes, { previousWriteUp: essay });
    const quoted = prompt.split('WORDING REFERENCE')[1];
    expect(quoted).toContain('x'.repeat(MAX_PREVIOUS_WRITE_UP));
    expect(quoted).not.toContain('x'.repeat(MAX_PREVIOUS_WRITE_UP + 1));
  });
});

describe('sanitizeComposed — confirmable additions', () => {
  const notes = {
    workCarriedOut: 'cleaned filters condenser coils checked electrical components',
  };

  it('returns well-formed additions with their target field', () => {
    const raw = JSON.stringify({
      workCarriedOut: 'Cleaned the air filters and condenser coils.',
      suggestedAdditions: [
        {
          text: 'The unit was tested after servicing and found to be operating normally.',
          field: 'workCarriedOut',
        },
        { text: 'Compressor is nearing end of life.', field: 'recommendedWork' },
      ],
    });
    const out = sanitizeComposed(raw, notes);
    expect(out.suggestedAdditions).toEqual([
      {
        text: 'The unit was tested after servicing and found to be operating normally.',
        field: 'workCarriedOut',
      },
      { text: 'Compressor is nearing end of life.', field: 'recommendedWork' },
    ]);
    // Critically: the unsupported claim is NOT in the prose.
    expect(out.workCarriedOut).not.toMatch(/operating normally/i);
  });

  it('defaults a bare string addition to work carried out', () => {
    const raw = JSON.stringify({
      workCarriedOut: 'Cleaned the coils.',
      suggestedAdditions: ['The unit was left running correctly.'],
    });
    const out = sanitizeComposed(raw, notes);
    expect(out.suggestedAdditions).toEqual([
      { text: 'The unit was left running correctly.', field: 'workCarriedOut' },
    ]);
  });

  it('falls back to work carried out when the field names a non-write-up slot', () => {
    const raw = JSON.stringify({
      workCarriedOut: 'Cleaned the coils.',
      suggestedAdditions: [{ text: 'Tested and normal.', field: 'riskAssessment' }],
    });
    const out = sanitizeComposed(raw, notes);
    expect(out.suggestedAdditions).toEqual([
      { text: 'Tested and normal.', field: 'workCarriedOut' },
    ]);
  });

  it('drops malformed entries: blanks, non-objects, missing text', () => {
    const raw = JSON.stringify({
      workCarriedOut: 'Cleaned the coils.',
      suggestedAdditions: [
        { text: '   ', field: 'workCarriedOut' },
        { field: 'workCarriedOut' },
        null,
        42,
        { text: 'Kept.', field: 'workCarriedOut' },
      ],
    });
    const out = sanitizeComposed(raw, notes);
    expect(out.suggestedAdditions).toEqual([{ text: 'Kept.', field: 'workCarriedOut' }]);
  });

  it(`dedupes and caps additions at ${MAX_ADDITIONS}`, () => {
    const raw = JSON.stringify({
      workCarriedOut: 'Cleaned the coils.',
      suggestedAdditions: [
        { text: 'Tested after servicing.', field: 'workCarriedOut' },
        { text: 'tested after servicing.', field: 'recommendedWork' }, // dupe
        { text: 'Claim two.', field: 'workCarriedOut' },
        { text: 'Claim three.', field: 'workCarriedOut' },
        { text: 'Claim four.', field: 'workCarriedOut' },
        { text: 'Claim five.', field: 'workCarriedOut' }, // over the cap
      ],
    });
    const out = sanitizeComposed(raw, notes);
    expect(out.suggestedAdditions).toHaveLength(MAX_ADDITIONS);
    expect(out.suggestedAdditions.map((a) => a.text)).not.toContain('Claim five.');
  });

  it('returns no additions when the key is absent or not an array', () => {
    expect(
      sanitizeComposed(JSON.stringify({ workCarriedOut: 'Cleaned.' }), notes)
        .suggestedAdditions,
    ).toEqual([]);
    expect(
      sanitizeComposed(
        JSON.stringify({ workCarriedOut: 'Cleaned.', suggestedAdditions: 'nope' }),
        notes,
      ).suggestedAdditions,
    ).toEqual([]);
  });

  it('offers no additions when the reply is unusable — notes are kept instead', () => {
    const out = sanitizeComposed('not json', notes);
    expect(out.workCarriedOut).toBe(notes.workCarriedOut);
    expect(out.suggestedAdditions).toEqual([]);
  });
});
