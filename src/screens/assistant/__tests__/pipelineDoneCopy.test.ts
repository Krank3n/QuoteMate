/**
 * Regression: Mate said the quote was done, out loud, when it wasn't.
 *
 * applyProposal returns `ok: true` when the pricing pipeline throws — on
 * purpose, so the tradie still gets their draft instead of an error. The voice
 * narration branched on `ok` alone, so Mate said "sweet, came together fine"
 * over a quote with no prices, while the working card underneath read
 * "Couldn't finish pricing that one." The card was right.
 *
 * Only voice hit this: [narrate] / [pipeline-done] need an open live session,
 * and the narrationModeRef gate suppresses transcripts for the whole window —
 * so the claim was spoken, never written, and left no trace in the chat log.
 */
import { describe, it, expect } from 'vitest';
import { buildPipelineDonePrompt } from '../pipelineDoneCopy';

/** Words that assert the work FINISHED. "draft" as a noun is not one. */
const DONE_WORDS = /\b(done|sorted|ready|finished|came together)\b/i;

/**
 * The part of the prompt that tells Mate what TO say, with the prohibition
 * clause stripped. Matching the whole instruction is a false positive trap:
 * "Do NOT say it's done, drafted, sorted…" necessarily contains every word
 * we're checking isn't there.
 */
const affirmative = (prompt: string): string =>
  prompt
    // The tag itself contains the word "done" — strip it, or every assertion
    // below matches on "[pipeline-done]" rather than on what Mate is told to say.
    .replace('[pipeline-done]', '')
    .split(/Do NOT|Never say/)[0];

describe('buildPipelineDonePrompt — pipeline finished cleanly', () => {
  const prompt = buildPipelineDonePrompt({ jobLabel: 'Raised deck', ok: true });

  it('lets Mate acknowledge a clean run', () => {
    expect(prompt).toContain('Pipeline finished');
    expect(prompt).toContain('Raised deck');
  });

  it('still forbids echoing the tag or reciting the materials list', () => {
    // Phrasing is deliberately terse — see NO_ECHO. What matters is that both
    // prohibitions survive: echoing the tag is the failure a tradie hears, and
    // reciting the list is what the inline card is for.
    expect(prompt).toMatch(/never say the tag/i);
    expect(prompt).toMatch(/no numbers/i);
  });

  it('folds a review heads-up into the same line', () => {
    const withReview = buildPipelineDonePrompt({
      jobLabel: 'Raised deck', ok: true,
      reviewNote: 'Heads up — 2 rows need a look. Work that into the line.',
    });
    expect(withReview).toContain('2 rows need a look');
  });

  it('folds the supplier-book gap note in too', () => {
    const withGap = buildPipelineDonePrompt({
      jobLabel: 'Raised deck', ok: true, gapNote: 'Their book covered none of it.',
    });
    expect(withGap).toContain('Their book covered none of it.');
  });
});

describe('buildPipelineDonePrompt — apply succeeded but pricing did not', () => {
  const prompt = buildPipelineDonePrompt({
    jobLabel: 'Raised deck', ok: true, pipelineDegraded: true,
  });

  it('never tells Mate the quote is done, sorted, ready or finished', () => {
    // THE regression. The affirmative half is what Mate is being told to say;
    // none of it may round the outcome up to success. "draft" as a noun is
    // fine — "the draft's there" is the honest description.
    const instruction = affirmative(prompt);
    expect(instruction.trim()).not.toBe('');
    expect(instruction).not.toMatch(/\b(done|sorted|ready|finished|came together)\b/i);
  });

  it('explicitly forbids the completion words', () => {
    expect(prompt).toMatch(/Do NOT say it's done, drafted, sorted, ready, or finished/);
  });

  it('says plainly that the quote has no prices on it', () => {
    expect(prompt).toMatch(/no prices/i);
    expect(prompt).toMatch(/did NOT finish/);
  });

  it('points the tradie at the one action that fixes it', () => {
    expect(prompt).toContain('Fetch Prices');
  });

  it('does not read as the clean-run prompt', () => {
    const clean = buildPipelineDonePrompt({ jobLabel: 'Raised deck', ok: true });
    expect(prompt).not.toBe(clean);
    expect(prompt).not.toContain('Pipeline finished');
  });

  it('still carries the review and gap notes when there are any', () => {
    const withBoth = buildPipelineDonePrompt({
      jobLabel: 'Raised deck', ok: true, pipelineDegraded: true,
      reviewNote: 'Heads up — 1 row needs a look.',
      gapNote: 'Their book covered none of it.',
    });
    expect(withBoth).toContain('1 row needs a look');
    expect(withBoth).toContain('Their book covered none of it.');
  });
});

describe('buildPipelineDonePrompt — apply failed outright', () => {
  const prompt = buildPipelineDonePrompt({
    jobLabel: 'Raised deck', ok: false, error: 'Quote not found.',
  });

  it('names the failure', () => {
    expect(prompt).toContain('Pipeline hit a snag');
    expect(prompt).toContain('Quote not found.');
  });

  it('never claims completion', () => {
    expect(affirmative(prompt)).not.toMatch(DONE_WORDS);
  });

  it('copes with a failure that carries no message', () => {
    const bare = buildPipelineDonePrompt({ jobLabel: 'X', ok: false });
    expect(bare).toContain('unknown error');
  });
});

describe('the three outcomes stay distinguishable', () => {
  it('produces a different instruction for each', () => {
    const clean = buildPipelineDonePrompt({ jobLabel: 'J', ok: true });
    const degraded = buildPipelineDonePrompt({ jobLabel: 'J', ok: true, pipelineDegraded: true });
    const failed = buildPipelineDonePrompt({ jobLabel: 'J', ok: false, error: 'nope' });
    expect(new Set([clean, degraded, failed]).size).toBe(3);
  });

  it('only the clean run is allowed to sound like success', () => {
    expect(affirmative(buildPipelineDonePrompt({ jobLabel: 'J', ok: true }))).toMatch(DONE_WORDS);
    expect(affirmative(buildPipelineDonePrompt({ jobLabel: 'J', ok: true, pipelineDegraded: true })))
      .not.toMatch(DONE_WORDS);
    expect(affirmative(buildPipelineDonePrompt({ jobLabel: 'J', ok: false, error: 'nope' })))
      .not.toMatch(DONE_WORDS);
  });
});
