/**
 * Regression tests for jobs-listener echo suppression.
 *
 * Firestore snapshots echo our own writes (and the server aggregate-trigger
 * writes) with brand-new instances of every job. The listener used to
 * `set({ jobs })` unconditionally, replacing array and item identity on
 * every echo — re-rendering Dashboard/JobsList right as the user navigated
 * back ("flicker on return to dashboard").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from '../../shared/job/types';

const captured = vi.hoisted(() => ({
  cb: null as null | ((jobs: Job[]) => void),
}));

vi.mock('../services/jobService', () => ({
  jobService: {
    listenToJobs: vi.fn((cb: (jobs: Job[]) => void) => {
      captured.cb = cb;
    }),
    loadJobs: vi.fn(async () => []),
    saveJob: vi.fn(async () => {}),
    deleteJob: vi.fn(async () => {}),
  },
}));

import { useJobStore } from './useJobStore';

const makeJob = (id: string, updatedAt: number): Job =>
  ({
    id,
    name: `Job ${id}`,
    customerName: 'Someone',
    jobAddress: '1 Test St',
    stage: 'quoted',
    createdAt: updatedAt,
    updatedAt,
  } as unknown as Job);

function snapshot(jobs: Job[]) {
  captured.cb!(jobs);
}

describe('useJobStore.listenToJobs echo suppression', () => {
  beforeEach(() => {
    captured.cb = null;
    useJobStore.setState({ jobs: [], jobsLoaded: false });
    useJobStore.getState().listenToJobs();
    expect(captured.cb).toBeTruthy();
  });

  it('marks jobsLoaded on the first (even empty) snapshot', () => {
    snapshot([]);
    expect(useJobStore.getState().jobsLoaded).toBe(true);
  });

  it('ignores an identical echo snapshot: same array reference, no subscriber notification', () => {
    snapshot([makeJob('a', 100), makeJob('b', 200)]);
    const before = useJobStore.getState().jobs;

    const listener = vi.fn();
    const unsubscribe = useJobStore.subscribe(listener);

    // Fresh instances, identical ids + updatedAt — a listener echo.
    snapshot([makeJob('a', 100), makeJob('b', 200)]);

    expect(useJobStore.getState().jobs).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('applies a real change but keeps the instances of unchanged jobs', () => {
    snapshot([makeJob('a', 100), makeJob('b', 200)]);
    const before = useJobStore.getState().jobs;
    const unchangedInstance = before[0];

    const bUpdated = makeJob('b', 250);
    snapshot([makeJob('a', 100), bUpdated]);

    const after = useJobStore.getState().jobs;
    expect(after).not.toBe(before);
    expect(after[0]).toBe(unchangedInstance); // untouched job keeps identity
    expect(after[1]).toBe(bUpdated);
  });

  it('applies added and removed jobs', () => {
    snapshot([makeJob('a', 100)]);
    snapshot([makeJob('a', 100), makeJob('c', 300)]);
    expect(useJobStore.getState().jobs.map((j) => j.id)).toEqual(['a', 'c']);

    snapshot([makeJob('c', 300)]);
    expect(useJobStore.getState().jobs.map((j) => j.id)).toEqual(['c']);
  });
});
