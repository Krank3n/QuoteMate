/**
 * Service Report — pure form helpers.
 *
 * Kept network- and React-free so the draft-building logic can be unit tested
 * without a live Job store or Firestore. The capture screen owns the editable
 * `ReportFormState`; these helpers seed it from a Job and fold it back into the
 * `CreateReportInput` shape reportService.createReport expects.
 *
 * Discipline: optional narrative/risk fields collapse to `undefined` when the
 * tradie left them blank (Firestore rejects undefined at write time, and
 * stripUndefined in reportService drops them cleanly), and equipment /
 * checklist rows with only whitespace are pruned so they never reach the
 * customer-facing document.
 */

import { format, formatDistance } from 'date-fns';

import type { Job, JobPhoto } from '../../../shared/job/types';
import type {
  ReportChecklistItem,
  ServiceReport,
  SignatureCapture,
} from '../../../shared/report/types';
import { pathHasInk } from '../../../shared/pdf/signatureInk';
import type { CreateReportInput } from '../../services/reportService';

/** Customer context lifted off the Job for the PDF export options. */
export interface ReportCustomerContext {
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  jobAddress?: string;
}

/** The editable state the capture screen holds. Strings stay strings (never
 *  undefined) so the controlled inputs never flip between controlled and
 *  uncontrolled; buildReportInput narrows blanks to undefined at save time. */
export interface ReportFormState {
  jobId: string;
  visitDate: number;
  serviceType: string;
  riskAssessment: string;
  equipment: string[];
  itemsChecked: ReportChecklistItem[];
  natureOfProblem: string;
  workCarriedOut: string;
  recommendedWork: string;
  photos: JobPhoto[];
  customerSignature?: SignatureCapture;
  technicianSignature?: SignatureCapture;
}

const trim = (v: string | undefined | null): string => (v || '').trim();

/** Empty string → undefined; anything else → its trimmed value. */
const orUndefined = (v: string | undefined | null): string | undefined => {
  const t = trim(v);
  return t.length > 0 ? t : undefined;
};

/**
 * Pull the customer/address fields off a Job for the report PDF + email
 * context. Only fields with content survive so the PDF builder can skip empty
 * rows.
 */
export function deriveReportContext(job: Job): ReportCustomerContext {
  return {
    customerName: trim(job.customerName),
    customerEmail: orUndefined(job.customerEmail),
    customerPhone: orUndefined(job.customerPhone),
    jobAddress: orUndefined(job.jobAddress),
  };
}

/**
 * Seed a fresh, empty report form from a Job. The service type defaults to the
 * job name (the tradie's own label for the work) so the most common case needs
 * no typing; everything else starts blank. Mate never pre-fills the checklist
 * or ticks anything — ticking is a manual tap only.
 */
export function buildInitialReportForm(
  job: Job,
  opts?: { visitDate?: number },
): ReportFormState {
  return {
    jobId: job.id,
    visitDate: opts?.visitDate ?? Date.now(),
    serviceType: trim(job.name),
    riskAssessment: '',
    equipment: [],
    itemsChecked: [],
    natureOfProblem: '',
    workCarriedOut: '',
    recommendedWork: '',
    photos: [],
  };
}

/**
 * Fold the editable form state into the CreateReportInput shape. Trims every
 * text field, prunes blank equipment / checklist rows, and collapses empty
 * optional fields to undefined.
 */
export function buildReportInput(state: ReportFormState): CreateReportInput {
  const equipment = state.equipment
    .map((e) => trim(e))
    .filter((e) => e.length > 0);

  const itemsChecked = state.itemsChecked
    .map((it) => ({ ...it, text: trim(it.text) }))
    .filter((it) => it.text.length > 0);

  return {
    jobId: state.jobId,
    visitDate: state.visitDate,
    serviceType: trim(state.serviceType),
    riskAssessment: orUndefined(state.riskAssessment),
    equipment,
    itemsChecked,
    natureOfProblem: orUndefined(state.natureOfProblem),
    workCarriedOut: orUndefined(state.workCarriedOut),
    recommendedWork: orUndefined(state.recommendedWork),
    photos: state.photos.length > 0 ? state.photos : undefined,
    customerSignature: state.customerSignature,
    technicianSignature: state.technicianSignature,
  };
}

