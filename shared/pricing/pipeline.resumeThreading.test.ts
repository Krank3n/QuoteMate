/**
 * The pipeline threads the two phone-only fields down to its analyse dep:
 * the quote id (so the ledger can tie a request to a draft) and, on a
 * resume, the parked payload. Everything AFTER the analyse call must run the
 * same way over a parked payload as over a fresh one — that is the whole
 * reason resume goes through generateMaterialsForQuote instead of a copy.
 */
import { describe, expect, it, vi } from 'vitest';
import { generateMaterialsForQuote, type PipelineDeps } from './pipeline';
import type { AnalyzeRequest, PricingQuote } from './types';

const quote = {
  id: 'q1',
  materials: [],
  sections: [],
  job: { name: 'Interior repaint', description: 'Repaint walls, ceilings and trims.' },
  photos: [],
} as unknown as PricingQuote;

function depsCapturing(seen: AnalyzeRequest[]): PipelineDeps {
  return {
    analyzeJobDescription: async (req) => {
      seen.push(req);
      return {
        materials: [{ name: 'Ceiling White 15L', quantity: 3, unit: 'each', searchTerm: 'ceiling white' }],
        estimatedHours: 64,
        jobSummary: '',
      } as any;
    },
    reconcilePricedMaterials: async () => [],
    estimateMaterialPrice: async () => ({ price: null } as any),
    searchBunningsCandidates: async () => [],
    batchSearchBunnings: async () => ({ results: [] } as any),
    searchReeceCandidates: async () => [],
    isReeceConnected: async () => false,
    loadSupplierGroups: async () => [],
    loadFavorites: async () => ({}),
    loadPersonalRates: async () => [],
    loadTemplates: async () => [],
  };
}

describe('generateMaterialsForQuote — phone-only fields reach the analyse dep', () => {
  it('always passes the quote id, and no resume on a live run', async () => {
    const seen: AnalyzeRequest[] = [];
    await generateMaterialsForQuote(depsCapturing(seen), { quote, businessSettings: null, isPro: false, templates: [] });
    expect(seen).toHaveLength(1);
    expect(seen[0].quoteId).toBe('q1');
    expect('resume' in seen[0]).toBe(false);
  });

  it('passes the parked payload through on a resume, and still builds the rows from it', async () => {
    const seen: AnalyzeRequest[] = [];
    const resume = { requestId: 'req-1', result: { materials: [], estimatedHours: 64 } };
    const out = await generateMaterialsForQuote(depsCapturing(seen), {
      quote,
      businessSettings: null,
      isPro: false,
      templates: [],
      resume,
    });
    expect(seen[0].resume).toBe(resume);
    // The post-analyse half ran: what the dep returned became rows on the quote.
    expect(out.updatedQuote.materials.map((m) => m.name)).toEqual(['Ceiling White 15L']);
    expect(out.generatedMaterialCount).toBe(1);
  });

  it('is invisible to a server-side dep that only reads the wire fields', async () => {
    // The server core destructures named fields; an extra key must not
    // change what it sees. Modelled here as a dep that ignores the extras.
    const seen: AnalyzeRequest[] = [];
    const deps = depsCapturing(seen);
    const spy = vi.fn(deps.analyzeJobDescription);
    deps.analyzeJobDescription = spy;
    await generateMaterialsForQuote(deps, { quote, businessSettings: null, isPro: false, templates: [] });
    const { quoteId, resume, ...wire } = spy.mock.calls[0][0];
    expect(wire.jobDescription).toBe('Repaint walls, ceilings and trims.');
    expect(resume).toBeUndefined();
  });
});
