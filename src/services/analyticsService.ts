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
  // — Auth bootstrap (the window between sign-in and the app being usable) —
  // Fires the instant onAuthStateChanged hands us a user, BEFORE any load
  // runs. Pairs with auth_bootstrap_finished: a started with no finished is a
  // user stranded on the splash, which is the only way to see that failure —
  // it writes nothing, renders nothing, and fires no other event. The 2026-08
  // audit had to infer it from the absence of profile/onboarding docs.
  | 'auth_bootstrap_started'
  // The splash gate opened. `outcome` is settled | timeout, `duration_ms` how
  // long the user waited, `failed_loaders` names any loader that rejected.
  | 'auth_bootstrap_finished'
  // — Onboarding (the setup flow that gates the whole app) —
  // Entering the flow. `resumed` distinguishes a fresh start from a draft
  // picked back up, so resume rate is measurable.
  | 'onboarding_started'
  // One impression per step entry, carrying step_key + step_index +
  // steps_total. Back-navigation re-fires deliberately; the durable
  // last-seen step lives on profile/onboarding, not here.
  | 'onboarding_step_viewed'
  // The Skip button on an optional step (3+). Names the step skipped.
  | 'onboarding_step_skipped'
  // Flow finished. Carries what actually got filled in — above all
  // optional_fields_filled, the 2026-07 audit's strongest activation signal.
  | 'onboarding_completed'
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
  // — Send flow (Jul 2026 audit: sending IS the activation event; 113 of the
  //   138 quote-creators never sent one and none of them ever paid) —
  // The send flow opened, whether or not the sheet itself was shown. Carries
  // doc_type + has_customer_email + plan; has_customer_email is what decides
  // between the sheet and going straight to the email preview.
  | 'send_sheet_opened'
  // A delivery channel was picked: email / sms / share / export_pdf. Fires
  // for the auto-routed email path too, so sheet friction is measurable as
  // the gap between send_sheet_opened and this.
  | 'send_method_chosen'
  // Email preview reached a usable state. `prefilled` = the body was already
  // warm (pre-generated on JobPreview); `wait_ms` = how long the user
  // actually waited for generation, 0 when prefilled.
  | 'email_preview_opened'
  // Preview closed with nothing sent — the drop-off the audit couldn't see.
  // had_recipient / edited_body separate "no address" from "lost their nerve".
  | 'email_preview_abandoned'
  // A document actually went out. `to_self` flags a send to the tradie's own
  // account email — previously indistinguishable from a real customer send.
  | 'quote_send_succeeded'
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
  // Purchase flow: started → completed | failed | unconfirmed. User-cancels are
  // not failures and are never tracked as such.
  | 'checkout_started'
  // Fires only once the server has actually granted Pro. It used to fire the
  // moment the store handed back a purchase, i.e. before validation — which is
  // why the Jul–Aug 2026 outage was invisible: telemetry read three healthy
  // purchases while nobody was entitled. Keep this on the granted branch.
  | 'purchase_completed'
  // A settled rejection: the store's own error, or a receipt the server refused.
  | 'purchase_failed'
  // The store took the money but validation couldn't confirm it (transient 5xx,
  // offline, credentials missing). Distinct from purchase_failed: the transaction
  // is still live, deliberately left unfinished so the store re-delivers it, and
  // the launch-time sweep should heal it. This is the exact shape of the 2026
  // outage and the branch was previously silent — any non-zero count here means
  // someone has paid and is waiting, so it warrants an alert, not a dashboard row.
  | 'purchase_unconfirmed'
  // A purchase the stores still had outstanding was entitled by the launch-time
  // sweep rather than by the buyer returning to the paywall. Non-zero here means
  // someone was charged-but-not-Pro and we healed it without them noticing —
  // worth watching, because a rising count implies validation is flaking again.
  // Fires only on receipts the sweep actually HEALED. The stores hand back every
  // live subscription on each launch, so this once fired for healthy subscribers
  // too and could not be read as an alarm; those now land in the summary's
  // alreadyEntitled instead. See receiptEntitlement.RecoverySummary.
  | 'purchase_recovered_on_launch'
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
  // The tradie put their own wording back. A rising ratio against
  // report_written_up is the signal the clean-up prompt has drifted from
  // what tradespeople actually want to send.
  | 'report_cleanup_undone'
  // A new report pre-filled its equipment + checklist from the last visit to
  // the same site. Paired with report_site_memory_undone, this is the
  // read on whether site matching is picking the right previous visit.
  | 'report_site_memory_applied'
  // The tradie took those carried rows straight back off — a wrong match,
  // or a site whose plant has changed.
  | 'report_site_memory_undone'
  // First save carrying fresh signature ink (measured ink only — ghost
  // taps and carried-forward/loaded signatures don't count).
  | 'report_signed'
  // The report PDF went out via the export/share path.
  | 'report_shared'
  // Emailed to the customer with the PDF attached — distinct from
  // report_shared, which is the OS share sheet / print dialog.
  | 'report_sent';

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
