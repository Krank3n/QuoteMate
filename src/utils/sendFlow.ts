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
