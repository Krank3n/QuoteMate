// Empty-state intro for the Mate tab. Pure so the copy and the blank-slate
// decision can be unit tested without rendering the screen.
//
// Four pieces:
//   primary    — one short sentence, context-aware (unfinished draft > time
//                of day).
//   capability — fixed. The one line that tells a first-timer what Mate can
//                actually do; most bounces were door-peeks at a screen that
//                stated no capability.
//   hint       — fixed, muted, smaller. The on-rails reminder.
//   chips      — exactly 3 tappable examples that PREFILL the composer
//                (never auto-send — the tradie always owns the send).

export interface MateIntroChip {
  label: string;
  prefill: string;
}

export interface MateIntro {
  primary: string;
  capability: string;
  hint: string;
  chips: MateIntroChip[];
}

const CAPABILITY =
  "Tell me the job in plain words — I'll price the materials, draft the quote, and tee it up to send.";
const HINT = 'I draft. You tap to confirm. Nothing saves ’til you say.';
const CHIPS: MateIntroChip[] = [
  {
    label: 'Quote a job',
    prefill: 'Quote a bathroom reno for Sam at 12 Smith St — strip out, retile, new vanity and taps',
  },
  {
    label: 'Invoice a job',
    prefill: 'Invoice Dee for the deck repairs — 6 hours labour plus materials',
  },
  {
    label: 'Who owes me?',
    prefill: 'Who still owes me money on sent invoices?',
  },
];

export function getMateIntro(
  quotes: { status: string; updatedAt: Date; job?: { name?: string }; customerName?: string }[],
  now: Date = new Date(),
): MateIntro {
  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

  // Most recently touched draft — surface it so the tradie can pick it up.
  const drafts = quotes
    .filter((q) => q.status === 'draft')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const draft = drafts[0];
  if (draft) {
    const label =
      draft.job?.name?.trim() ||
      (draft.customerName ? `${draft.customerName}'s job` : 'that draft quote');
    return {
      primary: `“${label}” is still a draft — finish it, or start something new?`,
      capability: CAPABILITY,
      hint: HINT,
      chips: CHIPS,
    };
  }

  // No drafts — a short time-of-day nudge.
  const h = now.getHours();
  let openers: string[];
  if (h < 11) openers = ['Mornin’. What are we quoting?', 'G’day. What’s the job?'];
  else if (h < 14) openers = ['What are we quoting?', 'What’s the job?'];
  else if (h < 17) openers = ['Arvo. What are we quoting?', 'What’s next on the list?'];
  else openers = ['Evenin’. What are we quoting?', 'What’s the job?'];
  return { primary: pick(openers), capability: CAPABILITY, hint: HINT, chips: CHIPS };
}

// A conversation still counts as blank when it holds nothing substantive:
// hidden "[context]" notes never render, and error bubbles carry no content.
// Before this, one transport error unmounted the hero and hid the fact that
// typing still works.
export function isBlankSlate(
  messages?: { hidden?: boolean; errorMessage?: string }[],
): boolean {
  if (!messages?.length) return true;
  return messages.every((m) => m.hidden || m.errorMessage);
}
