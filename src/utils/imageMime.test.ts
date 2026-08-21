import { describe, it, expect } from 'vitest';
import { imageMimeFromBase64, attachmentMimeFromBytes, isPdfUrl } from './imageMime';

const bytes = (...values: (number | string)[]): Uint8Array => {
  const out: number[] = [];
  for (const v of values) {
    if (typeof v === 'number') out.push(v);
    else for (const ch of v) out.push(ch.charCodeAt(0));
  }
  return new Uint8Array(out);
};

describe('imageMimeFromBase64', () => {
  it('identifies the four embeddable image types', () => {
    expect(imageMimeFromBase64('iVBORw0KGgoAAAA')).toBe('image/png');
    expect(imageMimeFromBase64('/9j/4AAQSkZJRg')).toBe('image/jpeg');
    expect(imageMimeFromBase64('R0lGODlhAQAB')).toBe('image/gif');
    expect(imageMimeFromBase64('UklGRiQAAABXRUJQ')).toBe('image/webp');
  });

  it('returns null for non-image payloads (e.g. a Storage 404 JSON body)', () => {
    expect(imageMimeFromBase64(Buffer.from('{"error":{"code":404}}').toString('base64'))).toBeNull();
  });
});

describe('attachmentMimeFromBytes', () => {
  it('identifies JPEG from FF D8 FF', () => {
    expect(attachmentMimeFromBytes(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
  });

  it('identifies PNG', () => {
    expect(attachmentMimeFromBytes(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
  });

  it('identifies WebP (RIFF container with WEBP tag)', () => {
    expect(attachmentMimeFromBytes(bytes('RIFF', 0x24, 0x00, 0x00, 0x00, 'WEBP'))).toBe('image/webp');
  });

  it('identifies GIF', () => {
    expect(attachmentMimeFromBytes(bytes('GIF89a'))).toBe('image/gif');
  });

  it('identifies PDF from %PDF- magic', () => {
    expect(attachmentMimeFromBytes(bytes('%PDF-1.7'))).toBe('application/pdf');
  });

  it('returns null for HEIC and arbitrary bytes', () => {
    expect(attachmentMimeFromBytes(bytes(0x00, 0x00, 0x00, 0x18, 'ftypheic'))).toBeNull();
    expect(attachmentMimeFromBytes(bytes('hello world'))).toBeNull();
  });

  it('returns null for a too-short header rather than misfiring', () => {
    expect(attachmentMimeFromBytes(bytes(0xff))).toBeNull();
    expect(attachmentMimeFromBytes(new Uint8Array(0))).toBeNull();
  });
});

describe('isPdfUrl', () => {
  it('matches Firebase Storage download URLs for PDFs', () => {
    expect(
      isPdfUrl('https://firebasestorage.googleapis.com/v0/b/x/o/users%2Fu%2Fquote-photos%2Fabc.pdf?alt=media&token=t')
    ).toBe(true);
  });

  it('matches bare storage paths ending in .pdf', () => {
    expect(isPdfUrl('users/u/quote-photos/abc.pdf')).toBe(true);
  });

  it('does not match image URLs or undefined', () => {
    expect(isPdfUrl('https://example.com/photo.jpg?alt=media')).toBe(false);
    expect(isPdfUrl('users/u/quote-photos/abc.jpg')).toBe(false);
    expect(isPdfUrl(undefined)).toBe(false);
    expect(isPdfUrl('')).toBe(false);
  });

  it('does not match .pdf appearing mid-path', () => {
    expect(isPdfUrl('users/u/my.pdf.notes/photo.jpg')).toBe(false);
  });
});
