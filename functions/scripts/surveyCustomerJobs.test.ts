/**
 * Tests for the bake-off corpus filters.
 *
 * The whole point of the corpus is that it contains REAL tradies' jobs and
 * nothing else. If an exclusion silently stops matching, the accuracy numbers
 * get quietly computed over the founder's own test quotes — which is exactly
 * the contamination the earlier replay audits had.
 */

import { describe, it, expect } from 'vitest';
import { isExcludedEmail, isRealScope, tradeBucket, bucketFromCategory } from './surveyCustomerJobs';

describe('isExcludedEmail', () => {
  it('excludes the founder and demo/seed accounts', () => {
    expect(isExcludedEmail('tom@hansendev.com.au')).toBe(true);
    expect(isExcludedEmail('thomas.andrew.hansen@gmail.com')).toBe(true);
    expect(isExcludedEmail('demo.screenshots@example.com')).toBe(true);
    expect(isExcludedEmail('test@foo.com')).toBe(true);
    expect(isExcludedEmail('someone+test@gmail.com')).toBe(true);
  });

  it('keeps real tradies, including ones whose name merely contains "test"', () => {
    expect(isExcludedEmail('dave@davesfencing.com.au')).toBe(false);
    expect(isExcludedEmail('info@protesting-electrical.com.au')).toBe(false);
    expect(isExcludedEmail(undefined)).toBe(false);
  });
});

describe('isRealScope', () => {
  const real =
    'Supply and install 30m of colorbond fence, 1800mm high, with two gates and posts concreted into 300mm footings.';

  it('accepts a real scope', () => {
    expect(isRealScope(real, 40)).toBe(true);
  });

  it('rejects self-tests and stubs', () => {
    expect(isRealScope('test', 40)).toBe(false);
    expect(isRealScope('asdf asdf asdf asdf asdf asdf asdf asdf asdf', 40)).toBe(false);
    expect(isRealScope('Fence', 40)).toBe(false);
    expect(isRealScope(undefined, 40)).toBe(false);
  });

  it('rejects a long string that is only a couple of distinct words', () => {
    // Real example shape: "Acre Acrylic rendering a Acrylic rendering 100 and Acrylic rendering"
    expect(isRealScope('rendering rendering rendering rendering rendering rendering rendering', 40)).toBe(false);
  });
});

describe('tradeBucket', () => {
  it('buckets common trades from the scope text', () => {
    expect(tradeBucket('Build a 15m x 6m merbau timber deck')).toBe('decking');
    expect(tradeBucket('Replace existing driveway slab, 66m2 reinforced concrete')).toBe('concreting');
    expect(tradeBucket('Supply and installation of timber fence panels')).toBe('fencing');
  });

  it('does not read "retaining the existing chassis" as landscaping', () => {
    // Regression: a switchboard upgrade was bucketed as landscaping because the
    // rule matched the verb "retaining", which put electrical jobs into the
    // wrong stratum and skewed the corpus balance.
    const scope = 'Upgrade existing 3-phase switchboard, retaining the existing chassis. Replace all circuit breakers with RCBOs.';
    expect(tradeBucket(scope)).toBe('electrical');
  });

  it('still buckets a genuine retaining wall as landscaping', () => {
    expect(tradeBucket('Build a 12m retaining wall with treated pine sleepers')).toBe('landscaping');
  });
});

describe('bucketFromCategory', () => {
  it('normalises declared trade categories onto the bucket vocabulary', () => {
    expect(bucketFromCategory('Electrician')).toBe('electrical');
    expect(bucketFromCategory('plumbing')).toBe('plumbing');
    expect(bucketFromCategory('Carpenter')).toBe('carpentry');
  });

  it('returns null for anything it does not recognise, so inference takes over', () => {
    expect(bucketFromCategory('all')).toBeNull();
    expect(bucketFromCategory(undefined)).toBeNull();
    expect(bucketFromCategory('')).toBeNull();
  });
});
