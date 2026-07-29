/**
 * The JobPreview email warm-up.
 *
 * Jul 2026 send audit: 40 tradies stalled on a finished, priced quote and
 * never pressed send. Generating the email at tap time — a writing task in
 * response to an action — was a chunk of that friction, so it now runs in the
 * background when the doc is saved. The properties that matter here are all
 * about it being *safe*: never a second generation for the same doc, never a
 * throw, and never a write that rolls back an edit made while it was in
 * flight.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const llm = vi.hoisted(() => ({
  generateQuoteEmail: vi.fn(async () => 'Written quote email'),
  generateInvoiceEmail: vi.fn(async () => 'Written invoice email'),
  getDefaultEmailBody: vi.fn(() => 'Template quote email'),
  getDefaultInvoiceEmailBody: vi.fn(() => 'Template invoice email'),
}));
vi.mock('../services/llmService', () => llm);

const store = vi.hoisted(() => ({
  state: {
    quotes: [] as any[],
    invoices: [] as any[],
    saveDraft: vi.fn(async () => {}),
    saveInvoice: vi.fn(async () => {}),
  },
}));
vi.mock('../store/useStore', () => ({ useStore: { getState: () => store.state } }));

import { shouldWarmEmailDraft, warmEmailDraft } from './emailDraft';
import type { Document } from '../types/document';
import type { BusinessSettings } from '../types';

const settings = { businessName: 'Hansen Decks' } as BusinessSettings;

function quoteDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: 'q1',
    type: 'quote',
    stage: 'draft',
    number: 'Q-001',
    createdAt: 0,
    updatedAt: 0,
    customerName: 'Sam',
    customerEmail: 'sam@example.com',
    job: { name: 'Deck restain', description: 'Sand and restain the back deck' },
    payments: [],
    materials: [{ name: 'Decking oil', quantity: 2, unit: 'each' }],
    laborRate: 80,
    laborHours: 6,
    laborTotal: 480,
    materialsSubtotal: 200,
    markup: 10,
    markupAmount: 20,
    subtotal: 700,
    gst: 70,
    total: 770,
    ...overrides,
  } as Document;
}

function invoiceDoc(overrides: Partial<Document> = {}): Document {
  return quoteDoc({
    id: 'i1',
    type: 'invoice',
    number: 'INV-001',
    dueDate: new Date('2026-08-12').getTime(),
    ...overrides,
  });
}

/** The legacy quote the store holds for the doc under test. */
function storedQuote(overrides: Record<string, any> = {}) {
  return { id: 'q1', notes: 'Gate code 4821', status: 'draft', ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.state.quotes = [storedQuote()];
  store.state.invoices = [{ id: 'i1', notes: '', status: 'draft' }];
});

describe('shouldWarmEmailDraft', () => {
  it('warms a saved draft with no body yet', () => {
    expect(shouldWarmEmailDraft(quoteDoc())).toBe(true);
  });

  it('skips a doc that already carries a body', () => {
    expect(shouldWarmEmailDraft(quoteDoc({ draftEmailBody: 'Already written' }))).toBe(false);
  });

  it('treats a whitespace-only body as no body', () => {
    expect(shouldWarmEmailDraft(quoteDoc({ draftEmailBody: '   ' }))).toBe(true);
  });

  it('skips docs that have left draft — those already went out', () => {
    expect(shouldWarmEmailDraft(quoteDoc({ stage: 'quote_sent' }))).toBe(false);
    expect(shouldWarmEmailDraft(quoteDoc({ stage: 'quote_accepted' }))).toBe(false);
    expect(shouldWarmEmailDraft(invoiceDoc({ stage: 'invoice_sent' }))).toBe(false);
  });

  it('skips a doc with no id, and nullish input', () => {
    expect(shouldWarmEmailDraft(quoteDoc({ id: '' }))).toBe(false);
    expect(shouldWarmEmailDraft(null)).toBe(false);
    expect(shouldWarmEmailDraft(undefined)).toBe(false);
  });
});

