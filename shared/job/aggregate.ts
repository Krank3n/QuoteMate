import type { Job, JobDocument } from './types';

export interface JobAggregates {
  totalQuoted: number;    // Σ doc.total where doc.type === 'quote'
  totalInvoiced: number;  // Σ doc.total where doc.type === 'invoice'
  totalPaid: number;      // Σ doc.paidTotal across all attached docs
  balanceDue: number;     // Σ doc.balanceDue across all attached docs
  documentIds: string[];  // sorted ids of attached, non-cancelled docs
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function computeJobAggregates(
  job: Pick<Job, 'id'>,
  docs: JobDocument[],
): JobAggregates {
  const attached = docs.filter((d) => d.jobId === job.id);

  // Cancelled docs stop contributing to money aggregates but stay listed in
  // documentIds (so the history remains visible on the job card).
  const live = attached.filter((d) => d.stage !== 'cancelled');

  const totalQuoted = live
    .filter((d) => d.type === 'quote')
    .reduce((sum, d) => sum + num(d.total), 0);

  const totalInvoiced = live
    .filter((d) => d.type === 'invoice')
    .reduce((sum, d) => sum + num(d.total), 0);

  const totalPaid = live.reduce((sum, d) => sum + num(d.paidTotal), 0);
  const balanceDue = live.reduce((sum, d) => sum + num(d.balanceDue), 0);

  const documentIds = attached
    .map((d) => d.id)
    .filter((id, idx, arr) => arr.indexOf(id) === idx)
    .sort();

  return { totalQuoted, totalInvoiced, totalPaid, balanceDue, documentIds };
}
