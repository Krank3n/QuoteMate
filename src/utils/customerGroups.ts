/**
 * Grouping jobs by the customer they belong to.
 *
 * There is no reliable foreign key to lean on. `Job.customerId` is declared but
 * almost never written (the wizard records the link on the Document instead,
 * and only when the tradie picked from saved Contacts — most pick a "recent"
 * suggestion, which sets nothing). So the derived key below is load-bearing and
 * the ids are a bonus that fills in over time.
 *
 * MERGING IS DELIBERATELY CONSERVATIVE, because the two failure modes are not
 * symmetric:
 *
 *   - Split too eagerly: Jane shows up as two rows, each owed figure smaller
 *     than reality. Visible on screen, mildly annoying, self-correcting.
 *   - Merge too eagerly: two different Jane Smiths become one row with a
 *     blended owed total and one of their phone numbers. The tradie rings the
 *     wrong Jane about money she doesn't owe. Nothing on screen says the row is
 *     fiction, and it costs a customer.
 *
 * So phone beats name, there is no fuzzy matching in the key, and a job with
 * nothing identifiable stays out of every group rather than piling into a fake
 * "Unknown customer". Same call sameSite already made for sites:
 * "Anything cleverer risks matching two different addresses, and the cost of
 * that is a wrong document."
 *
 * Address is NOT part of the key. A customer is not a site — two owners of the
 * same rental unit are two customers, and keying on address would inherit the
 * mis-grouping hazard the jobs backfill already documents.
 */

import type { Job } from '../../shared/job/types';
import type { Document } from '../types/document';
import { jobStatusTimestamp, sortJobsForList } from './jobTimeline';
import { normalizePhoneTail } from './textMatch';

/** Amounts within half a cent are settled. Mirrors jobBuckets / jobSort. */
const EPSILON = 0.005;

/** Below this many digits a phone number isn't distinctive enough to key on. */
const MIN_PHONE_DIGITS = 6;

export type CustomerKeyBasis = 'contact' | 'phone' | 'email' | 'name' | 'none';

export interface CustomerKey {
  key: string;
  basis: CustomerKeyBasis;
}

/** Structurally accepts a Job, a Document, or a Contact. */
export interface CustomerKeyInput {
  customerId?: string;
  contactId?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
}

/**
 * Fold a name to a comparison key.
 *
 * Case, padding and punctuation are noise. Tokens are SORTED, which is what
 * makes "Smith, Jane" key identically to "Jane Smith" — and it's
 * order-independent by construction, so the key can't depend on how the name
 * happened to be typed.
 */
