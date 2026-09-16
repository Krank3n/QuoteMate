/**
 * The job screen shows job photos and attached-document photos as one strip.
 * These pin the rules the strip relies on: job photos first, then documents,
 * de-duplicated; PDFs stay in the strip but out of the lightbox; job-owned
 * photos are always editable, document-owned ones only with a write path.
 */
import { describe, it, expect } from 'vitest';
import type { Document } from '../types/document';
import type { JobStage } from '../../shared/job/types';
import type { PhotoStage } from '../types';
import {
  aggregatePhotos,
  canEditPhoto,
  defaultStageForJob,
  documentOwnedCount,
  documentPhotoLabel,
  documentPhotoRemoveMessage,
  groupPhotosByStage,
  lightboxPhotos,
  photoRowSummary,
  photoStage,
  EMPTY_PHOTOS_SUMMARY,
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
  it('allows job-owned photos and blocks document-owned ones without a document write path', () => {
    const all = aggregatePhotos([photo('j1')], [doc('d1', 'QU-1', [photo('a')])]);
    expect(canEditPhoto(all[0])).toBe(true);
    expect(canEditPhoto(all[1])).toBe(false);
    expect(canEditPhoto(all[1], false)).toBe(false);
  });

  it('allows document-owned photos once the strip can write documents', () => {
    const all = aggregatePhotos([photo('j1')], [doc('d1', 'QU-1', [photo('a')])]);
    expect(canEditPhoto(all[0], true)).toBe(true);
    expect(canEditPhoto(all[1], true)).toBe(true);
  });
});

describe('documentPhotoRemoveMessage', () => {
  it('warns that the photo leaves the online copy, naming the document kind', () => {
    expect(documentPhotoRemoveMessage({ type: 'quote' })).toBe(
      "This photo also comes off the quote's online copy. Remove it?",
    );
    expect(documentPhotoRemoveMessage({ type: 'invoice' })).toBe(
      "This photo also comes off the invoice's online copy. Remove it?",
    );
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

describe('defaultStageForJob', () => {
  // A Record over JobStage so adding a stage fails to compile until it is
  // classified here.
  const expected: Record<JobStage, PhotoStage> = {
    inquiry: 'before',
    quoted: 'before',
    accepted: 'before',
    cancelled: 'before',
    scheduled: 'after',
    in_progress: 'after',
    completed: 'after',
    paid: 'after',
    closed: 'after',
  };

  it.each(Object.entries(expected) as Array<[JobStage, PhotoStage]>)(
    'maps %s to %s',
    (jobStage, stage) => {
      expect(defaultStageForJob(jobStage)).toBe(stage);
    },
  );

  it('falls back to before for a stage value it has never seen', () => {
    expect(defaultStageForJob('something_new' as JobStage)).toBe('before');
  });
});

describe('photoStage', () => {
  it('treats a missing stage as before', () => {
    expect(photoStage(photo('legacy'))).toBe('before');
    expect(photoStage({ stage: undefined })).toBe('before');
  });

  it('returns the stored stage when there is one', () => {
    expect(photoStage(photo('b', { stage: 'before' }))).toBe('before');
    expect(photoStage(photo('a', { stage: 'after' }))).toBe('after');
  });
});

describe('groupPhotosByStage', () => {
  it('shows headings only when both groups are non-empty', () => {
    const both = groupPhotosByStage(aggregatePhotos([photo('b1'), photo('a1', { stage: 'after' })], []));
    expect(both.showHeadings).toBe(true);
    expect(both.before.map(e => e.photo.id)).toEqual(['b1']);
    expect(both.after.map(e => e.photo.id)).toEqual(['a1']);

    const onlyBefore = groupPhotosByStage(aggregatePhotos([photo('b1'), photo('b2', { stage: 'before' })], []));
    expect(onlyBefore.showHeadings).toBe(false);
    expect(onlyBefore.after).toEqual([]);

    const onlyAfter = groupPhotosByStage(aggregatePhotos([photo('a1', { stage: 'after' })], []));
    expect(onlyAfter.showHeadings).toBe(false);
    expect(onlyAfter.before).toEqual([]);

    expect(groupPhotosByStage([]).showHeadings).toBe(false);
  });

  it('keeps each group in strip order and puts document-owned photos under before', () => {
    const groups = groupPhotosByStage(
      aggregatePhotos(
        [photo('a1', { stage: 'after' }), photo('b1'), photo('a2', { stage: 'after' })],
        [doc('d1', 'QU-1', [photo('d')])],
      ),
    );
    expect(groups.before.map(e => e.photo.id)).toEqual(['b1', 'd']);
    expect(groups.after.map(e => e.photo.id)).toEqual(['a1', 'a2']);
  });
});

describe('documentPhotoLabel', () => {
  it('uses the number when there is one and falls back to the document kind', () => {
    expect(documentPhotoLabel({ number: 'IN-7', type: 'invoice' } as Document)).toBe('From IN-7');
    expect(documentPhotoLabel({ number: '', type: 'invoice' } as Document)).toBe('From the invoice');
    expect(documentPhotoLabel({ number: '', type: 'quote' } as Document)).toBe('From the quote');
  });
});

describe('photoRowSummary', () => {
  const rows = (photos: StripPhoto[]) => aggregatePhotos(photos, []);
  const pending = (id: string): StripPhoto =>
    ({ id, storageUrl: '', localUri: `file:///${id}.jpg`, uploading: true, stage: 'after' });

  it('invites the tradie to add photos when the job has none', () => {
    expect(photoRowSummary([])).toBe('Add site or progress photos');
    expect(photoRowSummary([])).toBe(EMPTY_PHOTOS_SUMMARY);
  });

  it('uses the singular for one photo', () => {
    expect(photoRowSummary(rows([photo('a')]))).toBe('1 photo');
  });

  it('gives a bare count when every photo is in one group', () => {
    expect(photoRowSummary(rows([photo('a'), photo('b'), photo('c')]))).toBe('3 photos');
    expect(
      photoRowSummary(rows([photo('a', { stage: 'after' }), photo('b', { stage: 'after' })])),
    ).toBe('2 photos');
  });

  it('adds the before/after split once both groups have something', () => {
    expect(
      photoRowSummary(rows([photo('a'), photo('b', { stage: 'after' }), photo('c', { stage: 'after' })])),
    ).toBe('3 photos · 1 before, 2 after');
  });

  it('appends the batch progress while photos are uploading', () => {
    expect(photoRowSummary(rows([photo('a'), pending('p1'), pending('p2')]), { current: 2, total: 4 })).toBe(
      '3 photos · 1 before, 2 after · uploading 2 of 4',
    );
    expect(photoRowSummary(rows([photo('a'), photo('b')]), { current: 1, total: 2 })).toBe(
      '2 photos · uploading 1 of 2',
    );
  });

  it('clamps a progress position that runs past the batch', () => {
    expect(photoRowSummary(rows([photo('a')]), { current: 9, total: 3 })).toBe('1 photo · uploading 3 of 3');
    expect(photoRowSummary(rows([photo('a')]), { current: 0, total: 3 })).toBe('1 photo · uploading 1 of 3');
  });

  it('says just "uploading" for a single-photo batch, where "1 of 1" adds nothing', () => {
    expect(photoRowSummary(rows([photo('a')]), { current: 1, total: 1 })).toBe('1 photo · uploading');
  });

  it('drops the progress once the batch is done', () => {
    expect(photoRowSummary(rows([photo('a')]), null)).toBe('1 photo');
  });
});
