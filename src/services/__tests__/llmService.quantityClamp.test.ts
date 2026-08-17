/**
 * QU-178694 regression — a 6x8 m Merbau deck quoted at $37,070 because the
 * "Deck Footings" section stored 35 m³ of ready-mix concrete ($9,545.55).
 *
 * The AI is prompted to emit poured concrete as a PER-FOOTING volume in m³
 * ("A 0.054 m³ footing = 0.054", functions/src/index.ts). validateMaterials
 * then clamped every unit with Math.min(Math.max(Math.round(q), 1), 999), so
 * 0.054 became 0, was floored to 1, and the 35-footing sectionMultiplier
 * multiplied it into 35 m³ — 18.5x the 1.89 m³ the job needs.
 *
 * Covers the whole client path: analyzeJobDescription (which runs
 * validateMaterials on the server response) → convertLLMMaterialsToMaterials
 * (which applies sectionMultiplier and is what lands in Firestore).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@env', () => ({ ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '' }));
vi.mock('../../config/firebase', () => ({
  auth: { currentUser: { getIdToken: async () => 'test-token' } },
}));

import { analyzeJobDescription, convertLLMMaterialsToMaterials } from '../llmService';

const FOOTING_COUNT = 35;
const CONCRETE_M3_PER_FOOTING = 0.054;

function stubServerResponse(materials: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        jobSummary: 'Merbau Deck Construction',
        estimatedHours: 58,
        materials,
      }),
    })),
  );
}

const deckFootings = [
  {
    name: 'H4 Treated Pine Post 90x90mm',
    searchTerm: 'h4 treated pine post 90x90',
    quantity: 1,
    unit: 'each',
    section: 'Deck Footings',
    sectionMultiplier: FOOTING_COUNT,
    sectionLaborHours: 0.4,
  },
  {
    name: 'Ready Mix Concrete',
    searchTerm: 'ready mix concrete',
    quantity: CONCRETE_M3_PER_FOOTING,
    unit: 'm³',
    section: 'Deck Footings',
    sectionMultiplier: FOOTING_COUNT,
    sectionLaborHours: 0.4,
  },
  {
    name: 'M10 Cup Head Bolt Galvanized 120mm',
    searchTerm: 'm10 cup head bolt galvanised 120mm',
    quantity: 2,
    unit: 'each',
    section: 'Deck Footings',
    sectionMultiplier: FOOTING_COUNT,
    sectionLaborHours: 0.4,
  },
];

describe('QU-178694 — per-footing m³ concrete inside a multiplied section', () => {
  beforeEach(() => stubServerResponse(deckFootings));

  it('keeps the per-footing volume fractional instead of flooring it to 1', async () => {
    const analysis = await analyzeJobDescription('Build a new 6m x 8m Merbau deck');
    const concrete = analysis.materials.find(m => m.name === 'Ready Mix Concrete')!;
    expect(concrete.quantity).toBe(CONCRETE_M3_PER_FOOTING);
  });

  it('stores 1.89 m³ for 35 footings, not the 35 m³ that shipped', async () => {
    const analysis = await analyzeJobDescription('Build a new 6m x 8m Merbau deck');
    const stored = convertLLMMaterialsToMaterials(analysis.materials as never);
    const concrete = stored.find(m => m.name === 'Ready Mix Concrete')!;

    expect(concrete.quantity).toBe(1.89);
    expect(concrete.quantity).not.toBe(35);
  });

  it('prices the concrete at ~$515 rather than $9,545.55', async () => {
    const analysis = await analyzeJobDescription('Build a new 6m x 8m Merbau deck');
    const stored = convertLLMMaterialsToMaterials(analysis.materials as never);
    const concrete = stored.find(m => m.name === 'Ready Mix Concrete')!;

    const unitPrice = 272.73; // the AI fallback estimate the live quote used
    expect(concrete.quantity! * unitPrice).toBeCloseTo(515.46, 2);
  });

  it('leaves the discrete counts in the same section untouched', async () => {
    const analysis = await analyzeJobDescription('Build a new 6m x 8m Merbau deck');
    const stored = convertLLMMaterialsToMaterials(analysis.materials as never);

    expect(stored.find(m => m.name!.startsWith('H4'))!.quantity).toBe(35);
    expect(stored.find(m => m.name!.startsWith('M10'))!.quantity).toBe(70);
  });
});

describe('bulk units are no longer truncated at the discrete-count ceiling', () => {
  it('keeps the 4000 kg of crusher dust the prompt asks for on a 25 m² patio', async () => {
    stubServerResponse([
      {
        name: 'Crusher Dust',
        searchTerm: 'crusher dust',
        quantity: 4000,
        unit: 'kg',
        section: 'Paving Base',
        sectionMultiplier: 1,
        sectionLaborHours: 4,
      },
    ]);
    const analysis = await analyzeJobDescription('25 m² paver patio');
    expect(analysis.materials[0].quantity).toBe(4000);
  });

  it('still caps a runaway discrete count at 999', async () => {
    stubServerResponse([
      {
        name: 'Stainless Steel Decking Screws 10g x 50mm',
        searchTerm: 'stainless decking screws 10g 50mm',
        quantity: 2400,
        unit: 'each',
        section: 'Merbau Decking',
        sectionMultiplier: 1,
        sectionLaborHours: 24,
      },
    ]);
    const analysis = await analyzeJobDescription('Build a new 6m x 8m Merbau deck');
    expect(analysis.materials[0].quantity).toBe(999);
  });
});
