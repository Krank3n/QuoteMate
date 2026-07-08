import { describe, it, expect } from 'vitest';
import {
  buildReconcileItems,
  applyReconcileDecisions,
  finalCoverageSweep,
  rescueRejectedRows,
  ReplayPricedRow,
  ReplayScraperCandidate,
} from './replayReconcile';

function row(overrides: Partial<ReplayPricedRow> = {}): ReplayPricedRow {
  return {
    name: 'Decking screws 50mm',
    searchTerm: 'decking screws 50mm',
    quantity: 2,
    unit: 'pack',
    price: 42.5,
    totalPrice: 85,
    priceStatus: 'priced',
    requiredQty: 600,
    ...overrides,
  };
}

const screwsCandidates: ReplayScraperCandidate[] = [
  { productName: 'Zenith Decking Screws Box of 500', price: 42.5 },
  { productName: 'Merbau Decking Board 5.4m', price: 38 },
];

describe('buildReconcileItems', () => {
  it('sends rows with candidates, forwarding pack info parsed from the title', () => {
    const cand = new Map([['decking screws 50mm', screwsCandidates]]);
    const { items, candidatesById } = buildReconcileItems([row()], cand);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('row-0');
    expect(items[0].requirement).toBe(600);
    expect(items[0].candidates[0].packSize).toBe(500);
    expect(candidatesById.get('row-0')).toHaveLength(2);
  });

  it('drops spec-incompatible candidates before the LLM sees them', () => {
    // The QU-178270 class: a 140x45 rafter request must never be offered a
    // 70x35 candidate to "apply".
    const cand = new Map([[
      'rafters 140x45mm h2 treated pine',
      [
        { productName: '70 x 35mm Outdoor Framing H3 Treated Pine', price: 15.9 },
        { productName: '140 x 45mm MGP10 H2 Framing Pine 4.8m', price: 42.8 },
      ],
    ]]);
    const rows = [row({ name: 'Rafters 140x45mm H2 Treated Pine', searchTerm: 'rafters 140x45mm h2 treated pine' })];
    const { items } = buildReconcileItems(rows, cand);
    expect(items).toHaveLength(1);
    expect(items[0].candidates).toHaveLength(1);
    expect(items[0].candidates[0].name).toContain('140 x 45');
  });

  it('skips trade-fallback rows and rows without candidates', () => {
    const cand = new Map([['decking screws 50mm', screwsCandidates]]);
    const rows = [
      row({ priceStatus: 'estimated-trade' }),
      row({ searchTerm: 'no candidates here' }),
    ];
    const { items } = buildReconcileItems(rows, cand);
    expect(items).toHaveLength(0);
  });

  it('uses the original requirement unit via the chosen pack unit when present', () => {
    const cand = new Map([['decking screws 50mm', screwsCandidates]]);
    const rows = [row({ unit: 'pack', chosen: { name: 'x', price: 42.5, pack: { packSize: 500, packUnit: 'each' } } })];
    const { items } = buildReconcileItems(rows, cand);
    expect(items[0].requirementUnit).toBe('each');
  });
});

