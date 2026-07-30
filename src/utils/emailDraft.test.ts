/**
 * The JobPreview email warm-up.
 *
 * Jul 2026 send audit: 40 tradies stalled on a finished, priced quote and
 * never pressed send. Generating the email at tap time — a writing task in
 * response to an action — was a chunk of that friction, so it now runs in the
 * background when the doc is saved. The properties that matter are all about
 * it being *safe*: never a second generation for the same doc, never a throw,
 * no store write at all (saveDraft replaces the wizard's live editing buffer),
 * and never caching a body that is really the failure template.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const llm = vi.hoisted(() => ({
  generateQuoteEmail: vi.fn(async () => 'Written quote email'),
  generateInvoiceEmail: vi.fn(async () => 'Written invoice email'),
  getDefaultEmailBody: vi.fn(() => 'Template quote email'),
  getDefaultInvoiceEmailBody: vi.fn(() => 'Template invoice email'),
}));
vi.mock('../services/llmService', () => llm);

import {
  getWarmedEmailBody,
  resetWarmedEmailDrafts,
  shouldWarmEmailDraft,
  warmEmailDraft,
  whenEmailDraftWarm,
} from './emailDraft';
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

beforeEach(() => {
  vi.clearAllMocks();
  resetWarmedEmailDrafts();
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
  it('generates the body and leaves it ready for the send flow', async () => {
    await warmEmailDraft(quoteDoc(), settings, { isPro: true });

    expect(llm.generateQuoteEmail).toHaveBeenCalledTimes(1);
    expect(llm.generateQuoteEmail.mock.calls[0][0]).toMatchObject({
      jobName: 'Deck restain',
      businessName: 'Hansen Decks',
      customerName: 'Sam',
    });
    expect(getWarmedEmailBody('q1')).toBe('Written quote email');
  });

  // Guard, not decoration: saveDraft replaces `currentQuote`, the wizard's
  // live editing buffer. A background write landing while the tradie is in
  // MaterialsList silently reverts their unsaved line-item edits and resets
  // that screen's dirty check, so nothing prompts on the way out.
  it('never reaches for the store at all', () => {
    // Comments stripped — several of them explain this very rule.
    const code = readFileSync(resolve(__dirname, 'emailDraft.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/useStore|saveDraft|saveInvoice/);
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
  });

  it('exposes the in-flight run so the send flow can wait instead of re-generating', async () => {
    let release: (body: string) => void = () => {};
    llm.generateQuoteEmail.mockImplementationOnce(
      () => new Promise<string>((resolve) => { release = resolve; }),
    );

    const warming = warmEmailDraft(quoteDoc(), settings, { isPro: true });
    const pending = whenEmailDraftWarm('q1');
    expect(pending).toBeTruthy();

    release('Written quote email');
    await Promise.all([warming, pending]);

    expect(getWarmedEmailBody('q1')).toBe('Written quote email');
    expect(whenEmailDraftWarm('q1')).toBeUndefined();
  });

  it('does not re-generate once a body is already warm', async () => {
    await warmEmailDraft(quoteDoc(), settings, { isPro: true });
    await warmEmailDraft(quoteDoc(), settings, { isPro: true });

    expect(llm.generateQuoteEmail).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the doc already has a body', async () => {
    await warmEmailDraft(quoteDoc({ draftEmailBody: 'Already written' }), settings, { isPro: true });

    expect(llm.generateQuoteEmail).not.toHaveBeenCalled();
    expect(getWarmedEmailBody('q1')).toBeUndefined();
  });

  it('does nothing on the free tier — that template is local and instant', async () => {
    await warmEmailDraft(quoteDoc(), settings, { isPro: false });

    expect(llm.generateQuoteEmail).not.toHaveBeenCalled();
    expect(llm.getDefaultEmailBody).not.toHaveBeenCalled();
    expect(getWarmedEmailBody('q1')).toBeUndefined();
  });

  // generateQuoteEmail swallows network/server failures and returns the plain
  // template. Caching that would pin a Pro tradie to the generic email for
  // good, because every later path reads "a body exists" as "nothing to do".
  it('does not cache a body that is really the failure template', async () => {
    llm.generateQuoteEmail.mockResolvedValueOnce('Template quote email');

    await warmEmailDraft(quoteDoc(), settings, { isPro: true });

    expect(getWarmedEmailBody('q1')).toBeUndefined();
  });

  it('does not cache an empty body', async () => {
    llm.generateQuoteEmail.mockResolvedValueOnce('   ');

    await warmEmailDraft(quoteDoc(), settings, { isPro: true });

    expect(getWarmedEmailBody('q1')).toBeUndefined();
  });

  it('swallows a generation failure — the send flow still writes one on tap', async () => {
    llm.generateQuoteEmail.mockRejectedValueOnce(new Error('network down'));

    await expect(warmEmailDraft(quoteDoc(), settings, { isPro: true })).resolves.toBeUndefined();
    expect(getWarmedEmailBody('q1')).toBeUndefined();
  });

  it('recovers after a failure — the next warm-up for that doc still runs', async () => {
    llm.generateQuoteEmail.mockRejectedValueOnce(new Error('network down'));
    await warmEmailDraft(quoteDoc(), settings, { isPro: true });

    await warmEmailDraft(quoteDoc(), settings, { isPro: true });

    expect(llm.generateQuoteEmail).toHaveBeenCalledTimes(2);
    expect(getWarmedEmailBody('q1')).toBe('Written quote email');
  });

  it('routes invoices through the invoice generator', async () => {
    await warmEmailDraft(invoiceDoc(), settings, { isPro: true });

    expect(llm.generateInvoiceEmail).toHaveBeenCalledTimes(1);
    expect(llm.generateQuoteEmail).not.toHaveBeenCalled();
    expect(getWarmedEmailBody('i1')).toBe('Written invoice email');
  });

  it('keeps the cache bounded across a long session', async () => {
    for (let i = 0; i < 25; i++) {
      llm.generateQuoteEmail.mockResolvedValueOnce(`Written quote email ${i}`);
      await warmEmailDraft(quoteDoc({ id: `q-${i}` }), settings, { isPro: true });
    }

    // Oldest evicted, newest kept.
    expect(getWarmedEmailBody('q-0')).toBeUndefined();
    expect(getWarmedEmailBody('q-24')).toBe('Written quote email 24');
  });
});

/**
 * Which screens actually warm. warmEmailDraft's own behaviour is covered
 * above; what broke in testing was purely wiring — the warm-up existed but
 * only one of three routes to Send ever reached it, so the other two paid the
 * full generation wait. These are source-level on purpose: rendering either
 * screen is infeasible, and the regression is "the call site went missing",
 * which is exactly what reading the source catches.
 */
describe('warm-up entry points', () => {
  const sourceOf = (relativePath: string) =>
    readFileSync(resolve(__dirname, relativePath), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

  it('JobPreview warms on the viewing path, which its mount effect bails out of', () => {
    // JobPreviewScreen's mount effect early-returns on `viewing`, and the
    // save-path warm-up lives inside it. A tradie who built a quote, left,
    // and came back via "View job preview" therefore arrived at Send cold —
    // precisely the person the send audit is about. The warm-up must also
    // hang off a `viewing`-positive branch.
    expect(sourceOf('../screens/NewQuote/JobPreviewScreen.tsx'))
      .toMatch(/!viewing[\s\S]{0,200}?warmEmailDraft\(/);
  });

  it('ViewJob warms the doc it is showing — its Send had none of its own', () => {
    // ViewJobScreen's sticky bar drives the same SendDocumentDialog as the
    // wizard but never warmed anything, so sending an existing job from the
    // job screen always waited on generation.
    expect(sourceOf('../screens/ViewJobScreen.tsx')).toMatch(/warmEmailDraft\(/);
  });
});
