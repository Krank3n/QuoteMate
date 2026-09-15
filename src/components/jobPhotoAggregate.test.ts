/**
 * The job screen shows job photos and attached-document photos as one strip.
 * These pin the rules the strip relies on: job photos first, then documents,
 * de-duplicated; PDFs stay in the strip but out of the lightbox; only
 * job-owned photos may be edited.
 */
import { describe, it, expect } from 'vitest';
import type { Document } from '../types/document';
import {
  aggregatePhotos,
  canEditPhoto,
  documentOwnedCount,
  documentPhotoLabel,
  lightboxPhotos,
  type StripPhoto,
} from './jobPhotoAggregate';

const photo = (id: string, extra: Partial<StripPhoto> = {}): StripPhoto => ({
  id,
  storageUrl: `https://storage.example/${id}.jpg`,
  ...extra,
});

const doc = (id: string, number: string, photos: StripPhoto[], type: 'quote' | 'invoice' = 'quote'): Document =>
  ({ id, number, type, photos } as unknown as Document);

describe('aggregatePhotos', () => {
  it('lists the job photos first, then each attached document in order', () => {
    const out = aggregatePhotos(
      [photo('j1'), photo('j2')],
      [doc('d1', 'QU-1', [photo('a')]), doc('d2', 'IN-1', [photo('b')])],
    );
    expect(out.map(e => e.photo.id)).toEqual(['j1', 'j2', 'a', 'b']);
    expect(out.map(e => e.owner.kind)).toEqual(['job', 'job', 'document', 'document']);
  });

  it('de-duplicates by id, keeping the job-owned copy', () => {
    const out = aggregatePhotos([photo('same')], [doc('d1', 'QU-1', [photo('same')])]);
    expect(out).toHaveLength(1);
    expect(out[0].owner).toEqual({ kind: 'job' });
  });

  it('de-duplicates by storageUrl when a photo has no id', () => {
    const url = 'https://storage.example/shared.jpg';
    const out = aggregatePhotos(
      [{ id: '', storageUrl: url }],
      [doc('d1', 'QU-1', [{ id: '', storageUrl: url }])],
    );
    expect(out).toHaveLength(1);
  });

  it('drops entries with nothing to show and keeps a pending upload by its local uri', () => {
    const out = aggregatePhotos(
      [{ id: 'blank', storageUrl: '' }, { id: 'pending', storageUrl: '', localUri: 'file:///p.jpg', uploading: true }],
      [],
    );
    expect(out.map(e => e.photo.id)).toEqual(['pending']);
  });

  it('labels a document-owned photo with the document number', () => {
    const out = aggregatePhotos([], [doc('d1', 'QU-1042', [photo('a')])]);
    expect(out[0].owner).toEqual({ kind: 'document', documentId: 'd1', label: 'From QU-1042' });
  });
});

describe('lightboxPhotos', () => {
  it('keeps PDF plans in the strip but out of the lightbox', () => {
    const all = aggregatePhotos(
      [photo('j1'), photo('plan', { storageUrl: 'https://storage.example/plan.pdf?alt=media' })],
      [doc('d1', 'QU-1', [photo('a')])],
    );
    expect(all.map(e => e.photo.id)).toEqual(['j1', 'plan', 'a']);
    expect(lightboxPhotos(all).map(e => e.photo.id)).toEqual(['j1', 'a']);
  });

  it('leaves a still-uploading photo out of the lightbox', () => {
    const all = aggregatePhotos(
      [photo('done'), { id: 'pending', storageUrl: '', localUri: 'file:///p.jpg', uploading: true }],
      [],
    );
    expect(lightboxPhotos(all).map(e => e.photo.id)).toEqual(['done']);
  });
});

describe('canEditPhoto', () => {
  it('allows job-owned photos and blocks document-owned ones', () => {
    const all = aggregatePhotos([photo('j1')], [doc('d1', 'QU-1', [photo('a')])]);
    expect(canEditPhoto(all[0])).toBe(true);
    expect(canEditPhoto(all[1])).toBe(false);
  });
});

describe('documentOwnedCount', () => {
  it('counts only the photos that live on documents, after de-duplication', () => {
    const all = aggregatePhotos(
      [photo('j1'), photo('shared')],
      [doc('d1', 'QU-1', [photo('shared'), photo('a'), photo('b')])],
    );
    expect(documentOwnedCount(all)).toBe(2);
  });
});

describe('documentPhotoLabel', () => {
  it('uses the number when there is one and falls back to the document kind', () => {
    expect(documentPhotoLabel({ number: 'IN-7', type: 'invoice' } as Document)).toBe('From IN-7');
    expect(documentPhotoLabel({ number: '', type: 'invoice' } as Document)).toBe('From the invoice');
    expect(documentPhotoLabel({ number: '', type: 'quote' } as Document)).toBe('From the quote');
  });
});