describe('applyReconcileDecisions', () => {
  const cand = new Map([['decking screws 50mm', screwsCandidates]]);

  it('reject zeroes the row and records why', () => {
    const { candidatesById } = buildReconcileItems([row()], cand);
    const [m] = applyReconcileDecisions(
      [row()],
      [{ id: 'row-0', decision: 'reject', rejectReason: 'All candidates were boards, not screws' }],
      candidatesById
    );
    expect(m.price).toBe(0);
    expect(m.totalPrice).toBe(0);
    expect(m.priceStatus).toBe('rejected');
    expect(m.reconcile?.note).toContain('boards');
  });

  it('apply re-prices from the chosen candidate and derives total from unit price', () => {
    const { candidatesById } = buildReconcileItems([row()], cand);
    const [m] = applyReconcileDecisions(
      [row()],
      [{ id: 'row-0', decision: 'apply', chosenIndex: 0, purchaseCount: 2, purchaseUnit: 'pack', confidence: 'high' }],
      candidatesById
    );
    expect(m.quantity).toBe(2);
    expect(m.price).toBe(42.5);
    expect(m.totalPrice).toBe(85);
    expect(m.chosen?.name).toBe('Zenith Decking Screws Box of 500');
    expect(m.reconcile?.decision).toBe('apply');
  });

  it('apply clamps an over-buy down using the candidate pack size', () => {
    // 600 screws, box of 500 → 2 boxes needed, LLM says 19. Coverage guard clamps.
    const bulk: ReplayScraperCandidate[] = [{ productName: 'Stainless Decking Screws Box of 500', price: 151.64 }];
    const candBulk = new Map([['decking screws 50mm', bulk]]);
    const { candidatesById } = buildReconcileItems([row()], candBulk);
    const [m] = applyReconcileDecisions(
      [row()],
      [{ id: 'row-0', decision: 'apply', chosenIndex: 0, purchaseCount: 19, purchaseUnit: 'pack' }],
      candidatesById
    );
    expect(m.quantity).toBe(2);
    expect(m.totalPrice).toBe(303.28);
  });

  it('apply raises an under-buy to the coverage floor (7-post requirement, LLM says 3)', () => {
    // The QU-178290 class: requirement "7 each" posts, reconcile LLM divides
    // by the 2.4m length and returns 3. The floor raises it back to 7.
    const postCands: ReplayScraperCandidate[] = [
      { productName: '100x75mm H4 Treated Pine Post 2.4m', price: 32.9 },
    ];
    const candPosts = new Map([['treated pine post 100x75', postCands]]);
    const postRow = row({
      name: '100x75mm H4 Treated Hardwood Post 2.4m',
      searchTerm: 'treated pine post 100x75',
      requiredQty: 7,
      requiredUnit: 'each',
      quantity: 7,
      unit: 'each',
    });
    const { candidatesById } = buildReconcileItems([postRow], candPosts);
    const [m] = applyReconcileDecisions(
      [postRow],
      [{ id: 'row-0', decision: 'apply', chosenIndex: 0, purchaseCount: 3, purchaseUnit: 'each' }],
      candidatesById
    );
    expect(m.quantity).toBe(7);
    expect(m.totalPrice).toBe(230.3);
  });

  it('apply keeps an LLM-corrected requirement instead of re-inflating it', () => {
    const boardCands: ReplayScraperCandidate[] = [
      { productName: 'Merbau Decking Board 90x19 5.4m', price: 38 },
    ];
    const candBoards = new Map([['merbau decking board', boardCands]]);
    const boardRow = row({
      name: 'Merbau Decking Board 5.4m',
      searchTerm: 'merbau decking board',
      requiredQty: 223,
      requiredUnit: 'each',
      quantity: 223,
      unit: 'each',
    });
    const { candidatesById } = buildReconcileItems([boardRow], candBoards);
    const [m] = applyReconcileDecisions(
      [boardRow],
      [{ id: 'row-0', decision: 'apply', chosenIndex: 0, purchaseCount: 22, correctedRequirement: 22, purchaseUnit: 'each' }],
      candidatesById
    );
    expect(m.quantity).toBe(22);
  });

  it('estimate re-prices from the estimated unit price with coverage guard', () => {
    const { candidatesById } = buildReconcileItems([row()], cand);
    const [m] = applyReconcileDecisions(
      [row()],
      [{ id: 'row-0', decision: 'estimate', estimatedUnitPrice: 25, purchaseCount: 2, purchaseUnit: 'pack', coverageNote: 'estimated 100-pack' }],
      candidatesById
    );
    expect(m.price).toBe(25);
    expect(m.quantity).toBe(2);
    expect(m.totalPrice).toBe(50);
    expect(m.priceStatus).toBe('estimated-reconcile');
  });

  it('rows without a decision pass through unchanged', () => {
    const { candidatesById } = buildReconcileItems([row()], cand);
    const original = row();
    const [m] = applyReconcileDecisions([original], [], candidatesById);
    expect(m).toEqual(original);
  });
});

