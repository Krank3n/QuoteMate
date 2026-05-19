/**
 * useMaterialSearch
 *
 * React wrapper around `runMaterialSearch`. Owns the query string, debounce
 * timer, and request-id cancellation so stale results never overwrite fresh
 * ones. Used by both the existing AddMaterialScreen search tab (debounce = 0,
 * `runSearch()` triggered by the Search button) and the new inline quick-add
 * row on MaterialsListScreen (debounce ~300ms, auto-fires on typing).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { runMaterialSearch, type MaterialSearchMode } from '../services/materialSearch';
import type { SupplierGroup, BusinessSettings } from '../types';

export interface UseMaterialSearchOptions {
  /** When false, `runSearch` and the debounced auto-fire both bail without
   *  calling the orchestrator. Lets the caller gate by Pro / paywall state. */
  enabled: boolean;
  businessSettings?: BusinessSettings | null;
  supplierGroups: SupplierGroup[];
  selectedSupplierGroupId?: string;
  reeceConnected: boolean;
  onReeceReauthRequired?: () => void;
  /** Debounce window for auto-firing on `setQuery`. Pass 0 to disable
   *  auto-fire (caller drives via `runSearch`). Default 300ms. */
  debounceMs?: number;
  /** Mode used for the debounced auto-fire path. Defaults to 'light' so
   *  typing only hits local sources + Reece (cheap). Manual triggers via
   *  `runSearch` use 'full' by default to include Bunnings/web/AI. */
  autoMode?: MaterialSearchMode;
}

export interface UseMaterialSearchResult {
  query: string;
  setQuery: (q: string) => void;
  results: any[];
  isSearching: boolean;
  hasSearched: boolean;
  error?: string;
  /** Fire a search immediately, optionally with a query override and mode
   *  (defaults to 'full' — Bunnings + web + AI). */
  runSearch: (queryOverride?: string, mode?: MaterialSearchMode) => Promise<void>;
  /** Cancel any in-flight search and reset results. */
  cancel: () => void;
  clearResults: () => void;
}

export function useMaterialSearch(opts: UseMaterialSearchOptions): UseMaterialSearchResult {
  const debounceMs = opts.debounceMs ?? 300;

  const [query, setQueryState] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // Latest options ref so the debounced/auto-fire path always sees the most
  // recent supplier/business config without retriggering on every render.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Monotonic request id; results from anything other than the latest id are
  // discarded so stale searches can't overwrite fresh ones.
  const requestIdRef = useRef(0);
  const debounceHandleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDebounce = () => {
    if (debounceHandleRef.current) {
      clearTimeout(debounceHandleRef.current);
      debounceHandleRef.current = null;
    }
  };

  const runSearch = useCallback(async (queryOverride?: string, mode: MaterialSearchMode = 'full') => {
    const o = optsRef.current;
    const q = (queryOverride ?? query).trim();
    if (!o.enabled || !q) {
      setResults([]);
      setHasSearched(false);
      setError(undefined);
      return;
    }
    const myId = ++requestIdRef.current;
    setIsSearching(true);
    setError(undefined);
    const outcome = await runMaterialSearch(q, {
      mode,
      businessSettings: o.businessSettings,
      supplierGroups: o.supplierGroups,
      selectedSupplierGroupId: o.selectedSupplierGroupId,
      reeceConnected: o.reeceConnected,
      onReeceReauthRequired: o.onReeceReauthRequired,
    });
    if (myId !== requestIdRef.current) return; // stale
    setResults(outcome.results);
    setError(outcome.error);
    setIsSearching(false);
    setHasSearched(true);
  }, [query]);

  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    if (debounceMs <= 0) return;
    clearDebounce();
    if (!next.trim()) {
      // Empty query — clear results immediately, no fetch.
      requestIdRef.current++;
      setResults([]);
      setHasSearched(false);
      setIsSearching(false);
      return;
    }
    const autoMode = optsRef.current.autoMode ?? 'light';
    debounceHandleRef.current = setTimeout(() => {
      runSearch(next, autoMode);
    }, debounceMs);
  }, [debounceMs, runSearch]);

  const cancel = useCallback(() => {
    clearDebounce();
    requestIdRef.current++;
    setIsSearching(false);
  }, []);

  const clearResults = useCallback(() => {
    clearDebounce();
    requestIdRef.current++;
    setResults([]);
    setHasSearched(false);
    setIsSearching(false);
    setError(undefined);
  }, []);

  useEffect(() => () => clearDebounce(), []);

  return { query, setQuery, results, isSearching, hasSearched, error, runSearch, cancel, clearResults };
}
