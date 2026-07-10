import { describe, it, expect } from 'vitest';
import { normaliseEmail, suppressionDocId } from './leadOutreach';

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
