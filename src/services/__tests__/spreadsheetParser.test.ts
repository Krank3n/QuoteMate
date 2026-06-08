/**
 * Tests for spreadsheetParser
 *
 * Covers the pure logic (auto-detect, unit/price normalisation, building
 * an ExtractResult from a mapping). File-reading is covered indirectly
 * by feeding `buildExtractFromMapping` a hand-built ParsedSpreadsheet.
 */

import { describe, it, expect } from 'vitest';
import {
  autoDetectMapping,
  buildExtractFromMapping,
  normaliseUnit,
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
