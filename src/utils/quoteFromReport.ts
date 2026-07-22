/**
 * "Quote it" — turn a service report's Recommended Work into a new draft
 * quote for the same customer.
 *
 * Mirrors the Mate applyProposal 'propose_draft_quote' flow (useStore.ts):
 * mint a fresh draft via createNewQuote() so business defaults (labour
 * rate, markup, GST) are stamped from settings, seed customer + scope,
 * then saveDraft — saveDocument→ensureJobForDocument mints and links the
 * NEW job automatically. The caller then opens the wizard's MaterialsList
 * with autoGenerate:true so the materials pipeline runs, exactly like the
 * wizard does after a fresh description.
 *
 * Factual rule: the recommended-work text becomes the job description
 * VERBATIM (outer whitespace trimmed, nothing rewritten, nothing added).
 *
 * Store calls are injected as deps (pattern: cascadeDeleteJob /
 * openJobPreview) so the decision logic stays unit-testable. Wire them
 * from useStore in the calling screen:
 *
 *   const s = useStore.getState();
 *   createQuoteFromRecommendedWork(params, {
 *     createNewQuote: s.createNewQuote,
 *     getCurrentQuote: () => useStore.getState().currentQuote,
 *     updateQuote: s.updateQuote,
 *     saveDraft: s.saveDraft,
 *   });
 */

import type { Quote } from '../types';
import type { Job } from '../../shared/job/types';

// ─── Pure decision logic ────────────────────────────────────────────────

export interface CreateQuoteFromReportParams {
  /** The job the source report belongs to — supplies the customer. */
  job: Job;
  /** ServiceReport.recommendedWork — becomes the quote scope verbatim. */
  recommendedWork?: string | null;
  /** ServiceReport.serviceType — used only for the new job's name. */
  serviceTypeLabel?: string;
}

/** Customer + scope fields to stamp onto a freshly minted draft quote. */
export interface FollowUpQuoteSeed {
  jobName: string;
  jobDescription: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  jobAddress?: string;
  contactId?: string;
}

/** "Aircon service — follow-up work", or "Follow-up work" when the report
 *  has no service type. */
export function buildFollowUpJobName(serviceTypeLabel?: string | null): string {
  const label = (serviceTypeLabel ?? '').trim();
  return label ? `${label} — follow-up work` : 'Follow-up work';
}

/**
 * Decide what the new draft should contain. Returns null when there's
 * nothing to quote (blank/whitespace-only recommended work) — callers
 * should hide or no-op the "Quote it" action in that case.
 */
export function buildFollowUpQuoteSeed(
  params: CreateQuoteFromReportParams,
): FollowUpQuoteSeed | null {
  const description = (params.recommendedWork ?? '').trim();
  if (!description) return null;

  const { job } = params;
  return {
    jobName: buildFollowUpJobName(params.serviceTypeLabel),
    jobDescription: description,
    customerName: job.customerName,
    customerEmail: job.customerEmail,
    customerPhone: job.customerPhone,
    jobAddress: job.jobAddress || undefined,
    contactId: job.customerId,
  };
}

/** Stamp the seed onto a freshly minted draft, keeping the draft's
 *  business defaults (labour rate, markup, GST flags) untouched. */
export function applySeedToQuote(fresh: Quote, seed: FollowUpQuoteSeed): Quote {
  return {
    ...fresh,
    customerName: seed.customerName,
    customerEmail: seed.customerEmail,
    customerPhone: seed.customerPhone,
    jobAddress: seed.jobAddress,
    contactId: seed.contactId,
    job: {
      ...fresh.job,
      name: seed.jobName,
      description: seed.jobDescription,
    },
  };
}

// ─── Thin store orchestration ───────────────────────────────────────────

export interface CreateQuoteFromReportDeps {
  createNewQuote: () => void;
  getCurrentQuote: () => Quote | null;
  updateQuote: (quote: Quote) => void;
  saveDraft: (quote: Quote) => Promise<void>;
}

export interface QuoteFromReportResult {
  /** Id of the new draft quote (currentQuote is already set to it). */
  quoteId: string;
  /** Wizard entry that runs the materials pipeline on mount:
   *  navigation.navigate(navigate.navigator, { screen, params }). */
  navigate: {
    navigator: 'NewJob';
    screen: 'MaterialsList';
    params: { autoGenerate: true };
  };
}

/**
 * Create the follow-up draft quote and return the navigation payload for
 * opening the wizard with the pipeline running. Returns null when the
 * report has no recommended work. currentQuote is left set to the new
 * draft, which is what MaterialsList reads.
 */
export async function createQuoteFromRecommendedWork(
  params: CreateQuoteFromReportParams,
  deps: CreateQuoteFromReportDeps,
): Promise<QuoteFromReportResult | null> {
  const seed = buildFollowUpQuoteSeed(params);
  if (!seed) return null;

  deps.createNewQuote();
  const fresh = deps.getCurrentQuote();
  if (!fresh) throw new Error('Failed to create draft quote.');

  deps.updateQuote(applySeedToQuote(fresh, seed));
  // Re-read: updateQuote runs the calculation pass before storing.
  const current = deps.getCurrentQuote();
  if (!current) throw new Error('Failed to create draft quote.');
  await deps.saveDraft(current);

  return {
    quoteId: current.id,
    navigate: {
      navigator: 'NewJob',
      screen: 'MaterialsList',
      params: { autoGenerate: true },
    },
  };
}
