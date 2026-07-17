/**
 * The behavioural-state conversion model: ONE primary commercial action per
 * user, selected from durable job state — never from trial day alone.
 *
 * Spec: QuoteMateAppWebsite/marketing/high-intent-conversion-plan.md
 * (Intervention 0). Core rules encoded here:
 *   - One primary commercial action at a time; Square (Path B) and Pro
 *     (Path A) never compete as primary CTAs.
 *   - A money moment (deposit/payment waiting to be collected) always beats
 *     a subscription ask — a free tradie collecting via Square IS revenue.
 *   - No subscription pricing before the user reaches a meaningful outcome
 *     (`sellingAllowed` is false on activation states); the exception —
 *     user-initiated opens of Pro features — is the caller's context, not
 *     this model's.
 *   - "Happy on Free" suppresses every generic Pro ask; job actions remain.
 *
 * Mirrors the server's furthestStage classifier semantics
 * (functions/src/eventFunnel.helpers.ts): durable document/payment state
 * always wins over anything lossy. Pure and `now`-injectable like
 * followUpNudge.ts — no store, no Firestore, no Date.now().
 */
import type { DocumentStage } from '../types/document';
import { TRIAL_MS } from './trialConfig';
import { monthlyFeeSaving, FEE_SAVING_CLAIM_THRESHOLD_AUD, squareCollectedLast30d } from '../config/pricingConfig';

export type EffectivePlan = 'trial' | 'free' | 'pro';

export type NextBestActionKey =
  /** Accepted quote / sent invoice with no real Square money yet — collect it. */
  | 'take_deposit'
  /** No documents at all — get the first quote drafted. */
  | 'create_first_quote'
  /** Draft(s) exist but nothing has ever gone to a customer — send it. */
  | 'send_first_quote'
  /** Trial in its final days — informed keep-Pro / go-Free choice. */
  | 'continuity_choice'
  /** Free user with real Square volume — Pro pitched on their actual fees. */
  | 'fee_comparison'
  /** Trial user repeatedly using Pro-only tools — keep them with Pro. */
  | 'keep_pro_tools'
  /** Sent quote(s) awaiting a customer response — follow up. */
  | 'follow_up'
  /** Settled on Free — help them run jobs and get paid through Square. */
  | 'complete_via_square'
  /** Nothing to ask (e.g. Pro user, all jobs settled). */
  | 'none';

/**
 * Mirror of ENDING_THRESHOLD_DAYS in functions/src/lifecycleEmails.helpers.ts
 * so the in-app "trial ending" state flips the same day the trial_ending
 * email fires. Pinned by crossPackageMirrors.guard.test.ts — update both
 * sides together.
 */
export const NBA_ENDING_THRESHOLD_DAYS = 3;

/** Pro-only feature uses in the trial before "keep these tools" outranks generic states. */
export const REPEAT_PRO_USE_MIN = 2;

/** Stages where the customer owes money and no further sending is needed first. */
const AWAITING_PAYMENT_STAGES: ReadonlyArray<DocumentStage> = [
  'quote_accepted',
  'invoice_sent',
  'partially_paid',
];

/** Stages proving a document reached a customer at some point. */
const SENT_TIER_STAGES: ReadonlyArray<DocumentStage> = [
  'quote_sent',
  'quote_rejected',
  'quote_accepted',
  'invoice_sent',
  'partially_paid',
  'paid',
];

export interface NextBestActionDoc {
  stage: DocumentStage;
  payments?: Array<{ amount?: number; paidAt?: number; method?: string; squarePaymentId?: string }>;
}

/**
 * Mirror of docHasSquarePayment in functions/src/eventFunnel.helpers.ts:
 * only webhook-written Square money counts as collected — manual cash/bank
 * records never monetise QuoteMate and never settle a "take_deposit" state.
 */
export function docHasRealSquarePayment(doc: NextBestActionDoc | null | undefined): boolean {
  const payments = doc?.payments;
  if (!Array.isArray(payments)) return false;
  return payments.some((p) => p && (p.method === 'square' || typeof p.squarePaymentId === 'string'));
}

