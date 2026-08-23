// Empty-state intro for the Mate tab. Pure so the copy and the blank-slate
// decision can be unit tested without rendering the screen.
//
// Four pieces:
//   primary    — the headline. One short question, time-of-day aware.
//   draftChip  — present only when a draft is sitting unfinished. The draft is
//                the most valuable thing on the screen, so it gets a tappable
//                row rather than a sentence the tradie has to answer by typing
//                the name of their own quote.
//   chips      — 3 tappable STEMS that prefill the composer and leave the
//                cursor at the end. Never a worked example: a 70-character
//                prefill is more to delete than to type, and a tradie who taps
//                and sends without reading ends up with a quote for someone
//                who doesn't exist.
//   capability — fixed, one line. Tells a first-timer what Mate does and that
//                nothing saves without them; most bounces were door-peeks at a
//                screen that stated no capability at all.

export interface MateIntroChip {
  label: string;
  prefill: string;
}

export interface MateIntro {
  primary: string;
  capability: string;
  chips: MateIntroChip[];
  draftChip?: MateIntroChip;
}

const CAPABILITY =
  "Tell me the job in plain words — I'll price it up and draft the quote. Nothing saves ’til you say.";

const CHIPS: MateIntroChip[] = [
  { label: 'Quote a job', prefill: 'Quote a job for ' },
  { label: 'Invoice a job', prefill: 'Invoice ' },
  { label: 'Who owes me?', prefill: 'Who still owes me money on sent invoices?' },
];

export function getMateIntro(
  quotes: { status: string; updatedAt: Date; job?: { name?: string }; customerName?: string }[],
  now: Date = new Date(),
): MateIntro {
  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

  const h = now.getHours();
  let openers: string[];
  if (h < 11) openers = ['Mornin’. What are we quoting?', 'G’day. What’s the job?'];
  else if (h < 14) openers = ['What are we quoting?', 'What’s the job?'];
  else if (h < 17) openers = ['Arvo. What are we quoting?', 'What’s next on the list?'];
  else openers = ['Evenin’. What are we quoting?', 'What’s the job?'];

  // Most recently touched draft — surfaced as a one-tap action, not a question.
  const draft = quotes
    .filter((q) => q.status === 'draft')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];

  const intro: MateIntro = { primary: pick(openers), capability: CAPABILITY, chips: CHIPS };
  if (draft) {
    const label =
      draft.job?.name?.trim() ||
      (draft.customerName ? `${draft.customerName}'s job` : 'that draft quote');
    intro.draftChip = { label: `Finish “${label}”`, prefill: `Finish the “${label}” quote` };
  }
  return intro;
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
