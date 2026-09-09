/**
 * Regression: the snag note named a button that wasn't on the screen.
 *
 * Every degraded apply said "tap Fetch Prices in the wizard". MaterialsList
 * only renders that button when the quote has rows on it — a pipeline that
 * dies in the ANALYSE phase leaves none. That is what a draft hit on
 * 7 Sep 2026: the analyse fetch lost its
 * response, the draft was parked with zero materials, and the tradie was told
 * to tap something that does not exist on an empty materials list. What IS
 * there is the empty state's hero card, "Build my list".
 */
import { describe, it, expect } from 'vitest';
import { pipelineSnagNote, snagStepLabel } from '../pipelineSnagCopy';
import { getMaterialsEmptyState } from '../../../screens/NewQuote/materialsEmptyState';

describe('snagStepLabel', () => {
  it('names Fetch Prices when there are rows to price', () => {
    expect(snagStepLabel(12)).toBe('Fetch Prices');
    expect(snagStepLabel(1)).toBe('Fetch Prices');
  });

  it('names Build my list when the analyse never landed', () => {
    expect(snagStepLabel(0)).toBe('Build my list');
  });

  it('keeps the priced wording when the caller cannot count the rows', () => {
    expect(snagStepLabel(undefined)).toBe('Fetch Prices');
  });

  it('matches the label the empty materials list actually renders', () => {
    // If someone re-words the hero CTA, this fails rather than quietly
    // sending tradies after a button that no longer exists.
    const empty = getMaterialsEmptyState({ hasJobNotes: true, isPro: true });
    expect(snagStepLabel(0)).toBe(empty.hero.ctaLabel);
    // A free-plan tradie sees the same label behind the paywall.
    expect(getMaterialsEmptyState({ hasJobNotes: true, isPro: false }).hero.ctaLabel).toBe(
      empty.hero.ctaLabel,
    );
  });
});

describe('pipelineSnagNote', () => {
  it('sends a tradie with no gear list to Build my list — THE regression', () => {
    const note = pipelineSnagNote({ stage: 'draft', materialCount: 0, error: 'Network request failed' });
    expect(note).toContain('Build my list');
    expect(note).not.toContain('Fetch Prices');
    expect(note).toContain("the gear list didn't get built");
    // The underlying failure still reaches the chat log verbatim.
    expect(note).toContain('(Network request failed)');
  });

  it('still sends a tradie with priced-less rows to Fetch Prices', () => {
    const note = pipelineSnagNote({ stage: 'draft', materialCount: 18, error: 'boom' });
    expect(note).toContain('Fetch Prices');
    expect(note).toContain('opened the draft');
    expect(note).not.toContain('Build my list');
  });

  it('says the scope landed even when the rebuild did not', () => {
    const withRows = pipelineSnagNote({ stage: 'scope', materialCount: 6, error: 'boom' });
    expect(withRows).toContain("the scope's updated but pricing didn't finish");
    expect(withRows).toContain('Fetch Prices');

    const without = pipelineSnagNote({ stage: 'scope', materialCount: 0, error: 'boom' });
    expect(without).toContain("the scope's updated but the gear list didn't get rebuilt");
    expect(without).toContain('Build my list');
  });

  it('never claims the run finished', () => {
    for (const stage of ['draft', 'scope'] as const) {
      for (const materialCount of [0, 5]) {
        const note = pipelineSnagNote({ stage, materialCount, error: 'boom' });
        expect(note).toMatch(/^Pipeline snag —/);
        expect(note).not.toMatch(/\b(done|sorted|ready|finished)\b/i);
      }
    }
  });
});
