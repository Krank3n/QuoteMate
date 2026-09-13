/**
 * Every job delete writes one `job_deleted` row naming the screen that did
 * it — the companion of quote_deleted, so a "my job vanished" report can be
 * answered from the events collection instead of trigger logs.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../services/analyticsService', () => ({ trackEvent: vi.fn() }));
vi.mock('../config/firebase', () => ({ auth: { currentUser: { uid: 'u1' } }, db: {} }));
vi.mock('../services/jobService', () => ({
  jobService: { deleteJob: vi.fn(async () => { throw new Error('offline'); }), saveJob: vi.fn(async () => {}) },
}));

import { useJobStore } from './useJobStore';
import { trackEvent } from '../services/analyticsService';
import { jobService } from '../services/jobService';
import type { Job } from '../../shared/job/types';

const tracked = vi.mocked(trackEvent);

beforeEach(() => {
  vi.clearAllMocks();
  useJobStore.setState({
    jobs: [
      { id: 'job-brian', createdAt: Date.now() - 5 * 3600e3, stage: 'inquiry', name: 'Forbes Ave', customerName: 'Brian', customerPhone: '0400', documentIds: [] } as unknown as Job,
    ],
  } as any);
});

describe('job_deleted', () => {
  it('the actions sheet delete writes one row naming the source and the job shape, before the cloud delete', async () => {
    const order: string[] = [];
    tracked.mockImplementation(() => { order.push('tracked'); });
    vi.mocked(jobService.deleteJob).mockImplementation(async () => { order.push('cloud'); });
    await useJobStore.getState().deleteJob('job-brian', 'job_actions_sheet');
    expect(tracked).toHaveBeenCalledTimes(1);
    expect(tracked.mock.calls[0][0]).toBe('job_deleted');
    expect(tracked.mock.calls[0][1]).toMatchObject({
      job_id: 'job-brian', source: 'job_actions_sheet', stage: 'inquiry', attached_doc_count: 0,
      has_name: true, has_customer_phone: true, has_customer_email: false, record_found: true,
    });
    expect(tracked.mock.calls[0][1]?.age_hours).toBeCloseTo(5, 0);
    expect(order).toEqual(['tracked', 'cloud']);
    expect(useJobStore.getState().jobs).toHaveLength(0);
  });

  it('a delete that fails in the cloud still leaves its row', async () => {
    vi.mocked(jobService.deleteJob).mockRejectedValueOnce(new Error('offline'));
    await expect(useJobStore.getState().deleteJob('job-brian', 'mate_cascade')).rejects.toThrow('offline');
    expect(tracked).toHaveBeenCalledWith('job_deleted', expect.objectContaining({ source: 'mate_cascade' }));
  });

  it('an unnamed caller and an unknown id still get a row', async () => {
    vi.mocked(jobService.deleteJob).mockResolvedValue(undefined as any);
    await useJobStore.getState().deleteJob('never-seen');
    expect(tracked).toHaveBeenCalledWith('job_deleted', expect.objectContaining({ job_id: 'never-seen', source: 'unknown', record_found: false }));
  });
});
