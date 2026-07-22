/**
 * Minimal analytics service.
 *
 * Writes events to `users/{userId}/events/{autoId}` so the funnel can be
 * queried from the admin tools we already have (Firestore console, BigQuery
 * export, or the adminCrm functions). Stops short of installing a third-party
 * SDK — we don't have enough volume yet to justify the bundle bloat, and
 * Firestore writes are already part of the user's session cost.
 *
 * Calls are fire-and-forget: every failure is swallowed so a flaky network
 * never breaks the UI flow that triggered the event. Anonymous (signed-out)
 * sessions short-circuit silently — we don't have an anonymous-id setup yet
 * and the freemium funnel only matters post-signin.
 *
 * Add new events to the AnalyticsEvent union so call sites can't typo a name.
 */

import {
  collection,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { Platform } from 'react-native';

import { auth, db } from '../config/firebase';

export type AnalyticsEvent =
  // First touch of the core value proposition — fires the moment a draft
  // starts. Tells us whether the app's onboarding actually hooks them.
  | 'quote_started'
  // Persistent dashboard / job-screen nudge after trial expires + no Square.
  | 'trial_expired_banner_shown'
  // The hard gate at Send. Fires when SendGateModal opens — funnel's last
  // visible decision point.
  | 'send_gate_shown'
  // User closed the gate without picking a path. Drop-off signal.
  | 'send_gate_abandoned'
  // User picked a path. `method` distinguishes square_connected vs pro_upgrade.
  | 'send_gate_resolved'
  // Dashboard follow-up nudge banner. `nudge_type` distinguishes
  // invoice_overdue / self_sent_quote / unsent_quote / quote_follow_up —
  // measures whether nudging moves quotes to real customers (the Jul 2026
  // audit: only customer-senders ever convert to paid).
  | 'nudge_shown'
  | 'nudge_tapped'
  | 'nudge_dismissed'
  // — Conversion funnel (trial→monetised engine, Step 1) —
  // Paywall lifecycle. `source` names the surface that sent the user here
  // (send_gate / trial_banner / dashboard / unknown).
  | 'paywall_viewed'
  | 'paywall_dismissed'
  // Purchase flow: started → completed | failed. User-cancels are not
  // failures and are never tracked as such.
  | 'checkout_started'
  | 'purchase_completed'
  | 'purchase_failed'
  // The 14-day Pro trial began (fires with the first quote). Deliberately
  // redundant with the durable trialStartedAt field — events are lossy,
  // Firestore state stays the source of truth.
  | 'trial_started'
  // Path B: Square OAuth completed (client-observed poll success).
  | 'square_connected'
  // Path B opt-in at send (trial users): the "get paid on this quote" row.
  // shown = impression per sheet open; tapped carries `outcome`
  // (connect_required / attached / failed) so attach-rate is measurable.
  | 'pay_link_optin_shown'
  | 'pay_link_optin_tapped'
  // — Service reports —
  // First persist of a new service report (mints the RP number; re-saves
  // don't fire again).
  | 'report_created'
  // Mate returned a clean write-up for the rough notes.
  | 'report_written_up'
  // First save carrying fresh signature ink (measured ink only — ghost
  // taps and carried-forward/loaded signatures don't count).
  | 'report_signed'
  // The report PDF went out via the export/share path.
  | 'report_shared';

interface BaseProps {
  // Free-form per-event payload. Keep it flat (Firestore indexes flat fields
  // best) and serialisable. Don't put PII here.
  [key: string]: string | number | boolean | null | undefined;
}

export function trackEvent(event: AnalyticsEvent, props?: BaseProps): void {
  // Fire-and-forget. Never await, never throw upstream — analytics must
  // never wedge a user flow.
  void writeEvent(event, props).catch(() => { /* swallow */ });
}

async function writeEvent(event: AnalyticsEvent, props?: BaseProps): Promise<void> {
  const user = auth.currentUser;
  if (!user) return; // anonymous; nothing to attribute

  const ref = collection(db, 'users', user.uid, 'events');
  await addDoc(ref, {
    event,
    props: props || {},
    platform: Platform.OS,
    ts: serverTimestamp(),
  });
}
