/**
 * The three corrections that were lost on 3 Sep 2026 — said while the
 * smoke-alarm quote was pricing, answered by the canned "Here's the draft".
 */
import { describe, it, expect } from 'vitest';
import { correctionsClause, createPricingCorrections } from './pricingCorrections';

const LOST = ['using red dot brand', 'Change those numbers.', "Also those detectors are pre-existing. I'm just replacing existing hardwire."];

describe('createPricingCorrections', () => {
  it('keeps what the tradie says between start and drain, and hands it over once', () => {
    const c = createPricingCorrections();
    c.note('ignored — nothing is pricing yet');
    c.start();
    for (const line of LOST) c.note(line);
    expect(c.isActive()).toBe(true);
    expect(c.drain()).toEqual(LOST);
    expect(c.isActive()).toBe(false);
    expect(c.drain()).toEqual([]);
  });

  it('never keeps prompt framing, blanks, or more than a handful of lines', () => {
    const c = createPricingCorrections();
    c.start();
    c.note('[narrate] one short line');
    c.note('   ');
    for (let i = 0; i < 10; i++) c.note(`line ${i}`);
    const kept = c.drain();
    expect(kept).toHaveLength(6);
    expect(kept[0]).toBe('line 0');
  });

  it('a new run forgets the last run', () => {
    const c = createPricingCorrections();
    c.start();
    c.note('first run');
    c.start();
    c.note('second run');
    expect(c.drain()).toEqual(['second run']);
  });
});

describe('correctionsClause', () => {
  it('quotes the lines and points at propose_update_quote_scope on the quote', () => {
    const clause = correctionsClause(LOST, 'q-smoke-1');
    for (const line of LOST) expect(clause).toContain(`"${line}"`);
    expect(clause).toContain('propose_update_quote_scope on q-smoke-1');
    expect(clause).toContain('Never draft a new quote for them.');
  });

  it('is empty when there is nothing to act on', () => {
    expect(correctionsClause([], 'q1')).toBe('');
  });
});
