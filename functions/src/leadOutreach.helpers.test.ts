import { describe, it, expect } from 'vitest';
import { normaliseEmail, suppressionDocId, buildDiscoveryQuery, isNonAustralianPlace } from './leadOutreach';

/**
 * Regression tests for the Jun-Jul 2026 poisoned send queue: a scraped
 * protocol-relative email ("//kirsten@example.com") passed normaliseEmail,
 * then isSuppressed built doc(`leadSuppression/email://kirsten@…`) — an
 * invalid path ("//") that threw on every autoSendQueuedLeads run and,
 * because the scan is oldest-first with no per-lead error handling,
 * blocked every queued lead behind it for 11 days.
 */
describe('normaliseEmail', () => {
  it('rejects protocol-relative scraper junk', () => {
    expect(normaliseEmail('//kirsten@toposlandscape.com')).toBeNull();
  });

  it('rejects any address containing a slash', () => {
    expect(normaliseEmail('info/sales@example.com')).toBeNull();
    expect(normaliseEmail('kirsten@example.com/contact')).toBeNull();
  });

  it('accepts and lowercases a normal address', () => {
    expect(normaliseEmail('  Kirsten@ToposLandscape.com ')).toBe('kirsten@toposlandscape.com');
  });

  it('rejects empties and non-addresses', () => {
    expect(normaliseEmail(undefined)).toBeNull();
    expect(normaliseEmail('')).toBeNull();
    expect(normaliseEmail('not-an-email')).toBeNull();
    expect(normaliseEmail('two words@example.com')).toBeNull();
  });
});

describe('suppressionDocId', () => {
  it('leaves slash-free IDs unchanged (existing docs stay addressable)', () => {
    expect(suppressionDocId('email', 'foo@bar.com')).toBe('email:foo@bar.com');
    expect(suppressionDocId('domain', 'bar.com')).toBe('domain:bar.com');
    expect(suppressionDocId('placeId', 'ChIJixalEZGtEmsRLHkrqATKF8o')).toBe(
      'placeId:ChIJixalEZGtEmsRLHkrqATKF8o',
    );
  });

  it('encodes slashes so the ID is always one valid path segment', () => {
    const id = suppressionDocId('placeId', 'AbC//dEf/g');
    expect(id).toBe('placeId:AbC%2F%2FdEf%2Fg');
    expect(id.includes('/')).toBe(false);
  });
});

/**
 * Regression tests for the Jul 2026 UK-leads incident: discovery for suburb
 * "Liverpool" returned Liverpool UK businesses (Mersey Fencing Ltd, Liverpool
 * One Fencing, …) because the Places query never named the country and
 * `region=au` is only a ranking bias, not a restriction.
 */
describe('buildDiscoveryQuery', () => {
  it('appends Australia to disambiguate suburb names shared with the UK', () => {
    expect(buildDiscoveryQuery('fencing contractor', 'Liverpool')).toBe(
      'fencing contractor Liverpool, Australia',
    );
    expect(buildDiscoveryQuery('roofer', 'Newcastle')).toBe('roofer Newcastle, Australia');
  });

  it('does not double-append when the suburb already names the country', () => {
    expect(buildDiscoveryQuery('plumber', 'Liverpool NSW Australia')).toBe(
      'plumber Liverpool NSW Australia',
    );
    expect(buildDiscoveryQuery('plumber', 'liverpool australia')).toBe('plumber liverpool australia');
  });

  it('trims whitespace from custom suburb input', () => {
    expect(buildDiscoveryQuery('painter', '  Byron Bay ')).toBe('painter Byron Bay, Australia');
  });
});

describe('isNonAustralianPlace', () => {
  const comp = (shortName: string, longName: string) => ({
    long_name: longName,
    short_name: shortName,
    types: ['country', 'political'],
  });

  it('rejects a UK business that slipped past the query bias', () => {
    expect(isNonAustralianPlace([comp('GB', 'United Kingdom')])).toBe(true);
  });

  it('keeps Australian businesses', () => {
    expect(isNonAustralianPlace([comp('AU', 'Australia')])).toBe(false);
  });

  it('fails open when the country component is missing or components are absent', () => {
    expect(isNonAustralianPlace([{ long_name: 'NSW', short_name: 'NSW', types: ['administrative_area_level_1'] }])).toBe(false);
    expect(isNonAustralianPlace([])).toBe(false);
    expect(isNonAustralianPlace(undefined)).toBe(false);
  });
});
