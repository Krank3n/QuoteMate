// @vitest-environment jsdom
/**
 * JobPhotoStrip on the job screen: the "Add photos" empty state, the "+"
 * tile, writes that go to job.photos and never to a document, and a
 * lightbox that only lets job-owned photos be annotated or removed.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { Job, JobPhoto, JobStage } from '../../shared/job/types';
import type { Document } from '../types/document';

vi.mock('../theme', async () => await import('../test/stubs/theme'));
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('react-native-paper', async () => {
  const { Text } = await import('react-native');
  return { Text };
});
vi.mock('../utils/haptics', () => ({ selectionTap: vi.fn() }));

const picker = vi.hoisted(() => ({
  getMediaLibraryPermissionsAsync: vi.fn(async () => ({ status: 'granted', canAskAgain: true })),
  requestMediaLibraryPermissionsAsync: vi.fn(async () => ({ status: 'granted' })),
  getCameraPermissionsAsync: vi.fn(async () => ({ status: 'granted', canAskAgain: true })),
  launchImageLibraryAsync: vi.fn(async () => ({ canceled: true, assets: [] as Array<{ uri: string }> })),
}));
vi.mock('expo-image-picker', () => picker);

const storage = vi.hoisted(() => ({
  uploadQuotePhoto: vi.fn(async (_uid: string, uri: string) => `https://storage.example/${uri.split('/').pop()}`),
  deleteQuotePhoto: vi.fn(async () => {}),
  sniffLocalPhotoMime: vi.fn(async () => 'image/jpeg'),
  UnsupportedPhotoError: class UnsupportedPhotoError extends Error {},
}));
vi.mock('../services/photoService', () => storage);
vi.mock('../services/planDetection', () => ({ detectIsPlan: vi.fn(async () => false) }));

// The real chrome pulls in the camera, the annotator and the themed alert.
// This double exposes the alert's primary action and the annotator's save so
// the tests can drive the confirm and re-upload flows.
vi.mock('./PhotoUploaderModals', async () => {
  const { Pressable, Text } = await import('react-native');
  const ReactLib = await import('react');
  return {
    PhotoUploaderModals: ({ uploader }: { uploader: import('./usePhotoUploader').PhotoUploader }) =>
      ReactLib.createElement(
        ReactLib.Fragment,
        null,
        uploader.alertConfig
          ? ReactLib.createElement(
              Pressable,
              { testID: 'alert-primary', onPress: uploader.alertConfig.primaryButtonAction },
              ReactLib.createElement(Text, null, uploader.alertConfig.title),
              ReactLib.createElement(Text, { testID: 'alert-message' }, uploader.alertConfig.message),
              ReactLib.createElement(Text, { testID: 'alert-buttons' }, `${uploader.alertConfig.primaryButtonText} / ${uploader.alertConfig.secondaryButtonText}`),
            )
          : null,
        uploader.annotatingPhoto
          ? ReactLib.createElement(
              Pressable,
              {
                testID: 'annotator-save',
                onPress: () => uploader.handleAnnotationSave('file:///annotated.jpg'),
              },
              ReactLib.createElement(Text, null, 'annotating'),
            )
          : null,
      ),
  };
});

import { JobPhotoStrip } from './JobPhotoStrip';
import { MAX_PHOTOS } from './jobPhotoLimits';

const jobPhoto = (id: string, extra: Partial<JobPhoto> = {}): JobPhoto =>
  ({ id, storageUrl: `https://storage.example/${id}.jpg`, ...extra });
const makeJob = (photos?: JobPhoto[], stage: JobStage = 'quoted'): Job =>
  ({ id: 'job-1', name: 'Fence', stage, documentIds: ['doc-1'], photos } as unknown as Job);
const makeDoc = (photos: JobPhoto[]): Document =>
  ({ id: 'doc-1', number: 'QU-1042', type: 'quote', jobId: 'job-1', photos } as unknown as Document);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('JobPhotoStrip tiles', () => {
  it('renders the "Add photos" empty state when the job has no photos', () => {
    render(<JobPhotoStrip job={makeJob()} documents={[]} onJobPhotosChange={vi.fn()} />);
    expect(screen.getByTestId('job-photo-strip-empty-add')).toBeTruthy();
    expect(screen.getByText('Add photos')).toBeTruthy();
    expect(screen.getByText('Site photos, plans and progress shots for this job.')).toBeTruthy();
    expect(screen.queryByTestId('job-photo-strip-add')).toBeNull();
  });

  it('renders nothing when read-only and empty (no onJobPhotosChange)', () => {
    const { container } = render(<JobPhotoStrip job={makeJob()} documents={[]} />);
    expect(container.textContent).toBe('');
  });

  it('appends a "+" tile when photos exist', () => {
    render(
      <JobPhotoStrip job={makeJob([jobPhoto('j1')])} documents={[makeDoc([jobPhoto('a')])]} onJobPhotosChange={vi.fn()} />,
    );
    expect(screen.getByTestId('job-photo-strip-add')).toBeTruthy();
    expect(screen.queryByTestId('job-photo-strip-empty-add')).toBeNull();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('hides the "+" tile once job and document photos together reach the cap', () => {
    const docPhotos = Array.from({ length: MAX_PHOTOS - 1 }, (_, i) => jobPhoto(`d${i}`));
    render(
      <JobPhotoStrip job={makeJob([jobPhoto('j1')])} documents={[makeDoc(docPhotos)]} onJobPhotosChange={vi.fn()} />,
    );
    expect(screen.getByText(String(MAX_PHOTOS))).toBeTruthy();
    expect(screen.queryByTestId('job-photo-strip-add')).toBeNull();
  });
});

describe('JobPhotoStrip writes', () => {
  it('adds from the job screen into job.photos and leaves the document untouched', async () => {
    picker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///new.jpg' }],
    });
    const onJobPhotosChange = vi.fn();
    const doc = makeDoc([jobPhoto('a')]);
    const docBefore = JSON.stringify(doc);
    render(
      <JobPhotoStrip job={makeJob([jobPhoto('j1')])} documents={[doc]} onJobPhotosChange={onJobPhotosChange} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('job-photo-strip-add'));
    });

    expect(onJobPhotosChange).toHaveBeenCalledTimes(1);
    const written = onJobPhotosChange.mock.calls[0][0] as JobPhoto[];
    expect(written.map(p => p.storageUrl)).toEqual([
      'https://storage.example/j1.jpg',
      'https://storage.example/new.jpg',
    ]);
    // The document's own photos are never part of the job write.
    expect(written.some(p => p.id === 'a')).toBe(false);
    expect(JSON.stringify(doc)).toBe(docBefore);
  });

  it('stamps stage and takenAt from the job stage on the new photo only', async () => {
    picker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///new.jpg' }],
    });
    const onJobPhotosChange = vi.fn();
    const existing = jobPhoto('j1');
    const before = Date.now();
    render(
      <JobPhotoStrip job={makeJob([existing], 'in_progress')} documents={[]} onJobPhotosChange={onJobPhotosChange} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('job-photo-strip-add'));
    });

    const written = onJobPhotosChange.mock.calls[0][0] as JobPhoto[];
    expect(written[0]).toEqual(existing);
    expect(written[1].stage).toBe('after');
    expect(written[1].takenAt).toBeGreaterThanOrEqual(before);
    expect(written[1].takenAt).toBeLessThanOrEqual(Date.now());
  });

  it('stamps "before" while the job is still being quoted', async () => {
    picker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///new.jpg' }],
    });
    const onJobPhotosChange = vi.fn();
    render(<JobPhotoStrip job={makeJob([], 'accepted')} documents={[]} onJobPhotosChange={onJobPhotosChange} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('job-photo-strip-empty-add'));
    });

    const written = onJobPhotosChange.mock.calls[0][0] as JobPhoto[];
    expect(written[0].stage).toBe('before');
  });
});

describe('JobPhotoStrip before and after', () => {
  it('shows a flip pill on job-owned tiles only, and tapping it flips the stage through job.photos', () => {
    const onJobPhotosChange = vi.fn();
    const j1 = jobPhoto('j1');
    const j2 = jobPhoto('j2', { stage: 'after' });
    render(
      <JobPhotoStrip job={makeJob([j1, j2])} documents={[makeDoc([jobPhoto('a')])]} onJobPhotosChange={onJobPhotosChange} />,
    );

    // A photo with no stage reads as Before; the document tile has no pill.
    expect(screen.getByTestId('job-photo-stage-0').textContent).toBe('Before');
    expect(screen.getByTestId('job-photo-stage-1').textContent).toBe('After');
    expect(screen.queryByTestId('job-photo-stage-2')).toBeNull();

    fireEvent.click(screen.getByTestId('job-photo-stage-0'));
    expect(onJobPhotosChange).toHaveBeenCalledWith([{ ...j1, stage: 'after' }, j2]);
    // The tap flips; it does not open the lightbox.
    expect(screen.queryByTestId('lightbox-counter')).toBeNull();

    fireEvent.click(screen.getByTestId('job-photo-stage-1'));
    expect(onJobPhotosChange).toHaveBeenLastCalledWith([j1, { ...j2, stage: 'before' }]);
  });

  it('has no pill when the strip is read-only', () => {
    render(<JobPhotoStrip job={makeJob([jobPhoto('j1')])} documents={[]} />);
    expect(screen.getByTestId('job-photo-thumb-0')).toBeTruthy();
    expect(screen.queryByTestId('job-photo-stage-0')).toBeNull();
  });

  it('shows Before and After headings only when both groups have photos', () => {
    const { rerender } = render(
      <JobPhotoStrip job={makeJob([jobPhoto('b1'), jobPhoto('b2', { stage: 'before' })])} documents={[]} onJobPhotosChange={vi.fn()} />,
    );
    expect(screen.queryByTestId('job-photo-group-before')).toBeNull();
    expect(screen.queryByTestId('job-photo-group-after')).toBeNull();

    rerender(
      <JobPhotoStrip job={makeJob([jobPhoto('b1'), jobPhoto('a1', { stage: 'after' })])} documents={[]} onJobPhotosChange={vi.fn()} />,
    );
    expect(screen.getByTestId('job-photo-group-before').textContent).toBe('Before');
    expect(screen.getByTestId('job-photo-group-after').textContent).toBe('After');
  });

  it('pages the lightbox within the tapped group and names the group in the counter', () => {
    render(
      <JobPhotoStrip
        job={makeJob([jobPhoto('b1'), jobPhoto('a1', { stage: 'after' }), jobPhoto('a2', { stage: 'after' })])}
        documents={[]}
        onJobPhotosChange={vi.fn()}
      />,
    );

    // a1 is photos[1]; it is the first of two in the After group.
    fireEvent.click(screen.getByTestId('job-photo-thumb-1'));
    expect(screen.getByTestId('lightbox-counter').textContent).toBe('After · 1 / 2');
    expect(screen.queryByTestId('lightbox-prev')).toBeNull();

    fireEvent.click(screen.getByTestId('lightbox-next'));
    expect(screen.getByTestId('lightbox-counter').textContent).toBe('After · 2 / 2');
    expect(screen.queryByTestId('lightbox-next')).toBeNull();
  });

  it('keeps the plain counter when there is only one group', () => {
    render(
      <JobPhotoStrip job={makeJob([jobPhoto('b1'), jobPhoto('b2')])} documents={[]} onJobPhotosChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('job-photo-thumb-1'));
    expect(screen.getByTestId('lightbox-counter').textContent).toBe('2 / 2');
  });
});

describe('JobPhotoStrip lightbox', () => {
  it('offers Annotate and Remove for a job-owned photo, and Remove writes job.photos', async () => {
    const onJobPhotosChange = vi.fn();
    const doc = makeDoc([jobPhoto('a')]);
    const docBefore = JSON.stringify(doc);
    render(
      <JobPhotoStrip job={makeJob([jobPhoto('j1')])} documents={[doc]} onJobPhotosChange={onJobPhotosChange} />,
    );

    // First thumb is the job-owned photo.
    fireEvent.click(screen.getByTestId('job-photo-thumb-0'));
    expect(screen.getByTestId('lightbox-annotate')).toBeTruthy();
    expect(screen.getByTestId('lightbox-remove')).toBeTruthy();
    expect(screen.queryByTestId('lightbox-caption')).toBeNull();

    fireEvent.click(screen.getByTestId('lightbox-remove'));
    expect(screen.getByText('Remove Photo')).toBeTruthy();
    // A job-owned photo keeps the plain confirm; nothing online changes.
    expect(screen.getByTestId('alert-message').textContent).toBe('Are you sure you want to remove this photo?');
    expect(onJobPhotosChange).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByTestId('alert-primary'));
    });

    expect(onJobPhotosChange).toHaveBeenCalledWith([]);
    expect(storage.deleteQuotePhoto).toHaveBeenCalledWith('https://storage.example/j1.jpg');
    expect(JSON.stringify(doc)).toBe(docBefore);
  });

  it('keeps a document-owned photo view-only, captioned with the document number, when there is no onDocumentPhotosChange', () => {
    render(
      <JobPhotoStrip job={makeJob([jobPhoto('j1')])} documents={[makeDoc([jobPhoto('a')])]} onJobPhotosChange={vi.fn()} />,
    );

    // No pill on the document tile...
    expect(screen.getByTestId('job-photo-stage-0')).toBeTruthy();
    expect(screen.queryByTestId('job-photo-stage-1')).toBeNull();

    // ...and no actions in the lightbox, only the caption.
    fireEvent.click(screen.getByTestId('job-photo-thumb-1'));
    expect(screen.getByTestId('lightbox-caption').textContent).toBe('From QU-1042');
    expect(screen.queryByTestId('lightbox-annotate')).toBeNull();
    expect(screen.queryByTestId('lightbox-remove')).toBeNull();
  });

  it('annotating a job-owned photo replaces its entry in job.photos and deletes the old file', async () => {
    const onJobPhotosChange = vi.fn();
    render(
      <JobPhotoStrip job={makeJob([jobPhoto('j1'), jobPhoto('j2')])} documents={[]} onJobPhotosChange={onJobPhotosChange} />,
    );

    fireEvent.click(screen.getByTestId('job-photo-thumb-0'));
    fireEvent.click(screen.getByTestId('lightbox-annotate'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('annotator-save'));
    });

    const last = onJobPhotosChange.mock.calls.at(-1)?.[0] as JobPhoto[];
    expect(last.map(p => p.id)).toEqual(['j2', 'j1']);
    expect(last[1]).toMatchObject({ storageUrl: 'https://storage.example/annotated.jpg', annotated: true });
    expect(storage.deleteQuotePhoto).toHaveBeenCalledWith('https://storage.example/j1.jpg');
  });
});

// With onDocumentPhotosChange the job page manages every photo it shows,
// including the ones that arrived on a quote. Each of these writes goes to
// the owning document's photos and never to job.photos.
describe('JobPhotoStrip document-owned photos', () => {
  const renderEditable = (jobPhotos: JobPhoto[], docPhotos: JobPhoto[]) => {
    const onJobPhotosChange = vi.fn();
    const onDocumentPhotosChange = vi.fn();
    const job = makeJob(jobPhotos);
    const jobBefore = JSON.stringify(job);
    render(
      <JobPhotoStrip
        job={job}
        documents={[makeDoc(docPhotos)]}
        onJobPhotosChange={onJobPhotosChange}
        onDocumentPhotosChange={onDocumentPhotosChange}
      />,
    );
    return { onJobPhotosChange, onDocumentPhotosChange, job, jobBefore };
  };

  it('flipping a document-owned photo writes the stage onto the document and leaves job.photos alone', () => {
    const a = jobPhoto('a');
    const b = jobPhoto('b', { stage: 'after' });
    const { onJobPhotosChange, onDocumentPhotosChange, job, jobBefore } = renderEditable([jobPhoto('j1')], [a, b]);

    // Tiles: j1 (job), a (doc), b (doc). Every tile now has a pill.
    expect(screen.getByTestId('job-photo-stage-1').textContent).toBe('Before');
    expect(screen.getByTestId('job-photo-stage-2').textContent).toBe('After');

    fireEvent.click(screen.getByTestId('job-photo-stage-1'));
    expect(onDocumentPhotosChange).toHaveBeenCalledWith('doc-1', [{ ...a, stage: 'after' }, b]);
    expect(onJobPhotosChange).not.toHaveBeenCalled();
    expect(JSON.stringify(job)).toBe(jobBefore);
    expect(screen.queryByTestId('lightbox-counter')).toBeNull();

    fireEvent.click(screen.getByTestId('job-photo-stage-2'));
    expect(onDocumentPhotosChange).toHaveBeenLastCalledWith('doc-1', [a, { ...b, stage: 'before' }]);
  });

  it('flipping a job-owned photo still writes job.photos, not the document', () => {
    const j1 = jobPhoto('j1');
    const { onJobPhotosChange, onDocumentPhotosChange } = renderEditable([j1], [jobPhoto('a')]);

    fireEvent.click(screen.getByTestId('job-photo-stage-0'));
    expect(onJobPhotosChange).toHaveBeenCalledWith([{ ...j1, stage: 'after' }]);
    expect(onDocumentPhotosChange).not.toHaveBeenCalled();
  });

  it('removing a document-owned photo warns about the online copy, then drops it from the document', async () => {
    const a = jobPhoto('a');
    const b = jobPhoto('b');
    const { onJobPhotosChange, onDocumentPhotosChange, job, jobBefore } = renderEditable([jobPhoto('j1')], [a, b]);

    fireEvent.click(screen.getByTestId('job-photo-thumb-1'));
    // The caption stays alongside the actions, so the tradie knows which
    // quote this Remove also touches.
    expect(screen.getByTestId('lightbox-caption').textContent).toBe('From QU-1042');
    expect(screen.getByTestId('lightbox-annotate')).toBeTruthy();

    fireEvent.click(screen.getByTestId('lightbox-remove'));
    expect(screen.getByText('Remove Photo')).toBeTruthy();
    expect(screen.getByTestId('alert-message').textContent).toBe(
      "This photo also comes off the quote's online copy. Remove it?",
    );
    expect(screen.getByTestId('alert-buttons').textContent).toBe('Remove / Cancel');
    expect(onDocumentPhotosChange).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByTestId('alert-primary'));
    });

    expect(onDocumentPhotosChange).toHaveBeenCalledWith('doc-1', [b]);
    expect(onJobPhotosChange).not.toHaveBeenCalled();
    expect(JSON.stringify(job)).toBe(jobBefore);
    expect(storage.deleteQuotePhoto).toHaveBeenCalledWith('https://storage.example/a.jpg');
  });

  it('annotating a document-owned photo replaces its entry on the document and deletes the old file', async () => {
    const a = jobPhoto('a', { stage: 'after', takenAt: 123 });
    const b = jobPhoto('b');
    const { onJobPhotosChange, onDocumentPhotosChange } = renderEditable([jobPhoto('j1')], [a, b]);

    fireEvent.click(screen.getByTestId('job-photo-thumb-1'));
    fireEvent.click(screen.getByTestId('lightbox-annotate'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('annotator-save'));
    });

    expect(onDocumentPhotosChange.mock.calls.every(call => call[0] === 'doc-1')).toBe(true);
    const last = onDocumentPhotosChange.mock.calls.at(-1)?.[1] as JobPhoto[];
    expect(last.map(p => p.id)).toEqual(['b', 'a']);
    expect(last[1]).toMatchObject({
      storageUrl: 'https://storage.example/annotated.jpg',
      annotated: true,
      stage: 'after',
      takenAt: 123,
    });
    expect(onJobPhotosChange).not.toHaveBeenCalled();
    expect(storage.deleteQuotePhoto).toHaveBeenCalledWith('https://storage.example/a.jpg');
  });

  it('names the invoice in the confirm when the photo lives on an invoice', () => {
    const onDocumentPhotosChange = vi.fn();
    const invoice = { ...makeDoc([jobPhoto('a')]), id: 'inv-1', number: 'IN-7', type: 'invoice' } as unknown as Document;
    render(
      <JobPhotoStrip
        job={makeJob([])}
        documents={[invoice]}
        onJobPhotosChange={vi.fn()}
        onDocumentPhotosChange={onDocumentPhotosChange}
      />,
    );

    fireEvent.click(screen.getByTestId('job-photo-thumb-0'));
    expect(screen.getByTestId('lightbox-caption').textContent).toBe('From IN-7');
    fireEvent.click(screen.getByTestId('lightbox-remove'));
    expect(screen.getByTestId('alert-message').textContent).toBe(
      "This photo also comes off the invoice's online copy. Remove it?",
    );
  });
});
