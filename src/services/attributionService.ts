/**
 * Ad-attribution and organic-acquisition capture (web only).
 *
 * Fire-and-forget throughout, like analyticsService — a flaky network or
 * blocked storage must never break launch or sign-in.
 *
 *  1. `captureAttributionFromUrl()` at app start: if the URL carries utm_,
 *     fbclid, or gclid params, stash them in sessionStorage. The marketing site
 *     (same origin — the web app serves at quotemateapp.au/app) writes the
 *     same key on landing, so a user who browsed the site before clicking
 *     through keeps their first-touch params even if the /app link lost them.
 *
 *  2. `persistAttributionIfNew(uid, accountCreatedAt)` once auth settles:
 *     write-once to users/{uid}/profile/attribution. Existing doc always wins
 *     (first touch); the stored copies are cleared after a confirmed write so
 *     token refreshes and later sign-ins don't spend reads re-checking.
 *
 * Two independent kinds of context land in that one doc:
 *
 *   - The paid campaign params (utm_ , fbclid, gclid) at the top level. This is
 *     the pre-existing contract and is untouched: same storage key, same field
 *     names, same rollup key, same native no-op.
 *
 *   - An `acquisition` map describing the ORGANIC first touch — which public
 *     page they landed on, which search engine or referrer sent them, and
 *     when. Read from the marketing site's `qm_acquisition` record (session
 *     storage, with a same-origin cookie for new-tab journeys).
 *
 * The acquisition map is written only for a genuinely NEW account, and only
 * when the record predates that account's creation. `persistAttributionIfNew`
 * runs on every auth state change, so without those two gates a returning
 * user signing in — or a token refreshing an hour later — would have today's
 * browsing stamped on them as their origin. An account we cannot explain is
 * recorded as nothing at all and reports as `unknown`, never as organic.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { Platform } from 'react-native';

import { db } from '../config/firebase';
import {
  ACQUISITION_STORAGE_KEY,
  ATTRIBUTION_STORAGE_KEY,
  acquisitionFitsAccount,
  buildAttributionDoc,
  buildAcquisitionRecord,
  isGenuinelyNewAccount,
  parseAcquisitionContext,
  parseAttributionParams,
  parseStoredAttribution,
  type AcquisitionContext,
} from '../utils/attribution';

function isWeb(): boolean {
  try {
    return Platform.OS === 'web' && typeof window !== 'undefined' && typeof document !== 'undefined';
  } catch {
    return false;
  }
}

function storage(): Storage | null {
  try {
    if (!isWeb()) return null;
    return window.sessionStorage ?? null;
  } catch {
    return null; // storage disabled (private mode etc.)
  }
}

/** Best-effort session-storage read that survives a throwing accessor. */
function readSession(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function clearStored(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // best effort
  }
  try {
    if (isWeb()) {
      const secure = window.location?.protocol === 'https:' ? ';Secure' : '';
      document.cookie = `${key}=;path=/;max-age=0;SameSite=Lax${secure}`;
    }
  } catch {
    // cookies blocked
  }
}

function readCookie(name: string): string | null {
  try {
    if (!isWeb()) return null;
    const raw = document.cookie
      .split('; ')
      .find((c) => c.startsWith(`${name}=`))
      ?.slice(name.length + 1);
    return raw ? decodeURIComponent(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Honour the same opt-outs the marketing site uses before its own tracking
 * runs (`?notrack=1` and a declined cookie banner). The site would not have
 * captured a record while either was set, but a cookie written before the
 * opt-out could still be sitting there.
 */
function acquisitionAllowed(): boolean {
  try {
    if (!isWeb()) return false;
    const local = window.localStorage;
    if (!local) return true;
    return local.getItem('qm_notrack') !== '1' && local.getItem('qm_cookie_consent') !== 'declined';
  } catch {
    return true; // localStorage unavailable is not an opt-out
  }
}

/**
 * The marketing site's organic first-touch record, validated. Session storage
 * covers same-tab journeys; the same-origin cookie covers `noopener` and
 * "open in new tab" clicks, where session storage does not carry over.
 */
export function readAcquisitionContext(): AcquisitionContext | null {
  if (!isWeb() || !acquisitionAllowed()) return null;
  return (
    parseAcquisitionContext(readSession(ACQUISITION_STORAGE_KEY)) ??
    parseAcquisitionContext(readCookie(ACQUISITION_STORAGE_KEY))
  );
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

/**
 * Write-once first touch for `uid`.
 *
 * `accountCreatedAt` is Firebase's `user.metadata.creationTime`. Passing it is
 * what separates a brand-new account from a returning sign-in; when it is
 * omitted the organic acquisition map is skipped entirely and only the
 * pre-existing paid-campaign behaviour runs.
 */
export async function persistAttributionIfNew(
  uid: string,
  accountCreatedAt?: string | number | null,
): Promise<void> {
  if (!isWeb()) return;
  const now = new Date();
  try {
    const pending = parseStoredAttribution(readSession(ATTRIBUTION_STORAGE_KEY));
    const context = readAcquisitionContext();
    if (!pending && !context) return;

    // Only a genuinely new account, explained by a record that predates it,
    // gets an acquisition map. Everything else stays unattributed.
    const createdMs =
      typeof accountCreatedAt === 'number' ? accountCreatedAt : Date.parse(String(accountCreatedAt));
    const acquisition =
      context &&
      isGenuinelyNewAccount(accountCreatedAt, now.getTime()) &&
      Number.isFinite(createdMs) &&
      acquisitionFitsAccount(context, createdMs, now.getTime())
        ? buildAcquisitionRecord(context, now)
        : null;

    if (!pending && !acquisition) {
      // Nothing worth writing, but the record has now been judged against a
      // signed-in account: drop it so it can't be picked up by a different
      // account later in the same browser.
      clearStored(ACQUISITION_STORAGE_KEY);
      return;
    }

    const ref = doc(db, 'users', uid, 'profile', 'attribution');
    const existing = await getDoc(ref);
    if (!existing.exists()) {
      await setDoc(ref, {
        ...(pending ?? { landedAt: acquisition!.landedAt, capturedOn: 'web' as const }),
        ...(acquisition ? { acquisition } : {}),
        recordedAt: now.toISOString(),
      });
    }
    // Clear either way: written, or the account already has first-touch data.
    clearStored(ATTRIBUTION_STORAGE_KEY);
    clearStored(ACQUISITION_STORAGE_KEY);
  } catch {
    // fire-and-forget — leave the stored context for a retry on the next auth
    // event rather than losing a first touch to one failed read.
  }
}
