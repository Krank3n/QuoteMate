/**
 * The end-of-wizard footer's shape.
 *
 * Jul 2026 send audit: 75% of tradies never send. JobPreview's footer gave
 * "Take Payment" equal billing with Send on a quote the customer had never
 * seen. Pins the rule that replaced it — while a doc has never left draft,
 * Send is the only thing on the row; once it's sent, the pair returns.
 */
import { describe, it, expect } from 'vitest';

import { resolvePreviewFooterActions } from './previewFooterActions';
import type { Document } from '../../types/document';

function doc(overrides: Partial<Document> = {}): Document {
  return {
    id: 'q1',
    type: 'quote',
    stage: 'draft',
    ...overrides,
  } as Document;
}

const PLATFORMS = ['android', 'web'] as const;

describe('resolvePreviewFooterActions — a quote that has never left draft', () => {
  it.each(PLATFORMS)('gives Send the whole footer on %s', (platform) => {
    const actions = resolvePreviewFooterActions({ doc: doc(), platform });

    expect(actions.payment).toBeNull();
    expect(actions.send).toEqual({ label: 'Send Quote' });
  });

  it('gives Send the whole footer on ios, as it always did', () => {
    const actions = resolvePreviewFooterActions({ doc: doc(), platform: 'ios' });

    expect(actions.payment).toBeNull();
    expect(actions.send).toEqual({ label: 'Send Quote' });
  });

  // Invoices are the exception. The work is done, the tradie is standing in
  // front of the customer, and convertDocumentToInvoice leaves the new
  // invoice on stage 'draft' — so "draft" here does NOT mean unseen.
  it('keeps the pair for a draft invoice', () => {
    const actions = resolvePreviewFooterActions({
      doc: doc({ type: 'invoice' }),
      platform: 'android',
    });

    expect(actions.payment).toEqual({ label: 'Take Payment' });
    expect(actions.send).toEqual({ label: 'Send Invoice' });
  });

  // A draft that somehow carries a send stamp has been in front of a
  // customer — treat it as sent, not as untouched work.
  it('treats a draft with a send stamp as sent', () => {
    const actions = resolvePreviewFooterActions({
      doc: doc({ sentAt: 1_700_000_000_000 }),
      platform: 'android',
    });

    expect(actions.payment).toEqual({ label: 'Tap to Pay' });
  });
});

describe('resolvePreviewFooterActions — once the doc is out the door', () => {
  it.each(PLATFORMS)('restores the payment slot on %s', (platform) => {
    const actions = resolvePreviewFooterActions({
      doc: doc({ stage: 'quote_sent', sentAt: 1 }),
      platform,
    });

    expect(actions.payment).toEqual({ label: 'Tap to Pay' });
    expect(actions.send).toEqual({ label: 'Send Quote' });
  });

  // The pay link is server-minted Square checkout, so iOS gets the slot
  // too — only the label differs: "Tap to Pay" promises the one flow Apple
  // hasn't approved yet, so iOS says "Take Payment" instead. (The in-sheet
  // Tap to Pay row self-gates via the config/squareTapToPay flag.)
  it('restores the slot on iOS as Take Payment, never Tap to Pay', () => {
    const actions = resolvePreviewFooterActions({
      doc: doc({ stage: 'quote_sent', sentAt: 1 }),
      platform: 'ios',
    });

    expect(actions.payment).toEqual({ label: 'Take Payment' });
    expect(actions.send).toEqual({ label: 'Send Quote' });
  });

  it.each([...PLATFORMS, 'ios'] as const)(
    'labels the slot Take Deposit when a deposit is owed on %s',
    (platform) => {
      const actions = resolvePreviewFooterActions({
        doc: doc({ stage: 'quote_sent', sentAt: 1, depositAmount: 500 }),
        platform,
      });

      expect(actions.payment).toEqual({ label: 'Take Deposit' });
    },
  );

  it.each([...PLATFORMS, 'ios'] as const)(
    'labels the slot Take Payment on an invoice on %s',
    (platform) => {
      const actions = resolvePreviewFooterActions({
        doc: doc({ type: 'invoice', stage: 'invoice_sent', sentAt: 1 }),
        platform,
      });

      expect(actions.payment).toEqual({ label: 'Take Payment' });
      expect(actions.send).toEqual({ label: 'Send Invoice' });
    },
  );
});

describe('resolvePreviewFooterActions — nothing to act on', () => {
  it('offers neither button without a doc', () => {
    expect(resolvePreviewFooterActions({ doc: null, platform: 'android' })).toEqual({
      payment: null,
      send: null,
    });
  });
});
