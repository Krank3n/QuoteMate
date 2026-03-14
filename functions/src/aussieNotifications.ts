/**
 * Aussie-themed push notification message pools for QuoteMate.
 * Each event type has multiple random variants with variable interpolation.
 */

export type AussieEvent =
  | 'quote_accepted'
  | 'quote_rejected'
  | 'quote_viewed'
  | 'quote_expiring'
  | 'invoice_paid'
  | 'invoice_overdue'
  | 'daily_motivation'
  | 'milestone'
  | 'inactivity';

interface MessageVariant {
  title: string;
  body: string;
}

const MESSAGE_POOL: Record<AussieEvent, MessageVariant[]> = {
  quote_accepted: [
    {
      title: 'Ripper! Quote Accepted ✅',
      body: "Ripper! {customer} just accepted your quote, legend!",
    },
    {
      title: 'Bewdy! Quote Accepted ✅',
      body: "Bewdy! {customer}'s given your quote the tick of approval!",
    },
    {
      title: 'Too Easy! Quote Accepted ✅',
      body: "Too easy! {customer} accepted the quote for {job}!",
    },
  ],
  quote_rejected: [
    {
      title: 'Quote Declined ❌',
      body: "Ah bugger, {customer} knocked back your quote.",
    },
    {
      title: 'Quote Declined ❌',
      body: "No wukkas mate, {customer} passed on this one. Plenty more fish!",
    },
    {
      title: 'Quote Declined ❌',
      body: "Bummer, {customer} gave your quote the flick.",
    },
  ],
  quote_viewed: [
    {
      title: "👀 Someone's Having a Squiz",
      body: "Heads up! {customer}'s having a squiz at your quote!",
    },
    {
      title: '👀 Quote Viewed',
      body: "Oi, someone's eyeballing your quote for {job}!",
    },
    {
      title: '👀 Eyes On Your Quote',
      body: "{customer} just opened your quote. Fingers crossed, mate!",
    },
  ],
  quote_expiring: [
    {
      title: '⏰ Quote Expiring Soon',
      body: "Your quote for {customer} is about to cark it! Chase 'em up!",
    },
    {
      title: '⏰ Quote Expiring Soon',
      body: "Oi, quote's expiring soon — give {customer} a nudge!",
    },
    {
      title: '⏰ Quote Expiring Soon',
      body: "Don't let this one slip, mate! Your quote for {customer} expires soon.",
    },
  ],
  invoice_paid: [
    {
      title: 'Ka-ching! Invoice Paid 💰',
      body: "Ka-ching! {customer} just paid up, ya legend! 🍺",
    },
    {
      title: "Money's In! 💰",
      body: "Money's in! {customer} settled the bill. Time for a cold one!",
    },
    {
      title: 'Invoice Paid! 💰',
      body: "{customer} paid the invoice. Beers are on them tonight! 🍻",
    },
  ],
  invoice_overdue: [
    {
      title: '🔴 Invoice Overdue',
      body: "This invoice is more overdue than a library book from 2003!",
    },
    {
      title: '🔴 Invoice Overdue',
      body: "Oi, {customer} still hasn't paid. Give 'em a bell!",
    },
    {
      title: '🔴 Invoice Overdue',
      body: "{customer}'s invoice is overdue. Time to chase up the cash, mate!",
    },
  ],
  daily_motivation: [
    {
      title: "G'day Legend! 🇦🇺",
      body: "G'day legend! Time to smash out some quotes!",
    },
    {
      title: 'Rise and Shine! ☀️',
      body: "Rise and shine, champ! Let's get after it today!",
    },
    {
      title: "Let's Go! 💪",
      body: "Oi oi oi! Another day, another dollar. Go get 'em, mate!",
    },
  ],
  milestone: [
    {
      title: 'Streuth! Milestone! 🏆',
      body: "Streuth! You've sent {n} quotes! Absolute machine!",
    },
    {
      title: 'Legend Status! 🏆',
      body: "Legend status! {n} quotes and counting!",
    },
    {
      title: 'What a Ripper! 🏆',
      body: "{n} quotes sent! You're smashing it harder than a snag on the barbie!",
    },
  ],
  inactivity: [
    {
      title: "Where'd Ya Go? 👋",
      body: "Oi, haven't seen ya in a while! Your quotes miss ya, mate.",
    },
    {
      title: 'We Miss Ya! 👋',
      body: "Where'd ya go? The app's lonely without ya!",
    },
    {
      title: 'Come Back, Legend! 👋',
      body: "It's been a while, mate. Got quotes to smash and invoices to send!",
    },
  ],
};

/**
 * Pick a random Aussie notification message for the given event and interpolate variables.
 */
export function getAussieMessage(
  event: AussieEvent,
  vars: Record<string, string> = {}
): { title: string; body: string } {
  const variants = MESSAGE_POOL[event];
  const variant = variants[Math.floor(Math.random() * variants.length)];

  let title = variant.title;
  let body = variant.body;

  for (const [key, value] of Object.entries(vars)) {
    const placeholder = `{${key}}`;
    title = title.split(placeholder).join(value);
    body = body.split(placeholder).join(value);
  }

  return { title, body };
}
