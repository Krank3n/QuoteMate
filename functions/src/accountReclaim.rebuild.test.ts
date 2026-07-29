import { describe, it, expect } from 'vitest';
import {
  assignUniqueQuoteDocIds,
  buildRecoveredQuoteDoc,
  buildRecoveredContactDoc,
  dedupeRecoveredQuotes,
  isNotificationDerivedTitle,
  isReclaimSweepActive,
  shouldInjectRecoveredDocs,
  INCIDENT_DATE,
  RECLAIM_SWEEP_EXPIRY,
  type RecoveredQuoteRecord,
} from './accountReclaim.rebuild';

const HAYDEN_REC = {
  quoteNumber: 'QU-177696',
  customerName: 'Tina Upton',
  customerEmail: 'tina@example.com',
  sentDate: '2026-04-23',
  jobTitle: 'Fencing, Garden Beds and Concrete Works',
  description: 'Supply and install of fencing plus garden beds.',
  materialsTotal: 2127.01,
  labourTotal: 6912.0,
  subtotal: 9039.01,
  gst: 903.9,
  total: 9942.91,
};

describe('buildRecoveredQuoteDoc', () => {
  it('builds a schema-complete quote with stored totals and recompute-safe lines', () => {
    const doc = buildRecoveredQuoteDoc(HAYDEN_REC, 3, 'admin@thieleconstructions.com.au')!;
    expect(doc).toMatchObject({
      id: 'recovered-QU-177696',
      quoteNumber: 'QU-177696',
      customerName: 'Tina Upton',
      customerEmail: 'tina@example.com',
      status: 'sent',
      subtotal: 9039.01,
      gst: 903.9,
      total: 9942.91,
      pricesIncludeGst: false,
      laborTotal: 0,
      markup: 0,
      restoredFromIncident: 'incident-2026-07',
    });
    const mats = doc.materials as Array<Record<string, unknown>>;
    expect(mats).toHaveLength(2);
    // dollar breakdown encoded as lines so a user edit's recompute
    // (Σ totalPrice + labour 0 + markup 0) reproduces the subtotal
    expect(mats.map(m => m.totalPrice)).toEqual([2127.01, 6912.0]);
    // priced + unlocked → the pricing pipeline gate always skips them
    expect(mats.every(m => m.manualPriceOverride === false && (m.price as number) > 0)).toBe(true);
    expect((doc.createdAt as Date).toISOString()).toBe('2026-04-23T00:00:00.000Z');
  });

  it('drops a self-addressed customer email (tradie sent the quote to themselves)', () => {
    const doc = buildRecoveredQuoteDoc(
      { ...HAYDEN_REC, customerEmail: 'Admin@ThieleConstructions.com.au' },
      0,
      'admin@thieleconstructions.com.au',
    )!;
    expect(doc.customerEmail).toBeUndefined();
  });

  it('handles total-only records as GST-inclusive single-line quotes', () => {
    const doc = buildRecoveredQuoteDoc(
      { customerName: 'George', sentDate: '2026-06-17', total: 1100 },
      7,
      't@t.co',
    )!;
    expect(doc.pricesIncludeGst).toBe(true);
    expect(doc.subtotal).toBe(1100);
    expect(doc.total).toBe(1100);
    expect(doc.gst).toBe(100); // extracted 1/11th
    const mats = doc.materials as Array<Record<string, unknown>>;
    expect(mats).toHaveLength(1);
    expect(mats[0].totalPrice).toBe(1100);
  });

  it('returns null for records without a usable total', () => {
    expect(buildRecoveredQuoteDoc({ customerName: 'X' }, 0, 't@t.co')).toBeNull();
    expect(buildRecoveredQuoteDoc({ total: 0 }, 0, 't@t.co')).toBeNull();
  });
});

