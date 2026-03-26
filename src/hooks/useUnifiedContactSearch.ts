/**
 * Unified Contact Search Hook
 * Merges contacts from saved, recent (quotes/invoices), Xero, and phone sources
 */

import { useMemo, useState, useEffect, useCallback } from 'react';
import { Contact, SearchableContact, Quote, Invoice } from '../types';
import {
  deduplicateContacts,
  searchPhoneContacts,
  checkPhoneContactsPermission,
} from '../services/contactService';

interface UseUnifiedContactSearchOptions {
  query: string;
  contacts: Contact[];
  quotes: (Quote | Invoice)[];
  xeroContacts: Contact[];
  enabled?: boolean;
}

interface UnifiedSearchResult {
  results: SearchableContact[];
  phonePermissionGranted: boolean;
  requestPhonePermission: () => Promise<void>;
  phonePermissionChecked: boolean;
}

const SOURCE_COLORS: Record<string, string> = {
  saved: '#4ade80',   // green
  recent: '#60a5fa',  // blue
  xero: '#2dd4bf',    // teal
  phone: '#9ca3af',   // gray
};

export { SOURCE_COLORS };

export function useUnifiedContactSearch({
  query,
  contacts,
  quotes,
  xeroContacts,
  enabled = true,
}: UseUnifiedContactSearchOptions): UnifiedSearchResult {
  const [phonePermissionGranted, setPhonePermissionGranted] = useState(false);
  const [phonePermissionChecked, setPhonePermissionChecked] = useState(false);
  const [phoneResults, setPhoneResults] = useState<SearchableContact[]>([]);

  const [permissionRequested, setPermissionRequested] = useState(false);

  // Check phone permission status on mount
  useEffect(() => {
    checkPhoneContactsPermission().then((granted) => {
      setPhonePermissionGranted(granted);
      setPhonePermissionChecked(true);
    }).catch(() => {
      setPhonePermissionChecked(true);
    });
  }, []);

  const requestPhonePermission = useCallback(async () => {
    const { requestPhoneContactsPermission } = await import('../services/contactService');
    const granted = await requestPhoneContactsPermission();
    setPhonePermissionGranted(granted);
    setPermissionRequested(true);
  }, []);

  // Auto-request phone contacts permission when user starts typing (>= 2 chars)
  // This triggers the OS permission dialog once; subsequent calls are no-ops
  useEffect(() => {
    if (!enabled || phonePermissionGranted || permissionRequested || query.length < 2) return;
    if (!phonePermissionChecked) return;

    // Auto-request permission
    setPermissionRequested(true);
    requestPhonePermission();
  }, [query, enabled, phonePermissionGranted, permissionRequested, phonePermissionChecked, requestPhonePermission]);

  // Search phone contacts when query changes (debounced via effect)
  useEffect(() => {
    if (!enabled || !phonePermissionGranted || query.length < 2) {
      setPhoneResults([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      const results = await searchPhoneContacts(query);
      if (!cancelled) setPhoneResults(results);
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, phonePermissionGranted, enabled]);

  // Build saved contacts results
  const savedResults = useMemo((): SearchableContact[] => {
    if (!enabled) return [];
    const search = query.toLowerCase().trim();

    return contacts
      .filter((c) => {
        if (!search) return true; // Show all saved when empty
        return (
          c.name.toLowerCase().includes(search) ||
          (c.businessName && c.businessName.toLowerCase().includes(search)) ||
          (c.email && c.email.toLowerCase().includes(search)) ||
          (c.phone && c.phone.includes(search))
        );
      })
      .slice(0, 8)
      .map((c) => ({ ...c, searchSource: 'saved' as const }));
  }, [contacts, query, enabled]);

  // Build recent customers from quotes/invoices
  const recentResults = useMemo((): SearchableContact[] => {
    if (!enabled) return [];
    const search = query.toLowerCase().trim();
    const customerMap = new Map<string, { name: string; email?: string; phone?: string; address?: string; lastUsed: Date }>();

    for (const doc of quotes) {
      const key = doc.customerName.toLowerCase().trim();
      if (key && !customerMap.has(key)) {
        customerMap.set(key, {
          name: doc.customerName,
          email: doc.customerEmail,
          phone: doc.customerPhone,
          address: doc.jobAddress,
          lastUsed: doc.updatedAt,
        });
      }
    }

    const sorted = Array.from(customerMap.values()).sort(
      (a, b) => b.lastUsed.getTime() - a.lastUsed.getTime()
    );

    const filtered = search
      ? sorted.filter((c) => c.name.toLowerCase().includes(search))
      : sorted;

    return filtered.slice(0, 8).map((c) => ({
      id: `recent-${c.name.toLowerCase().trim()}`,
      name: c.name,
      email: c.email,
      phone: c.phone,
      address: c.address,
      source: 'quote' as const,
      createdAt: '',
      updatedAt: '',
      searchSource: 'recent' as const,
    }));
  }, [quotes, query, enabled]);

  // Build Xero contact results
  const xeroResults = useMemo((): SearchableContact[] => {
    if (!enabled || xeroContacts.length === 0) return [];
    const search = query.toLowerCase().trim();

    return xeroContacts
      .filter((c) => {
        if (!search) return true;
        return (
          c.name.toLowerCase().includes(search) ||
          (c.email && c.email.toLowerCase().includes(search))
        );
      })
      .slice(0, 8)
      .map((c) => ({ ...c, searchSource: 'xero' as const }));
  }, [xeroContacts, query, enabled]);

  // Merge and deduplicate all sources
  const results = useMemo((): SearchableContact[] => {
    if (!enabled) return [];

    const all = [...savedResults, ...recentResults, ...xeroResults, ...phoneResults];
    const deduped = deduplicateContacts(all);

    // Sort: starts-with matches first, then contains
    const search = query.toLowerCase().trim();
    if (search) {
      deduped.sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(search) ? 0 : 1;
        const bStarts = b.name.toLowerCase().startsWith(search) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;

        // Within same match quality, sort by source priority
        const sourcePriority: Record<string, number> = { saved: 0, xero: 1, recent: 2, phone: 3 };
        return sourcePriority[a.searchSource] - sourcePriority[b.searchSource];
      });
    }

    return deduped.slice(0, 8);
  }, [savedResults, recentResults, xeroResults, phoneResults, query, enabled]);

  return {
    results,
    phonePermissionGranted,
    requestPhonePermission,
    phonePermissionChecked,
  };
}
