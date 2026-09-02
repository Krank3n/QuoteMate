/**
 * Price memory: a price the tradie types over a pipeline price (or tells
 * Mate) becomes a Supplier Book entry the next quote will use.
 *
 * The two properties worth pinning: WHEN the chip ticks itself (only a real
 * correction of a pipeline price, never a hand-typed row or a quantity edit),
 * and WHAT gets written (isPersonalRate: true — without it both consumers of
 * the book skip the entry, which is the bug this module exists to fix).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const bulkSaveFavorites = vi.hoisted(() =>
  vi.fn(async () => ({ created: 1, updated: 0, unchanged: 0 })),
);
const invalidateSupplierBookCache = vi.hoisted(() => vi.fn());
vi.mock('./materialFavorites', () => ({ bulkSaveFavorites }));
vi.mock('./supplierBook', () => ({ invalidateSupplierBookCache }));

import {
  buildRememberedRate,
  isPipelinePricedRow,
  rememberMaterialPrice,
  shouldAutoRememberPrice,
} from './priceMemory';
import type { Material } from '../types';

function row(extra: Partial<Material> = {}): Material {
  return {
    id: 'm1',
    name: 'Treated Pine Post 90x90 2.4m',
    quantity: 7,
    unit: 'each',
    price: 18.5,
    totalPrice: 129.5,
    manualPriceOverride: false,
    pricingSource: 'scraper',
    origin: 'recommended',
    asPriced: { price: 18.5, quantity: 7, name: 'Treated Pine Post 90x90 2.4m', pricingSource: 'scraper' },
    ...extra,
  } as Material;
}

describe('isPipelinePricedRow', () => {
  it('is true for a scraper-priced row with an asPriced snapshot', () => {
    expect(isPipelinePricedRow(row())).toBe(true);
  });

  it('is true for a recommended-origin row priced before asPriced existed', () => {
    expect(isPipelinePricedRow(row({ asPriced: undefined, pricingSource: undefined }))).toBe(true);
  });

  it('is true for an estimate row', () => {
    expect(
      isPipelinePricedRow(row({ asPriced: undefined, origin: undefined, pricingSource: 'ai' })),
    ).toBe(true);
  });

  it('is false for a row the tradie typed themselves', () => {
    expect(
      isPipelinePricedRow(
        row({ asPriced: undefined, origin: 'manual', pricingSource: 'manual', manualPriceOverride: true }),
      ),
    ).toBe(false);
  });

  it('is false for a work item even when it carries a snapshot', () => {
    expect(isPipelinePricedRow(row({ kind: 'work' }))).toBe(false);
  });

  it('is false for nothing', () => {
    expect(isPipelinePricedRow(undefined)).toBe(false);
    expect(isPipelinePricedRow(null)).toBe(false);
  });
});

describe('shouldAutoRememberPrice', () => {
  it('ticks when a pipeline price is changed', () => {
    expect(shouldAutoRememberPrice(row(), '22')).toBe(true);
    expect(shouldAutoRememberPrice(row(), '17.95')).toBe(true);
  });

  it('does not tick while the typed price equals the pipeline price', () => {
    expect(shouldAutoRememberPrice(row(), '18.5')).toBe(false);
    expect(shouldAutoRememberPrice(row(), '18.50')).toBe(false);
  });

  it('does not tick for blank, zero or junk', () => {
    expect(shouldAutoRememberPrice(row(), '')).toBe(false);
    expect(shouldAutoRememberPrice(row(), '0')).toBe(false);
    expect(shouldAutoRememberPrice(row(), 'abc')).toBe(false);
  });

  it('never ticks for a hand-typed row or a work item', () => {
    const typed = row({ asPriced: undefined, origin: 'manual', pricingSource: 'manual' });
    expect(shouldAutoRememberPrice(typed, '99')).toBe(false);
    expect(shouldAutoRememberPrice(row({ kind: 'work' }), '99')).toBe(false);
  });
});

describe('buildRememberedRate', () => {
  it('writes a personal rate keyed to the row name, with the searchTerm as a keyword', () => {
    const entry = buildRememberedRate(row({ price: 22, searchTerm: 'treated pine post 90x90' }));
    expect(entry).toMatchObject({
      productName: 'Treated Pine Post 90x90 2.4m',
      price: 22,
      unit: 'each',
      store: 'manual',
      isPersonalRate: true,
      source: 'manual',
      keywords: ['treated pine post 90x90'],
    });
    expect(Date.parse(entry!.lastUpdatedAt!)).not.toBeNaN();
  });

  it('adds no keyword when the searchTerm is just the name', () => {
    const entry = buildRememberedRate(row({ price: 22, searchTerm: 'treated pine post 90x90 2.4m' }));
    expect(entry?.keywords).toBeUndefined();
  });

  it('carries the picked supplier and item number when the tradie adopted a result verbatim', () => {
    const entry = buildRememberedRate(row({ price: 22 }), {
      productName: 'Treated Pine Post 90x90 2.4m',
      store: 'Bowens',
      itemNumber: 'B-771',
    });
    expect(entry).toMatchObject({ store: 'Bowens', itemNumber: 'B-771', isPersonalRate: true });
  });

  it('ignores a picked result whose name no longer matches the row', () => {
    const entry = buildRememberedRate(row({ price: 22 }), {
      productName: 'Something else',
      store: 'Bowens',
      itemNumber: 'B-771',
    });
    expect(entry?.store).toBe('manual');
    expect(entry?.itemNumber).toBeUndefined();
  });

  it('keeps the product link and image so the book entry still shows the product', () => {
    const entry = buildRememberedRate(
      row({ price: 22, productUrl: 'https://example.com/p/1', imageUrl: 'https://example.com/i/1.jpg' }),
    );
    expect(entry).toMatchObject({ productUrl: 'https://example.com/p/1', imageUrl: 'https://example.com/i/1.jpg' });
  });

  it('refuses a work item, a $0 row and a nameless row', () => {
    expect(buildRememberedRate(row({ kind: 'work', price: 500 }))).toBeNull();
    expect(buildRememberedRate(row({ price: 0 }))).toBeNull();
    expect(buildRememberedRate(row({ name: '   ' }))).toBeNull();
  });
});

describe('rememberMaterialPrice', () => {
  beforeEach(() => {
    bulkSaveFavorites.mockClear();
    invalidateSupplierBookCache.mockClear();
  });

  it('saves through bulkSaveFavorites so curated fields survive, then invalidates the snapshot', async () => {
    await expect(rememberMaterialPrice(row({ price: 22 }))).resolves.toBe(true);
    expect(bulkSaveFavorites).toHaveBeenCalledTimes(1);
    const [items] = bulkSaveFavorites.mock.calls[0] as unknown as [Array<Record<string, unknown>>];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ productName: 'Treated Pine Post 90x90 2.4m', price: 22, isPersonalRate: true });
    expect(invalidateSupplierBookCache).toHaveBeenCalledTimes(1);
  });

  it('writes nothing for a row it cannot remember', async () => {
    await expect(rememberMaterialPrice(row({ kind: 'work', price: 500 }))).resolves.toBe(false);
    expect(bulkSaveFavorites).not.toHaveBeenCalled();
    expect(invalidateSupplierBookCache).not.toHaveBeenCalled();
  });

  it('swallows a failed write — the quote-side save must never depend on it', async () => {
    bulkSaveFavorites.mockRejectedValueOnce(new Error('offline'));
    await expect(rememberMaterialPrice(row({ price: 22 }))).resolves.toBe(false);
    expect(invalidateSupplierBookCache).not.toHaveBeenCalled();
  });
});
