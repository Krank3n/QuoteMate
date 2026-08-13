/**
 * One-shot migration: move every stored document onto canonical labour units
 * (hours, dollars-per-hour) and repair the documents the day-rate bug inflated.
 *
 *   cd functions
 *   npx ts-node scripts/healLabourUnits.ts                      # dry-run, all users
 *   npx ts-node scripts/healLabourUnits.ts --uid=<uid>          # dry-run, one user
 *   npx ts-node scripts/healLabourUnits.ts --uid=<uid> --doc=<docId>
 *   add --commit to write
 *   add --include-sent to also repair documents a customer has already seen
 *
 * Two separate jobs, deliberately kept apart:
 *
 *   NORMALISE (money-preserving) — a section stored as "0.19 days @ $5,440/day"
 *     becomes "1.52 hours @ $680/hour". Same dollars, one unit. Applied to
 *     every document, including sent ones, because it cannot change a price.
 *
 *   REPAIR (money-changing) — a document whose effective hourly rate is 8× the
 *     business's own configured rate is the ×8 day-rate bug (see
 *     LaborMarkupScreen's old hydrate/save cycle). The rate is divided by 8 and
 *     every total recomputed. Drafts only unless --include-sent is passed,
 *     because a sent quote's price has already been communicated to a customer
 *     and that is a conversation, not a migration.
 *
 * Safety: before changing anything, the script recomputes the document's totals
 * from its own stored parts. If that recompute does not reproduce what is
 * already stored, the document is skipped and reported — it means this script's
 * understanding of the math disagrees with whatever wrote the record, and
 * guessing would be worse than leaving it alone. After changing anything, the
 * result is re-checked with the shared integrity checker.
 */

import * as admin from 'firebase-admin';
import {
  normaliseLabourToHours,
  rateToHourly,
  totalLabourHours,
} from '../src/shared/document/labourUnits';
import { checkDocumentIntegrity } from '../src/shared/document/integrityCheck';

/** The bug always lands on exactly this multiple — anything else is a human decision. */
const BUG_MULTIPLE = 8;
const MULTIPLE_TOLERANCE = 0.02;
const DOLLAR_TOLERANCE = 0.5;

type Outcome = 'canonical' | 'normalised' | 'repaired' | 'skipped_unverifiable' | 'skipped_sent' | 'flagged';

