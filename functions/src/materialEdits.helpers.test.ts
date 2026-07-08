import { describe, it, expect } from 'vitest';
import { summarizeMaterialEdits, SentMaterialLike } from './materialEdits.helpers';

const pipelineRow = (over: Partial<SentMaterialLike> = {}): SentMaterialLike => ({
  name: 'Treated Pine Post 2.4m',
  quantity: 7,
  price: 32.9,
  asPriced: { price: 32.9, quantity: 7, name: 'Treated Pine Post 2.4m', pricingSource: 'scraper', priceConfidence: 'high' },
  ...over,
});

describe('summarizeMaterialEdits', () => {
  it('returns null when no row carries a snapshot (no baseline to learn from)', () => {
    expect(summarizeMaterialEdits([{ name: 'x', price: 5, quantity: 1 }])).toBeNull();
    expect(summarizeMaterialEdits([])).toBeNull();
  });

  it('logs a zero-edit send — the success signal', () => {
    const s = summarizeMaterialEdits([pipelineRow(), pipelineRow({ name: 'Screws', asPriced: { price: 42.5, quantity: 2, name: 'Screws' } , price: 42.5, quantity: 2 })]);
    expect(s).toMatchObject({ pipelineRows: 2, editedRows: 0, addedRows: 0, edits: [] });
  });

  it('detects a price correction and keeps the snapshot provenance', () => {
    const s = summarizeMaterialEdits([pipelineRow({ price: 45 })]);
    expect(s?.editedRows).toBe(1);
    expect(s?.edits[0]).toMatchObject({
      field: 'price', from: 32.9, to: 45, pricingSource: 'scraper', priceConfidence: 'high',
    });
  });

  it('detects quantity and name corrections on the same row as one edited row', () => {
    const s = summarizeMaterialEdits([pipelineRow({ quantity: 9, name: 'Hardwood Post 2.4m' })]);
    expect(s?.editedRows).toBe(1);
    expect(s?.edits.map((e) => e.field).sort()).toEqual(['name', 'quantity']);
    expect(s?.edits.find((e) => e.field === 'name')).toMatchObject({ from: 'Treated Pine Post 2.4m', to: 'Hardwood Post 2.4m' });
  });

  it('ignores sub-cent price float noise', () => {
    const s = summarizeMaterialEdits([pipelineRow({ price: 32.902 })]);
    expect(s?.editedRows).toBe(0);
  });

  it('counts hand-added rows without inventing edits for them', () => {
    const s = summarizeMaterialEdits([
      pipelineRow(),
      { name: 'Custom bracket', price: 15, quantity: 2, origin: 'manual' },
      { name: 'Hand-priced skip', price: 300, quantity: 1, manualPriceOverride: true },
    ]);
    expect(s).toMatchObject({ pipelineRows: 1, editedRows: 0, addedRows: 2 });
  });
});
