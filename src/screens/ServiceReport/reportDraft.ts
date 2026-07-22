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

import type { Job, JobPhoto } from '../../../shared/job/types';
import type {
  ReportChecklistItem,
  SignatureCapture,
} from '../../../shared/report/types';
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
