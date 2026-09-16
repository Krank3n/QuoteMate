/**
 * Drop every stored Square pay link a user has once the connection those
 * links were minted under stops being the one that would get paid.
 *
 * A hosted checkout link belongs to a Square merchant. Every reader on the
 * phone and the server (the email fallback, SMS and share text, the exported
 * PDF, the follow-up sheet, the acceptance page) reuses the link it finds on
 * the doc rather than minting again. So after a disconnect, a reconnect to a
 * different merchant or location, or Square reporting that the account can't
 * charge cards, those readers keep handing customers a link that pays the
 * wrong seller or lands on "not accepting payments". Clearing the fields is
 * what makes every path mint fresh, and the readers need no changes.
 *
 * The unified `documents` collection is the source of truth; the legacy
 * `quotes` and `invoices` mirrors carry copies for older clients, so they
 * are swept too. The active link is archived, not lost, for the ledger.
 */
import * as admin from 'firebase-admin';

export type LinkInvalidationReason = 'disconnected' | 'connection_changed' | 'square_not_ready';

/** Every field a reader treats as "a link already exists". */
export const DOCUMENT_LINK_FIELDS = [
  'activePaymentLink',
  'squarePaymentLinkId',
  'squarePaymentLinkUrl',
  'depositPaymentLinkId',
  'depositPaymentLinkUrl',
  'depositPaymentLinkCreatedAt',
  'depositPaymentLinkAmount',
  'fullPaymentLinkId',
  'fullPaymentLinkUrl',
  'fullPaymentLinkCreatedAt',
  'fullPaymentLinkAmount',
] as const;

export const QUOTE_LINK_FIELDS = [
  'squarePaymentLinkId',
  'squarePaymentLinkUrl',
  'depositPaymentLinkId',
  'depositPaymentLinkUrl',
  'depositPaymentLinkCreatedAt',
  'depositPaymentLinkAmount',
  'fullPaymentLinkId',
  'fullPaymentLinkUrl',
  'fullPaymentLinkCreatedAt',
  'fullPaymentLinkAmount',
] as const;

export const INVOICE_LINK_FIELDS = ['squarePaymentLinkId', 'squarePaymentLinkUrl'] as const;

export interface SweepCounts {
  documents: number;
  quotes: number;
  invoices: number;
}

/** The slice of Firestore the sweep touches; a test hands in a fake. */
export interface LinkSweepDb {
  collection(path: string): {
    select(...fields: string[]): { get(): Promise<{ docs: Array<{ ref: unknown; data(): Record<string, unknown> }> }> };
  };
  batch(): { update(ref: unknown, data: Record<string, unknown>): unknown; commit(): Promise<unknown> };
}

/** Firestore batches take 500 writes; leave headroom. */
const BATCH_LIMIT = 400;

/**
 * True when a fresh connection would pay a different Square account than the
 * one the stored links were minted under. A plain re-authorisation of the same
 * merchant and location keeps its links.
 */
export function squareConnectionChanged(
  previous: { merchantId?: string | null; locationId?: string | null } | null | undefined,
  next: { merchantId?: string | null; locationId?: string | null },
): boolean {
  if (!previous) return false;
  if ((previous.merchantId ?? null) !== (next.merchantId ?? null)) return true;
  return (previous.locationId ?? null) !== (next.locationId ?? null);
}

export async function invalidateUserPaymentLinks(
  db: LinkSweepDb,
  userId: string,
  reason: LinkInvalidationReason,
  now: number = Date.now(),
): Promise<SweepCounts> {
  const del = admin.firestore.FieldValue.delete();
  const counts: SweepCounts = { documents: 0, quotes: 0, invoices: 0 };

  let batch = db.batch();
  let pending = 0;
  const flush = async () => {
    if (pending === 0) return;
    await batch.commit();
    batch = db.batch();
    pending = 0;
  };

  const sweep = async (
    key: keyof SweepCounts,
    fields: readonly string[],
    extra?: (data: Record<string, unknown>) => Record<string, unknown>,
  ) => {
    const snap = await db.collection(`users/${userId}/${key}`).select(...fields).get();
    for (const doc of snap.docs) {
      const data = doc.data();
      const present = fields.filter((f) => data[f] !== undefined && data[f] !== null);
      if (present.length === 0) continue;
      const update: Record<string, unknown> = {};
      for (const f of present) update[f] = del;
      Object.assign(update, extra?.(data) ?? {});
      batch.update(doc.ref, update);
      counts[key] += 1;
      pending += 1;
      if (pending >= BATCH_LIMIT) await flush();
    }
  };

  await sweep('documents', DOCUMENT_LINK_FIELDS, (data) => {
    const active = data.activePaymentLink;
    if (!active || typeof active !== 'object') return {};
    return {
      archivedPaymentLinks: admin.firestore.FieldValue.arrayUnion({
        ...(active as Record<string, unknown>),
        archivedAt: now,
        archivedReason: reason,
      }),
    };
  });
  await sweep('quotes', QUOTE_LINK_FIELDS);
  await sweep('invoices', INVOICE_LINK_FIELDS);
  await flush();

  console.log('[square] payment links invalidated', { userId, reason, ...counts });
  return counts;
}
