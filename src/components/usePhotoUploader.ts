/**
 * usePhotoUploader
 *
 * The one upload path for job photos, shared by the wizard's JobPhotos grid
 * and the job screen's JobPhotoStrip. Owns everything that used to live
 * inside JobPhotos: camera and library permission prompts (with the "open
 * Settings" path for a previously denied permission), plan detection, the
 * local mime sniff, sequential uploads with a running `committed` snapshot,
 * per-batch upload progress, annotation re-uploads, removal, and the alerts.
 *
 * The caller owns the committed list (`photos` + `onPhotosChange`) — a quote's
 * photos in the wizard, `job.photos` on the job screen — and renders the
 * chrome (tiles, ActionSheet, capture modal, AlertModal, PhotoAnnotator) from
 * the state this returns. See PhotoUploaderModals for the shared chrome.
 *
 * Removal and annotation can also aim at a second list the caller names per
 * call (a `PhotoTarget`): the job screen uses that for photos that live on
 * an attached quote or invoice, so those go through the same confirm,
 * re-upload and old-file cleanup as job-owned photos. Adds always land in
 * `photos`.
 *
 * The cap counts `photos` + pending uploads + `extraCount`. The job screen
 * passes the attached documents' photos as `extraCount` so a job never holds
 * more than MAX_PHOTOS in total, whichever record each photo lives on.
 */

