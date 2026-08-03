import { describe, it, expect } from 'vitest';
import { normaliseEmail, suppressionDocId, buildDiscoveryQuery, isNonAustralianPlace, domainAcceptsMail, isPermanentDomainBounce, mapWithConcurrency, buildDiscoveryGrid, stripStateSuffix, stateFromSuburb, AU_REGIONS, AU_ALL_REGIONS, AU_STATES } from './leadOutreach';

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

/**
 * Regression tests for the Jul 2026 outreach bounce: kirsten@toposlandscape.com
 * passed the format check but the domain has no mail host, so Brevo bounced it
 * ("Unable to find MX of domain toposlandscape.com") — 1 bounce in an 8-send
 * week tripped the weekly report's >5% pause. domainAcceptsMail is the
 * pre-send DNS gate; isPermanentDomainBounce escalates the webhook event.
 */
describe('domainAcceptsMail', () => {
  const mx = (...exchanges: string[]) =>
    exchanges.map((exchange, i) => ({ exchange, priority: (i + 1) * 10 }));
  const noRecord = (code: string) => {
    const e: any = new Error(code);
    e.code = code;
    return e;
  };
  const resolver = (opts: {
    mx?: Array<{ exchange: string; priority: number }> | Error;
    a?: string[] | Error;
  }) => ({
    resolveMx: async () => {
      if (opts.mx instanceof Error) throw opts.mx;
      return opts.mx ?? [];
    },
    resolve4: async () => {
      if (opts.a instanceof Error) throw opts.a;
      return opts.a ?? [];
    },
  });

  it('accepts a domain with MX records', async () => {
    expect(await domainAcceptsMail('bigpond.com', resolver({ mx: mx('mx1.bigpond.com') }))).toBe(true);
  });

  it('rejects a domain with no DNS records at all (the toposlandscape.com case)', async () => {
    expect(await domainAcceptsMail('toposlandscape.com', resolver({
      mx: noRecord('ENOTFOUND'),
      a: noRecord('ENOTFOUND'),
    }))).toBe(false);
  });

  it('accepts a domain with no MX but an A record (RFC 5321 fallback)', async () => {
    expect(await domainAcceptsMail('example.com', resolver({
      mx: noRecord('ENODATA'),
      a: ['203.0.113.10'],
    }))).toBe(true);
  });

  it('rejects an RFC 7505 null-MX domain that explicitly refuses mail', async () => {
    expect(await domainAcceptsMail('nomail.example', resolver({
      mx: mx('.'),
      a: ['203.0.113.10'],
    }))).toBe(false);
  });

  it('rejects when MX list is empty and A lookup finds nothing', async () => {
    expect(await domainAcceptsMail('deadzone.example', resolver({ mx: [], a: noRecord('ENODATA') }))).toBe(false);
  });

  it('fails open (null) on transient DNS errors so the queue is not stalled', async () => {
    expect(await domainAcceptsMail('flaky.example', resolver({ mx: noRecord('ETIMEOUT') }))).toBeNull();
    expect(await domainAcceptsMail('flaky.example', resolver({
      mx: noRecord('ENODATA'),
      a: noRecord('ESERVFAIL'),
    }))).toBeNull();
  });
});

describe('isPermanentDomainBounce', () => {
  it('matches the exact Brevo reason from the Jul 2026 bounce', () => {
    expect(isPermanentDomainBounce('Unable to find MX of domain toposlandscape.com')).toBe(true);
  });

  it('matches other no-mail-host phrasings', () => {
    expect(isPermanentDomainBounce('No MX record found for domain')).toBe(true);
    expect(isPermanentDomainBounce('domain does not exist')).toBe(true);
  });

  it('leaves genuine soft bounces alone', () => {
    expect(isPermanentDomainBounce('Mailbox full')).toBe(false);
    expect(isPermanentDomainBounce('Greylisted, try again later')).toBe(false);
    expect(isPermanentDomainBounce(null)).toBe(false);
    expect(isPermanentDomainBounce(undefined)).toBe(false);
  });
});

/**
 * Regression tests for the Jul-Aug 2026 starved send queue: weeklyLeadDiscovery
 * ran discovery + enrichment + generation serially in one 540s function and
 * timed out on 5 consecutive runs, truncating the generation step that is the
 * ONLY writer of status:'queued'. Sends collapsed to ~9/week against 500/week
 * of capacity. mapWithConcurrency is what now keeps each stage inside its
 * budget: bounded parallelism, a deadline that stops cleanly instead of being
 * killed, and per-item isolation so one bad lead can't abort the batch.
 */