describe('warmEmailDraft', () => {
  it('generates the body and persists it to draftEmailBody', async () => {
    await warmEmailDraft(quoteDoc(), settings, { isPro: true });

    expect(llm.generateQuoteEmail).toHaveBeenCalledTimes(1);
    expect(llm.generateQuoteEmail.mock.calls[0][0]).toMatchObject({
      jobName: 'Deck restain',
      businessName: 'Hansen Decks',
      customerName: 'Sam',
    });
    expect(store.state.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'q1', draftEmailBody: 'Written quote email' }),
    );
  });

  it('writes onto the LATEST stored copy, not the snapshot it started from', async () => {
    // Simulates the tradie typing notes on JobPreview while generation runs.
    llm.generateQuoteEmail.mockImplementationOnce(async () => {
      store.state.quotes = [storedQuote({ notes: 'Gate code 4821 — dog on site' })];
      return 'Written quote email';
    });

    await warmEmailDraft(quoteDoc(), settings, { isPro: true });

    expect(store.state.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ notes: 'Gate code 4821 — dog on site' }),
    );
  });

  it('never generates twice for the same doc while one is in flight', async () => {
    let release: (body: string) => void = () => {};
    llm.generateQuoteEmail.mockImplementationOnce(
      () => new Promise<string>((resolve) => { release = resolve; }),
    );

    const first = warmEmailDraft(quoteDoc(), settings, { isPro: true });
    const second = warmEmailDraft(quoteDoc(), settings, { isPro: true });
    release('Written quote email');
    await Promise.all([first, second]);

    expect(llm.generateQuoteEmail).toHaveBeenCalledTimes(1);
    expect(store.state.saveDraft).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the doc already has a body', async () => {
    await warmEmailDraft(quoteDoc({ draftEmailBody: 'Already written' }), settings, { isPro: true });

    expect(llm.generateQuoteEmail).not.toHaveBeenCalled();
    expect(store.state.saveDraft).not.toHaveBeenCalled();
  });

  it('does nothing on the free tier — that template is local and instant', async () => {
    await warmEmailDraft(quoteDoc(), settings, { isPro: false });

    expect(llm.generateQuoteEmail).not.toHaveBeenCalled();
    expect(llm.getDefaultEmailBody).not.toHaveBeenCalled();
    expect(store.state.saveDraft).not.toHaveBeenCalled();
  });

  it('swallows a generation failure — the send flow still writes one on tap', async () => {
    llm.generateQuoteEmail.mockRejectedValueOnce(new Error('network down'));

    await expect(warmEmailDraft(quoteDoc(), settings, { isPro: true })).resolves.toBeUndefined();
    expect(store.state.saveDraft).not.toHaveBeenCalled();
  });

  it('recovers after a failure — the next warm-up for that doc still runs', async () => {
    llm.generateQuoteEmail.mockRejectedValueOnce(new Error('network down'));
    await warmEmailDraft(quoteDoc(), settings, { isPro: true });

    await warmEmailDraft(quoteDoc(), settings, { isPro: true });

    expect(llm.generateQuoteEmail).toHaveBeenCalledTimes(2);
    expect(store.state.saveDraft).toHaveBeenCalledTimes(1);
  });

  it('skips the write when the doc is not in the store yet', async () => {
    store.state.quotes = [];

    await warmEmailDraft(quoteDoc(), settings, { isPro: true });

    expect(store.state.saveDraft).not.toHaveBeenCalled();
  });

  it('skips the write when a body landed while generation was running', async () => {
    llm.generateQuoteEmail.mockImplementationOnce(async () => {
      store.state.quotes = [storedQuote({ draftEmailBody: 'Written on tap' })];
      return 'Written quote email';
    });

    await warmEmailDraft(quoteDoc(), settings, { isPro: true });

    expect(store.state.saveDraft).not.toHaveBeenCalled();
  });

  it('never lets a store write failure escape', async () => {
    store.state.saveDraft.mockRejectedValueOnce(new Error('offline'));

    await expect(warmEmailDraft(quoteDoc(), settings, { isPro: true })).resolves.toBeUndefined();
  });

  it('routes invoices through the invoice generator and saveInvoice', async () => {
    await warmEmailDraft(invoiceDoc(), settings, { isPro: true });

    expect(llm.generateInvoiceEmail).toHaveBeenCalledTimes(1);
    expect(llm.generateQuoteEmail).not.toHaveBeenCalled();
    expect(store.state.saveInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'i1', draftEmailBody: 'Written invoice email' }),
    );
  });
});
