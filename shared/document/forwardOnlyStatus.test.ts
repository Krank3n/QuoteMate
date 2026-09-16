/**
 * A legacy save from a stale copy must never rewind the unified stage; a
 * deliberate stage change must still be able to. See forwardOnlyStatus.ts for
 * the 16 Sep 2026 drift that made this necessary.
 */
import { describe, it, expect } from 'vitest';

import { holdStatusForward } from './forwardOnlyStatus';

describe('holdStatusForward — quotes', () => {
  it('REGRESSION: a stale draft copy saved after the send keeps the sent status', () => {
    // The preview screen's currentQuote never learned about the send.
    expect(holdStatusForward({ status: 'draft' }, 'quote_sent', 'quote')).toBe('sent');
  });

  it('a stale sent copy saved after the customer accepted keeps accepted', () => {
    expect(holdStatusForward({ status: 'sent' }, 'quote_accepted', 'quote')).toBe('accepted');
  });

  it('a stale copy never un-cancels', () => {
    expect(holdStatusForward({ status: 'draft' }, 'cancelled', 'quote')).toBe('cancelled');
  });

  it('a forward move passes through untouched', () => {
    expect(holdStatusForward({ status: 'sent' }, 'draft', 'quote')).toBe('sent');
    expect(holdStatusForward({ status: 'accepted' }, 'quote_sent', 'quote')).toBe('accepted');
  });

  it('a same-tier status passes through: a re-send after a decline is live again', () => {
    expect(holdStatusForward({ status: 'sent' }, 'quote_rejected', 'quote')).toBe('sent');
  });

  it('an unchanged status is returned as-is, including undefined', () => {
    expect(holdStatusForward({ status: 'draft' }, 'draft', 'quote')).toBe('draft');
    expect(holdStatusForward({}, 'draft', 'quote')).toBeUndefined();
  });

  it('with no unified row yet there is nothing to hold against', () => {
    expect(holdStatusForward({ status: 'draft' }, null, 'quote')).toBe('draft');
    expect(holdStatusForward({ status: 'draft' }, undefined, 'quote')).toBe('draft');
  });

  it('a deliberate stage change may rewind: Undo "marked sent" still works', () => {
    expect(holdStatusForward({ status: 'draft' }, 'quote_sent', 'quote', { stageChange: true })).toBe('draft');
  });
});

describe('holdStatusForward — invoices', () => {
  it('REGRESSION: a stale draft copy saved after the invoice went out keeps sent', () => {
    expect(holdStatusForward({ status: 'draft', total: 500, paidAmount: 0 }, 'invoice_sent', 'invoice')).toBe('sent');
  });

  it('a stale sent copy saved after a part payment keeps partial', () => {
    expect(holdStatusForward({ status: 'sent', total: 500, paidAmount: 0 }, 'partially_paid', 'invoice')).toBe('partial');
  });

  it('a stale copy saved after settlement keeps paid', () => {
    expect(holdStatusForward({ status: 'sent', total: 500, paidAmount: 100 }, 'paid', 'invoice')).toBe('paid');
  });

  it('recording a payment is a forward move and passes through', () => {
    expect(holdStatusForward({ status: 'partial', total: 500, paidAmount: 200 }, 'invoice_sent', 'invoice')).toBe('partial');
    expect(holdStatusForward({ status: 'paid', total: 500, paidAmount: 500 }, 'partially_paid', 'invoice')).toBe('paid');
  });

  it('a deliberate stage change may rewind an invoice too', () => {
    expect(holdStatusForward({ status: 'draft', total: 500, paidAmount: 0 }, 'invoice_sent', 'invoice', { stageChange: true })).toBe('draft');
  });
});
