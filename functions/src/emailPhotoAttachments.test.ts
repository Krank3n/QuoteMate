/**
 * Which photos ride on the quote email as files. A quote can carry 30; the
 * email attaches at most ten, plans first, under the 7 MB byte budget.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_EMAIL_ATTACHMENT_BYTES,
  MAX_EMAIL_PHOTO_ATTACHMENTS,
  buildEmailPhotoAttachments,
  selectEmailPhotoUrls,
  type FetchedPhotoFile,
} from './emailPhotoAttachments';

const photoUrl = (i: number) => `https://firebasestorage.googleapis.com/v0/b/x/o/photos%2Fsite${i}.jpg?alt=media`;
const planUrl = (i: number) => `https://firebasestorage.googleapis.com/v0/b/x/o/plans%2Fplan${i}.pdf?alt=media&token=t`;
const photos = (n: number) => Array.from({ length: n }, (_, i) => photoUrl(i + 1));

describe('selectEmailPhotoUrls', () => {
  it('caps at ten files', () => {
    expect(MAX_EMAIL_PHOTO_ATTACHMENTS).toBe(10);
    const picked = selectEmailPhotoUrls(photos(30));
    expect(picked).toHaveLength(10);
  });

  it('keeps the first ten site photos in the order the tradie added them', () => {
    expect(selectEmailPhotoUrls(photos(30))).toEqual(photos(10));
  });

  it('puts PDF plans first even when they were added last', () => {
    const picked = selectEmailPhotoUrls([...photos(12), planUrl(1), planUrl(2)]);
    expect(picked).toHaveLength(10);
    expect(picked.slice(0, 2)).toEqual([planUrl(1), planUrl(2)]);
    expect(picked.slice(2)).toEqual(photos(8));
  });

  it('keeps every plan ahead of any photo, so a run of photos cannot crowd a plan out', () => {
    const urls = [photoUrl(1), planUrl(1), ...photos(20).slice(1), planUrl(2)];
    const picked = selectEmailPhotoUrls(urls);
    expect(picked[0]).toBe(planUrl(1));
    expect(picked[1]).toBe(planUrl(2));
    expect(picked.filter(u => u.endsWith('.pdf?alt=media&token=t'))).toHaveLength(2);
  });

  it('drops local file:// and blob: URIs that a mail client cannot resolve', () => {
    expect(selectEmailPhotoUrls(['file:///local.jpg', 'blob:abc', photoUrl(1)])).toEqual([photoUrl(1)]);
  });

  it('returns everything, unchanged in order, when the quote is under the cap', () => {
    expect(selectEmailPhotoUrls(photos(3))).toEqual(photos(3));
    expect(selectEmailPhotoUrls([])).toEqual([]);
  });

  it('honours an explicit cap', () => {
    expect(selectEmailPhotoUrls(photos(5), 2)).toEqual(photos(2));
  });
});

describe('buildEmailPhotoAttachments', () => {
  const photo = (bytes = 200_000): FetchedPhotoFile => ({ isPdf: false, ext: 'jpg', bytes, content: 'p' });
  const plan = (bytes = 900_000): FetchedPhotoFile => ({ isPdf: true, ext: 'pdf', bytes, content: 'd' });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names plans Plan_n.pdf and photos Job_Photo_n.ext, plans first by sniffed type', () => {
    // A plan stored under a .jpg name is still a plan once the response
    // content-type says so; it is ordered ahead of the photos.
    const out = buildEmailPhotoAttachments([photo(), plan(), photo(), plan()]);
    expect(out.map(a => a.name)).toEqual(['Plan_1.pdf', 'Plan_2.pdf', 'Job_Photo_1.jpg', 'Job_Photo_2.jpg']);
  });

  it('stops at ten files and warns about the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = buildEmailPhotoAttachments(Array.from({ length: 14 }, () => photo(100_000)));
    expect(out).toHaveLength(10);
    expect(out[9].name).toBe('Job_Photo_10.jpg');
    expect(warn).toHaveBeenCalledTimes(4);
    expect(warn.mock.calls[0][0]).toContain('over email file cap');
  });

  it('keeps the 7 MB byte budget as a second guard, skipping the file that would break it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(MAX_EMAIL_ATTACHMENT_BYTES).toBe(7_000_000);
    const out = buildEmailPhotoAttachments([
      plan(4_000_000),
      photo(2_000_000),
      photo(2_000_000), // would take the total to 8 MB
      photo(500_000),   // still fits
    ]);
    expect(out.map(a => a.name)).toEqual(['Plan_1.pdf', 'Job_Photo_1.jpg', 'Job_Photo_2.jpg']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('over email budget');
  });

  it('returns nothing for nothing', () => {
    expect(buildEmailPhotoAttachments([])).toEqual([]);
  });
});
