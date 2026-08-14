/**
 * One mapper, three renderers. Every field added to Material used to have to
 * be remembered in the client quote PDF, the client invoice PDF and the server
 * PDF — and never was, which is exactly how the two mapping layers drift.
 */

import { describe, it, expect } from 'vitest';
import { toPdfMaterial, toPdfMaterials } from './mapMaterial';

describe('toPdfMaterial', () => {
  it('carries kind and scope through', () => {
    const out = toPdfMaterial({
      name: 'INTERIOR Surfaces to be painted',
      quantity: 1,
      unit: 'each',
      price: 22750,
      totalPrice: 22750,
      kind: 'work',
      scope: 'Surfaces included: walls, ceilings.\nScope of works: full interior.',
      section: 'Interior',
    });
    expect(out.kind).toBe('work');
    expect(out.scope).toBe('Surfaces included: walls, ceilings.\nScope of works: full interior.');
    expect(out.section).toBe('Interior');
    expect(out.totalPrice).toBe(22750);
  });

  it('defaults kind to undefined for an ordinary material', () => {
    const out = toPdfMaterial({ name: 'Paint', quantity: 4, unit: 'each', price: 95, totalPrice: 380 });
    expect(out.kind).toBeUndefined();
    expect(out.scope).toBeUndefined();
  });

  it('coerces a missing price to 0 rather than emitting undefined', () => {
    // The server reads Firestore documents as `any`; legacy rows can be missing
    // either money field, and `undefined * 1.1` renders as "$NaN".
    const out = toPdfMaterial({ name: 'Legacy row', quantity: 1, unit: 'each' });
    expect(out.price).toBe(0);
    expect(out.totalPrice).toBe(0);
  });

  it('maps an empty or missing list to an empty array', () => {
    expect(toPdfMaterials(undefined)).toEqual([]);
    expect(toPdfMaterials(null)).toEqual([]);
    expect(toPdfMaterials([])).toEqual([]);
  });
});
