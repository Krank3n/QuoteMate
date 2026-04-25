/**
 * Job Photos Component
 * Camera capture + gallery picker with horizontal scrollable grid
 * Shows local preview immediately, uploads to Firebase Storage in background
 * Supports annotation via PhotoAnnotator
 */

import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Platform,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '../theme';
import { QuotePhoto } from '../types';
import { uploadQuotePhoto, deleteQuotePhoto } from '../services/photoService';
import { generateId } from '../utils/generateId';
import { auth } from '../config/firebase';
import { PhotoAnnotator } from './PhotoAnnotator';
import { ActionSheet, ActionSheetOption } from './ActionSheet';
import { SupplierListCaptureModal } from './SupplierListCaptureModal';
import { AlertModal, AlertType } from './AlertModal';

interface AlertConfig {
  type: AlertType;
  title: string;
  message: string;
  primaryButtonText?: string;
  primaryButtonAction?: () => void;
  secondaryButtonText?: string;
  secondaryButtonAction?: () => void;
}

const MAX_PHOTOS = 5;

interface LocalPhoto extends QuotePhoto {
  localUri?: string;   // Local file URI for immediate preview
  uploading?: boolean; // Whether upload is in progress
}

interface JobPhotosProps {
  photos: QuotePhoto[];
  onPhotosChange: (photos: QuotePhoto[]) => void;
  /** Ref attached to the first photo's wrapper — for tour spotlight targeting */
  firstPhotoRef?: React.RefObject<View | null>;
  /** When true, disable photo taps and add button (during tour) */
  interactionDisabled?: boolean;
}

