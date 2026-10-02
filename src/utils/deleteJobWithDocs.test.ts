import { describe, it, expect, vi } from 'vitest';
import { cascadeDeleteJob, pickPaidDocs } from './deleteJobWithDocs';

const job: any = { id: 'job-1' };

function deps() {
  const calls: string[] = [];
  return {
    calls,
    d: {
      deleteQuote: vi.fn(async (id: string) => { calls.push(`quote:${id}`); }),
      deleteInvoice: vi.fn(async (id: string) => { calls.push(`invoice:${id}`); }),
      deleteDocumentRecords: vi.fn(async (doc: any) => { calls.push(`records:${doc.id}`); }),
      deleteJob: vi.fn(async (id: string) => { calls.push(`job:${id}`); }),
    },
  };
}

describe('cascadeDeleteJob', () => {
  it('REGRESSION: a converted invoice has every stored copy removed, not just the invoice row', async () => {
    // A quote converted in place: one document, quote + invoice copies under
    // the same id. Removing only invoices/{id} left the quote copy, and the
    // server rebuilt the invoice from it with no job.
    const invoice: any = { id: 'q-1', type: 'invoice', legacyQuoteId: 'q-1', legacyInvoiceId: 'q-1' };
    const { calls, d } = deps();
    await cascadeDeleteJob(job, [invoice], d);
    expect(d.deleteDocumentRecords).toHaveBeenCalledWith(invoice);
    expect(calls).toEqual(['invoice:q-1', 'records:q-1', 'job:job-1']);
  });

  it('quotes go through deleteQuote and their records too, then the job last', async () => {
    const quote: any = { id: 'q-2', type: 'quote' };
    const { calls, d } = deps();
    await cascadeDeleteJob(job, [quote], d);
    expect(calls).toEqual(['quote:q-2', 'records:q-2', 'job:job-1']);
  });

  it('the delete analytics fire once per document (one store delete each)', async () => {
    const docs: any[] = [{ id: 'a', type: 'invoice' }, { id: 'b', type: 'quote' }];
    const { d } = deps();
    await cascadeDeleteJob(job, docs, d);
    expect(d.deleteInvoice).toHaveBeenCalledTimes(1);
    expect(d.deleteQuote).toHaveBeenCalledTimes(1);
  });
});

describe('pickPaidDocs', () => {
  it('blocks on paid and part-paid documents only', () => {
    const docs: any[] = [{ stage: 'paid' }, { stage: 'partially_paid' }, { stage: 'draft' }];
    expect(pickPaidDocs(docs)).toHaveLength(2);
  });
});
