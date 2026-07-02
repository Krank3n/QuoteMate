import { describe, it, expect, vi } from 'vitest';
import {
  applyStageChange,
  markDocumentSent,
  type ApplyStageChangeHelpers,
} from '../applyStageChange';
import type { Document } from '../../types/document';

const NOW_MS = Date.parse('2026-05-01T00:00:00.000Z');

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    number: 'QU-1',
    stage: 'draft',
    type: 'quote',
    createdAt: NOW_MS,
    updatedAt: NOW_MS,
    customerName: 'Davo',
    job: { id: 'job-1', name: 'Fence', description: 'Colorbond fence', template: 'fence' },
    materials: [],
    laborRate: 85,
    laborHours: 8,
    laborTotal: 680,
    materialsSubtotal: 120,
    markup: 20,
    markupAmount: 160,
    subtotal: 800,
    gst: 96,
    total: 1056,
    payments: [],
    paidTotal: 0,
    balanceDue: 1056,
    ...overrides,
  } as Document;
}

function makeHelpers() {
  const saveQuote = vi.fn().mockResolvedValue(undefined);
  const saveInvoice = vi.fn().mockResolvedValue(undefined);
  const createInvoiceFromQuote = vi.fn().mockResolvedValue(undefined);
  const helpers: ApplyStageChangeHelpers = { saveQuote, saveInvoice, createInvoiceFromQuote };
  return { helpers, saveQuote, saveInvoice, createInvoiceFromQuote };
}

describe('applyStageChange first-send stamping', () => {
  it('stamps sentAt+sendMethod on draft→quote_sent', async () => {
    const { helpers, saveQuote } = makeHelpers();
    await applyStageChange(makeDoc({ stage: 'draft' }), 'quote_sent', helpers, 'email');

    expect(saveQuote).toHaveBeenCalledTimes(1);
    const saved = saveQuote.mock.calls[0][0];
    expect(saved.status).toBe('sent');
    expect(typeof saved.sentAt).toBe('number');
    expect(saved.sendMethod).toBe('email');
  });

  it('does not overwrite existing sentAt (first-send wins)', async () => {
    const { helpers, saveQuote } = makeHelpers();
    const doc = makeDoc({ stage: 'quote_sent', sentAt: 111, sendMethod: 'email' });
    await applyStageChange(doc, 'quote_sent', helpers, 'sms');

    const saved = saveQuote.mock.calls[0][0];
    expect(saved.sentAt).toBe(111);
    expect(saved.sendMethod).toBe('email');
  });

  it('stamps invoice draft→invoice_sent', async () => {
    const { helpers, saveInvoice } = makeHelpers();
    const doc = makeDoc({ type: 'invoice', number: 'IN-1', stage: 'draft' });
    await applyStageChange(doc, 'invoice_sent', helpers, 'email');

    expect(saveInvoice).toHaveBeenCalledTimes(1);
    const saved = saveInvoice.mock.calls[0][0];
    expect(saved.status).toBe('sent');
    expect(typeof saved.sentAt).toBe('number');
    expect(saved.sendMethod).toBe('email');
  });

  it('no stamp for quote_accepted target', async () => {
    const { helpers, saveQuote } = makeHelpers();
    await applyStageChange(makeDoc({ stage: 'quote_sent' }), 'quote_accepted', helpers, 'email');

    const saved = saveQuote.mock.calls[0][0];
    expect(saved.status).toBe('accepted');
    expect(saved.sentAt).toBeUndefined();
    expect(saved.sendMethod).toBeUndefined();
  });

  it('defaults sendMethod to manual', async () => {
    const { helpers, saveQuote } = makeHelpers();
    await applyStageChange(makeDoc({ stage: 'draft' }), 'quote_sent', helpers);

    const saved = saveQuote.mock.calls[0][0];
    expect(typeof saved.sentAt).toBe('number');
    expect(saved.sendMethod).toBe('manual');
  });
});