import { useState } from 'react';
import { Linking, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { PhotoStage, QuotePhoto } from '../types';
import {
  uploadQuotePhoto,
  deleteQuotePhoto,
  sniffLocalPhotoMime,
  UnsupportedPhotoError,
} from '../services/photoService';
import { detectIsPlan } from '../services/planDetection';
import { generateId } from '../utils/generateId';
import { auth } from '../config/firebase';
import type { AlertType } from './AlertModal';
import type { ActionSheetOption } from './ActionSheet';
import {
  MAX_PHOTOS,
  photoLimitMessage,
  remainingPhotoSlots,
  trimToPhotoLimit,
  uploadProgressLabel,
  UploadProgress,
} from './jobPhotoLimits';

export interface PhotoAlertConfig {
  type: AlertType;
  title: string;
  message: string;
  primaryButtonText?: string;
  primaryButtonAction?: () => void;
  secondaryButtonText?: string;
  secondaryButtonAction?: () => void;
}

export interface LocalPhoto extends QuotePhoto {
  localUri?: string;   // Local file URI for immediate preview
  uploading?: boolean; // Whether upload is in progress
  localIsPdf?: boolean; // Sniffed pre-upload so a pending PDF gets its tile, not a broken <Image>
}

/**
 * A committed list other than `photos` that one removal or annotation
 * targets. `photos` is that list as it stands now; `onPhotosChange` receives
 * its replacement. The job screen builds one per attached document.
 */
export interface PhotoTarget {
  photos: QuotePhoto[];
  onPhotosChange: (photos: QuotePhoto[]) => void;
  /** Replaces the default "Are you sure" line in the remove confirm. */
  removeMessage?: string;
}

export interface UsePhotoUploaderOptions {
  /** The committed list this hook appends to, replaces in and removes from. */
  photos: QuotePhoto[];
  onPhotosChange: (photos: QuotePhoto[]) => void;
  /**
   * Photos that count against the cap but live somewhere this hook never
   * writes (the job screen's attached-document photos). Defaults to 0.
   */
  extraCount?: number;
  /** Cap on the total. Defaults to MAX_PHOTOS. */
  max?: number;
  /**
   * Stage to stamp on each newly added photo, read once per batch at add
   * time. The job screen passes the job's current stage; the wizard leaves
   * it out so quote photos carry no stage.
   */
  stageForNew?: () => PhotoStage;
}

/** The fields a re-upload (annotation) must carry across from the original. */
function carriedFields(photo: Pick<QuotePhoto, 'isPlan' | 'stage' | 'takenAt'>): Partial<QuotePhoto> {
  return {
    ...(photo.isPlan ? { isPlan: true } : {}),
    ...(photo.stage ? { stage: photo.stage } : {}),
    ...(photo.takenAt != null ? { takenAt: photo.takenAt } : {}),
  };
}

export interface PhotoUploader {
  /** Committed photos plus local pending uploads, in order. */
  allPhotos: LocalPhoto[];
  /** Everything counted against the cap: allPhotos + extraCount. */
  totalCount: number;
  /** True once totalCount reaches the cap; hides the Add tile. */
  atCap: boolean;
  /** Slots left for the multi-shot camera. */
  remainingSlots: number;
  hasAnyUploading: boolean;
  /** Position within the batch in flight, else null. */
  uploadProgress: UploadProgress | null;
  /** "Uploading 4 of 12" while a batch is in flight, else null. */
  progressLabel: string | null;

  uploadUris: (uris: string[], opts?: { isPlan?: boolean }) => Promise<void>;
  pickFromGallery: (opts?: { isPlan?: boolean }) => Promise<void>;
  openCameraCapture: () => Promise<void>;
  /** Web picks straight from the library; native opens the action sheet. */
  showAddOptions: () => void;
  photoSheetOptions: ActionSheetOption[];
  photoSheetVisible: boolean;
  setPhotoSheetVisible: (visible: boolean) => void;
  captureModalVisible: boolean;
  setCaptureModalVisible: (visible: boolean) => void;
  handleCaptureComplete: (uris: string[]) => Promise<void>;

  /**
   * Confirms (committed photo) or drops (pending photo) by id. With a
   * `target` the photo is looked up in, and removed from, that list instead.
   */
  handleDelete: (photoId: string, target?: PhotoTarget) => void;
  annotatingPhoto: LocalPhoto | null;
  /** With a `target`, the saved annotation replaces the entry in that list. */
  setAnnotatingPhoto: (photo: LocalPhoto | null, target?: PhotoTarget) => void;
  handleAnnotationSave: (annotatedUri: string) => Promise<void>;

  alertConfig: PhotoAlertConfig | null;
  showAlert: (config: PhotoAlertConfig) => void;
  dismissAlert: () => void;
}

export function usePhotoUploader({
  photos,
  onPhotosChange,
  extraCount = 0,
  max = MAX_PHOTOS,
  stageForNew,
}: UsePhotoUploaderOptions): PhotoUploader {
  const [localPhotos, setLocalPhotos] = useState<LocalPhoto[]>([]);
  // The photo under the annotator, with the list its saved version goes
  // back to (undefined means `photos`).
  const [annotating, setAnnotating] = useState<{ photo: LocalPhoto; target?: PhotoTarget } | null>(null);
  const annotatingPhoto = annotating?.photo ?? null;
  const setAnnotatingPhoto = (photo: LocalPhoto | null, target?: PhotoTarget) =>
    setAnnotating(photo ? { photo, target } : null);
  const [photoSheetVisible, setPhotoSheetVisible] = useState(false);
  const [captureModalVisible, setCaptureModalVisible] = useState(false);
  const [alertConfig, setAlertConfig] = useState<PhotoAlertConfig | null>(null);
  // Per-batch "Uploading 4 of 12" — only one batch runs at a time because the
  // Add tile is disabled while anything is uploading.
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

  const showAlert = (config: PhotoAlertConfig) => setAlertConfig(config);
  const dismissAlert = () => setAlertConfig(null);

  // Merged view: committed photos from parent + local pending uploads
  const allPhotos: LocalPhoto[] = [
    ...photos.map(p => ({ ...p, localUri: undefined, uploading: false })),
    ...localPhotos,
  ];
  const totalCount = allPhotos.length + extraCount;
  const atCap = totalCount >= max;

  const showLimitReached = () =>
    showAlert({ type: 'warning', title: 'Limit Reached', message: photoLimitMessage(max) });

  /**
   * Upload a list of local URIs as job photos. Shared by both the gallery
   * picker and the multi-shot camera modal. Uploads run one at a time and the
   * parent's photo list is updated as each one finishes — using a running
   * `committed` snapshot rather than the (stale) `photos` closure, so all
   * uploads from the same batch survive instead of clobbering each other.
   */
  const uploadUris = async (uris: string[], opts: { isPlan?: boolean } = {}) => {
    if (!uris.length) return;

    const userId = auth.currentUser?.uid;
    if (!userId) {
      showAlert({
        type: 'error',
        title: 'Not Signed In',
        message: 'You must be signed in to upload photos.',
      });
      return;
    }

    // Resolve a plan/photo flag per image: an explicit override wins (the
    // native "Plan or drawing" option), otherwise auto-detect so we never have
    // to ask the user. Detection is web-only and best-effort; a miss just
    // changes upload resolution, not correctness.
    const [planFlags, localMimes] = await Promise.all([
      Promise.all(uris.map(uri => (opts.isPlan ? Promise.resolve(true) : detectIsPlan(uri)))),
      Promise.all(uris.map(uri => sniffLocalPhotoMime(uri))),
    ]);

    // Stage and time are fixed at add time for the whole batch, not when
    // each upload lands — a slow batch should not straddle a stage change.
    const takenAt = Date.now();
    const stage = stageForNew?.();
    const pendingPhotos: LocalPhoto[] = uris.map((uri, i) => ({
      id: generateId(),
      storageUrl: '',
      localUri: uri,
      uploading: true,
      annotated: false,
      isPlan: planFlags[i],
      localIsPdf: localMimes[i] === 'application/pdf',
      takenAt,
      ...(stage ? { stage } : {}),
    }));

    setLocalPhotos(prev => [...prev, ...pendingPhotos]);

    // Snapshot the parent's committed list once, then append to it as each
    // upload completes. Avoids the stale-closure bug where sequential commits
    // would each replace the parent state with `photos + onlyTheLastNewOne`.
    // Uploads run sequentially: parallel `uploadBytes` calls from RN have
    // historically hit XHR/blob races on some devices.
    let committed: QuotePhoto[] = [...photos];
    let anyFailed = false;
    let unsupportedMessage: string | null = null;

    for (let i = 0; i < pendingPhotos.length; i++) {
      const pending = pendingPhotos[i];
      setUploadProgress({ current: i + 1, total: pendingPhotos.length });
      try {
        const storageUrl = await uploadQuotePhoto(userId, pending.localUri!, { isPlan: pending.isPlan });
        setLocalPhotos(prev => prev.filter(p => p.id !== pending.id));
        committed = [...committed, { id: pending.id, storageUrl, annotated: false, ...carriedFields(pending) }];
        onPhotosChange(committed);
      } catch (err) {
        setLocalPhotos(prev => prev.filter(p => p.id !== pending.id));
        if (err instanceof UnsupportedPhotoError) {
          unsupportedMessage = err.message;
        } else {
          anyFailed = true;
        }
        console.warn('[usePhotoUploader] upload failed', err);
      }
    }
    setUploadProgress(null);

    // A batch can fail both ways at once (one unsupported file + one network
    // failure) — report everything, or the tradie retries the wrong thing.
    if (unsupportedMessage || anyFailed) {
      const messages = [
        ...(unsupportedMessage ? [unsupportedMessage] : []),
        ...(anyFailed ? ['One or more photos could not be uploaded. Please try again.'] : []),
      ];
      showAlert({
        type: 'error',
        title: unsupportedMessage && !anyFailed ? 'File Not Supported' : 'Upload Problem',
        message: messages.join('\n\n'),
      });
    }
  };

  const pickFromGallery = async (opts: { isPlan?: boolean } = {}) => {
    if (atCap) {
      showLimitReached();
      return;
    }

    const current = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (current.status !== 'granted') {
      if (!current.canAskAgain) {
        showAlert({
          type: 'warning',
          title: 'Photo Library Access Needed',
          message:
            'QuoteMate needs photo library access to attach site photos. You can enable it in Settings.',
          primaryButtonText: 'Open Settings',
          primaryButtonAction: () => {
            dismissAlert();
            Linking.openSettings();
          },
          secondaryButtonText: 'Not Now',
          secondaryButtonAction: dismissAlert,
        });
        return;
      }
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') return;
    }

    const currentCount = totalCount;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsMultipleSelection: true,
      // Use 0 (unlimited) so iOS always shows the multi-select checkmark UI.
      // Setting this to 1 (e.g. when only one slot remains) makes PHPicker
      // fall back to single-tap mode. We trim to the remaining slots below.
      selectionLimit: 0,
    });

    if (result.canceled || !result.assets?.length) return;

    const { kept, notice } = trimToPhotoLimit(result.assets, currentCount, max);
    if (notice) {
      showAlert({ type: 'info', title: 'Photo Limit', message: notice });
    }

    await uploadUris(kept.map(a => a.uri), { isPlan: opts.isPlan });
  };

  const openCameraCapture = async () => {
    if (atCap) {
      showLimitReached();
      return;
    }

    // SupplierListCaptureModal handles its own camera permission UI, but we
    // still pre-flight the "previously denied" case so we can deep-link to
    // Settings rather than leaving the user stuck on the in-modal prompt.
    const current = await ImagePicker.getCameraPermissionsAsync();
    if (current.status !== 'granted' && !current.canAskAgain) {
      showAlert({
        type: 'warning',
        title: 'Camera Access Needed',
        message:
          'QuoteMate needs camera access to take site photos. You can enable it in Settings.',
        primaryButtonText: 'Open Settings',
        primaryButtonAction: () => {
          dismissAlert();
          Linking.openSettings();
        },
        secondaryButtonText: 'Not Now',
        secondaryButtonAction: dismissAlert,
      });
      return;
    }

    setCaptureModalVisible(true);
  };

  const handleCaptureComplete = async (uris: string[]) => {
    setCaptureModalVisible(false);
    await uploadUris(uris);
  };

  const handleDelete = (photoId: string, target?: PhotoTarget) => {
    // Check if it's a local pending photo (pending uploads only ever land
    // in `photos`, so a targeted delete skips this).
    const localPhoto = target ? undefined : localPhotos.find(p => p.id === photoId);
    if (localPhoto) {
      setLocalPhotos(prev => prev.filter(p => p.id !== photoId));
      return;
    }

    const list = target?.photos ?? photos;
    const commit = target?.onPhotosChange ?? onPhotosChange;
    const photo = list.find(p => p.id === photoId);
    if (!photo) return;

    showAlert({
      type: 'warning',
      title: 'Remove Photo',
      message: target?.removeMessage ?? 'Are you sure you want to remove this photo?',
      primaryButtonText: 'Remove',
      primaryButtonAction: async () => {
        dismissAlert();
        commit(list.filter(p => p.id !== photoId));
        try {
          await deleteQuotePhoto(photo.storageUrl);
        } catch {
          // Non-critical
        }
      },
      secondaryButtonText: 'Cancel',
      secondaryButtonAction: dismissAlert,
    });
  };

  const handleAnnotationSave = async (annotatedUri: string) => {
    if (!annotating) return;
    const { photo: annotatingPhoto, target } = annotating;
    // The list the saved version replaces its entry in: the target's when
    // the photo lives on a document, else the caller's `photos`.
    const list = target?.photos ?? photos;
    const commit = target?.onPhotosChange ?? onPhotosChange;

    const userId = auth.currentUser?.uid;
    if (!userId) return;

    // Show uploading state
    const photoId = annotatingPhoto.id;
    setLocalPhotos(prev => [...prev, {
      id: photoId,
      storageUrl: '',
      localUri: annotatedUri,
      uploading: true,
      annotated: true,
    }]);
    // Remove from the owning list while re-uploading
    commit(list.filter(p => p.id !== photoId));
    setAnnotatingPhoto(null);

    try {
      const storageUrl = await uploadQuotePhoto(userId, annotatedUri, { isPlan: annotatingPhoto.isPlan });
      setLocalPhotos(prev => prev.filter(p => p.id !== photoId));
      commit([...list.filter(p => p.id !== photoId), { id: photoId, storageUrl, annotated: true, ...carriedFields(annotatingPhoto) }]);

      // Delete old version in background
      if (annotatingPhoto.storageUrl) {
        try { await deleteQuotePhoto(annotatingPhoto.storageUrl); } catch { /* non-critical */ }
      }
    } catch (error) {
      // Restore original photo
      if (annotatingPhoto.storageUrl) {
        commit([...list, { id: photoId, storageUrl: annotatingPhoto.storageUrl, annotated: annotatingPhoto.annotated, ...carriedFields(annotatingPhoto) }]);
      }
      setLocalPhotos(prev => prev.filter(p => p.id !== photoId));
      showAlert({
        type: 'error',
        title: 'Save Failed',
        message: 'Could not save annotated photo.',
      });
    }
  };

  const showAddOptions = () => {
    if (Platform.OS === 'web') {
      // No ask — plans are auto-detected on upload (web) so we just pick.
      pickFromGallery();
      return;
    }

    setPhotoSheetVisible(true);
  };

  // Native can't read pixels to auto-detect, so it keeps an explicit
  // "Plan or drawing" option for the rare hi-res case. Web auto-detects.
  const photoSheetOptions: ActionSheetOption[] = [
    { icon: 'camera', label: 'Take Photo', onPress: openCameraCapture },
    { icon: 'image-multiple', label: 'Photo Library', onPress: () => pickFromGallery() },
    { icon: 'floor-plan', label: 'Plan or drawing (hi-res)', onPress: () => pickFromGallery({ isPlan: true }) },
  ];

  return {
    allPhotos,
    totalCount,
    atCap,
    remainingSlots: remainingPhotoSlots(totalCount, max),
    hasAnyUploading: localPhotos.some(p => p.uploading),
    uploadProgress,
    progressLabel: uploadProgressLabel(uploadProgress),

    uploadUris,
    pickFromGallery,
    openCameraCapture,
    showAddOptions,
    photoSheetOptions,
    photoSheetVisible,
    setPhotoSheetVisible,
    captureModalVisible,
    setCaptureModalVisible,
    handleCaptureComplete,

    handleDelete,
    annotatingPhoto,
    setAnnotatingPhoto,
    handleAnnotationSave,

    alertConfig,
    showAlert,
    dismissAlert,
  };
}