export function JobPhotos({ photos, onPhotosChange, firstPhotoRef, interactionDisabled }: JobPhotosProps) {
  const [localPhotos, setLocalPhotos] = useState<LocalPhoto[]>([]);
  const [annotatingPhoto, setAnnotatingPhoto] = useState<LocalPhoto | null>(null);
  const [photoSheetVisible, setPhotoSheetVisible] = useState(false);
  const [captureModalVisible, setCaptureModalVisible] = useState(false);
  const [alertConfig, setAlertConfig] = useState<AlertConfig | null>(null);

  const showAlert = (config: AlertConfig) => setAlertConfig(config);
  const dismissAlert = () => setAlertConfig(null);

  // Merged view: committed photos from parent + local pending uploads
  const allPhotos: LocalPhoto[] = [
    ...photos.map(p => ({ ...p, localUri: undefined, uploading: false })),
    ...localPhotos,
  ];

  /**
   * Upload a list of local URIs as job photos. Shared by both the gallery
   * picker and the multi-shot camera modal. Uploads run in parallel and the
   * parent's photo list is updated as each one finishes — using a running
   * `committed` snapshot rather than the (stale) `photos` closure, so all
   * uploads from the same batch survive instead of clobbering each other.
   */
  const uploadUris = async (uris: string[]) => {
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

    const pendingPhotos: LocalPhoto[] = uris.map(uri => ({
      id: generateId(),
      storageUrl: '',
      localUri: uri,
      uploading: true,
      annotated: false,
    }));

    setLocalPhotos(prev => [...prev, ...pendingPhotos]);

    // Snapshot the parent's committed list once, then append to it as each
    // upload completes. Avoids the stale-closure bug where sequential commits
    // would each replace the parent state with `photos + onlyTheLastNewOne`.
    // Uploads run sequentially: parallel `uploadBytes` calls from RN have
    // historically hit XHR/blob races on some devices.
    let committed: QuotePhoto[] = [...photos];
    let anyFailed = false;

    for (const pending of pendingPhotos) {
      try {
        const storageUrl = await uploadQuotePhoto(userId, pending.localUri!);
        setLocalPhotos(prev => prev.filter(p => p.id !== pending.id));
        committed = [...committed, { id: pending.id, storageUrl, annotated: false }];
        onPhotosChange(committed);
      } catch (err) {
        setLocalPhotos(prev => prev.filter(p => p.id !== pending.id));
        anyFailed = true;
        console.warn('[JobPhotos] upload failed', err);
      }
    }

    if (anyFailed) {
      showAlert({
        type: 'error',
        title: 'Upload Failed',
        message: 'One or more photos could not be uploaded. Please try again.',
      });
    }
  };

  const pickFromGallery = async () => {
    if (allPhotos.length >= MAX_PHOTOS) {
      showAlert({
        type: 'warning',
        title: 'Limit Reached',
        message: `Maximum ${MAX_PHOTOS} photos per quote.`,
      });
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

    const remainingSlots = MAX_PHOTOS - allPhotos.length;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsMultipleSelection: true,
      // Use 0 (unlimited) so iOS always shows the multi-select checkmark UI.
      // Setting this to 1 (e.g. when only one slot remains) makes PHPicker
      // fall back to single-tap mode. We trim to remainingSlots below.
      selectionLimit: 0,
    });

    if (result.canceled || !result.assets?.length) return;

    let assets = result.assets;
    if (assets.length > remainingSlots) {
      assets = assets.slice(0, remainingSlots);
      showAlert({
        type: 'info',
        title: 'Photo Limit',
        message: `Only the first ${remainingSlots} photo${remainingSlots === 1 ? '' : 's'} were added (max ${MAX_PHOTOS} per quote).`,
      });
    }

    await uploadUris(assets.map(a => a.uri));
  };

  const openCameraCapture = async () => {
    if (allPhotos.length >= MAX_PHOTOS) {
      showAlert({
        type: 'warning',
        title: 'Limit Reached',
        message: `Maximum ${MAX_PHOTOS} photos per quote.`,
      });
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

  const handleDelete = (photoId: string) => {
    // Check if it's a local pending photo
    const localPhoto = localPhotos.find(p => p.id === photoId);
    if (localPhoto) {
      setLocalPhotos(prev => prev.filter(p => p.id !== photoId));
      return;
    }

    const photo = photos.find(p => p.id === photoId);
    if (!photo) return;

    showAlert({
      type: 'warning',
      title: 'Remove Photo',
      message: 'Are you sure you want to remove this photo?',
      primaryButtonText: 'Remove',
      primaryButtonAction: async () => {
        dismissAlert();
        onPhotosChange(photos.filter(p => p.id !== photoId));
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
    if (!annotatingPhoto) return;

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
    // Remove from parent photos while re-uploading
    onPhotosChange(photos.filter(p => p.id !== photoId));
    setAnnotatingPhoto(null);

    try {
      const storageUrl = await uploadQuotePhoto(userId, annotatedUri);
      setLocalPhotos(prev => prev.filter(p => p.id !== photoId));
      onPhotosChange([...photos.filter(p => p.id !== photoId), { id: photoId, storageUrl, annotated: true }]);

      // Delete old version in background
      if (annotatingPhoto.storageUrl) {
        try { await deleteQuotePhoto(annotatingPhoto.storageUrl); } catch { /* non-critical */ }
      }
    } catch (error) {
      // Restore original photo
      if (annotatingPhoto.storageUrl) {
        onPhotosChange([...photos, { id: photoId, storageUrl: annotatingPhoto.storageUrl, annotated: annotatingPhoto.annotated }]);
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
      pickFromGallery();
      return;
    }

    setPhotoSheetVisible(true);
  };

  const photoSheetOptions: ActionSheetOption[] = [
    { icon: 'camera', label: 'Take Photo', onPress: openCameraCapture },
    { icon: 'image-multiple', label: 'Photo Library', onPress: pickFromGallery },
  ];

  const hasAnyUploading = localPhotos.some(p => p.uploading);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>Job Photos</Text>
        <Text style={styles.optional}>optional</Text>
      </View>
      <Text style={styles.hint}>
        Add site photos to help with AI analysis and show clients the scope
      </Text>

      <View style={styles.grid}>
        {allPhotos.map((photo, index) => {
          const displayUri = photo.localUri || photo.storageUrl;
          return (
            <View key={photo.id} style={styles.photoWrapper} ref={index === 0 ? firstPhotoRef : undefined}>
              <TouchableOpacity
                onPress={() => !photo.uploading && !interactionDisabled && setAnnotatingPhoto(photo)}
                activeOpacity={0.8}
              >
                <Image source={{ uri: displayUri }} style={styles.photo} />
                {photo.uploading && (
                  <View style={styles.uploadingOverlay}>
                    <ActivityIndicator size="small" color="#fff" />
                  </View>
                )}
                {!photo.uploading && !photo.annotated && (
                  <View style={styles.annotateHint}>
                    <MaterialCommunityIcons name="draw" size={10} color="rgba(255,255,255,0.8)" />
                  </View>
                )}
                {photo.annotated && !photo.uploading && (
                  <View style={styles.annotatedBadge}>
                    <MaterialCommunityIcons name="draw" size={12} color="#fff" />
                  </View>
                )}
              </TouchableOpacity>
              {!photo.uploading && (
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => handleDelete(photo.id)}
                >
                  <MaterialCommunityIcons name="close-circle" size={22} color="#ef4444" />
                </TouchableOpacity>
              )}
            </View>
          );
        })}

        {allPhotos.length < MAX_PHOTOS && (
          <TouchableOpacity
            style={[styles.addButton, allPhotos.length === 0 && styles.addButtonEmpty]}
            onPress={showAddOptions}
            disabled={hasAnyUploading || interactionDisabled}
          >
            <MaterialCommunityIcons name="camera-plus" size={28} color={colors.textMuted} />
            <Text style={styles.addText}>Add</Text>
          </TouchableOpacity>
        )}
      </View>

      {annotatingPhoto && (
        <PhotoAnnotator
          visible={true}
          imageUri={annotatingPhoto.localUri || annotatingPhoto.storageUrl}
          onSave={handleAnnotationSave}
          onCancel={() => setAnnotatingPhoto(null)}
        />
      )}

      <ActionSheet
        visible={photoSheetVisible}
        onDismiss={() => setPhotoSheetVisible(false)}
        title="Add Photo"
        options={photoSheetOptions}
      />

      <SupplierListCaptureModal
        visible={captureModalVisible}
        onCancel={() => setCaptureModalVisible(false)}
        onComplete={handleCaptureComplete}
        maxPhotos={MAX_PHOTOS - allPhotos.length}
        counterLabel="photos"
        tips={[
          'Capture each angle of the job site',
          'Get close to anything that needs work',
          'Snap measurements, fences, walls, gates',
          'Include any obstacles or access issues',
          'Multiple shots? Take them all before hitting Done',
        ]}
      />

      <AlertModal
        visible={!!alertConfig}
        onDismiss={dismissAlert}
        type={alertConfig?.type ?? 'info'}
        title={alertConfig?.title ?? ''}
        message={alertConfig?.message ?? ''}
        primaryButtonText={alertConfig?.primaryButtonText}
        primaryButtonAction={alertConfig?.primaryButtonAction}
        secondaryButtonText={alertConfig?.secondaryButtonText}
        secondaryButtonAction={alertConfig?.secondaryButtonAction}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 16,
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginBottom: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  optional: {
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  hint: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  photoWrapper: {
    position: 'relative',
  },
  photo: {
    width: 90,
    height: 90,
    borderRadius: 10,
    backgroundColor: colors.surfaceLight,
  },
  uploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  annotateHint: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  annotatedBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  deleteButton: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: colors.surface,
    borderRadius: 11,
  },
  addButton: {
    width: 90,
    height: 90,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  addButtonEmpty: {
    width: '100%',
    height: 100,
  },
  addText: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
  },
});
