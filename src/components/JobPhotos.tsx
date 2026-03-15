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
  Alert,
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

const MAX_PHOTOS = 5;

interface LocalPhoto extends QuotePhoto {
  localUri?: string;   // Local file URI for immediate preview
  uploading?: boolean; // Whether upload is in progress
}

interface JobPhotosProps {
  photos: QuotePhoto[];
  onPhotosChange: (photos: QuotePhoto[]) => void;
}

export function JobPhotos({ photos, onPhotosChange }: JobPhotosProps) {
  const [localPhotos, setLocalPhotos] = useState<LocalPhoto[]>([]);
  const [annotatingPhoto, setAnnotatingPhoto] = useState<LocalPhoto | null>(null);

  // Merged view: committed photos from parent + local pending uploads
  const allPhotos: LocalPhoto[] = [
    ...photos.map(p => ({ ...p, localUri: undefined, uploading: false })),
    ...localPhotos,
  ];

  const pickImage = async (useCamera: boolean) => {
    if (allPhotos.length >= MAX_PHOTOS) {
      Alert.alert('Limit Reached', `Maximum ${MAX_PHOTOS} photos per quote.`);
      return;
    }

    // Request permissions — handle the "previously denied" case with a Settings shortcut
    if (useCamera) {
      const current = await ImagePicker.getCameraPermissionsAsync();
      if (current.status !== 'granted') {
        if (!current.canAskAgain) {
          // Previously denied & system won't re-prompt — guide user to Settings
          Alert.alert(
            'Camera Access Needed',
            'QuoteMate needs camera access to take site photos. You can enable it in Settings.',
            [
              { text: 'Not Now', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ]
          );
          return;
        }
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') return;
      }
    } else {
      const current = await ImagePicker.getMediaLibraryPermissionsAsync();
      if (current.status !== 'granted') {
        if (!current.canAskAgain) {
          Alert.alert(
            'Photo Library Access Needed',
            'QuoteMate needs photo library access to attach site photos. You can enable it in Settings.',
            [
              { text: 'Not Now', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ]
          );
          return;
        }
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') return;
      }
    }

    const result = useCamera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.8,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.8,
          allowsMultipleSelection: true,
          selectionLimit: MAX_PHOTOS - allPhotos.length,
        });

    if (result.canceled || !result.assets?.length) return;

    const userId = auth.currentUser?.uid;
    if (!userId) {
      Alert.alert('Error', 'You must be signed in to upload photos.');
      return;
    }

    // Immediately show local previews
    const pendingPhotos: LocalPhoto[] = result.assets.map(asset => ({
      id: generateId(),
      storageUrl: '',
      localUri: asset.uri,
      uploading: true,
      annotated: false,
    }));

    setLocalPhotos(prev => [...prev, ...pendingPhotos]);

    // Upload each in background
    for (const pending of pendingPhotos) {
      try {
        const storageUrl = await uploadQuotePhoto(userId, pending.localUri!);

        // Move from local state to parent (committed) state
        setLocalPhotos(prev => prev.filter(p => p.id !== pending.id));
        onPhotosChange([...photos, { id: pending.id, storageUrl, annotated: false }]);
      } catch (error) {
        console.error('Photo upload failed:', error);
        // Remove the failed photo from local state
        setLocalPhotos(prev => prev.filter(p => p.id !== pending.id));
        Alert.alert('Upload Failed', 'Could not upload photo. Please try again.');
      }
    }
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

    Alert.alert('Remove Photo', 'Are you sure you want to remove this photo?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          onPhotosChange(photos.filter(p => p.id !== photoId));
          try {
            await deleteQuotePhoto(photo.storageUrl);
          } catch {
            // Non-critical
          }
        },
      },
    ]);
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
      console.error('Annotation save failed:', error);
      // Restore original photo
      if (annotatingPhoto.storageUrl) {
        onPhotosChange([...photos, { id: photoId, storageUrl: annotatingPhoto.storageUrl, annotated: annotatingPhoto.annotated }]);
      }
      setLocalPhotos(prev => prev.filter(p => p.id !== photoId));
      Alert.alert('Save Failed', 'Could not save annotated photo.');
    }
  };

  const showAddOptions = () => {
    if (Platform.OS === 'web') {
      pickImage(false);
      return;
    }

    Alert.alert('Add Photo', 'Choose a source', [
      { text: 'Camera', onPress: () => pickImage(true) },
      { text: 'Photo Library', onPress: () => pickImage(false) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

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
        {allPhotos.map((photo) => {
          const displayUri = photo.localUri || photo.storageUrl;
          return (
            <View key={photo.id} style={styles.photoWrapper}>
              <TouchableOpacity
                onPress={() => !photo.uploading && setAnnotatingPhoto(photo)}
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
            style={styles.addButton}
            onPress={showAddOptions}
            disabled={hasAnyUploading}
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
  addText: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
  },
});
