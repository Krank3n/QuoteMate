// @vitest-environment jsdom
/**
 * JobPhotoStrip on the job screen: the "Add photos" empty state, the "+"
 * tile, writes that go to job.photos and never to a document, and a
 * lightbox that only lets job-owned photos be annotated or removed.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { Job, JobPhoto } from '../../shared/job/types';
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

const jobPhoto = (id: string): JobPhoto => ({ id, storageUrl: `https://storage.example/${id}.jpg` });
const makeJob = (photos?: JobPhoto[]): Job =>
  ({ id: 'job-1', name: 'Fence', stage: 'quoted', documentIds: ['doc-1'], photos } as unknown as Job);
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
    expect(onJobPhotosChange).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByTestId('alert-primary'));
    });

    expect(onJobPhotosChange).toHaveBeenCalledWith([]);
    expect(storage.deleteQuotePhoto).toHaveBeenCalledWith('https://storage.example/j1.jpg');
    expect(JSON.stringify(doc)).toBe(docBefore);
  });

  it('shows a document-owned photo view-only with the document number', () => {
    render(
      <JobPhotoStrip job={makeJob([jobPhoto('j1')])} documents={[makeDoc([jobPhoto('a')])]} onJobPhotosChange={vi.fn()} />,
    );

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
