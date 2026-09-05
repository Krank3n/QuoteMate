/**
 * The sent-quote dead end (4 Sep 2026).
 *
 * A tradie sent a quote, then asked for a change. Mate hit two refusals that
 * pointed at each other:
 *
 *   propose_update_quote_scope → "already gone to the customer ... draft a new
 *                                 one instead"
 *   propose_draft_quote        → "already exists for this customer ... use
 *                                 propose_update_quote_scope"
 *
 * Neither tool could run. The tradie gave up on chat and rebuilt the quote by
 * hand — "I tried five times". These tests pin the exit: the duplicate guard
 * stands aside precisely when the scope tool refuses, so the advice the store
 * gives is a route that actually opens.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProposal, findRepeatedDraft, setAppliedDraftsProbe, setPendingScopeUpdateProbe } from '../proposalTools';
import { canUpdateScope, scopeStatusOf } from '../scopeEditable';

const SENT = { quoteId: 'q-eaves-1', jobName: 'Eaves replacement', customerName: 'Dave Loew', status: 'sent' };
const STILL_DRAFT = { quoteId: 'q-eaves-2', jobName: 'Eaves replacement', customerName: 'Dave Loew', status: 'draft' };

const redraft = () =>
  buildProposal('propose_draft_quote', 't', {
    jobName: 'Eaves replacement',
    jobDescription: 'Replace damaged eave sections on double storey house. Two 3m sheets. Paint eaves white. No scaffolding — access off ladders.',
    customerDraft: { name: 'Dave Loew' },
  });

afterEach(() => {
  setAppliedDraftsProbe(null);
  setPendingScopeUpdateProbe(null);
});

describe('canUpdateScope', () => {
  it('allows a draft, and a record with no status yet', () => {
    expect(canUpdateScope('draft')).toBe(true);
    expect(canUpdateScope(undefined)).toBe(true);
    expect(canUpdateScope(null)).toBe(true);
    expect(canUpdateScope('')).toBe(true);
  });

  it('refuses anything the customer has already seen', () => {
    for (const status of ['sent', 'accepted', 'rejected', 'completed', 'cancelled', 'quote_sent', 'invoice_sent', 'paid']) {
      expect(canUpdateScope(status), status).toBe(false);
    }
  });
});

describe('scopeStatusOf', () => {
  it('reads a legacy quote status and a unified document stage', () => {
    expect(scopeStatusOf({ status: 'sent' })).toBe('sent');
    expect(scopeStatusOf({ stage: 'quote_sent' })).toBe('quote_sent');
  });

  it('prefers status when a record somehow carries both', () => {
    expect(scopeStatusOf({ status: 'draft', stage: 'quote_sent' })).toBe('draft');
  });

  it('is undefined for a partial or absent record, which leaves the doc editable', () => {
    expect(scopeStatusOf(undefined)).toBeUndefined();
    expect(scopeStatusOf(null)).toBeUndefined();
    expect(scopeStatusOf({})).toBeUndefined();
    expect(canUpdateScope(scopeStatusOf({}))).toBe(true);
  });
});

describe('findRepeatedDraft ignores documents that can no longer take a scope change', () => {
  it('still refuses a re-draft while the prior quote is a draft', () => {
    expect(findRepeatedDraft([STILL_DRAFT], { customerName: 'Dave Loew', jobName: 'Eaves replacement' })?.quoteId).toBe('q-eaves-2');
  });

  it('lets the re-draft through once the prior quote is sent', () => {
    expect(findRepeatedDraft([SENT], { customerName: 'Dave Loew', jobName: 'Eaves replacement' })).toBeUndefined();
  });

  it('still matches a different, editable quote for the same customer', () => {
    expect(findRepeatedDraft([SENT, STILL_DRAFT], { customerName: 'Dave Loew', jobName: 'Eaves replacement' })?.quoteId).toBe('q-eaves-2');
  });

  it('treats a missing status as a draft, so the old guard is unchanged', () => {
    const legacy = { quoteId: 'q-old', jobName: 'Eaves replacement', customerName: 'Dave Loew' };
    expect(findRepeatedDraft([legacy], { customerName: 'Dave Loew', jobName: 'Eaves replacement' })?.quoteId).toBe('q-old');
  });
});

describe('the tool call itself', () => {
  it('refuses the re-draft against a draft quote', () => {
    setAppliedDraftsProbe(() => [STILL_DRAFT]);
    const { proposal, error } = redraft();
    expect(proposal).toBeUndefined();
    expect(error).toContain('already exists');
  });

  it('builds the re-draft once the prior quote is sent — the way out of the loop', () => {
    setAppliedDraftsProbe(() => [SENT]);
    const { proposal, error } = redraft();
    expect(error).toBeUndefined();
    expect(proposal?.type).toBe('propose_draft_quote');
  });
});