describe('markDocumentSent', () => {
  it('marks draft quote via sms', async () => {
    const { helpers, saveQuote } = makeHelpers();
    await markDocumentSent(makeDoc({ stage: 'draft' }), 'sms', helpers);

    expect(saveQuote).toHaveBeenCalledTimes(1);
    const saved = saveQuote.mock.calls[0][0];
    expect(saved.status).toBe('sent');
    expect(saved.sendMethod).toBe('sms');
    expect(typeof saved.sentAt).toBe('number');
  });

  it('targets invoice_sent for invoice docs', async () => {
    const { helpers, saveInvoice, saveQuote } = makeHelpers();
    const doc = makeDoc({ type: 'invoice', number: 'IN-1', stage: 'draft' });
    await markDocumentSent(doc, 'share', helpers);

    expect(saveQuote).not.toHaveBeenCalled();
    expect(saveInvoice).toHaveBeenCalledTimes(1);
    const saved = saveInvoice.mock.calls[0][0];
    expect(saved.status).toBe('sent');
    expect(saved.sendMethod).toBe('share');
  });

  it('skips when already quote_sent', async () => {
    const { helpers, saveQuote } = makeHelpers();
    await markDocumentSent(makeDoc({ stage: 'quote_sent' }), 'sms', helpers);

    expect(saveQuote).not.toHaveBeenCalled();
  });

  it('skips when quote_accepted (downgrade)', async () => {
    const { helpers, saveQuote } = makeHelpers();
    await markDocumentSent(makeDoc({ stage: 'quote_accepted' }), 'export_pdf', helpers);

    expect(saveQuote).not.toHaveBeenCalled();
  });
});

// The "Marked as sent" Snackbar's Undo rewinds a freshly-sent doc back to
// draft through applyStageChange(doc, 'draft', ...) — the same path the
// StageSheet uses for a sent→draft downgrade. It must restore the draft
// status without disturbing the first-send audit stamp.
describe('undo (sent→draft downgrade via the stage path)', () => {
  it('sent→draft downgrade via the stage path restores draft status', async () => {
    const { helpers, saveQuote } = makeHelpers();
    const doc = makeDoc({ stage: 'quote_sent', sentAt: 111, sendMethod: 'sms' });
    await applyStageChange(doc, 'draft', helpers);

    expect(saveQuote).toHaveBeenCalledTimes(1);
    const saved = saveQuote.mock.calls[0][0];
    expect(saved.status).toBe('draft');
  });

  it('sent→draft downgrade restores draft status for invoices', async () => {
    const { helpers, saveInvoice } = makeHelpers();
    const doc = makeDoc({ type: 'invoice', number: 'IN-1', stage: 'invoice_sent', sentAt: 222, sendMethod: 'share' });
    await applyStageChange(doc, 'draft', helpers);

    expect(saveInvoice).toHaveBeenCalledTimes(1);
    const saved = saveInvoice.mock.calls[0][0];
    expect(saved.status).toBe('draft');
  });

  it('undo after markDocumentSent leaves sentAt intact', async () => {
    const { helpers, saveQuote } = makeHelpers();
    // 1) Send from draft — stamps sentAt + sendMethod.
    await markDocumentSent(makeDoc({ stage: 'draft' }), 'sms', helpers);
    const sent = saveQuote.mock.calls[0][0];
    expect(typeof sent.sentAt).toBe('number');
    expect(sent.sendMethod).toBe('sms');

    // 2) Undo: rewind the now-sent doc to draft. The audit fields survive.
    const sentDoc = makeDoc({ stage: 'quote_sent', sentAt: sent.sentAt, sendMethod: 'sms' });
    await applyStageChange(sentDoc, 'draft', helpers);
    const reverted = saveQuote.mock.calls[1][0];
    expect(reverted.status).toBe('draft');
    expect(reverted.sentAt).toBe(sent.sentAt);
    expect(reverted.sendMethod).toBe('sms');
  });
});
