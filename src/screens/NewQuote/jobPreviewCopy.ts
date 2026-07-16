/**
 * JobPreview success-banner copy.
 *
 * This banner fires when the wizard finishes building the document — which
 * is NOT the finish line. The Jul 2026 stall audit found 36 users with
 * finished, sendable quotes who never sent them; the old copy told them the
 * job was "locked and loaded / a done deal / all wrapped up" and the app
 * celebrated with confetti before anything reached a customer. Every payer
 * to date sent a quote to a real customer; nobody who stalled here ever
 * converted.
 *
 * Rules for this copy (pinned by jobPreviewCopy.test.ts):
 *   - acknowledge the work, but always point at SENDING as the next step
 *   - never claim completion — no "done", "saved", "wrapped up", etc.
 *   - works for quotes and invoices (say "it", not "the quote")
 *
 * The real celebration (confetti) lives on the send-success alert in
 * DocumentEmailPreviewModal, where it belongs.
 */

export interface SuccessMessage {
  title: string;
  subtitle: string;
}

export const SUCCESS_MESSAGES: SuccessMessage[] = [
  { title: 'Built and ready!', subtitle: 'Now get it in front of your customer' },
  { title: 'Too easy!', subtitle: 'One tap to go — send it off' },
  { title: 'Looking sharp!', subtitle: "Send it while the job's still fresh" },
  { title: 'Ripper work!', subtitle: 'Fire it off before smoko' },
  { title: 'Nice one!', subtitle: "They can't say yes till they see it" },
  { title: 'Almost there!', subtitle: "Hit send and it's in their inbox" },
  { title: 'Beauty!', subtitle: "Send it now while it's front of mind" },
  { title: 'You beauty!', subtitle: "All that's left is to send it" },
];

export function pickSuccessMessage(): SuccessMessage {
  return SUCCESS_MESSAGES[Math.floor(Math.random() * SUCCESS_MESSAGES.length)];
}
