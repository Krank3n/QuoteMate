/**
 * Tests for spreadsheetParser
 *
 * Covers the pure logic (auto-detect, unit/price normalisation, building
 * an ExtractResult from a mapping). File-reading is covered indirectly
 * by feeding `buildExtractFromMapping` a hand-built ParsedSpreadsheet.
 */

import path from 'path';
import { describe, it, expect } from 'vitest';
import {
  autoDetectMapping,
  assessMapping,
  buildExtractFromMapping,
  normaliseUnit,
  parseSpreadsheet,
  type ParsedSpreadsheet,
} from '../spreadsheetParser';

describe('autoDetectMapping', () => {
  it('matches the common Description + Unit Price layout', () => {
    const m = autoDetectMapping(['SKU', 'Description', 'Unit Price', 'UOM']);
    expect(m).toEqual({
      name: 'Description',
      price: 'Unit Price',
      unit: 'UOM',
      qty: undefined,
      coveragePerUnit: undefined,
      coverageUnit: undefined,
      keywords: undefined,
      // SKU is now recognised as a product/item code.
      itemNumber: 'SKU',
      dimensions: undefined,
      notes: undefined,
    });
  });

  it('matches Product + Cost', () => {
    const m = autoDetectMapping(['Product Name', 'Cost (ex GST)']);
    expect(m?.name).toBe('Product Name');
    expect(m?.price).toBe('Cost (ex GST)');
  });

  it('returns null when no name column found', () => {
    expect(autoDetectMapping(['Foo', 'Price'])).toBeNull();
  });

  it('returns null when no price column found', () => {
    expect(autoDetectMapping(['Description', 'Notes'])).toBeNull();
  });

  it('picks up keywords + coverage when present', () => {
    const m = autoDetectMapping(['Item', 'Rate', 'Coverage', 'Tags']);
    expect(m?.coveragePerUnit).toBe('Coverage');
    expect(m?.keywords).toBe('Tags');
  });
});

describe('normaliseUnit', () => {
  it.each([
    ['ea', 'each'],
    ['each', 'each'],
    ['pcs', 'each'],
    ['lm', 'm'],
    ['metre', 'm'],
    ['sqm', 'm²'],
    ['m2', 'm²'],
    ['m3', 'm³'],
    ['ltr', 'L'],
    ['kg', 'kg'],
    ['carton', 'box'],
    ['pkt', 'pack'],
  ])('normalises %s -> %s', (input, expected) => {
    expect(normaliseUnit(input)).toBe(expected);
  });

  it('falls back to "each" for empty input', () => {
    expect(normaliseUnit(undefined)).toBe('each');
    expect(normaliseUnit('')).toBe('each');
  });

  it('passes through unknown units untouched', () => {
    expect(normaliseUnit('roll')).toBe('roll');
  });
});

describe('buildExtractFromMapping', () => {
  const parsed: ParsedSpreadsheet = {
    headers: ['SKU', 'Description', 'Unit Price', 'UOM', 'Tags'],
    rows: [
      { SKU: 'A1', Description: '90mm screws box', 'Unit Price': '$24.50', UOM: 'box', Tags: 'fasteners, screws' },
      { SKU: 'A2', Description: '2.4m H3 timber', 'Unit Price': '12.30 +gst', UOM: 'lm', Tags: 'timber' },
      // Row with no price → skipped
      { SKU: 'A3', Description: 'Bad row', 'Unit Price': '', UOM: 'ea', Tags: '' },
      // Row with no name → skipped
      { SKU: 'A4', Description: '', 'Unit Price': '5.00', UOM: 'ea', Tags: '' },
    ],
    kind: 'csv',
  };

  it('builds extracted items honouring the mapping', () => {
    const result = buildExtractFromMapping(parsed, {
      name: 'Description',
      price: 'Unit Price',
      unit: 'UOM',
      keywords: 'Tags',
    });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      name: '90mm screws box',
      price: 24.5,
      unit: 'box',
      keywords: ['fasteners', 'screws'],
      confidence: 'high',
    });
    expect(result.items[1]).toMatchObject({
      name: '2.4m H3 timber',
      price: 12.3,
      unit: 'm',
      keywords: ['timber'],
    });
  });

  it('threads the supplier name through', () => {
    const result = buildExtractFromMapping(
      parsed,
      { name: 'Description', price: 'Unit Price' },
      { supplierName: 'Acme Supplies' },
    );
    expect(result.supplierName).toBe('Acme Supplies');
    expect(result.supplierContact).toBeUndefined();
  });

  it('skips rows with no usable name or price', () => {
    const result = buildExtractFromMapping(parsed, {
      name: 'Description',
      price: 'Unit Price',
    });
    expect(result.items).toHaveLength(2);
  });
});

