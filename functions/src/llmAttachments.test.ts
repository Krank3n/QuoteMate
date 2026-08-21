import { describe, it, expect } from 'vitest';
import {
  attachmentTypeFromBase64,
  base64ByteLength,
  normalizeLlmAttachments,
  MAX_IMAGE_ATTACHMENT_BYTES,
  MAX_PDF_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
} from './llmAttachments';

const b64 = (bytes: number[] | Buffer): string => Buffer.from(bytes as any).toString('base64');

// Real magic bytes, padded so every sniffed prefix is fully covered.
const JPEG = b64([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP = b64(Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0x00, 0x00, 0x00]), Buffer.from('WEBPVP8 ')]));
const PDF = b64(Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1'));
const GIF = b64(Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1'));

describe('attachmentTypeFromBase64', () => {
  it('identifies JPEG', () => {
    expect(attachmentTypeFromBase64(JPEG)).toBe('image/jpeg');
  });

  it('identifies PNG', () => {
    expect(attachmentTypeFromBase64(PNG)).toBe('image/png');
  });

  it('identifies WebP', () => {
    expect(attachmentTypeFromBase64(WEBP)).toBe('image/webp');
  });

  it('identifies PDF from %PDF- magic (the teamconstruct incident bytes)', () => {
    expect(attachmentTypeFromBase64(PDF)).toBe('application/pdf');
  });

  it('identifies both PDF 1.x and 2.x headers', () => {
    expect(attachmentTypeFromBase64(b64(Buffer.from('%PDF-2.0\n')))).toBe('application/pdf');
  });

  it('recognizes GIF (unsupported downstream)', () => {
    expect(attachmentTypeFromBase64(GIF)).toBe('image/gif');
  });

  it('returns null for HEIC and arbitrary bytes', () => {
    const heic = b64(Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftypheic')]));
    expect(attachmentTypeFromBase64(heic)).toBeNull();
    expect(attachmentTypeFromBase64(b64(Buffer.from('hello world, not an image')))).toBeNull();
  });

  it('does NOT mistake other RIFF containers (WAV/AVI) for WebP', () => {
    const wav = b64(Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0x00, 0x00, 0x00]), Buffer.from('WAVEfmt ')]));
    const avi = b64(Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0x00, 0x00, 0x00]), Buffer.from('AVI LIST')]));
    expect(attachmentTypeFromBase64(wav)).toBeNull();
    expect(attachmentTypeFromBase64(avi)).toBeNull();
  });
});

describe('base64ByteLength', () => {
  it('approximates decoded size from string length', () => {
    const buf = Buffer.alloc(3000, 0xab);
    expect(base64ByteLength(buf.toString('base64'))).toBe(3000);
  });
});

describe('normalizeLlmAttachments', () => {
  it('REGRESSION: 2 PDFs + 3 JPEGs all pass through with true media types (21 Aug 2026 incident shape)', () => {
    const { attachments, dropped } = normalizeLlmAttachments([PDF, PDF, JPEG, JPEG, JPEG]);
    expect(dropped).toEqual([]);
    expect(attachments.map(a => a.mediaType)).toEqual([
      'application/pdf',
      'application/pdf',
      'image/jpeg',
      'image/jpeg',
      'image/jpeg',
    ]);
  });

  it('drops unrecognized bytes without failing the rest', () => {
    const junk = b64(Buffer.from('definitely not an image'));
    const { attachments, dropped } = normalizeLlmAttachments([junk, JPEG]);
    expect(attachments).toHaveLength(1);
    expect(attachments[0].mediaType).toBe('image/jpeg');
    expect(dropped).toEqual([{ index: 0, reason: 'unrecognized bytes (not JPEG/PNG/WebP/PDF)' }]);
  });

  it('drops GIFs as unsupported', () => {
    const { attachments, dropped } = normalizeLlmAttachments([GIF]);
    expect(attachments).toHaveLength(0);
    expect(dropped[0].reason).toContain('image/gif');
  });

  it('drops oversized images (Claude counts the 5MB cap on the base64 payload)', () => {
    const big = Buffer.alloc(MAX_IMAGE_ATTACHMENT_BYTES + 1024);
    big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff; big[3] = 0xe0;
    const { attachments, dropped } = normalizeLlmAttachments([big.toString('base64'), JPEG]);
    expect(attachments).toHaveLength(1);
    expect(dropped[0].reason).toContain('too large');
  });

  it('allows PDFs over the image cap — plans are never compressed client-side', () => {
    const bigPdf = Buffer.alloc(MAX_IMAGE_ATTACHMENT_BYTES + 1024);
    Buffer.from('%PDF-1.7\n').copy(bigPdf);
    const { attachments, dropped } = normalizeLlmAttachments([bigPdf.toString('base64')]);
    expect(dropped).toEqual([]);
    expect(attachments[0].mediaType).toBe('application/pdf');
  });

  it('drops a PDF above the per-file PDF cap', () => {
    const hugePdf = Buffer.alloc(MAX_PDF_ATTACHMENT_BYTES + 4096);
    Buffer.from('%PDF-1.7\n').copy(hugePdf);
    const { attachments, dropped } = normalizeLlmAttachments([hugePdf.toString('base64')]);
    expect(attachments).toHaveLength(0);
    expect(dropped[0].reason).toContain('too large');
  });

  it('enforces the total request budget so both providers stay sendable', () => {
    const eightMbPdf = Buffer.alloc(8_000_000);
    Buffer.from('%PDF-1.7\n').copy(eightMbPdf);
    const b = eightMbPdf.toString('base64');
    const { attachments, dropped } = normalizeLlmAttachments([b, b, JPEG]);
    expect(attachments.map(a => a.mediaType)).toEqual(['application/pdf', 'image/jpeg']);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].index).toBe(1);
    expect(dropped[0].reason).toContain('total attachment budget');
  });

  it('exposes total budget >= per-file caps so a single max-size file always fits', () => {
    expect(MAX_TOTAL_ATTACHMENT_BYTES).toBeGreaterThanOrEqual(MAX_PDF_ATTACHMENT_BYTES);
    expect(MAX_TOTAL_ATTACHMENT_BYTES).toBeGreaterThanOrEqual(MAX_IMAGE_ATTACHMENT_BYTES);
  });

  it('strips a data: URI prefix before sniffing', () => {
    const { attachments, dropped } = normalizeLlmAttachments([`data:image/jpeg;base64,${JPEG}`]);
    expect(dropped).toEqual([]);
    expect(attachments[0].mediaType).toBe('image/jpeg');
    expect(attachments[0].data).toBe(JPEG);
  });

  it('drops empty strings', () => {
    const { attachments, dropped } = normalizeLlmAttachments(['']);
    expect(attachments).toHaveLength(0);
    expect(dropped[0].reason).toBe('empty payload');
  });
});
