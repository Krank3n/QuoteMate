/**
 * Regression: Mate told tradies the quote was ready to view while it was still
 * being priced — repeatedly, on stray turns, because they keep talking to it
 * for the whole 15-40 second run.
 *
 * The system prompt now says the quote isn't ready until "[pipeline-done]",
 * but every rule there had been scoped to a specific prompt tag, and the
 * offending turns are the ones in between. A prompt is only as good as the
 * model's obedience, so show_quote gets a fact behind it: refuse while pricing
 * is in flight, inside the turn, so the model corrects itself before speaking.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  markPricingStarted,
  markPricingFinished,
  isPricingInFlight,
  __resetPricingInFlight,
} from '../pricingInFlight';
import { gateShowQuote, setRenderableQuoteProbe } from '../showQuoteGate';

beforeEach(() => {
  __resetPricingInFlight();
  setRenderableQuoteProbe((id) => id);
});
afterEach(() => {
  __resetPricingInFlight();
  setRenderableQuoteProbe(null);
});

describe('pricingInFlight', () => {
  it('reports a quote as in flight only between start and finish', () => {
    expect(isPricingInFlight('q1')).toBe(false);
    markPricingStarted('q1');
    expect(isPricingInFlight('q1')).toBe(true);
    markPricingFinished('q1');
    expect(isPricingInFlight('q1')).toBe(false);
  });

  it('tracks quotes independently, so one pricing run does not block another quote', () => {
    markPricingStarted('q1');
    expect(isPricingInFlight('q2')).toBe(false);
  });

  it('ignores empty ids rather than flagging everything', () => {
    markPricingStarted('');
    expect(isPricingInFlight('')).toBe(false);
  });

  it('is idempotent on finish, so a double-clear cannot throw', () => {
    markPricingStarted('q1');
    markPricingFinished('q1');
    expect(() => markPricingFinished('q1')).not.toThrow();
    expect(isPricingInFlight('q1')).toBe(false);
  });
});

describe('gateShowQuote while pricing is running', () => {
  it('refuses to put a still-pricing quote on screen', () => {
    markPricingStarted('q1');
    const result = gateShowQuote('q1');
    expect(result.ok).toBe(false);
  });

  it('tells the model why, and what not to say', () => {
    markPricingStarted('q1');
    const result = gateShowQuote('q1');
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error).toMatch(/still going through pricing/i);
    expect(result.error).toMatch(/no prices on it yet/i);
    // The instruction that matters: not just "don't show it" but "don't SAY it".
    expect(result.error).toMatch(/don't tell the tradie it's ready/i);
  });

  it('allows the same quote the moment pricing finishes', () => {
    markPricingStarted('q1');
    expect(gateShowQuote('q1').ok).toBe(false);
    markPricingFinished('q1');
    expect(gateShowQuote('q1')).toEqual({ ok: true, quoteId: 'q1' });
  });

  it('still lets the tradie see a different, finished quote mid-run', () => {
    // They can absolutely ask "what was Katie's total again?" while this prices.
    markPricingStarted('q1');
    expect(gateShowQuote('q2')).toEqual({ ok: true, quoteId: 'q2' });
  });

  it('refuses on the pricing check before the renderable-id check', () => {
    // No probe registered at all — the in-flight refusal must still bite,
    // rather than falling through to the optimistic pass.
    setRenderableQuoteProbe(null);
    markPricingStarted('q1');
    expect(gateShowQuote('q1').ok).toBe(false);
  });

  it('leaves the unknown-id refusal intact for quotes that are not pricing', () => {
    setRenderableQuoteProbe(() => null);
    const result = gateShowQuote('nope');
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error).toMatch(/doesn't match a quote on this phone/i);
  });
});
