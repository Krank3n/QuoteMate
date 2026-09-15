/**
 * The photo cap on a quote, how an over-sized picker batch is trimmed, and
 * the "Uploading 4 of 12" label. JobPhotos itself needs the camera, the
 * picker and Storage to render, so the rules live in jobPhotoLimits.ts and
 * are pinned here.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_PHOTOS,
  photoLimitMessage,
  remainingPhotoSlots,
  trimToPhotoLimit,
  uploadProgressLabel,
} from './jobPhotoLimits';

describe('MAX_PHOTOS', () => {
  it('allows 30 photos per quote (was 5; one in five photo users hit that wall)', () => {
    expect(MAX_PHOTOS).toBe(30);
  });

  it('the cap alert names the number so the copy follows the constant', () => {
    expect(photoLimitMessage()).toBe('Maximum 30 photos per quote.');
  });
});

describe('remainingPhotoSlots', () => {
  it('counts down from the cap', () => {
    expect(remainingPhotoSlots(0)).toBe(30);
    expect(remainingPhotoSlots(5)).toBe(25);
    expect(remainingPhotoSlots(29)).toBe(1);
  });

  it('is zero at the cap and never negative past it', () => {
    expect(remainingPhotoSlots(30)).toBe(0);
    expect(remainingPhotoSlots(45)).toBe(0);
  });
});

describe('trimToPhotoLimit', () => {
  const picked = (n: number) => Array.from({ length: n }, (_, i) => `file:///p${i}.jpg`);

  it('keeps a batch that fits, with no notice', () => {
    const r = trimToPhotoLimit(picked(10), 5);
    expect(r.kept).toHaveLength(10);
    expect(r.dropped).toBe(0);
    expect(r.notice).toBeNull();
  });

  it('keeps a batch that lands exactly on the cap, with no notice', () => {
    const r = trimToPhotoLimit(picked(25), 5);
    expect(r.kept).toHaveLength(25);
    expect(r.notice).toBeNull();
  });

  it('trims to the remaining slots, keeping the first ones picked', () => {
    const r = trimToPhotoLimit(picked(12), 25);
    expect(r.kept).toEqual(picked(5));
    expect(r.dropped).toBe(7);
    expect(r.notice).toBe('Only the first 5 photos were added (max 30 per quote).');
  });

  it('uses the singular when one slot is left', () => {
    const r = trimToPhotoLimit(picked(3), 29);
    expect(r.kept).toHaveLength(1);
    expect(r.notice).toBe('Only the first photo was added (max 30 per quote).');
  });

  it('keeps nothing when the quote is already at the cap', () => {
    const r = trimToPhotoLimit(picked(3), 30);
    expect(r.kept).toEqual([]);
    expect(r.dropped).toBe(3);
  });

  it('honours an explicit cap', () => {
    const r = trimToPhotoLimit(picked(4), 0, 2);
    expect(r.kept).toHaveLength(2);
    expect(r.notice).toBe('Only the first 2 photos were added (max 2 per quote).');
  });
});

describe('uploadProgressLabel', () => {
  it('reads "Uploading 4 of 12" while a batch is in flight', () => {
    expect(uploadProgressLabel({ current: 4, total: 12 })).toBe('Uploading 4 of 12');
  });

  it('starts at 1 and ends at the batch size', () => {
    expect(uploadProgressLabel({ current: 1, total: 30 })).toBe('Uploading 1 of 30');
    expect(uploadProgressLabel({ current: 30, total: 30 })).toBe('Uploading 30 of 30');
  });

  it('clamps a stray position into range', () => {
    expect(uploadProgressLabel({ current: 0, total: 3 })).toBe('Uploading 1 of 3');
    expect(uploadProgressLabel({ current: 9, total: 3 })).toBe('Uploading 3 of 3');
  });

  it('shows nothing for a single photo (the tile spinner covers it) or when idle', () => {
    expect(uploadProgressLabel({ current: 1, total: 1 })).toBeNull();
    expect(uploadProgressLabel(null)).toBeNull();
    expect(uploadProgressLabel(undefined)).toBeNull();
  });
});
