/**
 * applyJobStageChange is the single entry point every status control shares
 * — the timeline pill, the kebab's "Change status" submenu, ViewJob and
 * Dashboard. The `paid` guard lives here precisely so no surface can keep
 * the old flip-without-payment behaviour.
 *
 * The critical assertion in the routing case is the NEGATIVE one: saveJob
 * must not be called. Navigating while also flipping the stage would leave
 * the same lie in place with an extra screen in front of it.
 */
import { describe, it, expect, vi } from 'vitest';

import { applyJobStageChange } from './applyJobStageChange';

function job(over: Record<string, any> = {}): any {
  return { id: 'job1', stage: 'completed', name: 'A job', ...over };
}

function invoice(over: Record<string, any> = {}): any {
  return {
    id: 'inv1',
    type: 'invoice',
    stage: 'invoice_sent',
    total: 1000,
    paidTotal: 0,
    ...over,
  };
}

function harness() {
  const saveJob = vi.fn(async () => {});
  const navigate = vi.fn();
  return {
    saveJob,
    navigate,
    helpers: {
      saveQuote: vi.fn(async () => {}),
      saveInvoice: vi.fn(async () => {}),
      createInvoiceFromQuote: vi.fn(async () => ({}) as any),
      navigation: { navigate },
    },
  };
}

describe('applyJobStageChange — the paid guard', () => {
  it('routes to Record Payment and leaves the stage alone when money is owed', async () => {
    const h = harness();

    await applyJobStageChange({
      job: job({ stage: 'completed' }),
      target: 'paid',
      primaryDoc: null,
      attachedDocs: [invoice({ id: 'inv-006', total: 2598.84 })],
      saveJob: h.saveJob,
      helpers: h.helpers,
    });

    expect(h.navigate).toHaveBeenCalledWith('RecordPayment', { invoiceId: 'inv-006' });
    // The whole point: the job must NOT read Paid off the back of this tap.
    expect(h.saveJob).not.toHaveBeenCalled();
  });

  it('flips to paid without navigating when nothing is owed', async () => {
    const h = harness();

    await applyJobStageChange({
      job: job({ stage: 'completed' }),
      target: 'paid',
      primaryDoc: null,
      attachedDocs: [invoice({ total: 1000, paidTotal: 1000, stage: 'paid' })],
      saveJob: h.saveJob,
      helpers: h.helpers,
    });

    expect(h.saveJob).toHaveBeenCalledWith(expect.objectContaining({ stage: 'paid' }));
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('flips a cash job with no documents', async () => {
    const h = harness();

    await applyJobStageChange({
      job: job({ stage: 'completed' }),
      target: 'paid',
      primaryDoc: null,
      attachedDocs: [],
      saveJob: h.saveJob,
      helpers: h.helpers,
    });

    expect(h.saveJob).toHaveBeenCalledWith(expect.objectContaining({ stage: 'paid' }));
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('flips when unarchiving a closed job rather than demanding a payment', async () => {
    const h = harness();

    await applyJobStageChange({
      job: job({ stage: 'closed' }),
      target: 'paid',
      primaryDoc: null,
      attachedDocs: [invoice({ total: 1000, paidTotal: 0 })],
      saveJob: h.saveJob,
      helpers: h.helpers,
    });

    expect(h.saveJob).toHaveBeenCalledWith(expect.objectContaining({ stage: 'paid' }));
    expect(h.navigate).not.toHaveBeenCalled();
  });
});

describe('applyJobStageChange — other targets are untouched', () => {
  it('still saves a non-paid target even with an invoice owing', async () => {
    const h = harness();

    await applyJobStageChange({
      job: job({ stage: 'accepted' }),
      target: 'scheduled',
      primaryDoc: null,
      attachedDocs: [invoice({ total: 1000, paidTotal: 0 })],
      saveJob: h.saveJob,
      helpers: h.helpers,
    });

    expect(h.saveJob).toHaveBeenCalledWith(expect.objectContaining({ stage: 'scheduled' }));
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('still propagates `accepted` onto a quote doc in the quote lifecycle', async () => {
    const h = harness();
    // Fuller than the invoice fixtures above — this one is handed to the
    // real documentToQuote adapter, which walks materials/payments.
    const quoteDoc: any = {
      id: 'q1',
      type: 'quote',
      stage: 'quote_sent',
      total: 1000,
      paidTotal: 0,
      payments: [],
      materials: [],
      job: { name: 'A job' },
      createdAt: 1,
      updatedAt: 1,
    };

    await applyJobStageChange({
      job: job({ stage: 'quoted' }),
      target: 'accepted',
      primaryDoc: quoteDoc,
      attachedDocs: [quoteDoc],
      saveJob: h.saveJob,
      helpers: h.helpers,
    });

    // applyStageChange routes a quote save through saveQuote.
    expect(h.helpers.saveQuote).toHaveBeenCalled();
    expect(h.saveJob).toHaveBeenCalledWith(expect.objectContaining({ stage: 'accepted' }));
  });
});
