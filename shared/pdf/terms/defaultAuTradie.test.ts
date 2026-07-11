import { defaultAuTradieTerms, isUnmodifiedStarterTerms, hashTerms } from './defaultAuTradie';

describe('defaultAuTradieTerms', () => {
  it('picks the GST clause matching each mode', () => {
    expect(defaultAuTradieTerms('inclusive')).toContain('All prices include GST.');
    expect(defaultAuTradieTerms('exclusive')).toContain('10% GST will be added to the total.');
    expect(defaultAuTradieTerms('none')).toContain('GST is not applicable');
    expect(defaultAuTradieTerms('none')).not.toMatch(/10% GST|prices include GST/);
  });

  it('keeps legacy boolean callers working (true=inclusive, false=exclusive)', () => {
    expect(defaultAuTradieTerms(true)).toBe(defaultAuTradieTerms('inclusive'));
    expect(defaultAuTradieTerms(false)).toBe(defaultAuTradieTerms('exclusive'));
  });

  it('only differs between variants on the GST line', () => {
    const strip = (t: string) => t.split('\n').filter((l) => !/GST/i.test(l)).join('\n');
    expect(strip(defaultAuTradieTerms('none'))).toBe(strip(defaultAuTradieTerms('exclusive')));
    expect(strip(defaultAuTradieTerms('none'))).toBe(strip(defaultAuTradieTerms('inclusive')));
  });
});

describe('isUnmodifiedStarterTerms', () => {
  it('recognises all three starter variants so the GST-mode switch can auto-swap', () => {
    expect(isUnmodifiedStarterTerms(defaultAuTradieTerms('inclusive'))).toBe(true);
    expect(isUnmodifiedStarterTerms(defaultAuTradieTerms('exclusive'))).toBe(true);
    expect(isUnmodifiedStarterTerms(defaultAuTradieTerms('none'))).toBe(true);
  });

  it('rejects hand-edited terms', () => {
    expect(isUnmodifiedStarterTerms(defaultAuTradieTerms('none') + '\n- My extra clause.')).toBe(false);
    expect(isUnmodifiedStarterTerms('')).toBe(false);
    expect(isUnmodifiedStarterTerms(undefined)).toBe(false);
  });
});

describe('hashTerms', () => {
  it('gives each starter variant a distinct stable hash', () => {
    const hashes = ['inclusive', 'exclusive', 'none'].map((m) =>
      hashTerms(defaultAuTradieTerms(m as 'inclusive' | 'exclusive' | 'none')),
    );
    expect(new Set(hashes).size).toBe(3);
  });
});
