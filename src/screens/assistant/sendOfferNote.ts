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

export interface SendOfferFacts {
  jobName: string;
  customerName?: string;
  total?: number;
  /** An email or mobile is on file — there is someone to send it to. */
  hasContact: boolean;
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
}

const hasText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

export function sendOfferFactsForQuote(source: SendOfferSource, fallbackJobName = 'that job'): SendOfferFacts {
  return {
    jobName: hasText(source.job?.name) ? source.job!.name!.trim() : fallbackJobName,
    customerName: hasText(source.customerName) ? source.customerName.trim() : undefined,
    total: typeof source.total === 'number' && Number.isFinite(source.total) ? source.total : undefined,
    hasContact: hasText(source.customerEmail) || hasText(source.customerPhone),
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

/**
 * The hidden "[context]" note that drives the text-mode turn. Appended AFTER
 * the "Here's the draft" line and the inline card so the history ends on a
 * user turn, then the model replies into a fresh bubble.
 */
export function buildSendOfferNote(facts: SendOfferFacts): string {
  const total = typeof facts.total === 'number' ? ` — total ${formatAudRounded(facts.total)}` : '';
  const customer = facts.customerName ? `, customer ${facts.customerName}` : '';
  const contact = facts.hasContact ? 'contact details are on file' : 'NO email or mobile on file';
  const ask = facts.hasContact
    ? `Offer to send it: "${sendOfferLine(facts)}"`
    : `There's nobody to send it to yet, so ask for the customer's email or mobile in that one line instead of offering the send.`;
  return (
    `[context] The ${facts.docType} for "${facts.jobName}" is priced and on screen as a card${total}${customer}, ${contact}. ` +
    `Your turn: ONE short line. ${ask} ` +
    `Don't repeat the row summary — the card shows it. Never say the tag.`
  );
}
