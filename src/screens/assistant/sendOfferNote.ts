// The send offer after a draft lands.
//
// The 2 Sep 2026 draft audit: 44 Mate conversations, 34 drafts applied, ZERO
// send offers. The system prompt says "offer the send yourself the moment a
// quote is priced", but nothing ever gave the model the turn to do it. In
// text chat the post-Apply "[context]" note is parked as a hidden message and
// only reaches the model when the tradie types again — most never did, so the
// draft sat. Voice got a "[pipeline-done]" turn, but that prompt asked for
// one acknowledging line and forbade numbers, so the offer never came there
// either.
//
// Pure helpers so the decision and the wording can be tested without the
// screen: what facts the offer needs, whether this Apply earns a turn, and the
// hidden note that drives the text-mode turn.

import type { SendQuoteProposal } from '../../types/assistant';
import { correctionsClause } from './pricingCorrections';

export interface SendOfferFacts {
  jobName: string;
  customerName?: string;
  total?: number;
  /** An email or mobile is on file — there is someone to send it to. */
  hasContact: boolean;
  /** The address a Send card pre-fills, when there is one. */
  customerEmail?: string;
  docType: 'quote' | 'invoice';
}

/** Loose on purpose: a legacy Quote and a unified Document both fit. */
export interface SendOfferSource {
  job?: { name?: string } | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  total?: number | null;
  type?: string | null;
  /** Unified document stage, or the legacy quote status — either says "draft". */
  stage?: string | null;
  status?: string | null;
  sentAt?: number | null;
}

/**
 * Still a draft nobody has — the only kind a Send card belongs on. A customer
 * change on a sent quote is a correction, not a reason to send it twice.
 */
export function isUnsentSource(source: SendOfferSource): boolean {
  if (source.sentAt) return false;
  const stage = source.stage ?? source.status ?? 'draft';
  return stage === 'draft';
}

const hasText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

export function sendOfferFactsForQuote(source: SendOfferSource, fallbackJobName = 'that job'): SendOfferFacts {
  return {
    jobName: hasText(source.job?.name) ? source.job!.name!.trim() : fallbackJobName,
    customerName: hasText(source.customerName) ? source.customerName.trim() : undefined,
    total: typeof source.total === 'number' && Number.isFinite(source.total) ? source.total : undefined,
    hasContact: hasText(source.customerEmail) || hasText(source.customerPhone),
    ...(hasText(source.customerEmail) ? { customerEmail: source.customerEmail.trim() } : {}),
    docType: source.type === 'invoice' ? 'invoice' : 'quote',
  };
}

/** "$12,687" — rounded, thousands-separated, no locale tables needed. */
export function formatAudRounded(total: number): string {
  const rounded = Math.round(Math.abs(total));
  const grouped = String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${total < 0 ? '-' : ''}$${grouped}`;
}

export interface OfferSendTurnArgs {
  proposalType: string;
  ok: boolean;
  pipelineDegraded?: boolean;
  /** A live voice session is open — it gets its turn from [pipeline-done]. */
  voiceOpen: boolean;
}

/**
 * Whether this Apply earns Mate an explicit text-mode turn to offer the send.
 * Only the two proposals that leave a freshly priced quote on screen; never
 * over an unpriced one (there's nothing to send yet), and never in voice.
 */
export function shouldOfferSendTurn(args: OfferSendTurnArgs): boolean {
  if (!args.ok || args.pipelineDegraded) return false;
  if (args.voiceOpen) return false;
  return args.proposalType === 'propose_draft_quote' || args.proposalType === 'propose_update_quote_scope';
}

/** One clause the model can lift straight into its line. */
export function sendOfferLine(facts: SendOfferFacts): string {
  const who = facts.customerName ? `${facts.customerName}'s` : 'the';
  const amount = typeof facts.total === 'number' ? ` at ${formatAudRounded(facts.total)}` : '';
  return `that's ${who} ${facts.docType}${amount} — want me to send it?`;
}

export interface SendOfferNoteOptions {
  /**
   * Mate already asked for a mobile or email while pricing ran (see
   * buildContactAskNote). One ask only — the note must not have it ask twice.
   */
  contactAsked?: boolean;
  /**
   * A Send card is on screen under the draft (buildSendCardProposal). The
   * note is then pure context — no turn is driven, and Mate must not offer
   * the send a second time in words.
   */
  cardShown?: boolean;
}

/**
 * The hidden "[context]" note that drives the text-mode turn. Appended AFTER
 * the "Here's the draft" line and the inline card so the history ends on a
 * user turn, then the model replies into a fresh bubble.
 */
export function buildSendOfferNote(
  facts: SendOfferFacts,
  corrections: string[] = [],
  quoteId?: string,
  options: SendOfferNoteOptions = {},
): string {
  const total = typeof facts.total === 'number' ? ` — total ${formatAudRounded(facts.total)}` : '';
  const customer = facts.customerName ? `, customer ${facts.customerName}` : '';
  const contact = facts.hasContact ? 'contact details are on file' : 'NO email or mobile on file';
  const head = `[context] The ${facts.docType} for "${facts.jobName}" is priced and on screen as a card${total}${customer}, ${contact}. `;
  if (options.cardShown) {
    return (
      head +
      `A Send card is up right under it showing recipient + total — the tradie taps Send, or says yes and you call apply_pending_proposal. ` +
      `Don't offer the send again in words and don't repeat the row summary. Never say the tag.`
    );
  }
  const target = quoteId ? ` on ${quoteId}` : '';
  const ask = facts.hasContact
    ? `Offer to send it: "${sendOfferLine(facts)}"`
    : options.contactAsked
      ? `You already asked for their mobile or email while pricing ran — don't ask twice. Say the total's in and they can tap the card, ` +
        `and that a number or email any time gets it sent (propose_update_customer${target} the moment they give one).`
      : `There's nobody to send it to yet, so ask for the customer's email or mobile in that one line instead of offering the send.`;
  // Corrections said while pricing ran come first: a send offer on a quote
  // the tradie has already corrected is an offer to send the wrong quote.
  const fix = correctionsClause(corrections, quoteId);
  return (
    head +
    (fix ? `${fix.trim()} Do that BEFORE offering the send. ` : `Your turn: ONE short line. ${ask} `) +
    `Don't repeat the row summary — the card shows it. Never say the tag.`
  );
}

