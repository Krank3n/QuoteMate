/**
 * Job Photos Component
 * Camera capture + gallery picker with horizontal scrollable grid
 * Shows local preview immediately, uploads to Firebase Storage in background
 * Supports annotation via PhotoAnnotator
 *
 * The upload, permission, annotation and removal logic lives in
 * usePhotoUploader so the job screen's JobPhotoStrip shares one path with
 * this grid instead of carrying a copy.
 */

import React from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { makeStyles, useThemeColors } from '../theme';
import { QuotePhoto } from '../types';
import { isPdfUrl } from '../utils/imageMime';
import { usePhotoUploader } from './usePhotoUploader';
import { PhotoUploaderModals } from './PhotoUploaderModals';

interface JobPhotosProps {
  photos: QuotePhoto[];
  onPhotosChange: (photos: QuotePhoto[]) => void;
  /** Hide the built-in "Job Photos / optional / hint" header — for screens
   *  that render their own section label above this component. */
  hideHeader?: boolean;
}

export function JobPhotos({ photos, onPhotosChange, hideHeader }: JobPhotosProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const uploader = usePhotoUploader({ photos, onPhotosChange });
  const {
    allPhotos,
    atCap,
    hasAnyUploading,
    progressLabel,
    showAddOptions,
    handleDelete,
    setAnnotatingPhoto,
  } = uploader;

  return (
    <View style={styles.container}>
      {!hideHeader && (
        <>
          <View style={styles.headerRow}>
            <Text style={styles.label}>Job Photos</Text>
            <Text style={styles.optional}>optional</Text>
          </View>
          <Text style={styles.hint}>
            Add site photos or plans (PDF works) to help size the job and show clients the scope
          </Text>
        </>
      )}

      {/* Sits above the grid, not in the header, so it still shows when a
          screen hides the header and draws its own label. */}
      {progressLabel && <Text style={styles.hint}>{progressLabel}</Text>}

      <View style={styles.grid}>
        {allPhotos.map((photo) => {
          const displayUri = photo.localUri || photo.storageUrl;
          // PDF plans can't render in an <Image> or the annotator — show a
          // document tile and open the file itself on tap. Pending uploads
          // carry the sniffed flag since they have no storageUrl yet.
          const isPdf = photo.localIsPdf || isPdfUrl(photo.storageUrl);
          return (
            <View key={photo.id} style={styles.photoWrapper}>
              <TouchableOpacity
                onPress={() => {
                  if (photo.uploading) return;
                  if (isPdf) {
                    Linking.openURL(photo.storageUrl).catch(() => {});
                    return;
                  }
                  setAnnotatingPhoto(photo);
                }}
                activeOpacity={0.8}
              >
                {isPdf ? (
                  <View style={[styles.photo, styles.pdfTile]}>
                    <MaterialCommunityIcons name="file-document-outline" size={26} color={themeColors.textMuted} />
                    <Text style={styles.pdfTileLabel}>PDF plan</Text>
                  </View>
                ) : (
                  <Image source={{ uri: displayUri }} style={styles.photo} />
                )}
                {photo.uploading && (
                  <View style={styles.uploadingOverlay}>
                    <ActivityIndicator size="small" color="#fff" />
                  </View>
                )}
                {!photo.uploading && !photo.annotated && !isPdf && (
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

        {!atCap && (
          <TouchableOpacity
            style={[styles.addButton, allPhotos.length === 0 && styles.addButtonEmpty]}
            onPress={showAddOptions}
            disabled={hasAnyUploading}
          >
            <MaterialCommunityIcons name="camera-plus" size={28} color={themeColors.textMuted} />
            <Text style={styles.addText}>Add</Text>
          </TouchableOpacity>
        )}
      </View>

      <PhotoUploaderModals uploader={uploader} />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
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
    color: t.colors.text,
  },
  optional: {
    fontSize: 12,
    color: t.colors.textMuted,
    fontStyle: 'italic',
  },
  hint: {
    fontSize: 12,
    color: t.colors.textMuted,
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
    backgroundColor: t.colors.surfaceOverlay,
  },
  pdfTile: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  pdfTileLabel: {
    fontSize: 11,
    color: t.colors.textMuted,
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
    backgroundColor: t.colors.accent,
    borderRadius: 10,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  deleteButton: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: 11,
  },
  addButton: {
    width: 90,
    height: 90,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: t.colors.surfaceOverlay,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: t.colors.surfaceRaised,
  },
  addButtonEmpty: {
    width: '100%',
    height: 100,
  },
  addText: {
    fontSize: 11,
    color: t.colors.textMuted,
    marginTop: 4,
  },
}));
