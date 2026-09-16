// @vitest-environment jsdom
/**
 * JobPhotosCard on the job page: a PHOTOS row that opens by default on a
 * job with no photos and stays shut once it has some, expands the strip
 * inline on tap, and carries an upload in its summary while collapsed.
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

// The modals are the uploader owner's job; here we only need to know they
// are mounted by the card, not by the strip body.
vi.mock('./PhotoUploaderModals', async () => {
  const { Text } = await import('react-native');
  const ReactLib = await import('react');
  return {
    PhotoUploaderModals: () => ReactLib.createElement(Text, { testID: 'uploader-modals' }, ''),
  };
});

import { JobPhotosCard } from './JobPhotosCard';

const jobPhoto = (id: string, extra: Partial<JobPhoto> = {}): JobPhoto =>
  ({ id, storageUrl: `https://storage.example/${id}.jpg`, ...extra });
const makeJob = (photos?: JobPhoto[], stage: JobStage = 'quoted'): Job =>
  ({ id: 'job-1', name: 'Fence', stage, documentIds: ['doc-1'], photos } as unknown as Job);
const makeDoc = (photos: JobPhoto[]): Document =>
  ({ id: 'doc-1', number: 'QU-1042', type: 'quote', jobId: 'job-1', photos } as unknown as Document);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('JobPhotosCard default state', () => {
  it('starts expanded on a job with no photos, with the Add tile one tap away', () => {
    render(<JobPhotosCard job={makeJob()} documents={[]} onJobPhotosChange={vi.fn()} />);
    expect(screen.getByTestId('job-photos-row')).toBeTruthy();
    expect(screen.getByText('Add site or progress photos')).toBeTruthy();
    expect(screen.getByTestId('job-photos-body')).toBeTruthy();
    expect(screen.getByTestId('job-photo-strip-empty-add')).toBeTruthy();
    expect(screen.getByLabelText('Hide photos')).toBeTruthy();
  });

  it('starts collapsed once the job has photos and summarises them in the row', () => {
    render(
      <JobPhotosCard
        job={makeJob([jobPhoto('j1'), jobPhoto('j2', { stage: 'after' })])}
        documents={[makeDoc([jobPhoto('a')])]}
        onJobPhotosChange={vi.fn()}
      />,
    );
    expect(screen.getByText('3 photos · 2 before, 1 after')).toBeTruthy();
    expect(screen.queryByTestId('job-photos-body')).toBeNull();
    expect(screen.queryByTestId('job-photo-thumb-0')).toBeNull();
    expect(screen.getByLabelText('Show photos')).toBeTruthy();
  });

  it('renders nothing when read-only and empty (no onJobPhotosChange)', () => {
    const { container } = render(<JobPhotosCard job={makeJob()} documents={[]} />);
    expect(container.textContent).toBe('');
  });

  it('read-only with photos: the row and thumbs show, with no way to add', () => {
    render(<JobPhotosCard job={makeJob([jobPhoto('j1')])} documents={[]} />);
    expect(screen.getByText('1 photo')).toBeTruthy();
    fireEvent.click(screen.getByTestId('job-photos-row'));
    expect(screen.getByTestId('job-photo-thumb-0')).toBeTruthy();
    expect(screen.queryByTestId('job-photo-strip-add')).toBeNull();
    expect(screen.queryByTestId('uploader-modals')).toBeNull();
  });
});

describe('JobPhotosCard expand and collapse', () => {
  it('tapping the row expands the strip body and tapping again collapses it', () => {
    render(
      <JobPhotosCard
        job={makeJob([jobPhoto('j1'), jobPhoto('j2')])}
        documents={[]}
        onJobPhotosChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('job-photos-body')).toBeNull();

    fireEvent.click(screen.getByTestId('job-photos-row'));
    expect(screen.getByTestId('job-photos-body')).toBeTruthy();
    expect(screen.getByTestId('job-photo-thumb-0')).toBeTruthy();
    expect(screen.getByTestId('job-photo-thumb-1')).toBeTruthy();
    expect(screen.getByTestId('job-photo-strip-add')).toBeTruthy();
    expect(screen.getByLabelText('Hide photos')).toBeTruthy();

    fireEvent.click(screen.getByTestId('job-photos-row'));
    expect(screen.queryByTestId('job-photos-body')).toBeNull();
    expect(screen.queryByTestId('job-photo-thumb-0')).toBeNull();
    // The summary stays either way.
    expect(screen.getByText('2 photos')).toBeTruthy();
  });

  it('shows the Before/After rows inside the expanded body', () => {
    render(
      <JobPhotosCard
        job={makeJob([jobPhoto('j1'), jobPhoto('j2', { stage: 'after' })])}
        documents={[]}
        onJobPhotosChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('job-photos-row'));
    expect(screen.getByTestId('job-photo-group-before')).toBeTruthy();
    expect(screen.getByTestId('job-photo-group-after')).toBeTruthy();
  });

  it('does not snap shut when the first photo is added', async () => {
    picker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///new.jpg' }],
    });
    const onJobPhotosChange = vi.fn();
    const { rerender } = render(
      <JobPhotosCard job={makeJob()} documents={[]} onJobPhotosChange={onJobPhotosChange} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('job-photo-strip-empty-add'));
    });
    expect(onJobPhotosChange).toHaveBeenCalledTimes(1);
    const written = onJobPhotosChange.mock.calls[0][0] as JobPhoto[];
    rerender(<JobPhotosCard job={makeJob(written)} documents={[]} onJobPhotosChange={onJobPhotosChange} />);

    expect(screen.getByText('1 photo')).toBeTruthy();
    expect(screen.getByTestId('job-photos-body')).toBeTruthy();
    expect(screen.getByTestId('job-photo-thumb-0')).toBeTruthy();
  });
});

describe('JobPhotosCard while uploading', () => {
  it('keeps the batch going, and in the summary, after the row is collapsed', async () => {
    picker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///one.jpg' }, { uri: 'file:///two.jpg' }],
    });
    // The first upload never lands, so the batch is stuck at 1 of 2.
    storage.uploadQuotePhoto.mockImplementationOnce(() => new Promise(() => {}));
    render(<JobPhotosCard job={makeJob()} documents={[]} onJobPhotosChange={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('job-photo-strip-empty-add'));
    });
    expect(screen.getByText('2 photos · uploading 1 of 2')).toBeTruthy();
    expect(screen.getByTestId('job-photo-thumb-0')).toBeTruthy();

    fireEvent.click(screen.getByTestId('job-photos-row'));
    expect(screen.queryByTestId('job-photos-body')).toBeNull();
    expect(screen.getByText('2 photos · uploading 1 of 2')).toBeTruthy();
    // The modals stay mounted with the card, not the body.
    expect(screen.getByTestId('uploader-modals')).toBeTruthy();
  });
});