describe('mapWithConcurrency', () => {
  const far = () => Date.now() + 60_000;

  it('processes every item and preserves results', async () => {
    const { results, processed, hitDeadline } = await mapWithConcurrency(
      [1, 2, 3, 4, 5, 6, 7], 3, far(), async (n) => n * 2,
    );
    expect(results).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(processed).toBe(7);
    expect(hitDeadline).toBe(false);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency([...Array(12).keys()], 4, far(), async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
      return null;
    });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('stops starting work once the deadline passes and reports it', async () => {
    const seen: number[] = [];
    const { processed, hitDeadline } = await mapWithConcurrency(
      [...Array(20).keys()], 2, Date.now() + 30, async (n) => {
        seen.push(n);
        await new Promise(r => setTimeout(r, 20));
        return n;
      },
    );
    expect(hitDeadline).toBe(true);
    expect(processed).toBeLessThan(20);
    expect(seen.length).toBe(processed);
  });

  it('isolates a throwing item instead of aborting the batch', async () => {
    const { results, processed } = await mapWithConcurrency(
      [1, 2, 3, 4], 2, far(), async (n) => {
        if (n === 2) throw new Error('poison lead');
        return n;
      },
    );
    // The poison lead is counted as processed but contributes no result —
    // the other three still complete.
    expect(results).toEqual([1, 3, 4]);
    expect(processed).toBe(4);
  });

  it('handles an empty backlog without work', async () => {
    const { results, processed, hitDeadline } = await mapWithConcurrency([], 4, far(), async () => 1);
    expect(results).toEqual([]);
    expect(processed).toBe(0);
    expect(hitDeadline).toBe(false);
  });
});

/**
 * Discovery went national on 2026-08-03 (was 3 trades × 17 NSW suburbs, mining
 * out at 776 dedupes per 32 creates). These cover the pieces that make a
 * ~110-location grid behave: state-suffixed locations, a rotating cursor so
 * runs don't re-grind exhausted cells, and dedupe keys that stay compatible
 * with the NSW-era leads created before locations carried a state.
 */
describe('stripStateSuffix', () => {
  it('strips a trailing state code', () => {
    expect(stripStateSuffix('Sydney NSW')).toBe('Sydney');
    expect(stripStateSuffix('Gold Coast QLD')).toBe('Gold Coast');
    expect(stripStateSuffix('Alice Springs NT')).toBe('Alice Springs');
  });

  it('leaves bare names untouched so pre-2026-08 businessKeys still match', () => {
    expect(stripStateSuffix('Sydney')).toBe('Sydney');
    expect(stripStateSuffix('Central Coast')).toBe('Central Coast');
  });

  it('does not eat a state code that is part of the name', () => {
    expect(stripStateSuffix('NSW Central')).toBe('NSW Central');
    expect(stripStateSuffix('Waterloo')).toBe('Waterloo');
  });
});

describe('stateFromSuburb', () => {
  it('reads the state off a configured location', () => {
    expect(stateFromSuburb('Geelong VIC')).toBe('VIC');
    expect(stateFromSuburb('Perth WA')).toBe('WA');
  });

  it('returns null rather than defaulting to NSW', () => {
    // The old code hardcoded 'NSW', silently mislabelling every interstate lead.
    expect(stateFromSuburb('Sydney')).toBeNull();
    expect(stateFromSuburb('')).toBeNull();
    expect(stateFromSuburb(undefined)).toBeNull();
  });
});

describe('AU_REGIONS', () => {
  it('covers all 8 states and territories', () => {
    expect(Object.keys(AU_REGIONS).sort()).toEqual([...AU_STATES].sort());
    for (const s of AU_STATES) expect(AU_REGIONS[s].length).toBeGreaterThan(0);
  });

  it('suffixes every location with its own state', () => {
    for (const state of AU_STATES) {
      for (const loc of AU_REGIONS[state]) {
        expect(loc.endsWith(` ${state}`)).toBe(true);
      }
    }
  });

  it('has no duplicates', () => {
    expect(new Set(AU_ALL_REGIONS).size).toBe(AU_ALL_REGIONS.length);
  });
});

describe('buildDiscoveryGrid', () => {
  it('produces every trade × location pair', () => {
    const grid = buildDiscoveryGrid(['fencer', 'plumber'], ['Sydney NSW', 'Perth WA', 'Hobart TAS']);
    expect(grid.length).toBe(6);
    expect(new Set(grid.map(c => `${c.trade}|${c.suburb}`)).size).toBe(6);
  });

  it('varies location fastest so consecutive cells span the country', () => {
    const grid = buildDiscoveryGrid(['fencer'], ['Sydney NSW', 'Perth WA']);
    expect(grid[0].suburb).toBe('Sydney NSW');
    expect(grid[1].suburb).toBe('Perth WA');
  });

  it('is empty when either axis is empty', () => {
    expect(buildDiscoveryGrid([], ['Sydney NSW'])).toEqual([]);
    expect(buildDiscoveryGrid(['fencer'], [])).toEqual([]);
  });
});

describe('rotation cursor', () => {
  // Mirrors the offset arithmetic in dailyLeadDiscovery / runDiscoverySweep.
  const wrap = (offset: number, size: number) => ((offset % size) + size) % size;
  const nextOffset = (start: number, visited: number, size: number) =>
    size ? (start + visited) % size : 0;

  it('resumes where the previous run stopped', () => {
    expect(nextOffset(0, 12, 100)).toBe(12);
    expect(nextOffset(12, 9, 100)).toBe(21);
  });

  it('wraps past the end of the grid instead of stalling', () => {
    expect(nextOffset(95, 10, 100)).toBe(5);
  });

  it('survives a stored offset larger than a shrunken grid', () => {
    // Grid shrinks when trades/suburbs are edited; a stale cursor must not
    // index out of bounds.
    expect(wrap(450, 100)).toBe(50);
    expect(wrap(-1, 100)).toBe(99);
  });

  it('a full national grid takes many runs to sweep once', () => {
    const grid = buildDiscoveryGrid(
      ['fencer', 'landscaper', 'deck-builder', 'plumber', 'electrician'],
      AU_ALL_REGIONS,
    );
    expect(AU_ALL_REGIONS.length).toBe(90);
    expect(grid.length).toBe(450);
    // The cursor is what makes a grid this size usable: without it every run
    // restarts at cell 0 and the tail is never reached.
    expect(nextOffset(0, 449, grid.length)).toBe(449);
    expect(nextOffset(449, 1, grid.length)).toBe(0);
  });
});
