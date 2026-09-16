/**
 * Every reader reuses a stored pay link instead of minting. Once the Square
 * connection changes, the stored link pays the wrong seller or lands on a
 * dead page, so the sweep has to clear every field a reader looks at, on
 * the unified doc and both legacy mirrors, and keep the ledger's history.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const DELETE = Symbol('delete');
vi.mock('firebase-admin', () => ({
  firestore: Object.assign(() => ({}), {
    FieldValue: {
      delete: () => DELETE,
      arrayUnion: (...items: unknown[]) => ({ __arrayUnion: items }),
    },
  }),
}));

import {
  DOCUMENT_LINK_FIELDS,
  INVOICE_LINK_FIELDS,
  invalidateUserPaymentLinks,
  squareConnectionChanged,
} from './squareLinkInvalidation';

type Row = { id: string; data: Record<string, unknown> };

function fakeDb(collections: Record<string, Row[]>, failPaths: string[] = []) {
  const updates: Array<{ path: string; data: Record<string, unknown> }> = [];
  const db = {
    collection: (path: string) => ({
      select: (...fields: string[]) => ({
        get: async () => ({
          docs: (collections[path] ?? []).map((row) => ({
            ref: {
              path: `${path}/${row.id}`,
              update: async (data: Record<string, unknown>) => {
                if (failPaths.includes(`${path}/${row.id}`)) throw new Error('NOT_FOUND');
                updates.push({ path: `${path}/${row.id}`, data });
              },
            },
            data: () => Object.fromEntries(fields.filter((f) => f in row.data).map((f) => [f, row.data[f]])),
          })),
        }),
      }),
    }),
  };
  return { db, updates };
}

const NOW = 1_790_000_000_000;

describe('squareConnectionChanged', () => {
  it('a first connection has nothing to invalidate', () => {
    expect(squareConnectionChanged(null, { merchantId: 'M1', locationId: 'L1' })).toBe(false);
    expect(squareConnectionChanged(undefined, { merchantId: 'M1', locationId: 'L1' })).toBe(false);
  });

  it('re-authorising the same merchant and location keeps its links', () => {
    expect(squareConnectionChanged({ merchantId: 'M1', locationId: 'L1' }, { merchantId: 'M1', locationId: 'L1' })).toBe(false);
  });

  it('a different merchant, or the same merchant at a different location, changes it', () => {
    expect(squareConnectionChanged({ merchantId: 'M1', locationId: 'L1' }, { merchantId: 'M2', locationId: 'L1' })).toBe(true);
    expect(squareConnectionChanged({ merchantId: 'M1', locationId: 'L1' }, { merchantId: 'M1', locationId: 'L2' })).toBe(true);
    expect(squareConnectionChanged({ merchantId: 'M1', locationId: null }, { merchantId: 'M1', locationId: 'L2' })).toBe(true);
  });
});

describe('invalidateUserPaymentLinks', () => {
  let fixture: ReturnType<typeof fakeDb>;

  beforeEach(() => {
    fixture = fakeDb({
      'users/u1/documents': [
        {
          id: 'd-invoice',
          data: {
            total: 685.85,
            squarePaymentLinkId: 'KDHM',
            squarePaymentLinkUrl: 'https://checkout.square.site/merchant/ML8/order/7sbu',
            activePaymentLink: { id: 'KDHM', url: 'https://checkout.square.site/merchant/ML8/order/7sbu', kind: 'balance', amount: 685.85, createdAt: NOW - 1000 },
          },
        },
        { id: 'd-deposit', data: { depositPaymentLinkUrl: 'https://square.link/dep', depositPaymentLinkId: 'DEP', depositPaymentLinkCreatedAt: 1, depositPaymentLinkAmount: 50 } },
        { id: 'd-plain', data: { total: 100 } },
      ],
      'users/u1/quotes': [
        { id: 'q1', data: { depositPaymentLinkUrl: 'https://square.link/dep', fullPaymentLinkUrl: 'https://square.link/full' } },
        { id: 'q2', data: { total: 5 } },
      ],
      'users/u1/invoices': [
        { id: 'i1', data: { squarePaymentLinkId: 'KDHM', squarePaymentLinkUrl: 'https://checkout.square.site/x' } },
      ],
    });
  });

  it('clears every link field on the unified doc and both legacy mirrors, touching only docs that carry one', async () => {
    const counts = await invalidateUserPaymentLinks(fixture.db, 'u1', 'connection_changed', NOW);
    expect(counts).toEqual({ documents: 2, quotes: 1, invoices: 1 });

    const byPath = Object.fromEntries(fixture.updates.map((u) => [u.path, u.data]));
    expect(Object.keys(byPath).sort()).toEqual([
      'users/u1/documents/d-deposit',
      'users/u1/documents/d-invoice',
      'users/u1/invoices/i1',
      'users/u1/quotes/q1',
    ]);
    expect(byPath['users/u1/documents/d-invoice'].squarePaymentLinkUrl).toBe(DELETE);
    expect(byPath['users/u1/documents/d-invoice'].squarePaymentLinkId).toBe(DELETE);
    expect(byPath['users/u1/documents/d-invoice'].activePaymentLink).toBe(DELETE);
    expect(byPath['users/u1/documents/d-deposit']).toEqual({
      depositPaymentLinkUrl: DELETE, depositPaymentLinkId: DELETE, depositPaymentLinkCreatedAt: DELETE, depositPaymentLinkAmount: DELETE,
    });
    expect(byPath['users/u1/quotes/q1']).toEqual({ depositPaymentLinkUrl: DELETE, fullPaymentLinkUrl: DELETE });
    expect(byPath['users/u1/invoices/i1']).toEqual({ squarePaymentLinkId: DELETE, squarePaymentLinkUrl: DELETE });
  });

  it('archives the active link with the reason so the ledger keeps its history', async () => {
    await invalidateUserPaymentLinks(fixture.db, 'u1', 'disconnected', NOW);
    const invoiceUpdate = fixture.updates.find((u) => u.path === 'users/u1/documents/d-invoice')!.data;
    expect(invoiceUpdate.archivedPaymentLinks).toEqual({
      __arrayUnion: [{
        id: 'KDHM', url: 'https://checkout.square.site/merchant/ML8/order/7sbu', kind: 'balance', amount: 685.85,
        createdAt: NOW - 1000, archivedAt: NOW, archivedReason: 'disconnected',
      }],
    });
    // A doc with no active link gets no archive entry.
    const depositUpdate = fixture.updates.find((u) => u.path === 'users/u1/documents/d-deposit')!.data;
    expect(depositUpdate.archivedPaymentLinks).toBeUndefined();
  });

  it('never leaves a field a reader checks: the sweep list covers every stored link field', () => {
    // src/utils/quoteDeliveryGuard, FollowUpSheet, pdfGenerator, the email
    // fallback and paymentOfferForAcceptedQuote read these names.
    for (const f of ['squarePaymentLinkUrl', 'depositPaymentLinkUrl', 'fullPaymentLinkUrl', 'activePaymentLink']) {
      expect(DOCUMENT_LINK_FIELDS).toContain(f);
    }
  });

  it('a user with nothing to clear writes nothing', async () => {
    const empty = fakeDb({ 'users/u2/documents': [{ id: 'd', data: { total: 1 } }] });
    const counts = await invalidateUserPaymentLinks(empty.db, 'u2', 'disconnected', NOW);
    expect(counts).toEqual({ documents: 0, quotes: 0, invoices: 0 });
    expect(empty.updates).toEqual([]);
  });

  it('a doc deleted between the read and the write is skipped, and the rest are still swept', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ id: `d${i}`, data: { squarePaymentLinkUrl: `https://x/${i}` } }));
    const big = fakeDb({ 'users/u3/documents': rows }, ['users/u3/documents/d7', 'users/u3/documents/d99']);
    const counts = await invalidateUserPaymentLinks(big.db, 'u3', 'square_not_ready', NOW);
    expect(counts.documents).toBe(118);
    expect(big.updates).toHaveLength(118);
    expect(big.updates.map((u) => u.path)).not.toContain('users/u3/documents/d7');
  });

  it('the legacy invoice mirror loses its createdAt stamp too, not just the url', () => {
    // mirrorLinkToLegacy writes squarePaymentLinkCreatedAt on users/{uid}/invoices.
    expect(INVOICE_LINK_FIELDS).toContain('squarePaymentLinkCreatedAt');
  });
});
