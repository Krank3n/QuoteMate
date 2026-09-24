/**
 * The per-business block Mate carries into every session.
 *
 * MATE_SYSTEM_PROMPT is a static constant with no per-business content — the
 * only way business context reached the model was a tool call it might not
 * make. This appends the tradie's saved quoting profile (preferences + rate
 * card) to the prompt for the text path and the Gemini/OpenAI voice paths,
 * and hands the same text out as a "[context]" note for ElevenLabs, whose
 * prompt is provisioned server-side.
 *
 * While a business has saved nothing, the same seam carries an explicit
 * "nothing saved yet" line instead, so Mate asks once on their first job
 * (see "How they quote" in the prompt). No settings at all — store not
 * ready, source threw — means no line either way: the prompt stays static
 * rather than telling Mate to ask a tradie who may well have a rate card.
 *
 * The settings source is registered by the store rather than imported, so
 * none of the assistant services grow an import edge into the store graph.
 */
import type { BusinessSettings } from '../../types';
import type { EffectivePlan } from '../../store/planGates';
import { canRunMatePipeline } from '../../store/planGates';
import { MATE_SYSTEM_PROMPT } from './systemPrompt';
import { NO_PROFILE_NOTE, buildQuotingProfileBlock, labourRateIsTheirs, labourRateNotSetNote } from '../quotingProfile';

type ProfileSource = () => BusinessSettings | null | undefined;
type PlanSource = () => EffectivePlan | null | undefined;

let source: ProfileSource = () => null;
let planSource: PlanSource = () => null;

export function registerQuotingProfileSource(fn: ProfileSource): void {
  source = fn;
}

/** The store's getEffectivePlan, registered the same way as the settings source. */
export function registerPlanSource(fn: PlanSource): void {
  planSource = fn;
}

/**
 * What Mate is told on a free (post-trial) account.
 *
 * The apply path gates the pipeline (planGates.canRunMatePipeline), and it
 * always will. What it must not do is surprise the tradie: two of them on
 * 16–17 Sep 2026 answered six turns of scoping questions, tapped "Price it
 * up", and met the paywall as an error bubble with nothing from Mate. The
 * gate is a fact about the account Mate can know before the first question.
 */
export const FREE_PLAN_NOTE = [
  'This account is on the FREE plan.',
  'Auto-pricing — building the materials list and fetching prices — is a Pro feature, so every "Price it up" card you put up will fail at the tap: propose_draft_quote, propose_update_quote_scope, propose_add_line_item for a material, propose_reprice. Do not put one up and let them find out.',
  "The FIRST time they ask you to quote or invoice anything, say it plainly in one line before any scoping question: \"Auto-pricing's a Pro thing, so I can't build the materials list on this plan — you can add rows and prices yourself in the app, or go Pro and I'll price it.\" Never say \"AI\".",
  'Then stop asking scoping questions — there is nothing to hand the answers to. Answer questions about their quotes, send, mark paid, set totals, add a lump-sum line at a price they name, and save rates and preferences as normal — none of those need the pipeline.',
].join('\n');

/** The plan line, or null when the plan is unknown or the pipeline is open to them. */
function planText(): string | null {
  try {
    const plan = planSource();
    if (!plan || canRunMatePipeline(plan)) return null;
    return FREE_PLAN_NOTE;
  } catch {
    return null;
  }
}

/**
 * The registered business settings, for the one place outside the store that
 * must show the same money the apply path will write: the draft card's rate
 * lines. Null when nothing is registered or the source throws.
 */
export function registeredBusinessSettings(): BusinessSettings | null {
  try {
    return source() ?? null;
  } catch {
    return null;
  }
}

/**
 * The block when they've saved something, the "nothing saved yet" line when
 * their settings are loaded but empty, null when there are no settings to
 * read. Never throws.
 */
function profileText(): string | null {
  try {
    const settings = source();
    if (!settings) return null;
    const profile = buildQuotingProfileBlock(settings) ?? NO_PROFILE_NOTE;
    // Rides on every session, not just the get_business_defaults answer: Mate
    // read out the pre-filled rate as theirs without ever calling the tool.
    return labourRateIsTheirs(settings) ? profile : `${profile}\n${labourRateNotSetNote(settings.defaultLaborRate)}`;
  } catch {
    return null;
  }
}

/**
 * The static prompt, plus the profile (or the nothing-saved line) when settings
 * are loaded, plus the free-plan line when the pipeline is closed to them.
 */
export function systemPromptWithProfile(): string {
  const parts = [profileText(), planText()].filter((t): t is string => !!t);
  return parts.length ? `${MATE_SYSTEM_PROMPT}\n\n${parts.join('\n\n')}` : MATE_SYSTEM_PROMPT;
}

/** The same text as a silent context note, for providers that own their prompt. */
export function quotingProfileContextNote(): string | null {
  const parts = [profileText(), planText()].filter((t): t is string => !!t);
  return parts.length ? `[context] ${parts.join('\n\n')}` : null;
}
