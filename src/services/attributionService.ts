/**
 * Ad-attribution capture (web only).
 *
 * Two moments, both fire-and-forget like analyticsService — a flaky network
 * or storage failure must never break launch or sign-in:
 *
 *  1. `captureAttributionFromUrl()` at app start: if the URL carries utm_,
 *     fbclid, or gclid params, stash them in sessionStorage. The marketing site
 *     (same origin — the web app serves at quotemateapp.au/app) writes the
 *     same key on landing, so a user who browsed the site before clicking
 *     through keeps their first-touch params even if the /app link lost them.
 *
 *  2. `persistAttributionIfNew(uid)` once auth settles: write-once to
 *     users/{uid}/profile/attribution. Existing doc always wins (first touch);
 *     the sessionStorage copy is cleared after a confirmed write so token
 *     refreshes and later sign-ins don't spend reads re-checking.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { Platform } from 'react-native';

import { db } from '../config/firebase';
import {
  ATTRIBUTION_STORAGE_KEY,
  buildAttributionDoc,
  parseAttributionParams,
  parseStoredAttribution,
} from '../utils/attribution';

function storage(): Storage | null {
  try {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
    return window.sessionStorage ?? null;
  } catch {
    return null; // storage disabled (private mode etc.)
  }
}

export function captureAttributionFromUrl(): void {
  const store = storage();
  if (!store) return;
  try {
    const params = parseAttributionParams(window.location?.search);
    if (!params) return;
    // First touch wins within the session too: don't overwrite params the
    // landing page already recorded with whatever the URL says now.
    if (parseStoredAttribution(store.getItem(ATTRIBUTION_STORAGE_KEY))) return;
    store.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(buildAttributionDoc(params, new Date())));
  } catch {
    // never block launch
  }
}

export async function persistAttributionIfNew(uid: string): Promise<void> {
  const store = storage();
  if (!store) return;
  try {
    const pending = parseStoredAttribution(store.getItem(ATTRIBUTION_STORAGE_KEY));
    if (!pending) return;
    const ref = doc(db, 'users', uid, 'profile', 'attribution');
    const existing = await getDoc(ref);
    if (!existing.exists()) {
      await setDoc(ref, { ...pending, recordedAt: new Date().toISOString() });
    }
    // Clear either way: written, or the account already has first-touch data.
    store.removeItem(ATTRIBUTION_STORAGE_KEY);
  } catch {
    // fire-and-forget — leave the stored params for a retry on next auth event
  }
}
