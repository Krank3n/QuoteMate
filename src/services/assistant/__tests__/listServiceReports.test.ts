// listServiceReports — the fix for Mate answering a service-report request
// with an invoice.
//
// Aug 2026 (Mate conversation 2026-08-03T22:37Z): a tradie asked five ways
// over eight turns to open the service report from a July job. Mate had no
// tool that could see reports, so it kept handing back that job's invoice and
// finally told them "I've only got the invoice on file for that July job" —
// while two reports (RP-001, RP-002) sat on the job. A confidently wrong
// answer, which is worse than admitting it can't find something.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getDocsMock = vi.fn();
const getDocMock = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: (...p: any[]) => ({ path: p.slice(1).join('/') }),
  doc: (...p: any[]) => ({ path: p.slice(1).join('/') }),
  getDoc: (...a: any[]) => getDocMock(...a),
  getDocs: (...a: any[]) => getDocsMock(...a),
  limit: (n: number) => ({ limit: n }),
  orderBy: (f: string, d?: string) => ({ orderBy: f, dir: d }),
  query: (ref: any, ...c: any[]) => ({ ref, constraints: c }),
  where: (f: string, op: string, v: any) => ({ where: f, op, v }),
  Timestamp: class {},
}));

vi.mock('../../../config/firebase', () => ({
  auth: { currentUser: { uid: 'uid-1' } },
  db: {},
}));

import { listServiceReports } from '../readTools';

const JOB_ID = 'job-wf-1';

function reportSnap(docs: any[]) {
  return { empty: docs.length === 0, docs };
}

function report(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    data: () => ({
      number: id === 'r1' ? 'RP-001' : 'RP-002',
      jobId: JOB_ID,
      serviceType: 'Rodent activity and general pest service',
      visitDate: Date.UTC(2026, 6, 14),
      status: 'draft',
      ...over,
    }),
  };
}

beforeEach(() => {
  getDocsMock.mockReset();
  getDocMock.mockReset();
  getDocMock.mockResolvedValue({
    exists: () => true,
    data: () => ({ name: 'Rodent activity and general pest service', customerName: 'WF Electrical Contractors' }),
  });
});

describe('listServiceReports', () => {
  it('returns reports with the job name and customer resolved', async () => {
    getDocsMock.mockResolvedValue(reportSnap([report('r1'), report('r2')]));

    const res: any = await listServiceReports({});

    expect(res.count).toBe(2);
    expect(res.reports[0]).toMatchObject({
      id: 'r1',
      number: 'RP-001',
      jobId: JOB_ID,
      jobName: 'Rodent activity and general pest service',
      customerName: 'WF Electrical Contractors',
      status: 'draft',
    });
    expect(res.reports[0].visitDate).toBe(new Date(Date.UTC(2026, 6, 14)).toISOString());
  });

  it('flags whether a report carries recommended work', async () => {
    getDocsMock.mockResolvedValue(
      reportSnap([report('r1', { recommendedWork: '  ' }), report('r2', { recommendedWork: 'Replace bait stations' })]),
    );

    const res: any = await listServiceReports({});

    expect(res.reports[0].hasRecommendedWork).toBe(false);
    expect(res.reports[1].hasRecommendedWork).toBe(true);
  });

  it('says plainly when there are no reports rather than returning nothing useful', async () => {
    getDocsMock.mockResolvedValue(reportSnap([]));

    const res: any = await listServiceReports({});

    expect(res.reports).toEqual([]);
    expect(res.note).toMatch(/No service reports/i);
  });

  it('fuzzy-matches a query against the customer name', async () => {
    getDocsMock.mockResolvedValue(reportSnap([report('r1'), report('r2')]));
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ name: 'Termite treatment', customerName: 'WF Electrical Contractors' }),
    });

    const res: any = await listServiceReports({ query: 'WF Electrical' });

    expect(res.count).toBe(2);
  });

  it('falls back to the recent list when the query matches nothing', async () => {
    // Better that Mate reads back candidates than tells the tradie their
    // report doesn't exist.
    getDocsMock.mockResolvedValue(reportSnap([report('r1')]));

    const res: any = await listServiceReports({ query: 'zzzz nonsense' });

    expect(res.count).toBe(1);
  });

  it('caps the row count', async () => {
    getDocsMock.mockResolvedValue(reportSnap(Array.from({ length: 30 }, (_, i) => report(`r${i}`))));

    const res: any = await listServiceReports({ limit: 99 });

    expect(res.reports).toHaveLength(25);
  });

  it('survives a reports read failure without throwing', async () => {
    getDocsMock.mockRejectedValue(new Error('permission denied'));

    const res: any = await listServiceReports({});

    expect(res.reports).toEqual([]);
  });

  it('still lists a report whose job has gone missing', async () => {
    getDocsMock.mockResolvedValue(reportSnap([report('r1')]));
    getDocMock.mockResolvedValue({ exists: () => false });

    const res: any = await listServiceReports({});

    expect(res.reports[0].number).toBe('RP-001');
    expect(res.reports[0].jobName).toBeUndefined();
  });
});