// End-to-end over a REAL supplier price list (Craig's Flooring Supplies export):
// 30 columns, no single name column, prices like "$28.50/m²", no unit column,
// and lots of attribute columns. This is the exact file as if uploaded through
// the supplier book, run through parse → detect → build.
describe('real flooring supplier spreadsheet', () => {
  const fixture = path.join(__dirname, '__fixtures__', 'sample-flooring-database.xlsx');

  it('parses, auto-detects and builds correct line items', async () => {
    const parsed = await parseSpreadsheet(fixture, 'sample-flooring-database.xlsx');

    // Real header row picked up despite line-wrapped headers.
    expect(parsed.rows.length).toBe(4);

    const mapping = autoDetectMapping(parsed.headers, parsed.rows);
    expect(mapping).not.toBeNull();

    // Name is composed from Style/Range + Colour — NOT the generic "Product Type".
    expect(Array.isArray(mapping!.name)).toBe(true);
    // No dedicated unit column — unit must come from the price suffix.
    expect(mapping!.unit).toBeUndefined();
    // qty maps to "Qty per pack", not the greedy "m² per pack".
    expect(mapping!.qty?.toLowerCase()).toContain('qty');
    // coverage maps to "m² per pack", not the empty "Raw area".
    expect(mapping!.coveragePerUnit?.toLowerCase()).toContain('per pack');

    const { items } = buildExtractFromMapping(parsed, mapping!, {
      supplierName: 'Craig\'s Flooring Supplies',
    });
    expect(items).toHaveLength(4);

    // FC01 — Airlay Oakwood LVT.
    const lvt = items[0];
    expect(lvt.name).toBe('Oakwood LVP Collection — Blonde Oak');
    expect(lvt.price).toBe(28.5);
    expect(lvt.unit).toBe('m²'); // inferred from "$28.50/m²", NOT "each"
    expect(lvt.coveragePerUnit).toBe(2.8);
    expect(lvt.coverageUnit).toBe('m²');
    expect(lvt.qty).toBe(8); // Qty per pack, NOT 3 (m² per pack rounded)
    expect(lvt.dimensions).toBe('1524 × 230 × 5');
    expect(lvt.keywords).toContain('vinyl 5.0 plank');
    expect(lvt.notes ?? '').toMatch(/warranty/i);
    expect(lvt.notes ?? '').toMatch(/china/i);

    // FC03 — Supersafe safety sheet vinyl (40 m² roll).
    const vinyl = items[2];
    expect(vinyl.name).toBe('Supersafe Safety Sheet Vinyl — Stone Taupe Plain R11');
    expect(vinyl.price).toBe(29.5);
    expect(vinyl.unit).toBe('m²');
    expect(vinyl.coveragePerUnit).toBe(40);

    // FC05 — Spectrum entry mat, priced per linear metre with a supplier code.
    const mat = items[3];
    expect(mat.name).toBe('Excellence Entrance Matting — Anthracite');
    expect(mat.price).toBe(448.13);
    expect(mat.unit).toBe('m'); // "$448.13/m"
    expect(mat.itemNumber).toBe('PE607');
  });

  it('flags the import as needing confirmation rather than silently importing', async () => {
    const parsed = await parseSpreadsheet(fixture, 'sample-flooring-database.xlsx');
    const mapping = autoDetectMapping(parsed.headers, parsed.rows)!;
    const { confidence, warnings } = assessMapping(mapping, parsed.rows);
    // Composed name + price-inferred unit → not "high"; surfaced to the user.
    expect(confidence).not.toBe('high');
    expect(warnings.length).toBeGreaterThan(0);
  });
});
