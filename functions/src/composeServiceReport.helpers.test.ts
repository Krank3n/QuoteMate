import { describe, it, expect } from 'vitest';
import {
  buildComposePrompt,
  sanitizeComposed,
  ComposeNotes,
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
    expect(prompt).toMatch(/never add|do not add|only what is in the note|not already present/);
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

  it('only asks for the fields that were supplied', () => {
    const prompt = buildComposePrompt({ workCarriedOut: 'swapped the tap washer' });
    expect(prompt).toContain('"workCarriedOut"');
    expect(prompt).not.toContain('"natureOfProblem"');
    expect(prompt).not.toContain('"recommendedWork"');
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

  it('blanks a field whose source note was empty, even if the model returned prose', () => {
    const raw = JSON.stringify({
      natureOfProblem: 'Leaking mixer tap in the kitchen.',
      recommendedWork: 'You should really re-plumb the whole kitchen and add three new taps.',
    });
    const out = sanitizeComposed(raw, {
      natureOfProblem: 'leaking kitchen mixer',
      // workCarriedOut and recommendedWork were never entered by the tradie.
    });
    expect(out.natureOfProblem).toBe('Leaking mixer tap in the kitchen.');
    expect(out.workCarriedOut).toBe('');
    expect(out.recommendedWork).toBe('');
  });

  it('keeps the tradie note when the model drops a supplied field', () => {
    const raw = JSON.stringify({ natureOfProblem: 'Reported a blocked drain.' });
    const out = sanitizeComposed(raw, {
      natureOfProblem: 'blocked drain',
      workCarriedOut: 'cleared the blockage with the eel',
    });
    expect(out.natureOfProblem).toBe('Reported a blocked drain.');
    // Model omitted workCarriedOut — the tradie's own note is preserved.
    expect(out.workCarriedOut).toBe('cleared the blockage with the eel');
  });

  it('tolerates a code-fenced JSON reply', () => {
    const raw = '```json\n{"natureOfProblem":"Faulty powerpoint in the garage."}\n```';
    const out = sanitizeComposed(raw, { natureOfProblem: 'dead powerpoint garage' });
    expect(out.natureOfProblem).toBe('Faulty powerpoint in the garage.');
  });

  it('returns all-blank when source notes are empty and the reply is unusable', () => {
    const out = sanitizeComposed('not json at all', {});
    expect(out).toEqual({ natureOfProblem: '', workCarriedOut: '', recommendedWork: '' });
  });
});
