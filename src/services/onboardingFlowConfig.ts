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

/** One read of config/onboarding.longFlow. Never throws. */
export async function readLongFlowFlag(): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, 'config', 'onboarding'));
    if (!snap.exists()) return false;
    return parseLongFlowFlag((snap.data() as { longFlow?: unknown } | undefined)?.longFlow);
  } catch {
    return false;
  }
}
