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
import { generateId } from '../../utils/generateId';
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
 * Mate's confirmable write-up additions, pruned for display exactly as the
 * equipment / checklist chips are: blanks dropped, repeats removed, and
 * anything the target field ALREADY says retired.
 *
 * That last rule is what stops a second "Write it up" from re-offering a
 * sentence the tradie confirmed after the first one — tapping it again would
 * append the same claim twice. Re-run on every render (like pruneSuggestions)
 * so a sentence typed by hand retires its chip too.
 */
export function pruneAdditions<T extends { text: string; field: keyof WriteUpFields }>(
  additions: T[],
  current: WriteUpFields,
): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const addition of additions) {
    const text = trim(addition.text);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    if (trim(current[addition.field]).toLowerCase().includes(key)) continue;
    seen.add(key);
    out.push(addition);
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

/* --- Site memory ---------------------------------------------------------
 *
 * Servicing is repeat work: the same air conditioner, switchboard or hot
 * water unit sits at the same address year after year, and re-typing the
 * equipment list on every visit is the single biggest cost of the docket.
 * These helpers find the previous visit to the SAME SITE and carry its
 * equipment + checklist rows onto a fresh report.
 *
 * The site — not the job, and not the customer. A yearly service is a new
 * Job, so job-keyed memory would never fire; and a customer can own several
 * addresses, so customer-keyed memory would put one site's plant on
 * another's document. Address is therefore authoritative WHEN BOTH JOBS
 * HAVE ONE, with the customer as a fallback only when an address is
 * missing. A wrong non-match is a silent no-op; a wrong match puts foreign
 * equipment on a customer-facing report, so matching stays strict.
 *
 * Ticks never carry. Every `checked` flag lands false — a pre-ticked
 * checklist asserts that work was done on THIS visit, which only the tradie
 * can say.
 */

/** The identity of a site, derived from the Job the report hangs off. */
export interface SiteIdentity {
  /** Normalised street address — '' when the job has none. */
  address: string;
  /** Normalised customer id (preferred) or name — '' when neither is set. */
  customer: string;
}

/**
 * Fold a free-typed address or name down to a comparison key: case, padding
 * and punctuation are noise ("12 Smith St, Warragul" and "12 smith st
 * warragul" are one site). Deliberately conservative — no street-type
 * expansion, no fuzzy distance. Anything cleverer risks matching two
 * different addresses, and the cost of that is a wrong document.
 */
export function normaliseSiteText(value: string | undefined | null): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Derive the site identity of a job. */
export function siteIdentity(
  job: Pick<Job, 'jobAddress' | 'customerId' | 'customerName'>,
): SiteIdentity {
  const customerId = trim(job.customerId);
  return {
    address: normaliseSiteText(job.jobAddress),
    // A linked contact is a stronger key than a re-typed name, so it wins.
    customer: customerId
      ? `id:${customerId.toLowerCase()}`
      : normaliseSiteText(job.customerName),
  };
}

/**
 * Do two jobs describe the same site?
 *
 * When both carry an address, the address decides — that's what keeps a
 * customer's second property from inheriting the first one's plant. Only
 * when an address is missing on either side do we fall back to the
 * customer. Two jobs with nothing identifiable never match.
 */
export function sameSite(a: SiteIdentity, b: SiteIdentity): boolean {
  if (a.address && b.address) return a.address === b.address;
  return !!a.customer && a.customer === b.customer;
}

/** Job fields the site match needs — all this ever reads off a Job. */
type SiteJob = Pick<Job, 'id' | 'jobAddress' | 'customerId' | 'customerName'>;

/**
 * Newest report at the same site as `currentJob` that satisfies `wanted`.
 *
 * `reports` is expected newest-first (as listReports returns them) and
 * `jobs` is the client-side job list — the join happens in memory, so this
 * costs no extra reads and needs no denormalised key on the report. Reports
 * whose job has since been deleted are skipped.
 */
function findSiteReport(
  reports: ServiceReport[],
  jobs: SiteJob[],
  currentJob: SiteJob,
  wanted: (report: ServiceReport) => boolean,
): ServiceReport | null {
  const here = siteIdentity(currentJob);
  if (!here.address && !here.customer) return null;

  const jobsById = new Map(jobs.map((j) => [j.id, j]));

  for (const report of reports) {
    if (!wanted(report)) continue;
    // The same job is trivially the same site — no lookup needed, and it
    // still works when the job list hasn't loaded.
    if (report.jobId !== currentJob.id) {
      const priorJob = jobsById.get(report.jobId);
      if (!priorJob || !sameSite(siteIdentity(priorJob), here)) continue;
    }
    return report;
  }
  return null;
}

/**
 * The most recent report worth carrying forward for a new visit to this
 * job's site, or null when there's nothing to carry. Reports with no
 * equipment and no checklist are skipped rather than matched — carrying
 * nothing is not a match, and stopping at one would hide an older visit
 * that does have the plant listed.
 */
export function latestSiteReport(
  reports: ServiceReport[],
  jobs: SiteJob[],
  currentJob: SiteJob,
): ServiceReport | null {
  return findSiteReport(
    reports,
    jobs,
    currentJob,
    (r) => (r.equipment?.length ?? 0) > 0 || (r.itemsChecked?.length ?? 0) > 0,
  );
}

/**
 * The previous visit's write-up, for use as a VOCABULARY reference on the
 * compose step — it teaches the tradie's own words for their plant
 * ("package unit", "high wall split") and their level of detail. The server
 * prompt fences it hard: no fact in it may reach this visit's report.
 *
 * Deliberately a separate lookup from latestSiteReport: a quick call-out
 * might carry a solid write-up and no equipment list at all, and that visit
 * is still the best guide to how this tradie writes.
 */
export function latestSiteWriteUp(
  reports: ServiceReport[],
  jobs: SiteJob[],
  currentJob: SiteJob,
): string | undefined {
  const match = findSiteReport(reports, jobs, currentJob, (r) =>
    trim(r.workCarriedOut).length > 0,
  );
  return match ? trim(match.workCarriedOut) : undefined;
}

/** What a previous visit contributes to a fresh report. */
export interface SiteMemory {
  equipment: string[];
  itemsChecked: ReportChecklistItem[];
}

/**
 * Lift the equipment + checklist rows off a previous visit's report.
 *
 * Rows are trimmed, blanks dropped and duplicates removed case-insensitively.
 * Checklist rows get FRESH ids (an id is scoped to its own document) and
 * always land UNTICKED — what was done last visit says nothing about this
 * one. Nothing else travels: no narrative, no photos, no signatures, no risk
 * assessment. Those are observations about a specific visit.
 */
export function carryForwardSiteMemory(
  prior: Pick<ServiceReport, 'equipment' | 'itemsChecked'>,
  makeId: () => string = generateId,
): SiteMemory {
  const dedupe = (values: string[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of values) {
      const text = trim(raw);
      const key = text.toLowerCase();
      if (!text || seen.has(key)) continue;
      seen.add(key);
      out.push(text);
    }
    return out;
  };

  return {
    equipment: dedupe(prior.equipment ?? []),
    itemsChecked: dedupe((prior.itemsChecked ?? []).map((it) => it?.text ?? '')).map(
      (text) => ({ id: makeId(), text, checked: false }),
    ),
  };
}

/**
 * Undo a carry-forward: drop exactly the rows site memory added, leaving
 * anything the tradie typed or edited since. Equipment matches on text
 * (rows have no id), checklist on the ids we minted — so a carried row the
 * tradie has since reworded is theirs now and survives the undo.
 */
export function removeCarriedRows(
  state: Pick<ReportFormState, 'equipment' | 'itemsChecked'>,
  carried: SiteMemory,
): SiteMemory {
  const carriedEquipment = new Set(
    carried.equipment.map((e) => trim(e).toLowerCase()),
  );
  const carriedIds = new Set(carried.itemsChecked.map((it) => it.id));
  return {
    equipment: state.equipment.filter(
      (e) => !carriedEquipment.has(trim(e).toLowerCase()),
    ),
    itemsChecked: state.itemsChecked.filter((it) => !carriedIds.has(it.id)),
  };
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