/** Hydrate the editable form from a persisted report (edit mode). */
export function formFromReport(
  report: {
    jobId: string;
    visitDate: number;
    serviceType: string;
    riskAssessment?: string;
    equipment: string[];
    itemsChecked: ReportChecklistItem[];
    natureOfProblem?: string;
    workCarriedOut?: string;
    recommendedWork?: string;
    photos?: JobPhoto[];
    customerSignature?: SignatureCapture;
    technicianSignature?: SignatureCapture;
  },
): ReportFormState {
  return {
    jobId: report.jobId,
    visitDate: report.visitDate,
    serviceType: report.serviceType || '',
    riskAssessment: report.riskAssessment || '',
    equipment: Array.isArray(report.equipment) ? [...report.equipment] : [],
    itemsChecked: Array.isArray(report.itemsChecked)
      ? report.itemsChecked.map((it) => ({ ...it }))
      : [],
    natureOfProblem: report.natureOfProblem || '',
    workCarriedOut: report.workCarriedOut || '',
    recommendedWork: report.recommendedWork || '',
    photos: Array.isArray(report.photos) ? [...report.photos] : [],
    customerSignature: report.customerSignature,
    technicianSignature: report.technicianSignature,
  };
}

/** The three narrative fields Mate's write-up returns. */
export interface WriteUpFields {
  natureOfProblem: string;
  workCarriedOut: string;
  recommendedWork: string;
}

/**
 * Fold Mate's composed write-up back into the form. The compose step may
 * REDISTRIBUTE facts between fields (a "recommend…" line jotted under work
 * carried out comes back under recommended work), so every returned field is
 * applied verbatim — including an emptied one whose fact moved elsewhere.
 * The only guard: if Mate returned nothing at all, keep what the tradie
 * typed rather than wiping the lot.
 */
export function applyComposedWriteUp(
  current: WriteUpFields,
  composed: WriteUpFields,
): WriteUpFields {
  const allBlank =
    !trim(composed.natureOfProblem) &&
    !trim(composed.workCarriedOut) &&
    !trim(composed.recommendedWork);
  if (allBlank) return current;
  return {
    natureOfProblem: composed.natureOfProblem,
    workCarriedOut: composed.workCarriedOut,
    recommendedWork: composed.recommendedWork,
  };
}

/**
 * Mate's suggested equipment / checklist rows, pruned for display as
 * tap-to-add chips: blanks dropped, whitespace trimmed, and anything already
 * on the report (case-insensitive) or repeated within the list removed.
 * Chips only ever OFFER a row — the tradie taps to add it, and checklist
 * rows always land unticked.
 */
export function pruneSuggestions(
  suggestions: string[],
  existing: string[],
): string[] {
  const seen = new Set(
    existing.map((e) => trim(e).toLowerCase()).filter((e) => e.length > 0),
  );
  const out: string[] = [];
  for (const raw of suggestions) {
    const t = trim(raw);
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * The report the actions sheet should reopen instead of minting a new one.
 * Reports are expected newest-first (as listReports returns them): if the
 * newest report for the job is still a draft, that's an unfinished docket —
 * resume it. A sent newest report (or no reports at all) means the next tap
 * is a genuinely new visit, so nothing is resumed.
 */
export function resumableReportId(reports: ServiceReport[]): string | null {
  const newest = reports[0];
  return newest && newest.status === 'draft' ? newest.id : null;
}

/**
 * The tradie's most recent real technician signature, for pre-filling the
 * pad on a NEW report — their signature never changes, so drawing it fresh
 * on every docket is pure friction. Reports are expected newest-first (as
 * listReports returns them); ghost captures (no measurable ink) and the
 * customer signature are never carried forward — customer ink must be
 * fresh on every visit.
 */
export function latestTechnicianSignature(
  reports: ServiceReport[],
): SignatureCapture | null {
  for (const report of reports) {
    const sig = report.technicianSignature;
    if (sig && pathHasInk(sig.svgPath)) return sig;
  }
  return null;
}

/**
 * Compact one-line summary for a report row on the Job screen: the service
 * type leads (that's how the tradie thinks of the visit), with the report
 * number and lifecycle state underneath. `now` is injectable for tests.
 */
export function reportRowSummary(
  report: Pick<ServiceReport, 'number' | 'serviceType' | 'status' | 'sentAt' | 'updatedAt'>,
  now: number = Date.now(),
): { title: string; subtitle: string } {
  const title = report.serviceType?.trim() || 'Service report';
  const parts: string[] = [];
  if (report.number) parts.push(report.number);
  if (report.status === 'sent') {
    parts.push(
      report.sentAt ? `Sent ${format(new Date(report.sentAt), 'd MMM')}` : 'Sent',
    );
  } else {
    parts.push('Draft');
    if (report.updatedAt) {
      parts.push(
        `edited ${formatDistance(new Date(report.updatedAt), new Date(now), { addSuffix: true })}`,
      );
    }
  }
  return { title, subtitle: parts.join(' · ') };
}
