// The supplier-priority-fallback branch was missing entirely: the pipeline
// emitted the event and the chat card dropped it on the floor, so a tradie
// whose saved rates missed a row never learned Bunnings had filled it.

import { describe, it, expect } from 'vitest';
import { pricingEventToProgress } from './progress';
import type { PricingEvent } from '../services/materialsPipeline';

describe('pricingEventToProgress', () => {
  it('maps supplier-priority-fallback to a detail naming the miss count', () => {
    const next = pricingEventToProgress({
      kind: 'supplier-priority-fallback',
      missedTerms: ['Colorbond sheet 1.8m', 'Fence post 75x75', 'Top rail 2.4m'],
    });
    expect(next).toEqual({
      detail: "Your supplier list didn't cover 3 items — filling from Bunnings.",
    });
  });

  it('singularises "1 item"', () => {
    const next = pricingEventToProgress({
      kind: 'supplier-priority-fallback',
      missedTerms: ['Colorbond sheet 1.8m'],
    });
    expect(next?.detail).toContain('1 item —');
    expect(next?.detail).not.toContain('1 items');
  });

  it('phase-start still clears detail and items', () => {
    const next = pricingEventToProgress({
      kind: 'phase-start',
      phase: 'reconcile',
      status: 'Reconciling…',
    });
    expect(next).toEqual({
      phase: 'pricing',
      status: 'Reconciling…',
      detail: undefined,
      items: undefined,
    });
  });

  it('keeps the per-item and batch lines', () => {
    expect(
      pricingEventToProgress({
        kind: 'item-priced',
        phase: 'batch',
        materialId: 'm1',
        name: 'Fence post',
        success: true,
        progress: { current: 2, total: 9 },
      }),
    ).toEqual({ detail: '2/9 priced · Just priced Fence post' });

    expect(
      pricingEventToProgress({
        kind: 'batch-chunk',
        chunkIndex: 1,
        totalChunks: 3,
        termStatuses: new Map(),
        items: [],
        progress: { current: 0, total: 9 },
      }),
    ).toMatchObject({ status: 'Checking Bunnings (batch 1 of 3)…' });
  });

  it('unknown kinds return null', () => {
    expect(
      pricingEventToProgress({
        kind: 'complete',
        fetched: 9,
        failed: 0,
        skipped: 0,
        cancelled: false,
      }),
    ).toBeNull();
    expect(pricingEventToProgress({ kind: 'who-knows' } as unknown as PricingEvent)).toBeNull();
  });
});