interface DocSummary {
  uid: string;
  business: string;
  docId: string;
  number: string;
  type: string;
  stage: string;
  outcome: Outcome;
  detail: string;
  totalBefore: number;
  totalAfter: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const CUSTOMER_FACING_STAGES = new Set([
  'quote_sent', 'quote_viewed', 'quote_accepted', 'quote_rejected',
  'invoice_sent', 'invoice_viewed', 'invoice_paid', 'paid',
]);

export function isCustomerFacing(d: any): boolean {
  if (d?.sentAt || d?.acceptedAt || d?.invoicedAt) return true;
  if (num(d?.paidTotal) > 0) return true;
  return CUSTOMER_FACING_STAGES.has(String(d?.stage || ''));
}

/**
 * Mirror of calculateDocumentTotals (src/utils/documentCalculator.ts). Kept in
 * step by the verification pass below: every document is round-tripped through
 * this before being touched, so a divergence shows up as a skip rather than a
 * silent bad write.
 */
export function recomputeTotals(d: any): {
  materialsSubtotal: number; laborTotal: number; subtotal: number;
  markupAmount: number; gst: number; total: number;
} {
  const materials = Array.isArray(d.materials) ? d.materials : [];
  const sections = Array.isArray(d.sections) ? d.sections : [];
  const materialsSubtotal = materials.reduce((s: number, m: any) => s + num(m.totalPrice), 0);
  const laborTotal = sections.length > 0
    ? sections.reduce((s: number, x: any) => s + num(x.laborTotal), 0) + num(d.laborExtraHours) * num(d.laborRate)
    : num(d.laborRate) * num(d.laborHours);
  const subtotal = materialsSubtotal + laborTotal;
  const markupAmount = materialsSubtotal * (num(d.markup) / 100)
    + laborTotal * (num(d.laborMarkup ?? d.markup) / 100);
  const travelAdjustmentAmount = subtotal * (num(d.travelAdjustment) / 100);
  const subtotalWithMarkup = subtotal + markupAmount + travelAdjustmentAmount;
  const gstRegistered = d.gstRegistered !== false;
  const pricesIncludeGst = d.pricesIncludeGst === true;
  const total = !gstRegistered || pricesIncludeGst ? subtotalWithMarkup : subtotalWithMarkup * 1.1;
  const gst = !gstRegistered ? 0 : pricesIncludeGst ? total - total / 1.1 : subtotalWithMarkup * 0.1;
  return {
    materialsSubtotal: round2(materialsSubtotal),
    laborTotal: round2(laborTotal),
    subtotal: round2(subtotal),
    markupAmount: round2(markupAmount),
    gst: round2(gst),
    total: round2(total),
  };
}

/** Can we reproduce what is stored? If not, hands off. */
export function totalsAreVerifiable(d: any): boolean {
  if (typeof d.total !== 'number') return false;
  const recomputed = recomputeTotals(d);
  return Math.abs(recomputed.total - num(d.total)) <= DOLLAR_TOLERANCE
    && Math.abs(recomputed.laborTotal - num(d.laborTotal)) <= DOLLAR_TOLERANCE;
}

/** The multiple by which this document over-bills its own business rate. */
export function rateMultiple(d: any, businessHourlyRate: number): number | null {
  if (!(businessHourlyRate > 0)) return null;
  const sections = Array.isArray(d.sections) ? d.sections : [];
  const rateSection = sections.find((s: any) => num(s.laborRate) > 0);
  const effective = rateSection
    ? rateToHourly(rateSection.laborRate, rateSection.laborUnit)
    : rateToHourly(d.laborRate, d.laborUnit);
  if (!(effective > 0)) return null;
  return effective / businessHourlyRate;
}

/** Divide every labour rate by `divisor` and rebuild the totals around it. */
export function repairRate(d: any, divisor: number): any {
  const sections = (d.sections || []).map((s: any) => {
    const laborRate = round2(num(s.laborRate) / divisor);
    const laborHours = num(s.laborHours);
    const multiplier = num(s.multiplier) || 1;
    return { ...s, laborRate, laborTotal: round2(laborHours * laborRate * multiplier) };
  });
  const out: any = {
    ...d,
    ...(d.sections ? { sections } : {}),
    laborRate: round2(num(d.laborRate) / divisor),
  };
  Object.assign(out, recomputeTotals(out));
  if (num(out.paidTotal) >= 0) {
    out.balanceDue = round2(Math.max(0, num(out.total) - num(out.paidTotal)));
  }
  return out;
}

/** Keep JobSpec.estimatedHours honest once the units are canonical. */
export function syncEstimatedHours(d: any): any {
  if (!d.job || typeof d.job.estimatedHours !== 'number') return d;
  const hours = Math.round(totalLabourHours(d));
  if (!Number.isFinite(hours) || hours === d.job.estimatedHours) return d;
  return { ...d, job: { ...d.job, estimatedHours: hours } };
}

/**
 * Apply the same canonical labour fields to the legacy quotes/invoices record
 * this document mirrors. Only the labour + totals fields are touched, and only
 * if the legacy record exists — everything else about the legacy shape is left
 * exactly as the app wrote it.
 */
async function healLegacyCopy(uid: string, docId: string, next: any): Promise<void> {
  const db = admin.firestore();
  for (const collection of ['quotes', 'invoices']) {
    const ref = db.doc(`users/${uid}/${collection}/${docId}`);
    const snap = await ref.get();
    if (!snap.exists) continue;
    await ref.update({
      ...(next.sections ? { sections: next.sections } : {}),
      laborRate: next.laborRate,
      laborHours: next.laborHours,
      laborUnit: 'hours',
      labourDisplayUnit: next.labourDisplayUnit ?? 'hours',
      laborExtraHours: next.laborExtraHours ?? 0,
      laborTotal: next.laborTotal,
      materialsSubtotal: next.materialsSubtotal,
      subtotal: next.subtotal,
      markupAmount: next.markupAmount,
      gst: next.gst,
      total: next.total,
      labourUnitsHealedAt: Date.now(),
    });
  }
}

/**
 * Bring a legacy quotes/invoices record into line with its already-canonical
 * unified document. No-op when the legacy copy is already canonical, so the
 * common path costs one read and no write.
 */
async function healLegacyCopyIfStale(uid: string, docId: string, canonicalDoc: any): Promise<boolean> {
  const db = admin.firestore();
  let healed = false;
  for (const collection of ['quotes', 'invoices']) {
    const ref = db.doc(`users/${uid}/${collection}/${docId}`);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const legacy = snap.data() as any;
    const normalisedLegacy = normaliseLabourToHours(legacy);
    if (normalisedLegacy === legacy) continue; // already canonical
    await ref.update({
      ...(canonicalDoc.sections ? { sections: canonicalDoc.sections } : {}),
      laborRate: canonicalDoc.laborRate,
      laborHours: canonicalDoc.laborHours,
      laborUnit: 'hours',
      labourDisplayUnit: canonicalDoc.labourDisplayUnit ?? 'hours',
      laborExtraHours: canonicalDoc.laborExtraHours ?? 0,
      laborTotal: canonicalDoc.laborTotal,
      materialsSubtotal: canonicalDoc.materialsSubtotal,
      subtotal: canonicalDoc.subtotal,
      markupAmount: canonicalDoc.markupAmount,
      gst: canonicalDoc.gst,
      total: canonicalDoc.total,
      labourUnitsHealedAt: Date.now(),
    });
    healed = true;
  }
  return healed;
}

async function healDoc(
  uid: string,
  business: string,
  businessHourlyRate: number,
  snap: FirebaseFirestore.QueryDocumentSnapshot,
  opts: { commit: boolean; includeSent: boolean },
): Promise<DocSummary> {
  const before = snap.data() as any;
  const base: DocSummary = {
    uid,
    business,
    docId: snap.id,
    number: before.number || '?',
    type: before.type || 'doc',
    stage: before.stage || '?',
    outcome: 'canonical',
    detail: '',
    totalBefore: num(before.total),
    totalAfter: num(before.total),
  };

  const multiple = rateMultiple(before, businessHourlyRate);
  const looksInflated = multiple !== null && Math.abs(multiple - BUG_MULTIPLE) <= BUG_MULTIPLE * MULTIPLE_TOLERANCE;
  const normalised = normaliseLabourToHours(before);
  const needsNormalise = normalised !== before;

  // The legacy copy is healed against whatever the unified document says, even
  // when the unified document needs no work itself. That is the common case:
  // the first migration fixed `documents` and left `quotes`/`invoices` stale,
  // so 147 legacy records were still day-shaped afterwards. An old client
  // reading those sees the wrong money regardless of what the mirror does on
  // the way back.
  if (opts.commit && !needsNormalise && !looksInflated) {
    await healLegacyCopyIfStale(uid, snap.id, before);
  }

  if (!needsNormalise && !looksInflated) {
    // Still worth surfacing a rate that is wildly off but not the known bug.
    if (multiple !== null && multiple > 3) {
      return { ...base, outcome: 'flagged', detail: `effective rate is ${round2(multiple)}× the business rate — not the ×8 signature, left alone` };
    }
    return base;
  }

  if (!totalsAreVerifiable(before)) {
    return { ...base, outcome: 'skipped_unverifiable', detail: 'stored totals could not be reproduced from stored parts' };
  }

  let next: any = normalised;
  let outcome: Outcome = needsNormalise ? 'normalised' : 'canonical';
  let detail = needsNormalise ? 'day-shaped labour converted to hours (money unchanged)' : '';

  if (looksInflated) {
    if (isCustomerFacing(before) && !opts.includeSent) {
      return {
        ...base,
        outcome: 'skipped_sent',
        detail: `${round2(multiple!)}× the business rate but already sent to a customer — re-run with --include-sent once the tradie has been told`,
      };
    }
    next = repairRate(next, BUG_MULTIPLE);
    outcome = 'repaired';
    detail = `rate divided by ${BUG_MULTIPLE} (was ${round2(multiple!)}× the business rate of $${businessHourlyRate}/h)`
      + (needsNormalise ? '; day-shaped labour converted to hours' : '');
  } else {
    // Normalisation alone must not move a dollar — assert that.
    const after = recomputeTotals(next);
    if (Math.abs(after.total - num(before.total)) > DOLLAR_TOLERANCE) {
      return { ...base, outcome: 'skipped_unverifiable', detail: `normalisation moved the total by $${round2(after.total - num(before.total))} — refusing to write` };
    }
  }

  next = syncEstimatedHours(next);

  // Verify the result before writing it. Documents arrive with their own
  // pre-existing problems (drifted section totals, a rate the tradie set high
  // by hand) and fixing those is not this migration's job — so compare the
  // issue list before and after and block only on anything we INTRODUCED.
  const countByCode = (doc: any) => {
    const counts: Record<string, number> = {};
    for (const i of checkDocumentIntegrity(doc, { businessHourlyRate })) {
      counts[i.code] = (counts[i.code] || 0) + 1;
    }
    return counts;
  };
  const issuesBefore = countByCode(before);
  const issuesAfter = countByCode(next);
  const introduced = Object.entries(issuesAfter)
    .filter(([code, count]) => count > (issuesBefore[code] || 0))
    .map(([code]) => code);
  if (introduced.length > 0) {
    return {
      ...base,
      outcome: 'skipped_unverifiable',
      detail: `heal would introduce: ${introduced.join(', ')}`,
    };
  }
  const stillOpen = Object.keys(issuesAfter).filter((c) => c !== 'estimated_hours_drift');

  if (opts.commit) {
    await snap.ref.update({
      sections: next.sections ?? admin.firestore.FieldValue.delete(),
      laborRate: next.laborRate,
      laborHours: next.laborHours,
      laborUnit: 'hours',
      labourDisplayUnit: next.labourDisplayUnit ?? 'hours',
      laborExtraHours: next.laborExtraHours ?? 0,
      laborTotal: next.laborTotal,
      materialsSubtotal: next.materialsSubtotal,
      subtotal: next.subtotal,
      markupAmount: next.markupAmount,
      gst: next.gst,
      total: next.total,
      ...(next.balanceDue !== undefined ? { balanceDue: next.balanceDue } : {}),
      ...(next.job ? { job: next.job } : {}),
      labourUnitsHealedAt: Date.now(),
    });

    // Heal the LEGACY copy too. The unified document is a mirror of
    // users/{uid}/quotes|invoices/{id}, and onQuoteWritten/onInvoiceWritten
    // project that legacy record over the top whenever a client touches it.
    // Healing only the unified side leaves a day-shaped original that a pre-fix
    // client re-propagates — that is what reverted 21 of the 161 documents
    // healed on 2026-08-10. The mirror now normalises defensively as well, but
    // the stale source still has to go.
    await healLegacyCopy(snap.ref.parent.parent!.id, snap.id, next);
  }

  return {
    ...base,
    outcome,
    detail: detail + (stillOpen.length > 0 ? ` · pre-existing issues left alone: ${stillOpen.join(', ')}` : ''),
    totalAfter: num(next.total),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes('--commit');
  const includeSent = args.includes('--include-sent');
  const uidArg = args.find((a) => a.startsWith('--uid='));
  const docArg = args.find((a) => a.startsWith('--doc='));
  const onlyUid = uidArg ? uidArg.slice('--uid='.length) : undefined;
  const onlyDoc = docArg ? docArg.slice('--doc='.length) : undefined;

  if (onlyDoc && !onlyUid) {
    console.error('--doc requires --uid=<uid> (documents live under a user).');
    process.exit(1);
  }

  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'hansendev' });
  }
  const db = admin.firestore();

  console.log('\n=== Heal labour units → canonical hours ===');
  console.log(`Mode: ${commit ? 'COMMIT (will write)' : 'DRY-RUN (no writes)'}`);
  console.log(`Customer-facing documents: ${includeSent ? 'INCLUDED in rate repair' : 'normalise only'}`);
  if (onlyUid) console.log(`Scope: uid=${onlyUid}${onlyDoc ? `, doc=${onlyDoc}` : ''}`);

  // Chunking. A full walk reads every document plus both legacy copies, which
  // is slow enough that a single invocation gets killed part-way — and a killed
  // run still exits 0 with no summary, which reads exactly like success. Run it
  // in slices instead: --skip=0 --take=100, then 100, then 200…  Each slice is
  // short enough to finish and print, and the whole thing stays resumable.
  const skipArg = args.find((a) => a.startsWith('--skip='));
  const takeArg = args.find((a) => a.startsWith('--take='));
  const skip = skipArg ? Number(skipArg.slice('--skip='.length)) : 0;
  const take = takeArg ? Number(takeArg.slice('--take='.length)) : Infinity;

  const allUids = onlyUid
    ? [onlyUid]
    : (await db.collection('users').get()).docs.map((u) => u.id);
  const uids = onlyUid ? allUids : allUids.slice(skip, skip + take);
  console.log(
    `Walking ${uids.length} of ${allUids.length} user${allUids.length === 1 ? '' : 's'}` +
    (onlyUid ? '' : ` (skip=${skip} take=${take === Infinity ? 'all' : take})`) + '…\n',
  );

  const results: DocSummary[] = [];
  for (const uid of uids) {
    const settings = (await db.doc(`users/${uid}/settings/business`).get()).data() as any;
    const business = settings?.businessName || uid.slice(0, 8);
    const businessHourlyRate = num(settings?.defaultLaborRate);
    const docs = onlyDoc
      ? [await db.doc(`users/${uid}/documents/${onlyDoc}`).get()]
      : (await db.collection(`users/${uid}/documents`).get()).docs;
    for (const snap of docs) {
      if (!snap.exists) continue;
      results.push(await healDoc(uid, business, businessHourlyRate, snap as any, { commit, includeSent }));
    }
  }

  const byOutcome = (o: Outcome) => results.filter((r) => r.outcome === o);
  const report = (title: string, rows: DocSummary[]) => {
    if (rows.length === 0) return;
    console.log(`\n--- ${title} (${rows.length}) ---`);
    for (const r of rows) {
      const money = r.totalAfter !== r.totalBefore
        ? `  $${r.totalBefore.toFixed(2)} → $${r.totalAfter.toFixed(2)}`
        : '';
      console.log(`  ${r.business} · ${r.number} · ${r.type}/${r.stage}${money}`);
      if (r.detail) console.log(`      ${r.detail}`);
    }
  };

  report('REPAIRED — rate was 8× the business rate', byOutcome('repaired'));
  report('NORMALISED — days converted to hours, money unchanged', byOutcome('normalised'));
  report('SKIPPED — customer-facing, needs a human first', byOutcome('skipped_sent'));
  report('SKIPPED — could not verify, left untouched', byOutcome('skipped_unverifiable'));
  report('FLAGGED — unusual rate, not the known bug', byOutcome('flagged'));

  console.log('\n--- Summary ---');
  console.log(`  Documents scanned:     ${results.length}`);
  console.log(`  Already canonical:     ${byOutcome('canonical').length}`);
  console.log(`  Normalised:            ${byOutcome('normalised').length}`);
  console.log(`  Repaired (money):      ${byOutcome('repaired').length}`);
  console.log(`  Skipped (sent):        ${byOutcome('skipped_sent').length}`);
  console.log(`  Skipped (unverified):  ${byOutcome('skipped_unverifiable').length}`);
  console.log(`  Flagged for review:    ${byOutcome('flagged').length}`);
  console.log(commit ? '\nDone.' : '\nDRY-RUN done. Re-run with --commit to write.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
