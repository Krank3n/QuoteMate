// Rebuilds quote + contact documents for accounts destroyed in the July 2026
// deletion incident, from data parsed out of their sent-quote emails
// (retained by the email provider). The parsed records live at
// reclaimData/{oldUid}.json in the default bucket.
//
// Injection is deliberately DELAYED and CONDITIONAL: the client's loadQuotes
// is cloud-wins-no-merge, so writing quotes at signup would make a returning
// device discard its (richer) local cache instead of re-uploading it. The
// sweep therefore waits ≥24h after the claim and skips accounts that already
// have pre-incident quote history (= a device restored the real thing).
//
// Pure builders here; Firestore/Storage orchestration lives in index.ts.

export interface RecoveredQuoteRecord {
  quoteNumber?: string;        // "QU-178296"
  customerName?: string;
  customerEmail?: string;
  sentDate?: string;           // "2026-05-01"
  jobTitle?: string;
  description?: string;
  materialsTotal?: number;
  labourTotal?: number;
  subtotal?: number;
  gst?: number;
  total?: number;
}

export interface RecoveredContactRecord {
  name: string;
  email?: string;
}

/** The date the deletion job first ran — history older than this proves a device restore. */
export const INCIDENT_DATE = new Date('2026-07-04T00:00:00Z');

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Build a Firestore quote document (client-schema-compatible) from a
 * recovered record. Returns null for records too thin to render (no total).
 *
 * Money shape: totals are STORED and trusted by the app on load; recompute
 * only happens if the user edits the quote. To stay consistent under a
 * recompute, the dollar breakdown is encoded as material lines (labour as a
 * line too, since laborRate/laborHours are unknown → 0), with markup 0.
 */
export function buildRecoveredQuoteDoc(
  rec: RecoveredQuoteRecord,
  index: number,
  tradieEmail: string,
): Record<string, unknown> | null {
  const total = typeof rec.total === 'number' && rec.total > 0 ? round2(rec.total) : null;
  if (!total) return null;

  const hasBreakdown =
    typeof rec.materialsTotal === 'number' && typeof rec.labourTotal === 'number';
  const gst = typeof rec.gst === 'number' ? round2(rec.gst) : null;
  // With a parsed GST the source quote was GST-exclusive (total = subtotal*1.1);
  // without one, treat the total as GST-inclusive so stored figures stay coherent.
  const pricesIncludeGst = gst === null;
  const subtotal = rec.subtotal
    ? round2(rec.subtotal)
    : pricesIncludeGst
      ? total
      : round2(total / 1.1);

  const materials: Array<Record<string, unknown>> = [];
  const line = (id: string, name: string, amount: number) => ({
    id,
    name,
    quantity: 1,
    unit: 'each',
    price: amount,
    totalPrice: amount,
    // price > 0 && !manualPriceOverride → the pricing pipeline never touches it
    manualPriceOverride: false,
    pricingSource: 'manual',
  });
  if (hasBreakdown) {
    if (rec.materialsTotal! > 0) materials.push(line(`recovered-${index}-m`, 'Materials (recovered)', round2(rec.materialsTotal!)));
    if (rec.labourTotal! > 0) materials.push(line(`recovered-${index}-l`, 'Labour (recovered)', round2(rec.labourTotal!)));
  }
  if (materials.length === 0) {
    materials.push(line(`recovered-${index}-t`, 'Recovered quote total', subtotal));
  }

  const sentDate = rec.sentDate && !isNaN(Date.parse(rec.sentDate))
    ? new Date(`${rec.sentDate}T00:00:00Z`)
    : INCIDENT_DATE;

  const customerEmail =
    rec.customerEmail && rec.customerEmail.toLowerCase() !== tradieEmail.toLowerCase()
      ? rec.customerEmail
      : undefined;

  const num = rec.quoteNumber ? rec.quoteNumber.replace(/[^A-Za-z0-9-]/g, '') : `idx${index}`;
  return {
    id: `recovered-${num}`,
    ...(rec.quoteNumber ? { quoteNumber: rec.quoteNumber } : {}),
    customerName: rec.customerName || 'Recovered customer',
    ...(customerEmail ? { customerEmail } : {}),
    job: {
      id: `recovered-${num}-job`,
      name: rec.jobTitle || 'Recovered quote',
      description: rec.description || '',
    },
    materials,
    laborRate: 0,
    laborHours: 0,
    laborTotal: 0,
    materialsSubtotal: subtotal,
    markup: 0,
    markupAmount: 0,
    subtotal,
    gst: gst ?? round2(total - total / 1.1),
    total,
    pricesIncludeGst,
    status: 'sent',
    createdAt: sentDate,
    updatedAt: sentDate,
    restoredFromIncident: 'incident-2026-07',
  };
}

/** Build a contact doc (client Contact schema) from a recovered record. */
export function buildRecoveredContactDoc(
  rec: RecoveredContactRecord,
  index: number,
  nowIso: string,
): Record<string, unknown> | null {
  const name = (rec.name || '').trim();
  if (name.length < 2) return null;
  return {
    id: `recovered-contact-${index}`,
    name,
    ...(rec.email ? { email: rec.email } : {}),
    source: 'quote',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

/**
 * Whether the sweep should inject for this account:
 *  - claim must be ≥ minAgeMs old (give a returning device time to restore),
 *  - never twice,
 *  - and only when no pre-incident quote history exists (any quote created
 *    before the incident proves a device restored the real data — injecting
 *    would duplicate it).
 */
export function shouldInjectRecoveredDocs(opts: {
  claimedAtMs: number | null;
  alreadyRestored: boolean;
  hasPreIncidentQuotes: boolean;
  nowMs: number;
  minAgeMs?: number;
}): boolean {
  const { claimedAtMs, alreadyRestored, hasPreIncidentQuotes, nowMs } = opts;
  const minAge = opts.minAgeMs ?? 24 * 60 * 60 * 1000;
  if (!claimedAtMs) return false;
  if (alreadyRestored) return false;
  if (hasPreIncidentQuotes) return false;
  return nowMs - claimedAtMs >= minAge;
}
