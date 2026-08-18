/**
 * Jobs-list view preferences.
 *
 * The complaint: you work through the "Owed" pile, tap into a job to chase it,
 * come back — and you're on "All" again, at the top. The chip and the sort are
 * where you were up to, so they survive the round trip and the app restart.
 *
 * Stored locally rather than in Firestore, same reasoning as appearance: it's a
 * per-device view choice, not user data, and it must be readable before auth
 * resolves so the first paint isn't the wrong pile. Every read falls back to
 * the shipped defaults; a storage failure never blocks anything.
 *
 * Sort is remembered PER FILTER, not globally. One global sort puts the
 * freshest invoice on top of the Owed pile, which is the opposite of what that
 * pile is for; recomputing a default on every chip tap makes the sort button's
 * label change on its own, which reads as a bug. Per-pile memory with seeded
 * defaults is zero-config on first use and predictable after.
 *
 * The search query is deliberately NOT persisted — see useJobListPrefsStore.
 *
 * The decision logic here is pure and separate from the I/O (same split as
 * localDataReset) so it can be tested without mocking AsyncStorage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { isJobFilterKey, type JobFilterKey } from '../utils/jobBuckets';
import { isJobSortKey, type JobSortKey } from '../utils/jobSort';

const JOB_LIST_PREFS_KEY = '@quotemate:job_list_prefs';

export interface JobListPrefs {
  filter: JobFilterKey;
  /** Sort chosen per pile. Absent means "use the seeded default". */
  sortByFilter: Partial<Record<JobFilterKey, JobSortKey>>;
}

export const DEFAULT_JOB_LIST_PREFS: JobListPrefs = {
  filter: 'all',
  sortByFilter: {},
};

/**
 * The sort each pile opens on before the tradie expresses a preference.
 *
 * Owed defaults to most-overdue because the pile exists to chase money, and
 * Recent would bury the 60-day-old invoice under this morning's. Scheduled
 * defaults to soonest-start for the same reason: it's a diary, so date order
 * is the useful order. To book opens oldest-first on the same logic from the
 * other end: the job won three weeks ago and never put in the diary is the
 * one going cold, and Recent would hide it under today's.
 */
export function defaultSortForFilter(filter: JobFilterKey): JobSortKey {
  if (filter === 'owed') return 'overdue';
  if (filter === 'scheduled') return 'scheduled';
  if (filter === 'to_book') return 'oldest';
  return 'recent';
}

export function resolveSort(prefs: JobListPrefs, filter: JobFilterKey): JobSortKey {
  return prefs.sortByFilter[filter] ?? defaultSortForFilter(filter);
}

/**
 * Coerce whatever came back off disk into usable prefs.
 *
 * Rejects unknown ENUM VALUES, not just wrong types: a build before the filter
 * rebuild persisted keys like 'archived', and honouring one of those would
 * leave the tradie staring at a permanently empty list with no way to tell why.
 */
export function coerceJobListPrefs(raw: unknown): JobListPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return DEFAULT_JOB_LIST_PREFS;
  }

  const obj = raw as Record<string, unknown>;
  const filter = isJobFilterKey(obj.filter) ? obj.filter : DEFAULT_JOB_LIST_PREFS.filter;

  const sortByFilter: Partial<Record<JobFilterKey, JobSortKey>> = {};
  const rawSorts = obj.sortByFilter;
  if (rawSorts && typeof rawSorts === 'object' && !Array.isArray(rawSorts)) {
    for (const [key, value] of Object.entries(rawSorts as Record<string, unknown>)) {
      if (isJobFilterKey(key) && isJobSortKey(value)) sortByFilter[key] = value;
    }
  }

  return { filter, sortByFilter };
}

export async function getJobListPrefs(): Promise<JobListPrefs> {
  try {
    const stored = await AsyncStorage.getItem(JOB_LIST_PREFS_KEY);
    if (!stored) return DEFAULT_JOB_LIST_PREFS;
    return coerceJobListPrefs(JSON.parse(stored));
  } catch {
    // Unreadable or unparseable — open on the defaults rather than nothing.
    return DEFAULT_JOB_LIST_PREFS;
  }
}

export async function setJobListPrefs(prefs: JobListPrefs): Promise<void> {
  try {
    // Round-trip through coerce so a bad in-memory value can't be written to
    // disk and outlive the session that produced it.
    await AsyncStorage.setItem(JOB_LIST_PREFS_KEY, JSON.stringify(coerceJobListPrefs(prefs)));
  } catch {
    // Non-fatal: the choice applies for this session.
  }
}

/** Test-only helper. */
export async function clearJobListPrefs(): Promise<void> {
  try {
    await AsyncStorage.removeItem(JOB_LIST_PREFS_KEY);
  } catch {
    // ignore
  }
}
