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

/**
 * Retirement date for the recovery sweep — six months after the incident.
 *
 * Claims arrive as a slow trickle (5 in the three weeks after the incident,
 * out of 107 wiped accounts), so the sweep is worth keeping while anyone might
 * still return: 14 unclaimed accounts have a payload waiting, and a returner
 * who gets an empty app is the worst possible re-onboarding. But 95% never
 * came back, so it should not run forever.
 *
 * Past this date the sweep no-ops without touching Firestore or Storage, and
 * `restoreRecoveredDocuments`, this module's payload handling, and the
 * `reclaimData/` bucket contents can all be deleted outright.
 */
export const RECLAIM_SWEEP_EXPIRY = new Date('2027-01-04T00:00:00Z');

/**
 * Whether the recovery sweep should do anything at all. Checked before any
 * read, so an expired sweep costs one comparison per invocation.
 */
export function isReclaimSweepActive(
  nowMs: number,
  expiry: Date = RECLAIM_SWEEP_EXPIRY,
): boolean {
  return nowMs < expiry.getTime();
}

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

// --- duplicate collapse ---------------------------------------------------
//
// The recovery source is the tradie's SENT mail, so a single quote surfaces
// once as the real quote email plus once per message it generated — the
// "sent to" / "accepted by" / "declined by" notifications and the two
// customer reminders. Every one of those carries the same dollar total, so
// the parse yields N records for one quote and the sweep wrote N documents
// (real example: one $88,279.18 quote landed twice, as `recovered-QU-178156`
// from reminder 1 and `recovered-idx25` from reminder 2, because reminder 2's
// subject carries no job name or quote number to key on).

