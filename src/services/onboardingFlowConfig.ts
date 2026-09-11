/**
 * Remote kill switch for the shape of onboarding.
 *
 * Firestore document: config/onboarding
 * Field:
 *   longFlow: boolean — true restores the old seven/eight-step wizard.
 *
 * Onboarding is one step now (name + trade, then straight into the first
 * quote). If that turns out to cost us something the funnel can see, flipping
 * this field to true puts the long flow back on every device on its next cold
 * start — no build, no store review, no over-the-air publish.
 *
 * Fails SHORT, deliberately, in every ambiguous case: missing document,
 * missing field, a non-boolean value, offline, or a rules change that breaks
 * the read. The short flow is the one we want people on; a flag that fails the
 * other way would quietly hand the seven-step wizard to anyone whose first
 * launch happens on bad reception, which is exactly the tradie we can least
 * afford to lose. config/{docId} is world-readable (firestore.rules:181).
 */

import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

/** Only a literal `true` turns the long flow back on. */
export function parseLongFlowFlag(raw: unknown): boolean {
  return raw === true;
}

/**
 * How long the read may hold onboarding up. Firestore's getDoc waits on the
 * server with no deadline of its own, and this read sits in front of draft
 * hydration: a tradie on one bar of reception would otherwise be typing into
 * a screen whose saved draft could land on top of them seconds later. Past
 * this, the short flow wins.
 */
export const LONG_FLOW_READ_TIMEOUT_MS = 3000;

/** One read of config/onboarding.longFlow, bounded. Never throws. */
export async function readLongFlowFlag(
  timeoutMs: number = LONG_FLOW_READ_TIMEOUT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const read = (async () => {
    const snap = await getDoc(doc(db, 'config', 'onboarding'));
    if (!snap.exists()) return false;
    return parseLongFlowFlag((snap.data() as { longFlow?: unknown } | undefined)?.longFlow);
  })();
  try {
    return await Promise.race([read, timeout]);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
    // A read that loses the race and then rejects must not surface as an
    // unhandled rejection.
    void read.catch(() => undefined);
  }
}
