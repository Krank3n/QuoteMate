/**
 * Which Brevo webhook events count as the customer opening a quote email,
 * and which quote they belong to.
 *
 * Brevo fires `opened` / `unique_opened` for a human open and, separately,
 * `proxy_open` / `unique_proxy_open` for a privacy-proxy prefetch (Apple
 * Mail Privacy Protection and friends). Only the human events feed the
 * customer-open signal. The emailLog row written at send carries
 * `documentId` + `userId` for customer-facing quote sends; rows without
 * them (older sends, lifecycle mail, test sends to the tradie, blocked
 * sends) are ignored.
 *
 * Pure so the filter is testable; the webhook in adminCrm.ts calls it with
 * the emailLog row it just updated.
 */
export const BREVO_HUMAN_OPEN_EVENTS: ReadonlySet<string> = new Set(['opened', 'unique_opened']);

export interface BrevoOpenLogRow {
  userId?: unknown;
  documentId?: unknown;
  tags?: unknown;
  status?: unknown;
}

export interface BrevoOpenTarget {
  userId: string;
  quoteId: string;
}

export function isBrevoHumanOpen(event: string): boolean {
  return BREVO_HUMAN_OPEN_EVENTS.has(String(event || '').toLowerCase());
}

/**
 * The quote a Brevo open event should stamp, or null when the event is not a
 * human open of a customer-facing quote email.
 */
export function brevoOpenTarget(event: string, row: BrevoOpenLogRow | null | undefined): BrevoOpenTarget | null {
  if (!isBrevoHumanOpen(event)) return null;
  if (!row) return null;
  const tags = Array.isArray(row.tags) ? row.tags.map(String) : [];
  if (!tags.includes('quote-to-client')) return null;
  if (tags.some((t) => t.startsWith('blocked:'))) return null;
  if (row.status === 'blocked') return null;
  const userId = typeof row.userId === 'string' ? row.userId.trim() : '';
  const quoteId = typeof row.documentId === 'string' ? row.documentId.trim() : '';
  if (!userId || !quoteId) return null;
  return { userId, quoteId };
}
