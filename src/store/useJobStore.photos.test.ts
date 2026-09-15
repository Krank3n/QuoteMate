/**
 * The job screen's photo strip writes `job.photos` through saveJob. Pin that
 * the store passes the array through to the service unchanged (optimistically
 * and on the wire) and never reaches into the document store.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job, JobPhoto } from '../../shared/job/types';

const service = vi.hoisted(() => ({
  saveJob: vi.fn(async () => {}),
}));

vi.mock('../services/jobService', () => ({
  jobService: {
    listenToJobs: vi.fn(),
    loadJobs: vi.fn(async () => []),
    saveJob: service.saveJob,
    deleteJob: vi.fn(async () => {}),
  },
}));

import { useJobStore } from './useJobStore';

const job: Job = {
  id: 'job-1',
  name: 'Fence',
  customerName: 'Someone',
  jobAddress: '1 Test St',
  stage: 'quoted',
  documentIds: ['doc-1'],
  createdAt: 100,
  updatedAt: 100,
} as unknown as Job;

const photos: JobPhoto[] = [
  { id: 'p1', storageUrl: 'https://storage.example/p1.jpg' },
  { id: 'p2', storageUrl: 'https://storage.example/p2.jpg', annotated: true },
];

beforeEach(() => {
  service.saveJob.mockClear();
  useJobStore.setState({ jobs: [job], jobsLoaded: true });
});

describe('useJobStore.saveJob with photos', () => {
  it('stores the new photos on the job optimistically and sends them to the service', async () => {
    await useJobStore.getState().saveJob({ ...job, photos });

    const stored = useJobStore.getState().jobs.find((j) => j.id === 'job-1');
    expect(stored?.photos).toEqual(photos);
    expect(stored?.documentIds).toEqual(['doc-1']);

    expect(service.saveJob).toHaveBeenCalledTimes(1);
    const sent = service.saveJob.mock.calls[0][0] as unknown as Job;
    expect(sent.photos).toEqual(photos);
    expect(sent.stage).toBe('quoted');
  });

  it('removing the last photo writes an empty array rather than dropping the field', async () => {
    useJobStore.setState({ jobs: [{ ...job, photos }] });

    await useJobStore.getState().saveJob({ ...job, photos: [] });

    const sent = service.saveJob.mock.calls[0][0] as unknown as Job;
    expect(sent.photos).toEqual([]);
    expect(useJobStore.getState().jobs[0].photos).toEqual([]);
  });
});
