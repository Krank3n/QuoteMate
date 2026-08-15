// @vitest-environment jsdom
/**
 * Entering a lump-sum scope line.
 *
 * The quick-add row is already mounted in every section footer, the
 * unsectioned footer and edit mode, so a Material | Work item chip pair there
 * puts the affordance everywhere for free — no new screen, no new setting.
 *
 * Two properties matter enough to pin:
 *   1. What Save commits — quantity 1, unit 'each', totalPrice = the typed
 *      line total, and manualPriceOverride on top of `kind` as belt and
 *      braces. Everything downstream (totals, adapter, Xero) depends on it.
 *   2. That NOTHING is searched for in work mode. There is no product behind
 *      "Interior surfaces to be painted"; a supplier result landing on the row
 *      would overwrite the tradie's title and price.
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
// Heavy native/expo dependency graphs that ship untranspiled syntax vitest
// can't parse — same approach as JobCard.ghost.test.tsx.
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('react-native-paper', async () => {
  const { Text } = await import('react-native');
  return { Text };
});
vi.mock('../services/materialFavorites', () => ({ saveFavoriteProduct: vi.fn(async () => {}) }));
vi.mock('../utils/haptics', () => ({ lightTap: vi.fn(), selectionTap: vi.fn() }));
vi.mock('./ActionSheet', () => ({ ActionSheet: () => null }));

import { InlineAddMaterialRow } from './InlineAddMaterialRow';
import type { Material } from '../types';

function renderRow(onAdd: (m: Material) => void) {
  return render(
    <InlineAddMaterialRow
      sectionName=""
      onAdd={onAdd}
      supplierGroups={[]}
      reeceConnected={false}
    />,
  );
}

/** Open the collapsed pill and switch the card into work-item mode. */
function openInWorkMode() {
  fireEvent.click(screen.getByText('Add Material'));
  fireEvent.click(screen.getByText('Work item'));
}

function typeInto(placeholder: string, value: string) {
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
}

describe('InlineAddMaterialRow — work items', () => {
  beforeEach(() => {
    search.setQuery.mockClear();
    search.runSearch.mockClear();
  });

  it('builds a work item with qty 1, unit each and the typed line total', () => {
    const onAdd = vi.fn();
    renderRow(onAdd);
    openInWorkMode();

    typeInto('Work item name', 'INTERIOR Surfaces to be painted');
    typeInto("Scope of works — what's included", 'Walls and ceilings.\nAs per plans provided.');
    typeInto('0.00', '22750');
    fireEvent.click(screen.getByText('Save'));

    expect(onAdd).toHaveBeenCalledTimes(1);
    const material: Material = onAdd.mock.calls[0][0];
    expect(material.kind).toBe('work');
    expect(material.name).toBe('INTERIOR Surfaces to be painted');
    expect(material.scope).toBe('Walls and ceilings.\nAs per plans provided.');
    expect(material.quantity).toBe(1);
    expect(material.unit).toBe('each');
    expect(material.price).toBe(22750);
    expect(material.totalPrice).toBe(22750);
    // Belt and braces on top of the `kind` guards in the pricing pipeline.
    expect(material.manualPriceOverride).toBe(true);
    expect(material.pricingSource).toBe('manual');
  });

  it('runs no supplier search in work mode', () => {
    renderRow(vi.fn());
    openInWorkMode();
    typeInto('Work item name', 'Interior painting');

    expect(search.setQuery).not.toHaveBeenCalled();
    expect(search.runSearch).not.toHaveBeenCalled();
    // The magnify button is gone too, so there is no manual way in either.
    expect(screen.queryByLabelText('Search supplier catalogs')).toBeNull();
  });

  it('accepts a $0 line total', () => {
    // "General preparation — included" is a real row on a real painter's
    // quote. It must survive Save, not be rejected as unpriced.
    const onAdd = vi.fn();
    renderRow(onAdd);
    openInWorkMode();

    typeInto('Work item name', 'General Preparation to be carried out');
    fireEvent.click(screen.getByText('Save'));

    expect(onAdd).toHaveBeenCalledTimes(1);
    const material: Material = onAdd.mock.calls[0][0];
    expect(material.price).toBe(0);
    expect(material.totalPrice).toBe(0);
    expect(material.kind).toBe('work');
  });

  it('still searches, and still commits a normal material, in material mode', () => {
    const onAdd = vi.fn();
    renderRow(onAdd);
    fireEvent.click(screen.getByText('Add Material'));

    typeInto('Material name', 'Merbau decking');
    expect(search.setQuery).toHaveBeenCalledWith('Merbau decking');

    typeInto('0.00', '8.5');
    fireEvent.click(screen.getByText('Save'));

    const material: Material = onAdd.mock.calls[0][0];
    expect(material.kind).toBeUndefined();
    expect(material.scope).toBeUndefined();
    expect(material.quantity).toBe(1);
    expect(material.totalPrice).toBe(8.5);
  });
});
