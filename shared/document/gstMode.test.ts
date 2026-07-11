import { resolveGstMode, keepSupplierPriceInclusive, NO_GST_NOTE } from './gstMode';

describe('resolveGstMode', () => {
  it('returns exclusive for a fresh/legacy doc with neither flag set', () => {
    // The single most important invariant: every document created before
    // gstRegistered existed must behave exactly as it did — registered,
    // exclusive pricing.
    expect(resolveGstMode({})).toBe('exclusive');
    expect(resolveGstMode({ pricesIncludeGst: false })).toBe('exclusive');
  });

  it('returns inclusive when registered with pricesIncludeGst=true', () => {
    expect(resolveGstMode({ pricesIncludeGst: true })).toBe('inclusive');
    expect(resolveGstMode({ gstRegistered: true, pricesIncludeGst: true })).toBe('inclusive');
  });

  it('returns none when gstRegistered=false, regardless of pricesIncludeGst', () => {
    expect(resolveGstMode({ gstRegistered: false })).toBe('none');
    expect(resolveGstMode({ gstRegistered: false, pricesIncludeGst: true })).toBe('none');
    expect(resolveGstMode({ gstRegistered: false, pricesIncludeGst: false })).toBe('none');
  });

  it('treats undefined gstRegistered as registered', () => {
    expect(resolveGstMode({ gstRegistered: undefined, pricesIncludeGst: true })).toBe('inclusive');
    expect(resolveGstMode({ gstRegistered: undefined })).toBe('exclusive');
  });
});

describe('keepSupplierPriceInclusive', () => {
  it('strips GST from supplier prices only in exclusive mode', () => {
    expect(keepSupplierPriceInclusive({})).toBe(false); // exclusive → divide by 1.1
    expect(keepSupplierPriceInclusive({ pricesIncludeGst: true })).toBe(true);
  });

  it('keeps full inc-GST supplier prices for a non-registered business', () => {
    // A non-registered tradie pays GST at the till and can't claim it back —
    // stripping 1/11 would under-price every material line.
    expect(keepSupplierPriceInclusive({ gstRegistered: false })).toBe(true);
    expect(keepSupplierPriceInclusive({ gstRegistered: false, pricesIncludeGst: false })).toBe(true);
  });
});

describe('NO_GST_NOTE', () => {
  it('is the customer-facing sentence used across PDF/email/web surfaces', () => {
    expect(NO_GST_NOTE).toBe('No GST has been charged.');
  });
});
