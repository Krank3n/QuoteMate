/**
 * applyStageChange, and the one thing accepting a quote now has to do besides
 * saving it: take the job's other options off the table.
 *
 * The supersede is best-effort ON PURPOSE. "Mark Approved" records a decision
 * a human just made about money; losing it because sibling bookkeeping threw
 * would be a far worse bug than a job briefly showing two live quotes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { applyStageChange, markDocumentSent } from './applyStageChange';
import type { Document } from '../types/document';

function helpers(over: Partial<Record<string, any>> = {}) {
  return {
    saveQuote: vi.fn(async () => {}),
    saveInvoice: vi.fn(async () => {}),
    createInvoiceFromQuote: vi.fn(async () => ({ id: 'inv-1', jobId: 'job-1' } as any)),
    supersedeOtherQuotes: vi.fn(async () => ['opt-2']),
    navigation: { navigate: vi.fn() },
    ...over,
  };
}

function quoteDoc(over: Partial<Document> = {}): Document {
  return {
    id: 'opt-1',
    jobId: 'job-1',
    type: 'quote',
    stage: 'quote_sent',
    number: 'QU-001',
    total: 6389.02,
    job: { name: 'Aircon replacement' },
    materials: [],
    payments: [],
    ...over,
  } as unknown as Document;
}

beforeEach(() => vi.clearAllMocks());

describe('accepting a quote', () => {
  it('supersedes the job’s other options', async () => {
    const h = helpers();

    await applyStageChange(quoteDoc(), 'quote_accepted', h as any);

    expect(h.supersedeOtherQuotes).toHaveBeenCalledWith('opt-1');
  });

  it('saves the accepted quote BEFORE superseding the others', async () => {
    // Order matters: if the supersede ran first and the save then failed, the
    // job would be left with every option cancelled and none accepted.
    const h = helpers();

    await applyStageChange(quoteDoc(), 'quote_accepted', h as any);

    expect(h.saveQuote.mock.invocationCallOrder[0])
      .toBeLessThan(h.supersedeOtherQuotes.mock.invocationCallOrder[0]);
  });

  it('records the accept even when superseding throws', async () => {
    const h = helpers({ supersedeOtherQuotes: vi.fn(async () => { throw new Error('offline'); }) });

    await expect(applyStageChange(quoteDoc(), 'quote_accepted', h as any)).resolves.toBeUndefined();

    expect(h.saveQuote).toHaveBeenCalledTimes(1);
    expect(h.saveQuote.mock.calls[0][0].status).toBe('accepted');
  });
});

describe('every other transition', () => {
  it('does not supersede when a quote is merely sent', async () => {
    const h = helpers();

    await applyStageChange(quoteDoc({ stage: 'draft' }), 'quote_sent', h as any);

    expect(h.supersedeOtherQuotes).not.toHaveBeenCalled();
    expect(h.saveQuote.mock.calls[0][0].status).toBe('sent');
  });

  it('does not supersede when a quote is rejected', async () => {
    const h = helpers();

    await applyStageChange(quoteDoc(), 'quote_rejected', h as any);

    expect(h.supersedeOtherQuotes).not.toHaveBeenCalled();
  });

  it('does not supersede when a quote is cancelled', async () => {
    const h = helpers();

    await applyStageChange(quoteDoc(), 'cancelled', h as any);

    expect(h.supersedeOtherQuotes).not.toHaveBeenCalled();
  });

  it('does not supersede on the convert-to-invoice path', async () => {
    // Converting is not a choice between options — it is the accepted work
    // moving forward. Anything competing was already superseded at accept.
    const h = helpers();

    await applyStageChange(quoteDoc({ stage: 'quote_accepted' }), 'invoice_sent', h as any);

    expect(h.supersedeOtherQuotes).not.toHaveBeenCalled();
    expect(h.createInvoiceFromQuote).toHaveBeenCalledTimes(1);
  });

  it('does not supersede when an invoice is marked paid', async () => {
    const h = helpers();

    await applyStageChange(
      quoteDoc({ type: 'invoice', stage: 'invoice_sent' }) as any,
      'paid',
      h as any,
    );

    expect(h.supersedeOtherQuotes).not.toHaveBeenCalled();
    expect(h.saveInvoice).toHaveBeenCalledTimes(1);
  });
});

describe('markDocumentSent', () => {
  it('moves a draft quote to sent and stamps the channel', async () => {
    const h = helpers();

    await markDocumentSent(quoteDoc({ stage: 'draft' }), 'sms', h as any);

    const saved = h.saveQuote.mock.calls[0][0];
    expect(saved.status).toBe('sent');
    expect(saved.sendMethod).toBe('sms');
    expect(typeof saved.sentAt).toBe('number');
  });

  it('no-ops on a doc that has already left draft, so a re-share never supersedes', async () => {
    const h = helpers();

    await markDocumentSent(quoteDoc({ stage: 'quote_accepted' }), 'sms', h as any);

    expect(h.saveQuote).not.toHaveBeenCalled();
    expect(h.supersedeOtherQuotes).not.toHaveBeenCalled();
  });
});
