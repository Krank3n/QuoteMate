/**
 * One job, one quote. A smoke-alarm quote (3 Sep 2026) became three applied
 * drafts — re-drafted for "Red Dot brand, 2 hours" and again after the phone
 * digits — while the one propose_update_quote_scope card sat pending and
 * untapped. The validator refuses the repeat inside the turn.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProposal, findRepeatedDraft, jobNamesLookAlike, setAppliedDraftsProbe, setPendingScopeUpdateProbe } from '../proposalTools';
import { setRenderableQuoteProbe } from '../showQuoteGate';

const APPLIED = [
  { quoteId: 'q-smoke-1', jobName: 'Install fire detectors', customerName: 'Diane Bunk' },
  { quoteId: 'q-fence-1', jobName: 'Back fence', customerId: 'c-bob', customerName: 'Bob Smith' },
];

const draft = (over: Record<string, unknown> = {}) =>
  buildProposal('propose_draft_quote', 't', {
    jobName: 'Fire detectors - Red Dot',
    jobDescription: 'Supply and install 4 battery smoke detectors, 1 RF receiver and 2 hardwired alarms, Red Dot brand.',
    customerDraft: { name: 'Diane Bunk' },
    ...over,
  });

beforeEach(() => {
  setAppliedDraftsProbe(() => APPLIED);
  setRenderableQuoteProbe((id) => (APPLIED.some((a) => a.quoteId === id) ? id : null));
});
afterEach(() => {
  setAppliedDraftsProbe(null);
  setPendingScopeUpdateProbe(null);
  setRenderableQuoteProbe(null);
});

describe('findRepeatedDraft', () => {
  it('matches the same customer by name and a job name that shares its words — all three real re-drafts', () => {
    expect(findRepeatedDraft(APPLIED, { customerName: 'Diane Bunk', jobName: 'Fire detectors - Red Dot' })?.quoteId).toBe('q-smoke-1');
    expect(findRepeatedDraft(APPLIED, { customerName: 'diane  bunk', jobName: 'Smoke detector install' })?.quoteId).toBe('q-smoke-1');
    expect(findRepeatedDraft(APPLIED, { customerId: 'c-bob', jobName: 'Fence' })?.quoteId).toBe('q-fence-1');
  });

  it('a different job for the same customer is not a repeat — one shared generic word is not a match', () => {
    expect(findRepeatedDraft(APPLIED, { customerName: 'Diane Bunk', jobName: 'Pergola lights' })).toBeUndefined();
    const jane = [{ quoteId: 'q1', jobName: 'Smoke alarm install', customerName: 'Jane Cooper' }, { quoteId: 'q2', jobName: 'Bathroom retile', customerName: 'Jane Cooper' }];
    expect(findRepeatedDraft(jane, { customerName: 'Jane Cooper', jobName: 'Air con install' })).toBeUndefined();
    expect(findRepeatedDraft(jane, { customerName: 'Jane Cooper', jobName: 'Gutter clean at the rear' })).toBeUndefined();
    expect(findRepeatedDraft(jane, { customerName: 'Jane Cooper', jobName: 'Smoke alarms — Red Dot' })?.quoteId).toBe('q1');
  });

  it('matches the customer by id or by name, whichever both drafts carry', () => {
    const prior = [{ quoteId: 'q1', jobName: 'Smoke alarm install', customerId: 'c1', customerName: 'Jane Cooper' }];
    expect(findRepeatedDraft(prior, { customerName: 'Jane Cooper', jobName: 'Smoke alarm install' })?.quoteId).toBe('q1');
    expect(findRepeatedDraft(prior, { customerId: 'c1', jobName: 'Smoke alarm install' })?.quoteId).toBe('q1');
    expect(findRepeatedDraft(prior, { customerId: 'c2', jobName: 'Smoke alarm install' })).toBeUndefined();
  });

  it('jobNamesLookAlike needs half the shorter name\'s real words, stems and plurals included', () => {
    expect(jobNamesLookAlike('Install fire detectors', 'Fire detectors - Red Dot')).toBe(true);
    expect(jobNamesLookAlike('Install fire detectors', 'Smoke detector install')).toBe(true);
    expect(jobNamesLookAlike('Smoke alarm install', 'Air con install')).toBe(false);
    expect(jobNamesLookAlike('Bathroom retile', 'Gutter clean at the rear')).toBe(false);
    expect(jobNamesLookAlike('Install', 'Installation')).toBe(false);
  });

  it('a different customer is not a repeat', () => {
    expect(findRepeatedDraft(APPLIED, { customerName: 'Willem Duyenbank', jobName: 'Install fire detectors' })).toBeUndefined();
  });
});

describe('propose_draft_quote after a draft was applied', () => {
  it('refuses the repeat and names propose_update_quote_scope on the existing quote', () => {
    const { proposal, error } = draft();
    expect(proposal).toBeUndefined();
    expect(error).toContain('q-smoke-1');
    expect(error).toContain('propose_update_quote_scope');
    expect(error).toContain('different jobName');
  });

  it('points at the waiting "Update scope" card instead of drafting', () => {
    setPendingScopeUpdateProbe((id) => id === 'q-smoke-1');
    const { error } = draft();
    expect(error).toContain('still waiting');
    expect(error).toContain('apply_pending_proposal');
  });

  it('still drafts a genuinely different job, and drafts freely when nothing is applied', () => {
    expect(draft({ jobName: 'Pergola lights', jobDescription: 'Fit six LED strip lights under the pergola, on a new switch.' }).error).toBeUndefined();
    setAppliedDraftsProbe(null);
    expect(draft().error).toBeUndefined();
  });
});
