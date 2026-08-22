// Which extractor reads files Mate already has in hand. The mime is a hint at
// best — an attachment picked on web carries whatever the OS felt like — so
// anything that isn't unmistakably a PDF goes to the photo extractor.

import { describe, it, expect } from 'vitest';
import { MAX_IMPORT_IMAGES, routeSupplierImport } from '../supplierImportRouting';

describe('routeSupplierImport', () => {
  it('routes application/pdf to the PDF extractor', () => {
    expect(
      routeSupplierImport({ uris: ['file:///list.pdf'], mimeType: 'application/pdf' }),
    ).toEqual({ kind: 'pdf', uri: 'file:///list.pdf' });
  });

  it('routes image/* to the photo extractor', () => {
    expect(
      routeSupplierImport({ uris: ['file:///a.jpg', 'file:///b.png'], mimeType: 'image/jpeg' }),
    ).toEqual({ kind: 'photos', uris: ['file:///a.jpg', 'file:///b.png'] });
  });

  it('routes an unknown mimeType to photos', () => {
    expect(routeSupplierImport({ uris: ['file:///a.jpg'] })).toEqual({
      kind: 'photos',
      uris: ['file:///a.jpg'],
    });
    expect(routeSupplierImport({ uris: ['file:///a'], mimeType: 'application/octet-stream' })).toEqual({
      kind: 'photos',
      uris: ['file:///a'],
    });
  });

  it('rejects more than ten images', () => {
    const uris = Array.from({ length: MAX_IMPORT_IMAGES + 1 }, (_, i) => `file:///p${i}.jpg`);
    const route = routeSupplierImport({ uris });
    expect(route.kind).toBe('error');
    expect(route.kind === 'error' && route.message).toContain('more than 10 pages');
  });

  it('takes exactly ten', () => {
    const uris = Array.from({ length: MAX_IMPORT_IMAGES }, (_, i) => `file:///p${i}.jpg`);
    expect(routeSupplierImport({ uris }).kind).toBe('photos');
  });

  it('errors rather than calling an extractor with nothing', () => {
    expect(routeSupplierImport({ uris: [] }).kind).toBe('error');
    expect(routeSupplierImport({ uris: ['', '  '] }).kind).toBe('error');
  });
});
