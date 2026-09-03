/**
 * Push notification message pools for QuoteMate.
 *
 * Every body here has to carry the fact that justified the interruption — who,
 * which job, how much. A notification that reads "Ka-ching! Someone paid up!"
 * forces the tradie to open the app just to learn what happened, which is the
 * same cost as not sending it. The Aussie voice sits on top of the fact, never
 * in place of it.
 */

export type AussieEvent =
  | 'quote_accepted'
  | 'quote_rejected'
  | 'quote_viewed'
  | 'quote_expiring'
  | 'invoice_paid'
  | 'invoice_overdue'
  | 'milestone'
  | 'inactivity'
  | 'draft_nudge'
  // Mate finished (or couldn't finish) pricing a quote while the phone was
  // away — the one push a tradie has explicitly waited for.
  | 'quote_priced'
  | 'quote_pricing_snag';

interface MessageVariant {
  title: string;
  body: string;
}

const MESSAGE_POOL: Record<AussieEvent, MessageVariant[]> = {
  quote_accepted: [
    {
      title: 'Quote accepted ✅',
      body: '{customer} accepted your {amount} quote for {job}. Nice one!',
    },
    {
      title: 'Quote accepted ✅',
      body: "Beauty — {customer} gave {job} the tick. That's {amount} locked in.",
    },
  ],
  quote_rejected: [
    {
      title: 'Quote declined',
      body: '{customer} passed on {job}. Worth a call to see if the price was the sticking point.',
    },
    {
      title: 'Quote declined',
      body: "Ah bugger — {customer} knocked back {job}. Plenty more out there, mate.",
    },
  ],
  quote_viewed: [
    {
      title: 'Quote opened 👀',
      body: '{customer} just opened your {amount} quote for {job}. Good time to follow up.',
    },
    {
      title: 'Quote opened 👀',
      body: "{customer}'s having a squiz at {job} right now. Strike while it's hot.",
    },
  ],
  quote_expiring: [
    {
      title: 'Quote expires soon ⏰',
      body: "{customer}'s quote for {job} expires in {days}. Give 'em a nudge before it lapses.",
    },
    {
      title: 'Quote expires soon ⏰',
      body: "Don't let this one slip — {amount} for {customer} expires in {days}.",
    },
  ],
  invoice_paid: [
    {
      title: 'Paid 💰',
      body: '{customer} paid {amount} for {job}. Money\'s in!',
    },
    {
      title: 'Paid 💰',
      body: "Ka-ching — {amount} from {customer} just landed. Beers are on them. 🍻",
    },
  ],
  invoice_overdue: [
    {
      title: 'Overdue invoices',
      body: '{customer} owes you {amount}, past due. Time to chase it up.',
    },
    {
      title: 'Overdue invoices',
      body: "{amount} still outstanding from {customer}. Give 'em a bell?",
    },
  ],
  milestone: [
    {
      title: 'Milestone 🏆',
      body: "That's {n} quotes sent. Absolute machine.",
    },
    {
      title: 'Milestone 🏆',
      body: 'Legend status — {n} quotes and counting.',
    },
  ],
  draft_nudge: [
    {
      title: 'Quote ready to send',
      body: "{customer}'s quote for {job} has been sitting {days}. Send it before they find someone else.",
    },
    {
      title: 'Quote ready to send',
      body: "That {amount} quote for {customer} is still a draft. Flick it over?",
    },
  ],
  inactivity: [
    {
      title: 'Still got quotes to send?',
      body: "Haven't seen ya in a bit, mate. Your drafts are waiting whenever you're ready.",
    },
  ],
  quote_priced: [
    {
      title: 'Quote priced up ✅',
      body: '{job} is priced and ready for a squiz — {count} on the list.',
    },
    {
      title: 'Quote priced up ✅',
      body: "Mate's done pricing {job}. Have a look before it goes out.",
    },
  ],
  quote_pricing_snag: [
    {
      title: 'Pricing hit a snag',
      body: "Couldn't finish pricing {job}. Open it and tap Fetch Prices to have another go.",
    },
  ],
};

/** Drop placeholders the caller didn't supply, then tidy the spacing they leave. */
function stripUnfilled(text: string): string {
  return text
    .replace(/\s*\{[a-zA-Z0-9_]+\}/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,!?])/g, '$1')
    .trim();
}

/**
 * Pick a message for the event and interpolate variables.
 *
 * Variants that still contain an unfilled placeholder after interpolation are
 * skipped where possible, so a caller that has no dollar figure gets the
 * variant that doesn't need one rather than a body reading "your quote".
 */
export function getAussieMessage(
  event: AussieEvent,
  vars: Record<string, string> = {}
): { title: string; body: string } {
  const variants = MESSAGE_POOL[event];
  const supplied = Object.entries(vars).filter(([, value]) => Boolean(value));
  const suppliedKeys = new Set(supplied.map(([key]) => key));

  const placeholdersOf = (v: MessageVariant) =>
    (`${v.title} ${v.body}`.match(/\{([a-zA-Z0-9_]+)\}/g) || [])
      .map((p) => p.slice(1, -1));

  // Prefer variants whose every placeholder can actually be filled.
  const fillable = variants.filter((v) => placeholdersOf(v).every((p) => suppliedKeys.has(p)));
  const pool = fillable.length > 0 ? fillable : variants;
  const variant = pool[Math.floor(Math.random() * pool.length)];

  let title = variant.title;
  let body = variant.body;

  for (const [key, value] of supplied) {
    const placeholder = `{${key}}`;
    title = title.split(placeholder).join(value);
    body = body.split(placeholder).join(value);
  }

  return { title: stripUnfilled(title), body: stripUnfilled(body) };
}
