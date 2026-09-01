/**
 * The estimated price must carry what one purchase contains.
 *
 * `searchMaterialPrice` returned only a price and a name, so the pricing
 * pipeline could not tell a $45.90 BAG of tile adhesive from $45.90 per kg and
 * multiplied the purchase price by the job's whole requirement — $25,051 of
 * invented money across 16 lines in five real quotes.
 *
 * The unit normalisation matters as much as the number: the model is asked for
 * ASCII "m2" because a JSON prompt is a poor place to demand superscripts, but
 * every guard downstream compares against the app's canonical 'm²'. An
 * unnormalised unit fails those comparisons silently and the pack size is
 * thrown away — the same outcome as never asking.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fetchMock = vi.fn();

async function importFresh() {
  vi.resetModules();
  const mod = await import('./webSearchPricing');
  const { auth } = await import('../config/firebase');
  (auth as any).currentUser = { uid: 'test-uid', getIdToken: vi.fn(async () => 'test-token') };
  return mod;
}

function serverSays(body: Record<string, unknown>) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => body });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('searchMaterialPrice pack info', () => {
  it('carries packSize and packUnit through', async () => {
    serverSays({ price: 45.9, productName: 'Ardex 20kg Tile Adhesive', packSize: 20, packUnit: 'kg' });
    const { searchMaterialPrice } = await importFresh();

    const r = await searchMaterialPrice('tile adhesive', ['bunnings.com.au']);

    expect(r.price).toBe(45.9);
    expect(r.packSize).toBe(20);
    expect(r.packUnit).toBe('kg');
  });

  it('normalises m2 to the canonical m²', async () => {
    serverSays({ price: 32, productName: 'Floor Tile', packSize: 1.44, packUnit: 'm2' });
    const { searchMaterialPrice } = await importFresh();

    expect((await searchMaterialPrice('floor tile', [])).packUnit).toBe('m²');
  });

  it('normalises litre spellings to L', async () => {
    serverSays({ price: 89, productName: 'Paint 10L', packSize: 10, packUnit: 'litres' });
    const { searchMaterialPrice } = await importFresh();

    expect((await searchMaterialPrice('paint', [])).packUnit).toBe('L');
  });

  it('drops an unrecognised unit rather than guessing a lookalike', async () => {
    // A wrong unit is worse than none: it lets a pack size divide a
    // requirement it does not measure.
    serverSays({ price: 20, productName: 'Thing', packSize: 5, packUnit: 'furlong' });
    const { searchMaterialPrice } = await importFresh();

    const r = await searchMaterialPrice('thing', []);
    expect(r.packUnit).toBeUndefined();
    expect(r.packSize).toBe(5);
  });

  it('rejects a non-positive or non-numeric pack size', async () => {
    for (const bad of [0, -3, 'twenty', null, undefined]) {
      serverSays({ price: 20, productName: 'Thing', packSize: bad, packUnit: 'kg' });
      const { searchMaterialPrice } = await importFresh();
      expect((await searchMaterialPrice('thing', [])).packSize).toBeUndefined();
    }
  });

  it('still works when the estimator omits pack info entirely', async () => {
    serverSays({ price: 12.5, productName: 'Thing' });
    const { searchMaterialPrice } = await importFresh();

    const r = await searchMaterialPrice('thing', []);
    expect(r.price).toBe(12.5);
    expect(r.packSize).toBeUndefined();
    expect(r.packUnit).toBeUndefined();
  });
});
