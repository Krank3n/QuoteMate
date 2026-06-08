import { isProposalId, rememberAppliedQuote, resolveQuoteId } from '../quoteRefMap';

describe('quoteRefMap', () => {
  it('detects proposal-shaped ids', () => {
    expect(isProposalId('prop_1780359310863-mnmdxaog')).toBe(true);
    expect(isProposalId('QU-0453')).toBe(false);
    expect(isProposalId('doc_abc123')).toBe(false);
    expect(isProposalId(undefined)).toBe(false);
    expect(isProposalId('')).toBe(false);
  });

  it('passes real quote ids through unchanged', () => {
    expect(resolveQuoteId('doc_abc123')).toBe('doc_abc123');
    expect(resolveQuoteId('QU-0453')).toBe('QU-0453');
  });

  it('translates a remembered proposal id to the minted quote id', () => {
    rememberAppliedQuote('prop_aaa-111', 'doc_real_1');
    expect(resolveQuoteId('prop_aaa-111')).toBe('doc_real_1');
  });

  it('returns the proposal id unchanged when nothing was remembered for it', () => {
    expect(resolveQuoteId('prop_never-applied')).toBe('prop_never-applied');
  });

  it('ignores registrations missing either id, or a non-proposal key', () => {
    rememberAppliedQuote('', 'doc_x');
    rememberAppliedQuote('prop_bbb', '');
    rememberAppliedQuote('QU-0001', 'doc_y'); // key isn't proposal-shaped
    expect(resolveQuoteId('prop_bbb')).toBe('prop_bbb');
    expect(resolveQuoteId('QU-0001')).toBe('QU-0001');
  });

  it('keeps the latest mapping when a proposal id is re-applied', () => {
    rememberAppliedQuote('prop_ccc', 'doc_old');
    rememberAppliedQuote('prop_ccc', 'doc_new');
    expect(resolveQuoteId('prop_ccc')).toBe('doc_new');
  });

  it('evicts the oldest entries past the cap but keeps recent ones', () => {
    for (let i = 0; i < 60; i++) rememberAppliedQuote(`prop_cap_${i}`, `doc_cap_${i}`);
    // First few should have been evicted; the most recent survive.
    expect(resolveQuoteId('prop_cap_0')).toBe('prop_cap_0');
    expect(resolveQuoteId('prop_cap_59')).toBe('doc_cap_59');
  });
});
