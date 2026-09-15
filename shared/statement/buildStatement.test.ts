import { describe, it, expect } from 'vitest';
import {
  buildStatement,
  invoiceIssueDateMs,
  statementToCsv,
  csvField,
  isoDateInZone,
  statementPeriodLabel,
  type StatementDocumentInput,
} from './buildStatement';

// Noon UTC keeps the calendar date the same in UTC and in Sydney.
const T = (y: number, m: number, d: number, h = 12) => Date.UTC(y, m - 1, d, h);

// Last financial year: [1 Jul 2025, 1 Jul 2026)
const FY = { fromMs: T(2025, 7, 1, 0), toMs: T(2026, 7, 1, 0) };
const REGISTERED = { gstRegistered: true };
const NOT_REGISTERED = { gstRegistered: false };

function inv(over: Partial<StatementDocumentInput> & { id: string }): StatementDocumentInput {
  return {
    number: `IN-${over.id}`,
    type: 'invoice',
    stage: 'invoice_sent',
    customerName: 'Sam Customer',
    createdAt: T(2026, 3, 10),
    subtotal: 100,
    gst: 10,
    total: 110,
    payments: [],
    ...over,
  };
}

describe('buildStatement — invoices issued', () => {
  it('includes an invoice dated exactly at fromMs and excludes one dated exactly at toMs', () => {
    const data = buildStatement(
      [inv({ id: 'a', createdAt: FY.fromMs }), inv({ id: 'b', createdAt: FY.toMs }), inv({ id: 'c', createdAt: FY.toMs - 1 })],
      FY,
      REGISTERED,
    );
    expect(data.invoices.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('excludes cancelled documents from both tables', () => {
    const data = buildStatement(
      [inv({ id: 'x', stage: 'cancelled', payments: [{ amount: 50, paidAt: T(2026, 1, 5), method: 'cash' }] })],
      FY,
      REGISTERED,
    );
    expect(data.invoices).toEqual([]);
    expect(data.payments).toEqual([]);
  });

  it('excludes drafts', () => {
    const data = buildStatement([inv({ id: 'd', stage: 'draft' })], FY, REGISTERED);
    expect(data.invoices).toEqual([]);
  });

  it('excludes quotes from invoices issued even when sent or accepted', () => {
    const data = buildStatement(
      [inv({ id: 'q1', type: 'quote', stage: 'quote_sent' }), inv({ id: 'q2', type: 'quote', stage: 'quote_accepted' })],
      FY,
      REGISTERED,
    );
    expect(data.invoices).toEqual([]);
    expect(data.summary.invoicedTotal).toBe(0);
  });

  it('an invoice issued before the range with a payment in range appears in payments only', () => {
    const data = buildStatement(
      [inv({
        id: 'old',
        createdAt: T(2025, 5, 20),
        stage: 'paid',
        payments: [{ amount: 110, paidAt: T(2025, 8, 2), method: 'bank' }],
      })],
      FY,
      REGISTERED,
    );
    expect(data.invoices).toEqual([]);
    expect(data.payments).toHaveLength(1);
    expect(data.payments[0]).toMatchObject({ documentNumber: 'IN-old', amount: 110, method: 'bank' });
    expect(data.summary.invoicedTotal).toBe(0);
    expect(data.summary.receivedTotal).toBe(110);
  });

  it('documentDate backdating moves an invoice into the prior period', () => {
    const doc = inv({ id: 'back', createdAt: T(2026, 7, 3), documentDate: T(2026, 6, 28) });
    const lastFy = buildStatement([doc], FY, REGISTERED);
    const thisFy = buildStatement([doc], { fromMs: T(2026, 7, 1, 0), toMs: T(2027, 7, 1, 0) }, REGISTERED);
    expect(lastFy.invoices.map((r) => r.id)).toEqual(['back']);
    expect(thisFy.invoices).toEqual([]);
  });

  it('gstRegistered false: no gst on rows and no gstCollected in the summary', () => {
    const data = buildStatement([inv({ id: 'n', gst: 0, subtotal: 110 })], FY, NOT_REGISTERED);
    expect(data.gstRegistered).toBe(false);
    expect('gst' in data.invoices[0]).toBe(false);
    expect('gstCollected' in data.summary).toBe(false);
    expect(data.summary.invoicedTotal).toBe(110);
  });

  it('keeps the GST column when an in-range invoice carried GST, whatever the setting says today', () => {
    const data = buildStatement([inv({ id: 'g', subtotal: 1000, gst: 100, total: 1100 })], FY, NOT_REGISTERED);
    expect(data.gstRegistered).toBe(true);
    expect(data.invoices[0].gst).toBe(100);
    expect(data.summary.gstCollected).toBe(100);
  });

  it('registered inclusive pricing: the gst column equals doc.gst', () => {
    // Inclusive: $110 entered, $10 is the 1/11 component already extracted on the doc.
    const data = buildStatement([inv({ id: 'i', subtotal: 100, gst: 10, total: 110 })], FY, REGISTERED);
    expect(data.invoices[0].gst).toBe(10);
    expect(data.summary.gstCollected).toBe(10);
  });

  it('outstanding sums the balances of the in-range invoices only', () => {
    const data = buildStatement(
      [
        inv({ id: '1', stage: 'partially_paid', payments: [{ amount: 40, paidAt: T(2026, 3, 20), method: 'cash' }] }),
        inv({ id: '2', stage: 'paid', payments: [{ amount: 110, paidAt: T(2026, 3, 20), method: 'bank' }] }),
        inv({ id: '3' }),
        inv({ id: 'out', createdAt: T(2024, 1, 1) }), // issued before the range: not counted
      ],
      FY,
      REGISTERED,
    );
    expect(data.invoices.map((r) => r.balance)).toEqual([70, 0, 110]);
    expect(data.summary.outstandingTotal).toBe(180);
    expect(data.summary.invoiceCount).toBe(3);
  });

  it('sorts invoices by issue date', () => {
    const data = buildStatement(
      [inv({ id: 'late', createdAt: T(2026, 5, 1) }), inv({ id: 'early', createdAt: T(2025, 9, 1) })],
      FY,
      REGISTERED,
    );
    expect(data.invoices.map((r) => r.id)).toEqual(['early', 'late']);
  });
});

describe('buildStatement — balances are as at the end of the period', () => {
  it('a payment made after the period leaves the invoice outstanding inside it', () => {
    const data = buildStatement(
      [inv({
        id: 'jun',
        createdAt: T(2026, 6, 20),
        subtotal: 1000,
        gst: 100,
        total: 1100,
        payments: [{ amount: 1100, paidAt: T(2026, 7, 5), method: 'bank' }],
      })],
      FY,
      REGISTERED,
    );
    expect(data.invoices[0]).toMatchObject({ paid: 0, balance: 1100 });
    expect(data.summary.outstandingTotal).toBe(1100);
    expect(data.summary.receivedTotal).toBe(0);
  });

  it('ignores a stale stored balanceDue and paidTotal', () => {
    const data = buildStatement([inv({ id: 'stale', paidTotal: 110, balanceDue: 0 })], FY, REGISTERED);
    expect(data.invoices[0]).toMatchObject({ paid: 0, balance: 110 });
    expect(data.summary.outstandingTotal).toBe(110);
  });

  it('a legacy invoice with a total and no ledger is outstanding in full', () => {
    const data = buildStatement([inv({ id: 'legacy', payments: undefined })], FY, REGISTERED);
    expect(data.invoices[0]).toMatchObject({ paid: 0, balance: 110 });
  });

  it('never shows a negative balance when more was paid than invoiced', () => {
    const data = buildStatement(
      [inv({ id: 'over', payments: [{ amount: 150, paidAt: T(2026, 3, 20), method: 'cash' }] })],
      FY,
      REGISTERED,
    );
    expect(data.invoices[0]).toMatchObject({ paid: 150, balance: 0 });
  });
});

describe('buildStatement — payments received', () => {
  it('counts a deposit paid on a quote', () => {
    const data = buildStatement(
      [inv({
        id: 'q',
        type: 'quote',
        stage: 'quote_accepted',
        payments: [{ amount: 250, paidAt: T(2026, 2, 14), method: 'square' }],
      })],
      FY,
      REGISTERED,
    );
    expect(data.invoices).toEqual([]);
    expect(data.payments).toHaveLength(1);
    expect(data.payments[0]).toMatchObject({ documentNumber: 'IN-q', method: 'square', amount: 250 });
    expect(data.summary.receivedTotal).toBe(250);
    expect(data.summary.paymentCount).toBe(1);
  });

  it('applies from-inclusive / to-exclusive to paidAt and skips non-positive amounts', () => {
    const data = buildStatement(
      [inv({
        id: 'p',
        payments: [
          { amount: 10, paidAt: FY.fromMs, method: 'cash' },
          { amount: 20, paidAt: FY.toMs, method: 'cash' },
          { amount: 0, paidAt: T(2026, 1, 1), method: 'cash' },
          { amount: -5, paidAt: T(2026, 1, 1), method: 'cash' },
        ],
      })],
      FY,
      REGISTERED,
    );
    expect(data.payments.map((p) => p.amount)).toEqual([10]);
  });

  it('subtotals per method in a fixed order and labels a missing method as unrecorded', () => {
    const data = buildStatement(
      [inv({
        id: 'm',
        payments: [
          { amount: 1, paidAt: T(2026, 1, 1) },
          { amount: 2, paidAt: T(2026, 1, 2), method: 'cash' },
          { amount: 3, paidAt: T(2026, 1, 3), method: 'square' },
          { amount: 4, paidAt: T(2026, 1, 4), method: 'square' },
        ],
      })],
      FY,
      REGISTERED,
    );
    expect(data.paymentsByMethod).toEqual([
      { method: 'square', amount: 7, count: 2 },
      { method: 'cash', amount: 2, count: 1 },
      { method: 'unrecorded', amount: 1, count: 1 },
    ]);
  });

  it('sorts payments by paidAt', () => {
    const data = buildStatement(
      [inv({
        id: 's',
        payments: [
          { amount: 1, paidAt: T(2026, 4, 1), method: 'cash' },
          { amount: 2, paidAt: T(2025, 10, 1), method: 'cash' },
        ],
      })],
      FY,
      REGISTERED,
    );
    expect(data.payments.map((p) => p.amount)).toEqual([2, 1]);
  });
});

describe('buildStatement — rounding and empties', () => {
  it('rounds every figure to 2dp', () => {
    const data = buildStatement(
      [
        inv({ id: 'r', subtotal: 33.335, gst: 3.3335, total: 36.6685 }),
        inv({
          id: 'pp',
          payments: [
            { amount: 0.1, paidAt: T(2026, 1, 1), method: 'cash' },
            { amount: 0.2, paidAt: T(2026, 1, 2), method: 'cash' },
            { amount: 0.3, paidAt: T(2026, 1, 3), method: 'cash' },
          ],
        }),
      ],
      FY,
      REGISTERED,
    );
    expect(data.invoices.find((r) => r.id === 'r')).toMatchObject({ subtotal: 33.34, gst: 3.33, total: 36.67, balance: 36.67 });
    expect(data.summary.receivedTotal).toBe(0.6);
    expect(data.summary.invoicedTotal).toBe(146.67); // 36.67 + 110
  });

  it('an empty range yields empty tables and a zero summary', () => {
    const data = buildStatement([inv({ id: 'z' })], { fromMs: T(2019, 1, 1), toMs: T(2019, 2, 1) }, REGISTERED);
    expect(data.invoices).toEqual([]);
    expect(data.payments).toEqual([]);
    expect(data.paymentsByMethod).toEqual([]);
    expect(data.summary).toEqual({
      invoicedTotal: 0,
      gstCollected: 0,
      receivedTotal: 0,
      outstandingTotal: 0,
      invoiceCount: 0,
      paymentCount: 0,
    });
  });

  it('tolerates null/undefined documents and payment arrays', () => {
    const data = buildStatement([null as any, inv({ id: 'np', payments: null })], FY, REGISTERED);
    expect(data.invoices).toHaveLength(1);
    expect(data.payments).toEqual([]);
  });
});

describe('invoiceIssueDateMs — the date the invoice PDF prints', () => {
  it('prefers documentDate, then issueDate, then createdAt', () => {
    expect(invoiceIssueDateMs({ documentDate: 3, issueDate: 2, createdAt: 1 })).toBe(3);
    expect(invoiceIssueDateMs({ issueDate: 2, createdAt: 1 })).toBe(2);
    expect(invoiceIssueDateMs({ createdAt: 1 })).toBe(1);
  });

  it('treats 0/null/undefined as missing, like the || chain it replaces', () => {
    expect(invoiceIssueDateMs({ documentDate: 0, issueDate: null, createdAt: 7 })).toBe(7);
    expect(invoiceIssueDateMs({})).toBe(0);
  });

  it('accepts Dates and Firestore-Timestamp-like values (the legacy invoice record carries Dates)', () => {
    const ms = T(2026, 2, 2);
    expect(invoiceIssueDateMs({ issueDate: new Date(ms) })).toBe(ms);
    expect(invoiceIssueDateMs({ createdAt: { toDate: () => new Date(ms) } })).toBe(ms);
  });

  it('accepts the JSON-round-tripped {_seconds} shape a server read hands back', () => {
    const ms = T(2026, 2, 2);
    expect(invoiceIssueDateMs({ issueDate: { _seconds: ms / 1000, _nanoseconds: 0 } })).toBe(ms);
    // An invoice created in the new year but issued in February still lands
    // in the period its issue date falls in.
    const data = buildStatement(
      [inv({ id: 'ts', createdAt: T(2026, 7, 3), issueDate: { _seconds: ms / 1000, _nanoseconds: 0 } })],
      FY,
      REGISTERED,
    );
    expect(data.invoices.map((r) => r.dateMs)).toEqual([ms]);
  });
});

describe('statementToCsv', () => {
  const both = buildStatement(
    [
      inv({
        id: 'c',
        number: 'IN-7',
        customerName: 'Smith, "Bob"\nUnit 2',
        createdAt: T(2026, 3, 10),
        stage: 'partially_paid',
        payments: [{ amount: 50, paidAt: T(2026, 3, 12), method: 'bank' }],
      }),
    ],
    FY,
    REGISTERED,
  );

  it('quotes a customer name holding a comma, a quote and a newline (RFC 4180)', () => {
    const csv = statementToCsv(both, 'UTC');
    expect(csv).toContain('"Smith, ""Bob""\nUnit 2"');
    // Exactly two data lines plus the header once the quoted newline is accounted for.
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(3);
  });

  it('carries a leading section column and one row per table entry', () => {
    const lines = statementToCsv(both, 'UTC').split('\r\n').filter(Boolean);
    expect(lines[0]).toBe('section,date,number,customer,status,method,subtotal,gst,total,paid,balance,amount');
    expect(lines[1].startsWith('invoice,2026-03-10,IN-7,')).toBe(true);
    expect(lines[1]).toContain(',Part paid,,100,10,110,50,60,');
    expect(lines[2].startsWith('payment,2026-03-12,IN-7,')).toBe(true);
    expect(lines[2]).toContain(',,Bank transfer,,,,,,50');
  });

  it('omits the gst column when not registered', () => {
    const data = buildStatement([inv({ id: 'n', gst: 0 })], FY, NOT_REGISTERED);
    const lines = statementToCsv(data, 'UTC').split('\r\n').filter(Boolean);
    expect(lines[0]).toBe('section,date,number,customer,status,method,subtotal,total,paid,balance,amount');
    expect(lines[1].split(',')).toHaveLength(11);
  });

  it('is header-only when the period is empty', () => {
    const empty = buildStatement([], FY, REGISTERED);
    expect(statementToCsv(empty)).toBe('section,date,number,customer,status,method,subtotal,gst,total,paid,balance,amount\r\n');
  });

  it('writes dates in the requested zone', () => {
    // 23:00 UTC on 30 June is already 1 July in Sydney.
    const ms = Date.UTC(2026, 5, 30, 23);
    expect(isoDateInZone(ms, 'UTC')).toBe('2026-06-30');
    expect(isoDateInZone(ms, 'Australia/Sydney')).toBe('2026-07-01');
  });

  it('neutralises a text cell that opens with a formula character, and leaves numbers alone', () => {
    expect(csvField('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvField('+61400000000')).toBe('"\'+61400000000"');
    expect(csvField('@SUM(1)')).toBe('"\'@SUM(1)"');
    expect(csvField('-Bob')).toBe('"\'-Bob"');
    // Only strings are protected: an amount is still a number to the software.
    expect(csvField(-5)).toBe('-5');
    expect(csvField('IN-1')).toBe('IN-1');
    expect(csvField(12.5)).toBe('12.5');
  });
});

describe('statementPeriodLabel', () => {
  it('shows the last day of an exclusive range', () => {
    expect(statementPeriodLabel(FY, 'UTC')).toBe('1 July 2025 – 30 June 2026');
  });
});
