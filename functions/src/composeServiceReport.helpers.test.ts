import { describe, it, expect } from 'vitest';
import {
  buildComposePrompt,
  sanitizeComposed,
  ComposeNotes,
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
    expect(prompt).toMatch(/facts may move between fields, but nothing may be added/i);
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
    });
    const out = sanitizeComposed(raw, {});
    expect(out).toEqual({
      natureOfProblem: '',
      workCarriedOut: '',
      recommendedWork: '',
      suggestedEquipment: [],
      suggestedChecklist: [],
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
    });
  });
});
