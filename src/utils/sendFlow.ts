/**
 * Pure rules for the send flow.
 *
 * Extracted from SendDocumentDialog / DocumentEmailPreviewModal so the two
 * decisions the Jul 2026 send audit cares about are testable without
 * rendering a modal: do we still need to ask *how* to send, and did this
 * send actually reach a customer.
 */

/** Shape of an email address good enough to send to. */
export function isEmailAddress(value?: string | null): boolean {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Whether we already know where to email this doc. When we do, the send
 * sheet's five rows are pure friction — email is the dominant path — so the
 * flow opens the email preview directly and leaves SMS / Share / Export PDF
 * behind "More ways to send".
 */
export function hasCustomerEmail(doc: { customerEmail?: string }): boolean {
  return isEmailAddress(doc.customerEmail);
}

/**
 * True when the recipient is the tradie's own account email. Self-sends are
 * a rehearsal, not activation — the audit counted them as real sends because
 * the client never distinguished them.
 */
export function isSelfSend(recipient: string, ownerEmail?: string | null): boolean {
  const to = recipient.trim().toLowerCase();
  const own = (ownerEmail || '').trim().toLowerCase();
  return !!to && !!own && to === own;
}

/** The two channels whose order changes with what's on file. */
export type SendChannel = 'email' | 'sms';

/**
 * Which channel the send sheet leads with. Email is the dominant path and
 * stays first whenever there's an address to use — but CustomerDetails only
 * ever required email OR phone, so a phone-only customer was being offered
 * Email at the top of the sheet with nothing behind it. When email is the
 * one thing we don't have and SMS is the one thing we do, SMS leads.
 *
 * With neither on file the order is moot; Email stays first, since the
 * preview lets the tradie type an address and SMS can't ask for a number.
 */
export function orderSendOptions({
  hasEmail,
  hasPhone,
}: {
  hasEmail: boolean;
  hasPhone: boolean;
}): SendChannel[] {
  return !hasEmail && hasPhone ? ['sms', 'email'] : ['email', 'sms'];
}
