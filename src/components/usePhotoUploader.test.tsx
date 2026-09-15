// @vitest-environment jsdom
/**
 * usePhotoUploader is the one upload path for the wizard grid and the job
 * screen strip. These pin the rules the job screen depends on: the cap counts
 * photos it shows but never writes (extraCount), a batch appends to the
 * committed list one photo at a time, and removal asks first.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { QuotePhoto } from '../types';

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

import { usePhotoUploader } from './usePhotoUploader';
import { MAX_PHOTOS } from './jobPhotoLimits';

const photo = (id: string): QuotePhoto => ({ id, storageUrl: `https://storage.example/${id}.jpg` });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('usePhotoUploader cap', () => {
  it('counts extraCount (document photos) against the cap when picking from the library', async () => {
    const onPhotosChange = vi.fn();
    const { result } = renderHook(() =>
      usePhotoUploader({ photos: [photo('j1')], onPhotosChange, extraCount: MAX_PHOTOS - 1 }),
    );

    expect(result.current.totalCount).toBe(MAX_PHOTOS);
    expect(result.current.atCap).toBe(true);

    await act(async () => {
      await result.current.pickFromGallery();
    });

    expect(picker.launchImageLibraryAsync).not.toHaveBeenCalled();
    expect(result.current.alertConfig?.title).toBe('Limit Reached');
    expect(result.current.alertConfig?.message).toBe(`Maximum ${MAX_PHOTOS} photos per quote.`);
    expect(onPhotosChange).not.toHaveBeenCalled();
  });

  it('counts extraCount against the cap when opening the camera', async () => {
    const { result } = renderHook(() =>
      usePhotoUploader({ photos: [], onPhotosChange: vi.fn(), extraCount: MAX_PHOTOS }),
    );

    await act(async () => {
      await result.current.openCameraCapture();
    });

    expect(result.current.captureModalVisible).toBe(false);
    expect(result.current.alertConfig?.title).toBe('Limit Reached');
  });

  it('trims a picked batch to the slots left after counting extraCount', async () => {
    picker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///a.jpg' }, { uri: 'file:///b.jpg' }, { uri: 'file:///c.jpg' }],
    });
    const onPhotosChange = vi.fn();
    const { result } = renderHook(() =>
      usePhotoUploader({ photos: [photo('j1')], onPhotosChange, extraCount: MAX_PHOTOS - 2 }),
    );
    expect(result.current.remainingSlots).toBe(1);

    await act(async () => {
      await result.current.pickFromGallery();
    });

    expect(storage.uploadQuotePhoto).toHaveBeenCalledTimes(1);
    expect(storage.uploadQuotePhoto).toHaveBeenCalledWith('test-uid', 'file:///a.jpg', { isPlan: false });
    expect(result.current.alertConfig?.message).toBe(
      `Only the first photo was added (max ${MAX_PHOTOS} per quote).`,
    );
  });
});

describe('usePhotoUploader writes', () => {
  it('appends each uploaded photo to the committed list without dropping earlier ones', async () => {
    const onPhotosChange = vi.fn();
    const { result } = renderHook(() =>
      usePhotoUploader({ photos: [photo('j1')], onPhotosChange }),
    );

    await act(async () => {
      await result.current.uploadUris(['file:///a.jpg', 'file:///b.jpg']);
    });

    expect(onPhotosChange).toHaveBeenCalledTimes(2);
    const first = onPhotosChange.mock.calls[0][0] as QuotePhoto[];
    const second = onPhotosChange.mock.calls[1][0] as QuotePhoto[];
    expect(first.map(p => p.storageUrl)).toEqual([
      'https://storage.example/j1.jpg',
      'https://storage.example/a.jpg',
    ]);
    expect(second.map(p => p.storageUrl)).toEqual([
      'https://storage.example/j1.jpg',
      'https://storage.example/a.jpg',
      'https://storage.example/b.jpg',
    ]);
    expect(second[1]).toMatchObject({ annotated: false });
    expect(second[1].id).toBeTruthy();
    expect(result.current.hasAnyUploading).toBe(false);
  });

  it('removes a committed photo only after the tradie confirms, then deletes the file', async () => {
    const onPhotosChange = vi.fn();
    const { result } = renderHook(() =>
      usePhotoUploader({ photos: [photo('j1'), photo('j2')], onPhotosChange }),
    );

    act(() => {
      result.current.handleDelete('j1');
    });
    expect(result.current.alertConfig?.title).toBe('Remove Photo');
    expect(onPhotosChange).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.alertConfig?.primaryButtonAction?.();
    });

    expect(onPhotosChange).toHaveBeenCalledWith([photo('j2')]);
    expect(storage.deleteQuotePhoto).toHaveBeenCalledWith('https://storage.example/j1.jpg');
    expect(result.current.alertConfig).toBeNull();
  });

  it('on web, Add picks straight from the library instead of opening the action sheet', async () => {
    const { result } = renderHook(() =>
      usePhotoUploader({ photos: [], onPhotosChange: vi.fn() }),
    );

    await act(async () => {
      result.current.showAddOptions();
    });

    expect(result.current.photoSheetVisible).toBe(false);
    expect(picker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
  });
});