describe('finalCoverageSweep', () => {
  it('clamps a bulk fastener over-buy down', () => {
    // 470 screws requirement, $151.64/tub — the QU-178011 case; one tub covers it.
    const m = row({ quantity: 19, price: 151.64, totalPrice: 2881.16, requiredQty: 470 });
    finalCoverageSweep([m]);
    expect(m.quantity).toBe(1);
    expect(m.totalPrice).toBe(151.64);
  });

  it('clamps area-derived board over-counts using the job description', () => {
    const m = row({
      name: 'Merbau Decking Board 90x19 5.4m',
      quantity: 891,
      requiredQty: 891,
      price: 38,
      totalPrice: 33858,
      unit: 'each',
    });
    finalCoverageSweep([m], 'New deck 15m x 2m merbau');
    // 30 m² at ~95mm effective board width / 5.4m lengths + waste ≈ 105 boards.
    expect(m.quantity).toBe(105);
    expect(m.totalPrice).toBe(Math.round(m.quantity * 38 * 100) / 100);
  });

  it('leaves sane rows untouched', () => {
    const m = row({ quantity: 2, price: 42.5, totalPrice: 85, requiredQty: 600 });
    finalCoverageSweep([m], '5m x 2m deck');
    expect(m.quantity).toBe(2);
    expect(m.totalPrice).toBe(85);
  });
});

describe('rescueRejectedRows', () => {
  const rejectedPost = (): ReplayPricedRow => ({
    name: '2400x100x100mm CCA Treated Hardwood Post',
    searchTerm: '2400x100x100mm CCA treated hardwood post',
    quantity: 14,
    unit: 'each',
    requiredQty: 14,
    requiredUnit: 'each',
    price: 0,
    totalPrice: 0,
    priceStatus: 'rejected',
    reconcile: { decision: 'reject', note: 'All candidates were drill bits' },
  });

  it('rescues a rejected row via simplified-term search + re-reconcile', async () => {
    const fetched: string[] = [];
    const { rows, meta } = await rescueRejectedRows([rejectedPost()], {
      fetchCandidates: async (terms) => {
        fetched.push(...terms);
        return new Map([[
          'treated hardwood post',
          [{ productName: '100 x 100mm 2.4m Hardwood Post', price: 41.5 }],
        ]]);
      },
      reconcile: async (items) => [
        { id: items[0].id, decision: 'apply', chosenIndex: 0, purchaseCount: 14, purchaseUnit: 'each', confidence: 'medium' },
      ],
    });
    expect(fetched).toEqual(['treated hardwood post']);
    expect(rows[0].price).toBe(41.5);
    expect(rows[0].quantity).toBe(14);
    expect(rows[0].priceStatus).toBe('priced');
    expect(rows[0].searchTerm).toBe('treated hardwood post');
    expect(meta).toMatchObject({ rejected: 1, retried: 1, rescued: 1, stillUnpriced: 0 });
  });

  it('keeps the category gate: a re-rejected row falls to the deterministic estimate', async () => {
    const { rows, meta } = await rescueRejectedRows([rejectedPost()], {
      fetchCandidates: async () => new Map([[
        'treated hardwood post',
        [{ productName: 'Steel Star Picket 1800mm', price: 8.9 }],
      ]]),
      reconcile: async (items) => [
        { id: items[0].id, decision: 'reject', rejectReason: 'Still no timber posts' },
      ],
      fallbackUnitPrice: () => 45,
    });
    expect(rows[0].priceStatus).toBe('estimated-fallback');
    expect(rows[0].price).toBe(45);
    expect(rows[0].totalPrice).toBe(630);
    expect(meta).toMatchObject({ rescued: 0, estimatedFallback: 1, stillUnpriced: 0 });
  });

  it('leaves the row at $0 when there is no simplification and no fallback price', async () => {
    const alreadySimple = rejectedPost();
    alreadySimple.searchTerm = 'oil absorbent granules';
    alreadySimple.name = 'oil absorbent granules';
    const { rows, meta } = await rescueRejectedRows([alreadySimple], {
      fetchCandidates: async () => new Map(),
      reconcile: async () => [],
      fallbackUnitPrice: () => null,
    });
    expect(rows[0].price).toBe(0);
    expect(rows[0].priceStatus).toBe('rejected');
    expect(meta).toMatchObject({ rejected: 1, retried: 0, rescued: 0, stillUnpriced: 1 });
  });

  it('does not touch rows that were not rejected', async () => {
    const pricedRow = row();
    const { rows, meta } = await rescueRejectedRows([pricedRow], {
      fetchCandidates: async () => { throw new Error('should not be called'); },
      reconcile: async () => { throw new Error('should not be called'); },
    });
    expect(rows[0]).toEqual(pricedRow);
    expect(meta.rejected).toBe(0);
  });
});