// Every fixture below is a real shape observed in reclaimData/*.json — the
// parse turned each email a quote generated into its own record, all carrying
// the same total. 35 such duplicates were sitting across 20 payload files.
describe('dedupeRecoveredQuotes — notification-derived duplicates', () => {
  const titles = (rs: RecoveredQuoteRecord[]) => rs.map((r) => r.jobTitle);

  it('recognises lifecycle-notification subjects, not job titles', () => {
    for (const t of [
      'Quote #1776804712455-dkxvyi85g accepted by tom',
      'Quote #100001 declined by Helena ❤️',
      'Quote #270426 sent to Shane',
      'Reminder: your quote from Bribie Island Cabinetmakers for Kitchen Refurbishment ',
      'Following up on your quote from Bribie Island Cabinetmakers',
      '[TEST] Invoice from Hansen - Construction of 2m x 5m Deck',
    ]) {
      expect(isNotificationDerivedTitle(t), t).toBe(true);
    }
    for (const t of [
      'Deck Construction',
      'Kitchen Tap and Valve Replacement',
      '168 Church Road Moggill',
      'End of Lease Cleaning Service',
      'Custom Job',
      'Swing',
      'Yo',
      undefined,
    ]) {
      expect(isNotificationDerivedTitle(t), String(t)).toBe(false);
    }
  });

  it('collapses an "accepted by" notification into the real quote', () => {
    const out = dedupeRecoveredQuotes([
      { quoteNumber: 'QU-177680', sentDate: '2026-04-21', jobTitle: 'Deck Construction', total: 17034.14 },
      { quoteNumber: 'QU-177680', sentDate: '2026-04-21', jobTitle: 'Quote #1776804712455-dkxvyi85g accepted by tom', total: 17034.14 },
    ]);
    expect(titles(out)).toEqual(['Deck Construction']);
  });

  it('collapses a sent + declined + real triple down to the real quote', () => {
    const out = dedupeRecoveredQuotes([
      { sentDate: '2026-04-19', jobTitle: 'Kitchen Tap and Valve Replacement', total: 406.09 },
      { sentDate: '2026-04-19', jobTitle: 'Quote #100001 declined by Helena ❤️', total: 406.09 },
      { sentDate: '2026-04-19', jobTitle: 'Quote #1776580715487-o5ql1ifeh sent to Helena ', total: 406.09 },
    ]);
    expect(titles(out)).toEqual(['Kitchen Tap and Valve Replacement']);
  });

  it('collapses the reminder-1 / reminder-2 pair that produced the $88k double (dates differ by 4 days)', () => {
    // The bug in the wild: reminder 2's subject carries no job name and no
    // quote number, so it fell back to `idx${index}` and became a second doc.
    const out = dedupeRecoveredQuotes([
      {
        quoteNumber: 'QU-178156',
        sentDate: '2026-06-19',
        jobTitle: 'Reminder: your quote from Bribie Island Cabinetmakers for Top Doctors Bribie Isl',
        total: 88279.18,
      },
      {
        sentDate: '2026-06-23',
        jobTitle: 'Following up on your quote from Bribie Island Cabinetmakers',
        total: 88279.18,
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].quoteNumber).toBe('QU-178156');
    // earliest date across the group — the quote predates its own reminders
    expect(out[0].sentDate).toBe('2026-06-19');
  });

  it('prefers the real job title over an invoice-notification subject', () => {
    const out = dedupeRecoveredQuotes([
      { sentDate: '2026-04-25', jobTitle: '[TEST] Invoice from Hansen - Construction of 2m x 5m Deck', total: 2112 },
      { sentDate: '2026-04-25', jobTitle: 'Construction of 2m x 5m Deck', total: 2112 },
    ]);
    expect(titles(out)).toEqual(['Construction of 2m x 5m Deck']);
  });

  it('never takes a quote number from a notification row (they are positionally wrong)', () => {
    // Observed: the row titled "Quote #QU-177828 accepted by …" carried
    // quoteNumber QU-177805 — the parse numbered rows by position.
    const out = dedupeRecoveredQuotes([
      { quoteNumber: 'QU-177828', sentDate: '2026-05-09', jobTitle: 'Custom Job', total: 23555.44 },
      { quoteNumber: 'QU-177805', sentDate: '2026-05-09', jobTitle: 'Quote #QU-177828 accepted by Data Jaaaa', total: 23555.44 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].quoteNumber).toBe('QU-177828');
  });

  it('does NOT merge genuinely distinct quotes that share a total', () => {
    // A cleaner quoting $200 five times. One generated an acceptance email —
    // that must not swallow the other four.
    const records: RecoveredQuoteRecord[] = [
      { customerName: 'Ann', sentDate: '2026-04-20', jobTitle: 'Swing', total: 200 },
      { customerName: 'Bo', sentDate: '2026-04-21', jobTitle: 'Gate latch', total: 200 },
      { customerName: 'Cal', sentDate: '2026-04-22', jobTitle: 'Tap washer', total: 200 },
      { customerName: 'Di', sentDate: '2026-04-23', jobTitle: 'Downpipe', total: 200 },
      { customerName: 'Ed', sentDate: '2026-04-24', jobTitle: 'Fence panel', total: 200 },
      { sentDate: '2026-04-20', jobTitle: 'Quote #1776655342862-fnss45oj9 sent to Tom Han', total: 200 },
    ];
    const out = dedupeRecoveredQuotes(records);
    expect(titles(out)).toEqual(['Swing', 'Gate latch', 'Tap washer', 'Downpipe', 'Fence panel']);
    // ambiguous ownership → the survivors are returned untouched
    expect(out[0].sentDate).toBe('2026-04-20');
  });

  it('backfills only missing fields, and takes the money breakdown as one coherent set', () => {
    const out = dedupeRecoveredQuotes([
      { sentDate: '2026-05-01', jobTitle: 'Retaining wall', total: 5000 },
      {
        sentDate: '2026-05-04',
        jobTitle: 'Quote #QU-1 accepted by Sam',
        customerName: 'Sam',
        customerEmail: 'sam@example.com',
        description: 'Block retaining wall to rear boundary.',
        materialsTotal: 2000,
        labourTotal: 2545.45,
        subtotal: 4545.45,
        gst: 454.55,
        total: 5000,
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      jobTitle: 'Retaining wall',
      customerName: 'Sam',
      customerEmail: 'sam@example.com',
      description: 'Block retaining wall to rear boundary.',
      materialsTotal: 2000,
      labourTotal: 2545.45,
      sentDate: '2026-05-01',
    });
  });

  it('does not mix half a breakdown from one sibling with half from another', () => {
    const out = dedupeRecoveredQuotes([
      { sentDate: '2026-05-01', jobTitle: 'Deck', total: 1000 },
      { sentDate: '2026-05-02', jobTitle: 'Quote #QU-9 sent to A', materialsTotal: 400, total: 1000 },
      { sentDate: '2026-05-03', jobTitle: 'Quote #QU-9 accepted by A', materialsTotal: 600, labourTotal: 309.09, total: 1000 },
    ]);
    expect(out).toHaveLength(1);
    // the complete donor wins outright; the partial row contributes nothing
    expect(out[0].materialsTotal).toBe(600);
    expect(out[0].labourTotal).toBe(309.09);
  });

  it('passes through records with no usable total and preserves input order', () => {
    const out = dedupeRecoveredQuotes([
      { quoteNumber: 'QU-177801', jobTitle: '', total: 0 },
      { jobTitle: 'Real job A', total: 500 },
      { quoteNumber: 'QU-177806', jobTitle: '' },
      { jobTitle: 'Quote #QU-2 accepted by X', total: 500 },
      { jobTitle: 'Real job B', total: 900 },
    ]);
    expect(titles(out)).toEqual(['', 'Real job A', '', 'Real job B']);
  });

  it('is idempotent', () => {
    const records: RecoveredQuoteRecord[] = [
      { sentDate: '2026-06-19', jobTitle: 'Top Doctors fit out', total: 88279.18 },
      { sentDate: '2026-06-23', jobTitle: 'Following up on your quote from Bribie Island Cabinetmakers', total: 88279.18 },
      { sentDate: '2026-04-21', jobTitle: 'Deck Construction', total: 17034.14 },
    ];
    const once = dedupeRecoveredQuotes(records);
    expect(dedupeRecoveredQuotes(once)).toEqual(once);
  });

  it('leaves a clean payload completely untouched', () => {
    const records: RecoveredQuoteRecord[] = [
      { quoteNumber: 'QU-1', jobTitle: 'Fence', total: 100 },
      { quoteNumber: 'QU-2', jobTitle: 'Deck', total: 200 },
    ];
    expect(dedupeRecoveredQuotes(records)).toEqual(records);
  });

  it('end-to-end: the collapsed set builds distinct docs with no repeated total', () => {
    const payload: RecoveredQuoteRecord[] = [
      { quoteNumber: 'QU-178156', sentDate: '2026-06-19', jobTitle: 'Reminder: your quote from Bribie Island Cabinetmakers for Top Doctors Bribie Isl', total: 88279.18 },
      { sentDate: '2026-06-23', jobTitle: 'Following up on your quote from Bribie Island Cabinetmakers', total: 88279.18 },
      { sentDate: '2026-06-18', jobTitle: 'Reminder: your quote from Bribie Island Cabinetmakers for Kitchen Refurbishment ', total: 15648.6 },
      { sentDate: '2026-06-22', jobTitle: 'Following up on your quote from Bribie Island Cabinetmakers', total: 15648.6 },
      { quoteNumber: 'QU-178245', sentDate: '2026-06-29', jobTitle: 'Supply and Install New Wardrobe', total: 9940.01 },
    ];
    const docs = dedupeRecoveredQuotes(payload)
      .map((r, i) => buildRecoveredQuoteDoc(r, i, 'tradie@example.com'))
      .filter((d): d is Record<string, unknown> => d !== null);

    expect(docs).toHaveLength(3);
    expect(new Set(docs.map((d) => d.id)).size).toBe(3);
    expect(docs.map((d) => d.total).sort((a, b) => (a as number) - (b as number)))
      .toEqual([9940.01, 15648.6, 88279.18]);
    // the $88,279.18 quote appears exactly once — this is the regression
    expect(docs.filter((d) => d.total === 88279.18)).toHaveLength(1);
  });
});

describe('assignUniqueQuoteDocIds — collision = silent quote loss', () => {
  it('keeps the first occurrence stable and suffixes repeats', () => {
    // Real payloads repeat a quote number across records with different
    // totals; the sweep writes merge:false, so the second would overwrite
    // the first and the tradie would simply lose a quote.
    const docs = [
      { quoteNumber: 'QU-1', total: 100 },
      { quoteNumber: 'QU-1', total: 250 },
      { quoteNumber: 'QU-1', total: 900 },
      { quoteNumber: 'QU-2', total: 400 },
    ].map((r, i) => buildRecoveredQuoteDoc(r, i, 't@t.co')!);

    expect(docs.map((d) => d.id)).toEqual([
      'recovered-QU-1', 'recovered-QU-1', 'recovered-QU-1', 'recovered-QU-2',
    ]);

    const unique = assignUniqueQuoteDocIds(docs);
    expect(unique.map((d) => d.id)).toEqual([
      'recovered-QU-1', 'recovered-QU-1-2', 'recovered-QU-1-3', 'recovered-QU-2',
    ]);
    // every quote survives, with its own total
    expect(unique.map((d) => d.total)).toEqual([100, 250, 900, 400]);
    expect(new Set(unique.map((d) => d.id)).size).toBe(4);
  });

  it('renames the nested job id alongside the doc id', () => {
    const docs = [
      { quoteNumber: 'QU-7', total: 10 },
      { quoteNumber: 'QU-7', total: 20 },
    ].map((r, i) => buildRecoveredQuoteDoc(r, i, 't@t.co')!);
    const unique = assignUniqueQuoteDocIds(docs);
    expect((unique[1].job as Record<string, unknown>).id).toBe('recovered-QU-7-2-job');
  });

  it('leaves a collision-free set byte-identical', () => {
    const docs = [
      { quoteNumber: 'QU-1', total: 10 },
      { quoteNumber: 'QU-2', total: 20 },
    ].map((r, i) => buildRecoveredQuoteDoc(r, i, 't@t.co')!);
    expect(assignUniqueQuoteDocIds(docs)).toEqual(docs);
  });

  it('never collides with an existing suffixed id', () => {
    const docs = [
      { quoteNumber: 'QU-1', total: 10 },
      { quoteNumber: 'QU-1-2', total: 20 },
      { quoteNumber: 'QU-1', total: 30 },
    ].map((r, i) => buildRecoveredQuoteDoc(r, i, 't@t.co')!);
    const ids = assignUniqueQuoteDocIds(docs).map((d) => d.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual(['recovered-QU-1', 'recovered-QU-1-2', 'recovered-QU-1-3']);
  });
});

describe('buildRecoveredContactDoc', () => {
  it('builds a Contact-schema doc', () => {
    expect(
      buildRecoveredContactDoc({ name: 'Tina Upton', email: 'tina@example.com' }, 2, '2026-07-06T00:00:00.000Z'),
    ).toEqual({
      id: 'recovered-contact-2',
      name: 'Tina Upton',
      email: 'tina@example.com',
      source: 'quote',
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
    });
  });

  it('rejects blank names', () => {
    expect(buildRecoveredContactDoc({ name: ' ' }, 0, 'x')).toBeNull();
  });
});

describe('isReclaimSweepActive — self-retirement', () => {
  it('runs up to, but not including, the expiry instant', () => {
    const expiry = RECLAIM_SWEEP_EXPIRY.getTime();
    expect(isReclaimSweepActive(expiry - 1)).toBe(true);
    expect(isReclaimSweepActive(expiry)).toBe(false);
    expect(isReclaimSweepActive(expiry + 1)).toBe(false);
  });

  it('is active today and retires six months after the incident', () => {
    expect(isReclaimSweepActive(Date.parse('2026-07-29T00:00:00Z'))).toBe(true);
    expect(isReclaimSweepActive(Date.parse('2026-12-31T00:00:00Z'))).toBe(true);
    expect(isReclaimSweepActive(Date.parse('2027-02-01T00:00:00Z'))).toBe(false);
    expect(RECLAIM_SWEEP_EXPIRY.getTime()).toBeGreaterThan(INCIDENT_DATE.getTime());
  });

  it('accepts an injected expiry so the cutoff can be tested and shifted', () => {
    const early = new Date('2026-08-01T00:00:00Z');
    expect(isReclaimSweepActive(Date.parse('2026-07-31T00:00:00Z'), early)).toBe(true);
    expect(isReclaimSweepActive(Date.parse('2026-08-02T00:00:00Z'), early)).toBe(false);
  });
});

describe('shouldInjectRecoveredDocs — device-restore protection', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.parse('2026-07-08T00:00:00Z');

  it('injects for a mature claim with no history', () => {
    expect(shouldInjectRecoveredDocs({
      claimedAtMs: now - 2 * DAY, alreadyRestored: false, hasPreIncidentQuotes: false, nowMs: now,
    })).toBe(true);
  });

  it('waits out the 24h device-restore window', () => {
    expect(shouldInjectRecoveredDocs({
      claimedAtMs: now - DAY / 2, alreadyRestored: false, hasPreIncidentQuotes: false, nowMs: now,
    })).toBe(false);
  });

  it('never duplicates a device restore (pre-incident history present)', () => {
    expect(shouldInjectRecoveredDocs({
      claimedAtMs: now - 2 * DAY, alreadyRestored: false, hasPreIncidentQuotes: true, nowMs: now,
    })).toBe(false);
  });

  it('never runs twice and never without a claim', () => {
    expect(shouldInjectRecoveredDocs({
      claimedAtMs: now - 2 * DAY, alreadyRestored: true, hasPreIncidentQuotes: false, nowMs: now,
    })).toBe(false);
    expect(shouldInjectRecoveredDocs({
      claimedAtMs: null, alreadyRestored: false, hasPreIncidentQuotes: false, nowMs: now,
    })).toBe(false);
  });
});
