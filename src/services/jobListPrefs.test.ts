/**
 * These guard two things that only bite in the field.
 *
 * One: a persisted value from an older build. The filter chips were rebuilt
 * (All/Active/Scheduled/Completed/Archived became the "what does this job need"
 * buckets), so a stored 'archived' is a real possibility on an upgrading
 * device — and honouring it would open the app on a permanently empty list
 * with nothing on screen to explain why.
 *
 * Two: the search query must never reach the disk. On next launch a stored
 * query would silently hide most of the list for a reason the tradie forgot
 * typing.
 */
import { describe, it, expect } from 'vitest';

import {
  DEFAULT_JOB_LIST_PREFS,
  coerceJobListPrefs,
  defaultSortForFilter,
  resolveSort,
} from './jobListPrefs';

describe('coerceJobListPrefs', () => {
  it('coerces a missing blob to the shipped defaults', () => {
    expect(coerceJobListPrefs(undefined)).toEqual(DEFAULT_JOB_LIST_PREFS);
    expect(coerceJobListPrefs(null)).toEqual(DEFAULT_JOB_LIST_PREFS);
  });

  it('coerces a corrupt blob to the defaults instead of throwing', () => {
    expect(coerceJobListPrefs('not an object')).toEqual(DEFAULT_JOB_LIST_PREFS);
    expect(coerceJobListPrefs([1, 2, 3])).toEqual(DEFAULT_JOB_LIST_PREFS);
    expect(coerceJobListPrefs(42)).toEqual(DEFAULT_JOB_LIST_PREFS);
  });

  it('drops an unknown filter key rather than leaving the user on a permanently empty list', () => {
    // 'archived' was a real chip before the filter rebuild.
    expect(coerceJobListPrefs({ filter: 'archived' }).filter).toBe('all');
  });

  it('drops an unknown sort key rather than sorting by nothing', () => {
    const prefs = coerceJobListPrefs({ filter: 'owed', sortByFilter: { owed: 'alphabetical' } });
    expect(prefs.sortByFilter.owed).toBeUndefined();
  });

  it('drops a sort stored against an unknown filter', () => {
    const prefs = coerceJobListPrefs({ sortByFilter: { archived: 'recent' } });
    expect(prefs.sortByFilter).toEqual({});
  });

  it('keeps a valid filter and its valid sort', () => {
    const prefs = coerceJobListPrefs({ filter: 'owed', sortByFilter: { owed: 'value' } });
    expect(prefs).toEqual({ filter: 'owed', sortByFilter: { owed: 'value' } });
  });

  it('keeps the good entries when only some are corrupt', () => {
    const prefs = coerceJobListPrefs({
      filter: 'waiting',
      sortByFilter: { waiting: 'oldest', owed: 'nonsense', archived: 'recent' },
    });
    expect(prefs).toEqual({ filter: 'waiting', sortByFilter: { waiting: 'oldest' } });
  });

  it('survives sortByFilter being the wrong shape entirely', () => {
    expect(coerceJobListPrefs({ filter: 'all', sortByFilter: 'nope' }).sortByFilter).toEqual({});
    expect(coerceJobListPrefs({ filter: 'all', sortByFilter: [] }).sortByFilter).toEqual({});
  });

  it('never persists the search query — there is no field for it to live in', () => {
    const prefs = coerceJobListPrefs({ filter: 'all', sortByFilter: {}, searchQuery: 'pergola' });
    expect(Object.keys(prefs).sort()).toEqual(['filter', 'sortByFilter']);
    expect(JSON.stringify(prefs)).not.toContain('pergola');
  });
});

describe('defaultSortForFilter', () => {
  it('defaults the Owed pile to most-overdue — the pile exists to chase money', () => {
    expect(defaultSortForFilter('owed')).toBe('overdue');
  });

  it('defaults the Scheduled pile to soonest start — it is a diary', () => {
    expect(defaultSortForFilter('scheduled')).toBe('scheduled');
  });

  // Same logic from the other end of the diary: the job won three weeks ago
  // and never booked is the one going cold, and Recent would hide it.
  it('defaults the To book pile to oldest first', () => {
    expect(defaultSortForFilter('to_book')).toBe('oldest');
  });

  it('defaults every other pile to Recent', () => {
    expect(defaultSortForFilter('all')).toBe('recent');
    expect(defaultSortForFilter('to_send')).toBe('recent');
    expect(defaultSortForFilter('waiting')).toBe('recent');
    expect(defaultSortForFilter('done')).toBe('recent');
  });
});

describe('resolveSort', () => {
  it('uses the seeded default when the tradie has never chosen for that pile', () => {
    expect(resolveSort(DEFAULT_JOB_LIST_PREFS, 'owed')).toBe('overdue');
  });

  it('remembers an explicit sort choice per filter', () => {
    const prefs = { filter: 'owed' as const, sortByFilter: { owed: 'recent' as const } };
    expect(resolveSort(prefs, 'owed')).toBe('recent');
  });

  it('keeps each pile’s choice independent — choosing on Owed does not move All', () => {
    const prefs = { filter: 'owed' as const, sortByFilter: { owed: 'value' as const } };
    expect(resolveSort(prefs, 'owed')).toBe('value');
    expect(resolveSort(prefs, 'all')).toBe('recent');
    expect(resolveSort(prefs, 'scheduled')).toBe('scheduled');
  });
});
