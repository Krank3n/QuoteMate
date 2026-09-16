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

/** The most addresses one quote or invoice email goes to. */
export const MAX_EMAIL_RECIPIENTS = 5;

/**
 * Split whatever a tradie typed or pasted into the recipient field into
 * addresses: "a@x.com, b@y.com" or one per line or space-separated all read
 * the same. Trimmed, lower-cased, deduplicated, first occurrence wins the
 * order. Does NOT validate — the caller decides what to do with a bad entry.
 */
export function splitEmailList(text?: string | null): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,;\s]+/)) {
    const addr = raw.trim().toLowerCase();
    if (!addr || seen.has(addr)) continue;
    seen.add(addr);
    out.push(addr);
  }
  return out;
}

/** True when there is at least one address and every one of them is usable. */
export function isEmailList(list: string[]): boolean {
  return list.length > 0 && list.every((e) => isEmailAddress(e));
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
 * one thing we don't have and SMS is the one thing we can finish, SMS leads.
 *
 * With neither the order is moot; Email stays first, since the preview lets
 * the tradie type an address and SMS can't ask for a number.
 *
 * @param canSms SMS can actually be COMPLETED here — not just "there's a
 *   number on file". Web is the case that forces the distinction: it can't
 *   open a composer, so it copies the message and relies on an Alert.alert
 *   to say so, and react-native-web's Alert.alert is a no-op. Leading with a
 *   row that ends in a silent dead end is worse than leading with Email.
 */
export function orderSendOptions({
  hasEmail,
  canSms,
}: {
  hasEmail: boolean;
  canSms: boolean;
}): SendChannel[] {
  return !hasEmail && canSms ? ['sms', 'email'] : ['email', 'sms'];
}
