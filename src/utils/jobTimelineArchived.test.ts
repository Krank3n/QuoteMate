/**
 * The "Archived" row on a job's activity log.
 *
 * Three affordances archive a job and they write different fields:
 *
 *   kebab "Archive"        -> archivedAt only, stage untouched
 *   stage sheet "Archive"  -> stage 'closed' (server stamps closedAt)
 *   closeJob CTA           -> stage 'closed' + archivedAt
 *
 * The timeline read `closedAt` alone, so a job archived from the kebab showed
 * nothing whatsoever in its history — while bucketFor() checks `archivedAt`
 * ahead of stage, so it had already dropped into the Done pile still wearing
 * its old stage pill. Archived, invisibly.
 */
import { describe, it, expect } from 'vitest';

import { deriveTimelineEvents } from './jobTimeline';

function job(over: Record<string, any> = {}): any {
  return {
    id: 'job1',
    name: 'A job',
    stage: 'accepted',
    createdAt: 1_000,
    documentIds: [],
    ...over,
  };
}

const archivedRows = (j: any) =>
  deriveTimelineEvents(j, [], 9_000_000).filter((e) => e.title === 'Archived');

describe('deriveTimelineEvents — the Archived row', () => {
  it('shows the archive when only archivedAt is set (the kebab path)', () => {
    const rows = archivedRows(job({ archivedAt: 5_000 }));
    expect(rows).toHaveLength(1);
    expect(rows[0].at).toBe(5_000);
  });

  it('still shows it when only closedAt is set (the stage-sheet path)', () => {
    const rows = archivedRows(job({ closedAt: 5_000 }));
    expect(rows).toHaveLength(1);
    expect(rows[0].at).toBe(5_000);
  });

  it('shows exactly one row, at the earlier stamp, when both are set', () => {
    const rows = archivedRows(job({ closedAt: 7_000, archivedAt: 5_000 }));
    expect(rows).toHaveLength(1);
    expect(rows[0].at).toBe(5_000);
  });

  it('shows nothing on a job that was never archived', () => {
    expect(archivedRows(job())).toHaveLength(0);
  });
});
