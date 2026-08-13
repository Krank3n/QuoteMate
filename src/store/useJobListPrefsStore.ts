/**
 * Where the Jobs list keeps its place.
 *
 * Lives in a store rather than in JobsListScreen's useState because the whole
 * point is surviving unmount: the screen is a tab, and tapping into a job
 * unmounts it. Component state would reset the pile you were working through,
 * which is the complaint this fixes.
 *
 * Deliberately NOT on useJobStore: that store owns Job entities and its
 * cleanup() resets on sign-out. A view preference shouldn't be wiped by signing
 * out any more than the theme should be.
 *
 * Two tiers on purpose:
 *
 *   filter + sortByFilter → disk (see jobListPrefs)
 *   searchQuery           → memory only
 *
 * A persisted search box is a trap. On next launch the list would show 3 of 44
 * jobs, and the reason would be a four-character string in a box the tradie has
 * long forgotten typing — a filter chip is visibly filled in, a search string
 * is quiet by comparison, and it's the narrower of the two. So the query
 * survives tapping into a job (same session) and dies on restart.
 */

import { create } from 'zustand';

import type { JobFilterKey } from '../utils/jobBuckets';
import type { JobSortKey } from '../utils/jobSort';
import {
  DEFAULT_JOB_LIST_PREFS,
  getJobListPrefs,
  resolveSort,
  setJobListPrefs,
  type JobListPrefs,
} from '../services/jobListPrefs';

interface JobListPrefsState {
  prefs: JobListPrefs;
  /** False until the first disk read lands, so the screen can avoid a flash. */
  hydrated: boolean;
  /** In-memory only — never serialised. */
  searchQuery: string;

  hydrate: () => Promise<void>;
  setFilter: (filter: JobFilterKey) => void;
  setSort: (filter: JobFilterKey, sort: JobSortKey) => void;
  setSearchQuery: (query: string) => void;
  /** The sort in force for a pile: the explicit choice, else the seeded default. */
  sortFor: (filter: JobFilterKey) => JobSortKey;
}

export const useJobListPrefsStore = create<JobListPrefsState>((set, get) => ({
  prefs: DEFAULT_JOB_LIST_PREFS,
  hydrated: false,
  searchQuery: '',

  hydrate: async () => {
    if (get().hydrated) return;
    const prefs = await getJobListPrefs();
    set({ prefs, hydrated: true });
  },

  setFilter: (filter) => {
    const prefs = { ...get().prefs, filter };
    set({ prefs });
    // Fire-and-forget: the choice is already applied in memory, and a failed
    // write only costs us the memory of it next launch.
    void setJobListPrefs(prefs);
  },

  setSort: (filter, sort) => {
    const current = get().prefs;
    const prefs: JobListPrefs = {
      ...current,
      sortByFilter: { ...current.sortByFilter, [filter]: sort },
    };
    set({ prefs });
    void setJobListPrefs(prefs);
  },

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  sortFor: (filter) => resolveSort(get().prefs, filter),
}));