export function normaliseCustomerName(value?: string | null): string {
  const tokens = (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  return tokens.sort().join(' ');
}

function trimmed(v?: string | null): string {
  return (v || '').trim();
}

/**
 * The strongest available identity for a customer.
 *
 * Precedence is fixed so the key is deterministic:
 *   1. a linked contact id       → 'c:<id>'
 *   2. the phone's last 8 digits → 'p:<digits>'
 *   3. the email                 → 'e:<email>'
 *   4. the folded name           → 'n:<name>'
 *   5. nothing usable            → '' (ungrouped)
 *
 * Phone above email on purpose: tradies capture phones far more reliably, and
 * a shared household or office inbox must not merge two customers.
 */
export function customerKeyFor(input: CustomerKeyInput): CustomerKey {
  const id = trimmed(input.customerId) || trimmed(input.contactId);
  if (id) return { key: `c:${id.toLowerCase()}`, basis: 'contact' };

  const phone = normalizePhoneTail(trimmed(input.customerPhone));
  if (phone.length >= MIN_PHONE_DIGITS) return { key: `p:${phone}`, basis: 'phone' };

  const email = trimmed(input.customerEmail).toLowerCase();
  if (email) return { key: `e:${email}`, basis: 'email' };

  const name = normaliseCustomerName(input.customerName);
  if (name) return { key: `n:${name}`, basis: 'name' };

  return { key: '', basis: 'none' };
}

/** Newest attached document that carries a contactId, id-tiebroken. */
function pickContactId(docs: Document[]): string | undefined {
  let best: Document | undefined;
  for (const d of docs || []) {
    if (!d?.contactId) continue;
    if (!best) {
      best = d;
      continue;
    }
    const dAt = Number(d.createdAt) || 0;
    const bestAt = Number(best.createdAt) || 0;
    if (dAt > bestAt || (dAt === bestAt && String(d.id) < String(best.id))) best = d;
  }
  return best?.contactId;
}

export function customerKeyForJob(job: Job, attachedDocs?: Document[]): CustomerKey {
  return customerKeyFor({
    customerId: job.customerId,
    contactId: pickContactId(attachedDocs ?? []),
    customerName: job.customerName,
    customerPhone: job.customerPhone,
    customerEmail: job.customerEmail,
  });
}

// --- Grouping ---------------------------------------------------------------

export interface CustomerGroup {
  key: string;
  basis: CustomerKeyBasis;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  /** Newest-first, matching the order the jobs list uses. */
  jobIds: string[];
  jobCount: number;
  /** Dated by the job's stage stamp, so it matches the date on the card. */
  lastActivityMs: number;
  isRepeat: boolean;
}

interface Draft {
  key: string;
  basis: CustomerKeyBasis;
  jobs: Job[];
}

/**
 * Latest non-empty value of a field across a customer's jobs.
 *
 * Deliberately not "first seen" — that would depend on the order the caller
 * happened to pass the jobs in. Newest `updatedAt` wins, ties broken on id, so
 * the display name is the spelling the tradie used most recently.
 */
function latestField(jobs: Job[], pick: (j: Job) => string | undefined): string | undefined {
  let bestValue: string | undefined;
  let bestAt = -Infinity;
  let bestId = '';
  for (const j of jobs) {
    const value = trimmed(pick(j));
    if (!value) continue;
    const at = Number(j.updatedAt) || 0;
    const id = String(j.id);
    const wins = bestValue === undefined || at > bestAt || (at === bestAt && id < bestId);
    if (wins) {
      bestValue = value;
      bestAt = at;
      bestId = id;
    }
  }
  return bestValue;
}

/**
 * Fold weaker-keyed groups into a contact-keyed group where they unambiguously
 * belong.
 *
 * Without this, one quote picked from Contacts silently splits a customer in
 * two: job A keys on the contact id, job B on the phone. Folding happens only
 * when EXACTLY ONE contact group claims the same phone / email / name. Zero
 * matches or two or more and the group is left alone — "exactly one" is what
 * keeps this both order-independent and conservative.
 */
function resolveAliases(drafts: Map<string, Draft>): Map<string, Draft> {
  const contactDrafts = [...drafts.values()].filter((d) => d.basis === 'contact');
  if (contactDrafts.length === 0) return drafts;

  // Which contact groups claim each weaker alias.
  const claims = new Map<string, Set<string>>();
  const claim = (alias: string, key: string) => {
    if (!alias) return;
    const set = claims.get(alias);
    if (set) set.add(key);
    else claims.set(alias, new Set([key]));
  };

  for (const draft of contactDrafts) {
    for (const job of draft.jobs) {
      const phone = normalizePhoneTail(trimmed(job.customerPhone));
      if (phone.length >= MIN_PHONE_DIGITS) claim(`p:${phone}`, draft.key);
      const email = trimmed(job.customerEmail).toLowerCase();
      if (email) claim(`e:${email}`, draft.key);
      const name = normaliseCustomerName(job.customerName);
      if (name) claim(`n:${name}`, draft.key);
    }
  }

  const merged = new Map(drafts);
  for (const draft of drafts.values()) {
    if (draft.basis === 'contact') continue;
    const owners = claims.get(draft.key);
    if (!owners || owners.size !== 1) continue;
    const target = merged.get([...owners][0]);
    if (!target) continue;
    target.jobs = [...target.jobs, ...draft.jobs];
    merged.delete(draft.key);
  }
  return merged;
}

export function groupJobsByCustomer(
  jobs: Job[],
  docsByJob?: Map<string, Document[]>,
): CustomerGroup[] {
  const drafts = new Map<string, Draft>();

  for (const job of jobs) {
    if (!job?.id) continue;
    const { key, basis } = customerKeyForJob(job, docsByJob?.get(job.id));
    // No name, phone, email or link — nothing to group on. Such jobs stay out
    // of the customer layer entirely rather than forming a fake bucket.
    if (!key) continue;
    const draft = drafts.get(key);
    if (draft) draft.jobs.push(job);
    else drafts.set(key, { key, basis, jobs: [job] });
  }

  const resolved = resolveAliases(drafts);

  const groups: CustomerGroup[] = [];
  for (const draft of resolved.values()) {
    const ordered = sortJobsForList(draft.jobs);
    groups.push({
      key: draft.key,
      basis: draft.basis,
      name: latestField(draft.jobs, (j) => j.customerName) || 'Unknown customer',
      phone: latestField(draft.jobs, (j) => j.customerPhone),
      email: latestField(draft.jobs, (j) => j.customerEmail),
      address: latestField(draft.jobs, (j) => j.jobAddress),
      jobIds: ordered.map((j) => j.id),
      jobCount: ordered.length,
      lastActivityMs: ordered.reduce((max, j) => Math.max(max, jobStatusTimestamp(j)), 0),
      isRepeat: ordered.length > 1,
    });
  }

  // Most recently active first, id-tiebroken so the order is total.
  return groups.sort(
    (a, b) => b.lastActivityMs - a.lastActivityMs || a.key.localeCompare(b.key),
  );
}

/**
 * Find the group a navigation target refers to.
 *
 * Needed because the caller's strongest key isn't always the key the jobs
 * grouped under. Tapping a saved Contact hands us `c:<id>`, but if none of that
 * customer's jobs or documents ever recorded the link, their jobs are grouped
 * under `p:<phone>` or `n:<name>` — and an exact-key lookup would report "no
 * jobs yet" for a customer with six.
 *
 * So: exact key first, then the weaker aliases in the same precedence order the
 * key itself uses. Returns null when nothing matches, which is a real state (a
 * contact imported but never quoted).
 */
export function findCustomerGroup(
  groups: CustomerGroup[],
  target: { key?: string; phone?: string; email?: string; name?: string },
): CustomerGroup | null {
  const candidates: string[] = [];
  if (target.key) candidates.push(target.key);

  const phone = normalizePhoneTail(trimmed(target.phone));
  if (phone.length >= MIN_PHONE_DIGITS) candidates.push(`p:${phone}`);

  const email = trimmed(target.email).toLowerCase();
  if (email) candidates.push(`e:${email}`);

  const name = normaliseCustomerName(target.name);
  if (name) candidates.push(`n:${name}`);

  for (const candidate of candidates) {
    const hit = groups.find((g) => g.key === candidate);
    if (hit) return hit;
  }
  return null;
}

/** Map every job id to how many jobs its customer has. Drives the card marker. */
export function jobCountByJobId(groups: CustomerGroup[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const g of groups) {
    for (const id of g.jobIds) out.set(id, g.jobCount);
  }
  return out;
}

/** Map every job id to its customer key, for navigating from a card. */
export function customerKeyByJobId(groups: CustomerGroup[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const g of groups) {
    for (const id of g.jobIds) out.set(id, g.key);
  }
  return out;
}

// --- Roll-up ---------------------------------------------------------------

export interface CustomerRollup {
  totalQuoted: number;
  totalInvoiced: number;
  totalPaid: number;
  /** What's still owing right now — the number that changes behaviour. */
  owed: number;
  jobCount: number;
  docCount: number;
  firstActivityMs: number;
  lastActivityMs: number;
  isRepeat: boolean;
}

/**
 * Totals for one customer, computed from the live documents.
 *
 * Never reads `Job.totalQuoted/totalInvoiced/totalPaid/balanceDue` — those are
 * server-trigger aggregates that lag, which is why jobBuckets, paidTransition
 * and jobHeadlineValue all recompute instead.
 *
 * `owed` clamps PER INVOICE before summing: summing raw differences first would
 * let one overpaid invoice mask another invoice's debt, and the tradie would
 * never chase it.
 *
 * Quoted and invoiced are summed separately, so a quote that became an invoice
 * isn't counted as both.
 */
export function computeCustomerRollup(
  group: CustomerGroup,
  jobsById: Map<string, Job>,
  docsByJob: Map<string, Document[]>,
): CustomerRollup {
  let totalQuoted = 0;
  let totalInvoiced = 0;
  let totalPaid = 0;
  let owed = 0;
  let docCount = 0;
  let firstActivityMs = Infinity;
  let lastActivityMs = 0;

  for (const jobId of group.jobIds) {
    const job = jobsById.get(jobId);
    if (job) {
      const at = jobStatusTimestamp(job);
      if (at > 0) {
        firstActivityMs = Math.min(firstActivityMs, at);
        lastActivityMs = Math.max(lastActivityMs, at);
      }
    }

    for (const d of docsByJob.get(jobId) ?? []) {
      if (!d || d.stage === 'cancelled') continue;
      docCount += 1;
      const total = Number(d.total) || 0;
      const paid = Number(d.paidTotal) || 0;
      totalPaid += paid;
      if (d.type === 'quote') totalQuoted += total;
      if (d.type === 'invoice') {
        totalInvoiced += total;
        const balance = total - paid;
        if (balance > EPSILON) owed += balance;
      }
    }
  }

  return {
    totalQuoted,
    totalInvoiced,
    totalPaid,
    owed,
    jobCount: group.jobCount,
    docCount,
    firstActivityMs: Number.isFinite(firstActivityMs) ? firstActivityMs : 0,
    lastActivityMs,
    isRepeat: group.isRepeat,
  };
}
