/**
 * Job writes are merges, so the server's aggregate fields survive a client
 * save. The cost of a merge is that a key you leave out means "don't
 * touch" — and the payload builder used to leave every cleared field out.
 * "Clear date" and unarchive both went out as no-ops: the field stayed on
 * the stored job, the listener echoed it back, and the calendar event
 * survived (the sync trigger only deletes when the date reaches zero).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted so the module factory below can reach them.
const { DELETE, setDoc } = vi.hoisted(() => ({
  DELETE: { __sentinel: 'deleteField' },
  setDoc: vi.fn(async () => {}),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join('/') })),
  setDoc,
  getDocs: vi.fn(),
  deleteDoc: vi.fn(),
  deleteField: () => DELETE,
  onSnapshot: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
}));

import { jobService } from './jobService';

function job(over: Record<string, unknown> = {}): any {
  return {
    id: 'job-1',
    stage: 'scheduled',
    name: 'Deck rebuild',
    scheduledStartDate: 1_756_684_800_000,
    documentIds: [],
    totalPaid: 400,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

/** The payload from the one setDoc call this test made. */
function payload(): Record<string, any> {
  expect(setDoc).toHaveBeenCalledTimes(1);
  return setDoc.mock.calls[0][1] as Record<string, any>;
}

beforeEach(() => {
  setDoc.mockClear();
});

describe('jobService.saveJob', () => {
  it('deletes a date the tradie cleared instead of silently keeping it', async () => {
    await jobService.saveJob(job({ scheduledStartDate: undefined }));
    expect(payload().scheduledStartDate).toBe(DELETE);
  });

  it('deletes archivedAt on unarchive', async () => {
    await jobService.saveJob(job({ archivedAt: undefined }));
    expect(payload().archivedAt).toBe(DELETE);
  });

  it('still merges, so the aggregates the server owns survive the write', async () => {
    await jobService.saveJob(job());
    expect(setDoc.mock.calls[0][2]).toEqual({ merge: true });
  });

  it('writes the fields that do have values untouched', async () => {
    await jobService.saveJob(job());
    const written = payload();
    expect(written.scheduledStartDate).toBe(1_756_684_800_000);
    expect(written.stage).toBe('scheduled');
    expect(written.totalPaid).toBe(400);
  });

  it('sends no sentinel for a field the job never carried', async () => {
    // A delete for every absent optional field would be noise on the wire
    // and a foot-gun the day one of them starts being server-owned.
    await jobService.saveJob(job());
    expect('archivedAt' in payload()).toBe(false);
  });

  it('drops a nested undefined rather than deleting it', async () => {
    // deleteField() is only legal at the top level of a merge write — a
    // sentinel inside the checklist array would throw at the SDK.
    await jobService.saveJob(
      job({ checklist: [{ id: 'c1', text: 'Tidy up', completedAt: undefined }] }),
    );
    expect(payload().checklist).toEqual([{ id: 'c1', text: 'Tidy up' }]);
  });
});