export interface NextBestActionInput {
  /** From useStore.getEffectivePlan() — expiry already resolved to 'free'. */
  plan: EffectivePlan;
  /** trialStartedAt in ms epoch, or null if the trial never started. */
  trialStartedAt: number | null;
  /** Minimal projection of the user's documents (durable truth). */
  docs: NextBestActionDoc[];
  /** users/{uid}/settings/squareConnection exists. */
  hasSquareConnection: boolean;
  /** Pro-only feature opens this trial (premium template, logo, …). */
  proFeatureUses: number;
  /** User chose "happy on Free" within the suppression window (promptState). */
  happyOnFree: boolean;
  /** Injected clock — never Date.now() inside the model. */
  now: number;
}

export interface NextBestAction {
  key: NextBestActionKey;
  /**
   * Whether subscription pricing may accompany this action. False on
   * activation and money-moment states: no selling before a real outcome,
   * and never against a pending payment.
   */
  sellingAllowed: boolean;
  /** Whole days of trial left (ceil, matches deriveSubFields), null if not trialing. */
  trialDaysRemaining: number | null;
  /** True when the primary action needs Square connected first (same CTA, extra step). */
  needsSquareConnect: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function nextBestAction(input: NextBestActionInput): NextBestAction {
  const trialing = input.plan === 'trial' && input.trialStartedAt !== null;
  const trialDaysRemaining = trialing
    ? Math.max(0, Math.ceil((input.trialStartedAt! + TRIAL_MS - input.now) / DAY_MS))
    : null;

  const base = { trialDaysRemaining, needsSquareConnect: false };
  const needsConnect = !input.hasSquareConnection;

  const awaitingPayment = input.docs.some(
    (d) => AWAITING_PAYMENT_STAGES.includes(d.stage) && !docHasRealSquarePayment(d)
  );
  const hasAnyDoc = input.docs.length > 0;
  const hasSentDoc = input.docs.some((d) => SENT_TIER_STAGES.includes(d.stage));
  const awaitingResponse = input.docs.some((d) => d.stage === 'quote_sent');

  // 1. Money moment: a collectable job always beats any subscription ask.
  if (awaitingPayment) {
    return { key: 'take_deposit', sellingAllowed: false, ...base, needsSquareConnect: needsConnect };
  }

  // 2–3. Activation: no pricing before the first real outcome.
  if (!hasAnyDoc) return { key: 'create_first_quote', sellingAllowed: false, ...base };
  if (!hasSentDoc) return { key: 'send_first_quote', sellingAllowed: false, ...base };

  // 4–6. Commercial states — never for Pro, and suppressed by "happy on Free".
  if (input.plan !== 'pro' && !input.happyOnFree) {
    if (trialing && trialDaysRemaining !== null && trialDaysRemaining <= NBA_ENDING_THRESHOLD_DAYS) {
      return { key: 'continuity_choice', sellingAllowed: true, ...base };
    }
    if (
      input.plan === 'free' &&
      monthlyFeeSaving(squareCollectedLast30d(input.docs, input.now)) >= FEE_SAVING_CLAIM_THRESHOLD_AUD
    ) {
      return { key: 'fee_comparison', sellingAllowed: true, ...base };
    }
    if (trialing && input.proFeatureUses >= REPEAT_PRO_USE_MIN) {
      return { key: 'keep_pro_tools', sellingAllowed: true, ...base };
    }
  }

  // 7. Job momentum: sent quotes waiting on a customer.
  if (awaitingResponse) return { key: 'follow_up', sellingAllowed: false, ...base };

  // 8. Settled on Free: the business model is Square collection, not nagging.
  if (input.plan === 'free') {
    return { key: 'complete_via_square', sellingAllowed: false, ...base, needsSquareConnect: needsConnect };
  }

  return { key: 'none', sellingAllowed: false, ...base };
}
