/**
 * Recording "the customer opened the quote" from any source, onto BOTH the
 * legacy quote (where the push trigger and the mirror read it) and the
 * documents mirror (where the app reads it).
 *
 * Two sources stamp email opens:
 *   - our own pixel (trackEmailOpen in index.ts), which Brevo's image proxy
 *     caches so repeat opens reach us only sometimes;
 *   - Brevo's `opened` / `unique_opened` webhook events, which arrive for
 *     every open and are already separated from proxy prefetches
 *     (`proxy_open`) on Brevo's side.
 *
 * Both write the same stamp shape (emailOpenPixel.buildEmailOpenStamp) under
 * the same one-write-per-minute throttle, so the derivation in
 * shared/document/customerOpened.ts and the push decision see one signal.
 *
 * The Firestore reads/writes are injected so the flow is testable; the
 * `withAdmin` bindings at the bottom are what production calls.
 */
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';

import {
  buildEmailOpenStamp,
  emailFirstOpenAfterMs,
  shouldWriteEmailOpen,
  type EmailOpenQuoteState,
  type EmailOpenStamp,
} from './emailOpenPixel';
import { customerOpenProjection } from './shared/document/customerOpened';
import { normaliseTimestamp } from './timestamps.helpers';

export interface QuoteRef {
  userId: string;
  quoteId: string;
}

export interface RecordEmailOpenDeps<TTimestamp, TIncrement> {
  readQuote: (ref: QuoteRef) => Promise<EmailOpenQuoteState | null>;
  writeStamp: (ref: QuoteRef, stamp: EmailOpenStamp<TTimestamp, TIncrement>) => Promise<void>;
  /** Called after the stamp lands so the mirror can carry the derived open. */
  afterWrite?: (ref: QuoteRef) => Promise<void>;
  serverTimestamp: (ms: number) => TTimestamp;
  increment: TIncrement;
}

export type RecordEmailOpenResult =
  | { written: true }
  | { written: false; reason: 'no-quote' | 'throttled' };

/**
 * Stamp one email open at `nowMs` on the quote. Idempotent under the
 * throttle: a second call inside EMAIL_OPEN_WRITE_THROTTLE_MS is a no-op.
 */
export async function recordEmailOpenOnQuote<TTimestamp, TIncrement>(
  deps: RecordEmailOpenDeps<TTimestamp, TIncrement>,
  ref: QuoteRef,
  nowMs: number,
): Promise<RecordEmailOpenResult> {
  const quote = await deps.readQuote(ref);
  if (!quote) return { written: false, reason: 'no-quote' };
  if (!shouldWriteEmailOpen({ now: nowMs, lastOpenedAtMs: quote.lastOpenedAtMs })) {
    return { written: false, reason: 'throttled' };
  }
  await deps.writeStamp(
    ref,
    buildEmailOpenStamp({
      hasFirstOpen: quote.hasFirstOpen,
      now: deps.serverTimestamp(nowMs),
      increment: deps.increment,
      firstOpenAfterMs: quote.hasFirstOpen ? null : emailFirstOpenAfterMs(nowMs, quote.sentAtMs),
    }),
  );
  await deps.afterWrite?.(ref);
  return { written: true };
}

// ---------------------------------------------------------------------------
// Production bindings
// ---------------------------------------------------------------------------

const db = () => admin.firestore();

/**
 * Push the customer-open slice of a legacy quote straight onto its
 * documents/{id} mirror. The open stamps never bump the legacy `updatedAt`,
 * and documentMirror's writeMirror skips any projection older than what is
 * on disk — so after any path that moved the mirror's updatedAt ahead of
 * the legacy row (the share-link mint, the terms snapshot, a Square link
 * rotation) an open would reach the push but never the app. Merge, no
 * updatedAt bump, and a missing mirror is left for the mirror trigger to
 * create — never half-built here.
 */
export async function projectCustomerOpenToDocument(
  userId: string,
  quoteId: string,
  legacy: FirebaseFirestore.DocumentData | undefined,
): Promise<void> {
  if (!legacy) return;
  const slice = Object.fromEntries(
    Object.entries(customerOpenProjection(legacy as any)).filter(([, v]) => v !== undefined),
  );
  if (Object.keys(slice).length === 0) return;
  try {
    await db().doc(`users/${userId}/documents/${quoteId}`).update(slice);
  } catch (err: any) {
    // NOT_FOUND (gRPC 5): no mirror yet — the next legacy write projects it whole.
    if (err?.code !== 5) functions.logger.warn('customer_open_projection_failed', { userId, quoteId, message: err?.message });
  }
}

/** Re-read the legacy quote after a stamp and carry the derived open to the mirror. */
export async function projectCustomerOpenFromLegacy(ref: QuoteRef): Promise<void> {
  const snap = await db().doc(`users/${ref.userId}/quotes/${ref.quoteId}`).get();
  await projectCustomerOpenToDocument(ref.userId, ref.quoteId, snap.data());
}

export const adminRecordEmailOpenDeps: RecordEmailOpenDeps<admin.firestore.Timestamp, admin.firestore.FieldValue> = {
  readQuote: async ({ userId, quoteId }) => {
    const snap = await db().doc(`users/${userId}/quotes/${quoteId}`).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    return {
      hasFirstOpen: data.emailFirstOpenedAt != null,
      lastOpenedAtMs: normaliseTimestamp(data.emailLastOpenedAt)?.getTime() ?? null,
      sentAtMs: normaliseTimestamp(data.sentAt)?.getTime() ?? null,
    };
  },
  writeStamp: async ({ userId, quoteId }, stamp) => {
    await db().doc(`users/${userId}/quotes/${quoteId}`).update(stamp as any);
  },
  afterWrite: projectCustomerOpenFromLegacy,
  serverTimestamp: (ms) => admin.firestore.Timestamp.fromMillis(ms),
  increment: admin.firestore.FieldValue.increment(1),
};