// ---------------------------------------------------------------------------
// Getting a contact BEFORE the quote is priced.
//
// 19 Sep 2026 audit, 58 Mate chats that reached a priced card: 44 had no
// email or mobile on file, so the send offer could never fire and the sheet
// asked the tradie to type an address. The draft-time ask ("got his number
// handy?") rides along with the draft card and gets skipped when the tradie
// taps Price it up. The 15–40 s pricing wait is dead time — ask then.
// ---------------------------------------------------------------------------

export interface DraftCustomerFacts {
  name?: string;
  /** null when the contact is not in the local cache — unknown, not missing. */
  hasContact: boolean | null;
}

/**
 * Who a draft card is for and whether they can be sent to, read off the
 * proposal the way Apply resolves it: an existing contact by id first, a
 * fresh customerDraft otherwise.
 */
export function describeDraftCustomer(
  proposal: { customerId?: string; customerDraft?: { name?: string; phone?: string; email?: string } },
  findContact: (id: string) => { name?: string | null; phone?: string | null; email?: string | null } | undefined,
): DraftCustomerFacts {
  if (proposal.customerId) {
    const c = findContact(proposal.customerId);
    if (!c) return { name: proposal.customerDraft?.name, hasContact: null };
    return { name: hasText(c.name) ? c.name.trim() : undefined, hasContact: hasText(c.phone) || hasText(c.email) };
  }
  if (proposal.customerDraft) {
    const d = proposal.customerDraft;
    return { name: hasText(d.name) ? d.name.trim() : undefined, hasContact: hasText(d.phone) || hasText(d.email) };
  }
  return { hasContact: null };
}

/** "Unnamed job" is the ballpark placeholder — nobody to ask for a number for. */
const isPlaceholderCustomer = (name?: string): boolean => !hasText(name) || /^unnamed\b/i.test(name.trim());

export interface ContactAskArgs {
  proposalType: string;
  customer: DraftCustomerFacts;
  /** A live voice session is open — it has its own flow. */
  voiceOpen: boolean;
}

/**
 * Whether a freshly minted draft earns Mate a turn to ask for a mobile or
 * email while pricing runs. Only a real draft (not a scope update, which
 * already had its ask), only when the contact is known to be missing (an
 * uncached contact is not missing), never for a placeholder customer, never
 * in voice.
 */
export function shouldAskContactDuringPricing(args: ContactAskArgs): boolean {
  if (args.voiceOpen) return false;
  if (args.proposalType !== 'propose_draft_quote') return false;
  if (args.customer.hasContact !== false) return false;
  return !isPlaceholderCustomer(args.customer.name);
}

/** The hidden note that drives the mid-pricing ask. */
export function buildContactAskNote(args: { quoteId: string; jobName: string; customerName?: string }): string {
  const who = args.customerName?.trim() || 'the customer';
  return (
    `[context] Pricing for "${args.jobName}" (quote ${args.quoteId}) is running — 15–40 s, the card shows progress. ` +
    `There's NO email or mobile on file for ${who}, and you'll need one to send it. ` +
    `Your turn: ONE short line asking for their mobile or email while that prices up — ` +
    `e.g. "While that prices up — got a mobile or email for ${who}?" Nothing about rows or totals yet. ` +
    `If they hand you one before pricing lands, say you'll pop it on once it's priced, and call propose_update_customer on ${args.quoteId} ` +
    `only after the "[context]" line that says pricing finished. If they don't answer, don't ask again. Never say the tag.`
  );
}

// ---------------------------------------------------------------------------
// The send offer as a card, not a question.
//
// Same audit: with a contact on file Mate asked "want me to send it?" 13
// times, 4 tradies replied, none said yes, and no Send card was ever
// proposed. A question needs a typed answer and a second model turn; a card
// needs one tap. The client mints the card itself the moment pricing lands.
// ---------------------------------------------------------------------------

export const SEND_CARD_TOOL_USE_PREFIX = 'client-send-offer:';

export function sendCardLine(facts: SendOfferFacts): string {
  const who = facts.customerName ? `${facts.customerName}'s ${facts.docType}` : `That ${facts.docType}`;
  const amount = typeof facts.total === 'number' ? ` — ${formatAudRounded(facts.total)}` : '';
  return `${who} is ready${amount}. Send it?`;
}

export function buildSendCardProposal(args: {
  quoteId: string;
  facts: SendOfferFacts;
  id: string;
  createdAt: string;
}): SendQuoteProposal {
  return {
    id: args.id,
    toolUseId: `${SEND_CARD_TOOL_USE_PREFIX}${args.quoteId}`,
    createdAt: args.createdAt,
    type: 'propose_send_quote',
    quoteId: args.quoteId,
    ...(args.facts.customerEmail ? { recipientEmail: args.facts.customerEmail } : {}),
    ...(typeof args.facts.total === 'number' ? { displayTotal: args.facts.total } : {}),
  };
}
