/**
 * 25 Aug 2026 replay bug: Mate answered "Here it is — tap Preview PDF on the
 * card" and the very next bubble was the screen's "couldn't pull that one up"
 * apology. The dispatcher answered show_quote with { ok: true } before anyone
 * checked the id rendered, so the model could never learn the card failed
 * inside the turn. The gate makes that check part of the tool call.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { gateShowQuote, setRenderableQuoteProbe } from '../showQuoteGate';

afterEach(() => setRenderableQuoteProbe(null));

describe('gateShowQuote', () => {
  it('passes through optimistically when no probe is registered (screen unmounted)', () => {
    const res = gateShowQuote('doc-1');
    expect(res).toEqual({ ok: true, quoteId: 'doc-1' });
  });

  it('fails the tool call in-turn when the probe cannot render the id', () => {
    setRenderableQuoteProbe(() => null);
    const res = gateShowQuote('doc-that-is-not-on-this-phone');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      // The error must route the model to recovery, not a dead end.
      expect(res.error).toContain('list_recent_quotes');
      expect(res.error).not.toContain('undefined');
    }
  });

  it('carries the probe-resolved id into the view (legacy id → unified doc id)', () => {
    setRenderableQuoteProbe((id) => (id === 'legacy-9' ? 'doc-9' : null));
    const res = gateShowQuote('legacy-9');
    expect(res).toEqual({ ok: true, quoteId: 'doc-9' });
  });

  it('returns to optimistic pass-through once the probe is unregistered', () => {
    setRenderableQuoteProbe(() => null);
    expect(gateShowQuote('doc-1').ok).toBe(false);
    setRenderableQuoteProbe(null);
    expect(gateShowQuote('doc-1')).toEqual({ ok: true, quoteId: 'doc-1' });
  });
});
