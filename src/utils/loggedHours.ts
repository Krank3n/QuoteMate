/**
 * Charging logged hours on a document — the "you logged 14.5 h, the invoice
 * charges 12 h" offer on an invoice.
 *
 * The change is the same one the labour screen makes when the tradie types a
 * new total: on a document with sections the difference goes into
 * laborExtraHours (shown as "Extra labour" / "Labour adjustment"), billed at
 * the document's own rate, so every quoted section keeps its hours; without
 * sections the top-level hours move.
 *
 * The offer is only made where "logged hours × one hourly rate" IS the
 * labour. Anything else — a lump-sum section, a work-item line, sections at
 * different rates, no hours quoted at all — means some of the logged time is
 * already paid for inside a price, and charging it again would bill it twice.
 * Nor is it made once money has been taken: a deposit is credited against
 * the invoice total at conversion, and recalculating would charge it again.
 */

import type { Document } from '../types/document';
import { normaliseLabourToHours } from '../../shared/document/labourUnits';
import { isWorkItem } from '../../shared/document/lumpSum';
import { labourHoursOnDocument, sectionHours } from './labourEditor';
import { updateDocumentCalculations } from './documentCalculator';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Closer than this and the offer isn't worth a tap (six minutes). */
export const LOGGED_HOURS_TOLERANCE = 0.1;

type LabourDoc = Pick<
  Document,
  'laborHours' | 'laborRate' | 'laborUnit' | 'labourDisplayUnit' | 'laborExtraHours' | 'sections'
> & {
  materials?: Document['materials'];
  quotedLaborHours?: number;
};

/**
 * The one $/hour all of this document's labour is charged at, or 0 when
 * there isn't one: no rate, a lump-sum section, a work-item line, or hourly
 * sections at different rates (an apprentice and a sparky on one quote).
 */
export function hourlyRateOf(rawDoc: LabourDoc): number {
  const doc = normaliseLabourToHours(rawDoc);
  const rate = doc.laborRate > 0 ? doc.laborRate : 0;
  if (!rate) return 0;
  if ((doc.materials ?? []).some((m) => isWorkItem(m))) return 0;
  const sections = doc.sections ?? [];
  if (sections.some((s) => s.pricing === 'lumpSum')) return 0;
  // Every section that carries hours has to be at the document's rate —
  // laborExtraHours is billed at the document rate, so a mismatch means
  // the charge would land at a price the tradie never set for that work.
  const mismatched = sections.some((s) => sectionHours(s) > 0 && Math.abs((s.laborRate || 0) - rate) > 0.005);
  return mismatched ? 0 : rate;
}

/** The hours the job was quoted at — the stamp once hours were charged. */
export function quotedHoursOf(doc: LabourDoc): number {
  return typeof doc.quotedLaborHours === 'number' && doc.quotedLaborHours > 0
    ? doc.quotedLaborHours
    : labourHoursOnDocument(doc);
}

export interface LoggedHoursOffer {
  /** Hours the document charges for right now. */
  quotedHours: number;
  loggedHours: number;
  rate: number;
}

/**
 * Whether charging the logged hours would change anything, and the figures.
 * Null when nothing was logged, the labour isn't plain hourly labour, no
 * hours are on the document to begin with, or the two already agree.
 */
export function loggedHoursOffer(doc: LabourDoc, loggedHours: number): LoggedHoursOffer | null {
  if (!(loggedHours > 0)) return null;
  const rate = hourlyRateOf(doc);
  if (!(rate > 0)) return null;
  const quotedHours = labourHoursOnDocument(doc);
  // No hours quoted means labour went on some other way (supply-only, rate
  // lines) — logged time isn't an adjustment to it.
  if (!(quotedHours > 0)) return null;
  if (Math.abs(quotedHours - loggedHours) < LOGGED_HOURS_TOLERANCE) return null;
  return { quotedHours, loggedHours: round2(loggedHours), rate };
}

/**
 * The document with its labour set to the logged hours and every total
 * recalculated. Null when the document has no plain hourly labour to set.
 */
export function applyLoggedHours(doc: Document, loggedHours: number): Document | null {
  const rate = hourlyRateOf(doc);
  if (!(rate > 0) || !(loggedHours > 0)) return null;
  const canonical = normaliseLabourToHours(doc);
  const sections = canonical.sections ?? [];
  const hours = round2(loggedHours);
  const next: Document =
    sections.length > 0
      ? {
          ...canonical,
          laborHours: hours,
          laborExtraHours: round2(hours - sections.reduce((sum, s) => sum + sectionHours(s), 0)),
        }
      : { ...canonical, laborHours: hours };
  // Stamp the quoted hours once, before the labour stops saying what they were.
  if (!(typeof doc.quotedLaborHours === 'number' && doc.quotedLaborHours > 0)) {
    next.quotedLaborHours = labourHoursOnDocument(doc);
  }
  const recalculated = updateDocumentCalculations(next);
  // Revert-to-quote restores this total; keep it in step with the labour it
  // now carries, or an undo would put back the old price on the new hours.
  if (recalculated.convertedFromQuote) {
    recalculated.convertedFromQuote = { ...recalculated.convertedFromQuote, total: recalculated.total };
  }
  return recalculated;
}

export interface ChargeLoggedHoursPlan extends LoggedHoursOffer {
  /** The invoice with the logged hours charged, totals recalculated. */
  next: Document;
  fromTotal: number;
  toTotal: number;
  /** True when logged hours are more than the invoice charges for. */
  raises: boolean;
  /** The customer already has this invoice — they'll need the new one. */
  alreadySent: boolean;
}

/**
 * Everything the "charge the hours you logged?" offer needs, or null when it
 * shouldn't be made: not an invoice, cancelled or paid, money already taken
 * against it (a deposit or a part payment), or pushed to Xero, where a
 * changed total would silently drift from the copy there.
 */
export function chargeLoggedHoursPlan(invoice: Document, loggedHours: number): ChargeLoggedHoursPlan | null {
  if (invoice.type !== 'invoice') return null;
  if (invoice.stage === 'paid' || invoice.stage === 'partially_paid' || invoice.stage === 'cancelled') return null;
  if ((Number(invoice.depositPaid) || 0) > 0 || (Number(invoice.paidTotal) || 0) > 0) return null;
  if (invoice.xeroInvoiceId) return null;
  const offer = loggedHoursOffer(invoice, loggedHours);
  if (!offer) return null;
  const next = applyLoggedHours(invoice, offer.loggedHours);
  if (!next) return null;
  return {
    ...offer,
    next,
    fromTotal: Number(invoice.total) || 0,
    toTotal: Number(next.total) || 0,
    raises: offer.loggedHours > offer.quotedHours,
    // A converted invoice starts as a draft even when the QUOTE was sent, so
    // only the invoice's own sent stage means the customer holds this total.
    alreadySent: invoice.stage === 'invoice_sent',
  };
}