/** Subjects that are lifecycle notifications, never a job title. */
const NOTIFICATION_TITLE_RE =
  /^\s*(?:\[TEST\]\s*)?(?:quote\s*#|reminder:\s*your\s+quote\b|following\s+up\s+on\s+your\s+quote\b|invoice\s+from\b)/i;

export function isNotificationDerivedTitle(title: string | undefined): boolean {
  return NOTIFICATION_TITLE_RE.test((title || '').trim());
}

function hasCompleteBreakdown(r: RecoveredQuoteRecord): boolean {
  return typeof r.materialsTotal === 'number' && typeof r.labourTotal === 'number';
}

function parsedDateMs(r: RecoveredQuoteRecord): number | null {
  if (!r.sentDate) return null;
  const ms = Date.parse(r.sentDate);
  return isNaN(ms) ? null : ms;
}

/** Richest record in an all-notification group: real quote number, then a
 *  money breakdown, then the most descriptive text. Ties keep input order. */
function bestOfGroup(group: RecoveredQuoteRecord[]): RecoveredQuoteRecord {
  const score = (r: RecoveredQuoteRecord) =>
    (r.quoteNumber ? 8 : 0) +
    (hasCompleteBreakdown(r) ? 4 : 0) +
    (r.description ? 2 : 0) +
    (r.jobTitle ? 1 : 0);
  return group.reduce((best, r) => (score(r) > score(best) ? r : best), group[0]);
}

/**
 * Fold a collapsed group's siblings into the surviving record. Only ever fills
 * fields the survivor is MISSING — a notification sibling's own values are
 * otherwise untrusted. Notably `quoteNumber` is never taken from a sibling:
 * the parse assigns those positionally and they are demonstrably wrong on
 * notification rows (a record titled "Quote #QU-177828 accepted by …" carried
 * quoteNumber QU-177805).
 */
function enrichFromSiblings(
  winner: RecoveredQuoteRecord,
  group: RecoveredQuoteRecord[],
): RecoveredQuoteRecord {
  const others = group.filter((r) => r !== winner);
  if (others.length === 0) return winner;
  const out: RecoveredQuoteRecord = { ...winner };

  // The original quote email always predates the notifications it triggered.
  const dates = group.map(parsedDateMs).filter((ms): ms is number => ms !== null);
  if (dates.length > 0) {
    out.sentDate = new Date(Math.min(...dates)).toISOString().slice(0, 10);
  }

  if (!out.customerEmail) out.customerEmail = others.find((r) => r.customerEmail)?.customerEmail;
  if (!out.customerName) out.customerName = others.find((r) => r.customerName)?.customerName;
  if (!out.description) out.description = others.find((r) => r.description)?.description;

  // Breakdown is taken as a coherent set from ONE sibling — never half from
  // each, which would produce a materials/labour split that never existed.
  if (!hasCompleteBreakdown(out)) {
    const donor = others.find(hasCompleteBreakdown);
    if (donor) {
      out.materialsTotal = donor.materialsTotal;
      out.labourTotal = donor.labourTotal;
      if (out.subtotal === undefined) out.subtotal = donor.subtotal;
      if (out.gst === undefined) out.gst = donor.gst;
    }
  }
  return out;
}

/**
 * Collapse notification-derived duplicates, preserving input order.
 *
 * Records are grouped by total alone — reminder emails are sent days after the
 * quote, so the dates differ and can't be part of the key. To stop that
 * over-merging genuinely distinct quotes that share a total, a group only
 * collapses around its NON-notification records:
 *
 *   - ≥1 real title  → keep every real record, drop the notification rows
 *                      (they are duplicates of one of those quotes)
 *   - 0 real titles  → keep the single richest notification row
 *
 * So five separate $200 quotes stay five quotes even if one of them generated
 * an "accepted by" email. Enrichment only runs when a group collapses to one
 * survivor; with multiple real records there is no way to tell which
 * notification belongs to which, so they are left untouched.
 *
 * Known limit: two genuine quotes with an identical total that BOTH survive
 * only as notification emails collapse to one. Rare, and preferred over
 * inflating a tradie's pipeline with phantom quotes.
 *
 * Records without a usable total are passed through untouched — they are not
 * duplicates of anything, and buildRecoveredQuoteDoc drops them anyway.
 */
export function dedupeRecoveredQuotes(records: RecoveredQuoteRecord[]): RecoveredQuoteRecord[] {
  const groups = new Map<string, RecoveredQuoteRecord[]>();
  const keyOf = (r: RecoveredQuoteRecord): string | null =>
    typeof r.total === 'number' && r.total > 0 ? round2(r.total).toFixed(2) : null;

  for (const r of records) {
    const key = keyOf(r);
    if (key === null) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(r);
    else groups.set(key, [r]);
  }

  const resolved = new Map<RecoveredQuoteRecord, RecoveredQuoteRecord>();
  for (const group of groups.values()) {
    const real = group.filter((r) => !isNotificationDerivedTitle(r.jobTitle));
    if (real.length === 0) {
      const winner = bestOfGroup(group);
      resolved.set(winner, enrichFromSiblings(winner, group));
    } else if (real.length === 1) {
      resolved.set(real[0], enrichFromSiblings(real[0], group));
    } else {
      for (const r of real) resolved.set(r, r);
    }
  }

  const out: RecoveredQuoteRecord[] = [];
  for (const r of records) {
    if (keyOf(r) === null) {
      out.push(r);
      continue;
    }
    const survivor = resolved.get(r);
    if (survivor) out.push(survivor);
  }
  return out;
}

/**
 * Make every built quote doc's id unique.
 *
 * Doc ids are keyed on the parsed quote number, and the sweep writes with
 * `{ merge: false }` — so two records sharing a quote number silently
 * OVERWRITE each other and the tradie loses a quote. This is not the
 * notification-duplicate case (those share a total and are collapsed by
 * dedupeRecoveredQuotes); these are distinct quotes whose numbers repeat,
 * either because a quote was revised and re-sent under the same number or
 * because the parse assigned numbers positionally. Real payloads carry up to
 * 12 collisions each, so without this the sweep drops that many quotes.
 *
 * The first occurrence keeps its natural id so existing restored accounts stay
 * addressable; later ones take a `-2`, `-3`, … suffix.
 */
export function assignUniqueQuoteDocIds(
  docs: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const taken = new Set<string>();
  return docs.map((doc) => {
    const baseId = String(doc.id);
    if (!taken.has(baseId)) {
      taken.add(baseId);
      return doc;
    }
    let n = 2;
    while (taken.has(`${baseId}-${n}`)) n += 1;
    const id = `${baseId}-${n}`;
    taken.add(id);
    const job = doc.job as Record<string, unknown> | undefined;
    return {
      ...doc,
      id,
      ...(job ? { job: { ...job, id: `${id}-job` } } : {}),
    };
  });
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
