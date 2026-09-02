// @vitest-environment jsdom
/**
 * Correcting a pipeline price remembers it.
 *
 * 64% of sent quotes carry a hand-corrected price and none of them reached
 * the Supplier Book unless the tradie ticked "Save to book" — and even then
 * the entry went in without isPersonalRate, so the next quote ignored it.
 *
 * Pinned here (the pure rules live in priceMemory.test.ts):
 *   1. The whole chain from keystroke to book write, in the document's GST
 *      basis — an ex-GST $22 lands in the book as $24.20.
 *   2. An edit that leaves the price alone writes nothing.
 *   3. The tradie's own tap on the chip wins over the auto-tick.
 *   4. The explicit chip in add mode now writes a rate the pipeline will use.
 *
 * Under jsdom, react-native is aliased to react-native-web (see
 * vitest.config.ts), so the real component renders to DOM nodes.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';

const search = vi.hoisted(() => ({
  setQuery: vi.fn(),
  runSearch: vi.fn(async () => {}),
  clearResults: vi.fn(),
  cancel: vi.fn(),
}));
const book = vi.hoisted(() => ({
  bulkSaveFavorites: vi.fn(async () => ({ created: 1, updated: 0, unchanged: 0 })),
  invalidateSupplierBookCache: vi.fn(),
}));

vi.mock('../hooks/useMaterialSearch', () => ({
  useMaterialSearch: () => ({
    query: '',
    setQuery: search.setQuery,
    results: [],
    isSearching: false,
    hasSearched: false,
    error: undefined,
    runSearch: search.runSearch,
    cancel: search.cancel,
    clearResults: search.clearResults,
  }),
}));
// Render each icon as its glyph name: the chip's ticked/unticked state is
// what the tradie sees (bookmark-check vs bookmark-outline), so that is what
// the assertions read.
vi.mock('@expo/vector-icons/MaterialCommunityIcons', async () => {
  const React = await import('react');
  return { default: (p: { name: string }) => React.createElement('span', { 'data-icon': p.name }) };
});
vi.mock('react-native-paper', async () => {
  const { Text } = await import('react-native');
  return { Text };
});
// priceMemory itself runs for real; only its two side-effecting dependencies
// are stubbed, so the assertion covers the whole chain from keystroke to
// book write.
vi.mock('../services/materialFavorites', () => ({ bulkSaveFavorites: book.bulkSaveFavorites }));
vi.mock('../services/supplierBook', () => ({ invalidateSupplierBookCache: book.invalidateSupplierBookCache }));
vi.mock('../utils/haptics', () => ({ lightTap: vi.fn(), selectionTap: vi.fn() }));
vi.mock('./ActionSheet', () => ({ ActionSheet: () => null }));

import { InlineAddMaterialRow } from './InlineAddMaterialRow';
import type { Material } from '../types';

function pipelineRow(extra: Partial<Material> = {}): Material {
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
    searchTerm: 'treated pine post 90x90',
    asPriced: { price: 18.5, quantity: 7, name: 'Treated Pine Post 90x90 2.4m', pricingSource: 'scraper' },
    ...extra,
  } as Material;
}

function renderEdit(initialMaterial: Material, pricesIncludeGst = false, onUpdate = vi.fn()) {
  render(
    <InlineAddMaterialRow
      sectionName=""
      onAdd={vi.fn()}
      supplierGroups={[]}
      reeceConnected={false}
      pricesIncludeGst={pricesIncludeGst}
      mode="edit"
      initialMaterial={initialMaterial}
      onUpdate={onUpdate}
      onExitEdit={vi.fn()}
    />,
  );
  return onUpdate;
}

const chip = () => screen.getByLabelText('Also save to supplier book');
const chipChecked = () => chip().querySelector('[data-icon="bookmark-check"]') !== null;
const typePrice = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value } });
const save = () => fireEvent.click(screen.getByText('Save'));
const savedEntry = () =>
  (book.bulkSaveFavorites.mock.calls[0] as unknown as [Array<Record<string, unknown>>])[0][0];

beforeEach(() => {
  book.bulkSaveFavorites.mockClear();
  book.invalidateSupplierBookCache.mockClear();
});

describe('InlineAddMaterialRow — remembering a corrected price', () => {
  it('ticks Save to book when a pipeline price is corrected, and writes a GST-inclusive personal rate on Save', async () => {
    const onUpdate = renderEdit(pipelineRow());
    expect(chipChecked()).toBe(false);

    typePrice('22');
    expect(chipChecked()).toBe(true);

    save();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0].price).toBe(22);

    await vi.waitFor(() => expect(book.bulkSaveFavorites).toHaveBeenCalledTimes(1));
    // Ex-GST business (the default): the row's $22 is stored as $24.20 so the
    // pipeline's ÷1.1 brings it back to $22 on the next quote.
    expect(savedEntry()).toMatchObject({
      productName: 'Treated Pine Post 90x90 2.4m',
      price: 24.2,
      unit: 'each',
      isPersonalRate: true,
      source: 'manual',
      keywords: ['treated pine post 90x90'],
    });
    expect(book.invalidateSupplierBookCache).toHaveBeenCalledTimes(1);
  });

  it('stores the typed price as-is for an inclusive-GST document', async () => {
    renderEdit(pipelineRow(), true);
    typePrice('22');
    save();
    await vi.waitFor(() => expect(book.bulkSaveFavorites).toHaveBeenCalledTimes(1));
    expect(savedEntry()).toMatchObject({ price: 22 });
  });

  it('writes nothing for an edit that leaves the price alone', () => {
    const onUpdate = renderEdit(pipelineRow());
    save();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(chipChecked()).toBe(false);
    expect(book.bulkSaveFavorites).not.toHaveBeenCalled();
  });

  it("respects the tradie un-ticking it — their tap wins over the auto-tick", () => {
    renderEdit(pipelineRow());
    typePrice('22');
    expect(chipChecked()).toBe(true);
    fireEvent.click(chip());
    expect(chipChecked()).toBe(false);
    // Further typing does not re-tick it behind their back.
    typePrice('23');
    expect(chipChecked()).toBe(false);
    save();
    expect(book.bulkSaveFavorites).not.toHaveBeenCalled();
  });

  it('the explicit chip in add mode now writes a personal rate the pipeline will use', async () => {
    const onAdd = vi.fn();
    render(<InlineAddMaterialRow sectionName="" onAdd={onAdd} supplierGroups={[]} reeceConnected={false} />);
    fireEvent.click(screen.getByText('Add Material'));
    fireEvent.change(screen.getByPlaceholderText('Material name'), { target: { value: 'Merbau decking 90x19' } });
    typePrice('8.5');
    fireEvent.click(chip());
    expect(chipChecked()).toBe(true);
    save();

    expect(onAdd).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(book.bulkSaveFavorites).toHaveBeenCalledTimes(1));
    expect(savedEntry()).toMatchObject({ productName: 'Merbau decking 90x19', price: 9.35, isPersonalRate: true });
  });
});
