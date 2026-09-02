/**
 * A saved supplier rate matched at GENERATION time lands on the row in the
 * document's GST basis — the same conversion the local pre-pricing pass
 * applies.
 *
 * The book holds GST-inclusive prices (as the supplier quotes them). The
 * local pass at pricing time already divides them by 1.1 for an ex-GST
 * business; the generation-time match used to copy the book price straight
 * onto the row, so the same entry produced two different prices depending on
 * which pass matched it — and a remembered $22 (stored as $24.20) came back
 * as $24.20 here and $22 there.
 */
import { describe, it, expect, vi } from 'vitest';

// Same native stubs as materialsPipeline.descriptionArray.test.ts — the
// generation step is pure apart from the LLM + favourites reads, but the
// module graph is not.
vi.mock('expo-modules-core', () => ({
  default: {},
  NativeModule: class {},
  SharedObject: class {},
  SharedRef: class {},
  EventEmitter: class {},
  NativeModulesProxy: {},
  requireNativeModule: () => ({}),
  requireOptionalNativeModule: () => null,
  registerWebModule: (m: unknown) => m,
  Platform: { OS: 'ios' },
  uuid: { v4: () => 'test-uuid' },
}));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: vi.fn(), deactivateKeepAwake: vi.fn() }));
vi.mock('../../config/firebase', () => ({ auth: { currentUser: null }, functions: {} }));

const RATE = {
  productName: 'R2.5 HD Insulation Batts',
  store: 'Insulation Depot',
  unit: 'pack' as const,
  price: 24.2,
  isPersonalRate: true,
};
vi.mock('../materialFavorites', () => ({
  loadAllFavoritesForLLM: vi.fn(async () => [RATE]),
  loadFavoritesFromLocal: vi.fn(async () => ({ r2_5_hd_insulation_batts: RATE })),
}));
vi.mock('../llmService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../llmService')>()),
  analyzeJobDescription: vi.fn(async () => ({
    materials: [
      {
        name: 'R2.5 HD Insulation Batts',
        quantity: 5,
        unit: 'pack',
        savedRateName: 'R2.5 HD Insulation Batts',
        pricingSource: 'saved_rate',
      },
    ],
    estimatedHours: 4,
  })),
}));

import { generateMaterialsForQuote } from '../materialsPipeline';
import type { Quote } from '../../types';

function quote(gst: Partial<Pick<Quote, 'gstRegistered' | 'pricesIncludeGst'>> = {}): Quote {
  return {
    id: 'q1',
    job: { name: 'Ceiling insulation', description: 'Insulate a 40 m² ceiling with R2.5 batts.' },
    materials: [],
    sections: [],
    laborHours: 0,
    ...gst,
  } as unknown as Quote;
}

describe('generation-time saved-rate match — GST basis', () => {
  it('divides the inclusive book price by 1.1 for an ex-GST business', async () => {
    const { updatedQuote } = await generateMaterialsForQuote({
      quote: quote(),
      businessSettings: null,
      isPro: false,
      templates: [],
    });
    const row = updatedQuote.materials[0];
    expect(row.name).toBe('R2.5 HD Insulation Batts');
    expect(row.price).toBe(22);
    expect(row.totalPrice).toBe(110);
    expect(row.pricingSource).toBe('manual');
    expect(row.favoriteProduct?.price).toBe(24.2);
  });

  it('keeps the inclusive book price for an inclusive-GST business', async () => {
    const { updatedQuote } = await generateMaterialsForQuote({
      quote: quote({ gstRegistered: true, pricesIncludeGst: true }),
      businessSettings: null,
      isPro: false,
      templates: [],
    });
    expect(updatedQuote.materials[0].price).toBe(24.2);
  });

  it('keeps the inclusive book price for a business not registered for GST', async () => {
    const { updatedQuote } = await generateMaterialsForQuote({
      quote: quote({ gstRegistered: false }),
      businessSettings: null,
      isPro: false,
      templates: [],
    });
    expect(updatedQuote.materials[0].price).toBe(24.2);
  });
});
