/**
 * JobPhotoStrip
 *
 * Horizontal scroll of site-photo thumbnails for ViewJobScreen. Aggregates
 * photos from every attached Document plus any that live directly on the
 * Job. Tap a thumb to open a full-screen lightbox with the image.
 *
 * With `onJobPhotosChange` the strip is the place a tradie goes back to
 * after quoting: an "Add photos" tile when the job has none, a "+" tile at
 * the end otherwise, and Annotate / Remove in the lightbox. Every write goes
 * to `job.photos` through that callback. Photos that live on an attached
 * document are view-only here (the customer has already seen that quote);
 * the lightbox captions them with the document number instead.
 */

import React, { useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  Linking,
  Modal,
  Dimensions,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import type { Job, JobPhoto } from '../../shared/job/types';
import type { Document } from '../types/document';
import { makeStyles, useThemeColors } from '../theme';
import { selectionTap } from '../utils/haptics';
import { isPdfUrl } from '../utils/imageMime';
import { usePhotoUploader, type LocalPhoto } from './usePhotoUploader';
import { PhotoUploaderModals } from './PhotoUploaderModals';
import {
  aggregatePhotos,
  canEditPhoto,
  documentOwnedCount,
  lightboxPhotos,
  type AggregatedPhoto,
} from './jobPhotoAggregate';

interface JobPhotoStripProps {
  job: Job;
  documents: Document[];
  /**
   * Receives the job's new `photos` list after an add, annotate or remove.
   * Without it the strip is read-only and hides itself when there is
   * nothing to show.
   */
  onJobPhotosChange?: (photos: JobPhoto[]) => void;
}

const THUMB_SIZE = 80;
const EMPTY_PHOTOS: JobPhoto[] = [];
const noop = () => {};

export function JobPhotoStrip({ job, documents, onJobPhotosChange }: JobPhotoStripProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const editable = !!onJobPhotosChange;
  const jobPhotos = job.photos ?? EMPTY_PHOTOS;

  // Photos on attached documents count against the cap but are never
  // written from here, so they ride along as extraCount.
  const docPhotoCount = useMemo(
    () => documentOwnedCount(aggregatePhotos(jobPhotos, documents)),
    [jobPhotos, documents],
  );
  const uploader = usePhotoUploader({
    photos: jobPhotos,
    onPhotosChange: onJobPhotosChange ?? noop,
    extraCount: docPhotoCount,
  });

  // Job-owned photos (committed plus still-uploading) first, then documents.
  // Not memoised: allPhotos is rebuilt by the hook on every render and the
  // list is at most 30 entries.
  const photos = aggregatePhotos(uploader.allPhotos, documents);
  // The lightbox only pages through renderable images — PDF plans open in
  // the browser instead, so they'd be blank frames and dead chevrons there.
  const imagePhotos = lightboxPhotos(photos);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (photos.length === 0 && !editable) return null;

  const open = (i: number) => {
    selectionTap();
    const entry = photos[i];
    if (!entry || entry.photo.uploading) return;
    if (isPdfUrl(entry.photo.storageUrl)) {
      Linking.openURL(entry.photo.storageUrl).catch(() => {});
      return;
    }
    const imageIndex = imagePhotos.indexOf(entry);
    if (imageIndex >= 0) setLightboxIndex(imageIndex);
  };
  const close = () => setLightboxIndex(null);
  const advance = (delta: number) => {
    if (lightboxIndex == null) return;
    const next = lightboxIndex + delta;
    if (next < 0 || next >= imagePhotos.length) return;
    setLightboxIndex(next);
  };

  // Both actions close the lightbox first: the annotator and the confirm
  // alert are modals of their own, and iOS shows one modal at a time.
  const annotate = (entry: AggregatedPhoto) => {
    if (!editable || !canEditPhoto(entry)) return;
    close();
    uploader.setAnnotatingPhoto(entry.photo as LocalPhoto);
  };
  const remove = (entry: AggregatedPhoto) => {
    if (!editable || !canEditPhoto(entry)) return;
    close();
    uploader.handleDelete(entry.photo.id);
  };

  const showAddTile = editable && !uploader.atCap;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Photos</Text>
        <Text style={styles.count}>
          {uploader.progressLabel ?? (photos.length > 0 ? photos.length : '')}
        </Text>
      </View>

      {photos.length === 0 ? (
        <Pressable
          testID="job-photo-strip-empty-add"
          accessibilityRole="button"
          accessibilityLabel="Add photos"
          onPress={uploader.showAddOptions}
          disabled={uploader.hasAnyUploading}
          style={({ pressed }) => [styles.emptyTile, pressed && styles.thumbPressed]}
        >
          <MaterialCommunityIcons
            name={'camera-plus' as any}
            size={26}
            color={themeColors.textMuted}
          />
          <Text style={styles.emptyTitle}>Add photos</Text>
          <Text style={styles.emptyHint}>
            Site photos, plans and progress shots for this job.
          </Text>
        </Pressable>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
        >
          {photos.map((entry, idx) => {
            const { photo } = entry;
            const isPdf = photo.localIsPdf || isPdfUrl(photo.storageUrl);
            return (
              <Pressable
                key={photo.id || photo.storageUrl}
                onPress={() => open(idx)}
                style={({ pressed }) => [styles.thumbWrap, pressed && styles.thumbPressed]}
              >
                {isPdf ? (
                  <View style={styles.pdfThumb}>
                    <MaterialCommunityIcons
                      name={'file-document-outline' as any}
                      size={24}
                      color={themeColors.textMuted}
                    />
                    <Text style={styles.pdfThumbLabel}>PDF</Text>
                  </View>
                ) : (
                  <Image
                    source={{ uri: photo.localUri || photo.thumbnailUrl || photo.storageUrl }}
                    style={styles.thumb}
                    resizeMode="cover"
                  />
                )}
                {photo.uploading ? (
                  <View style={styles.uploadingOverlay}>
                    <ActivityIndicator size="small" color={themeColors.alwaysLight} />
                  </View>
                ) : null}
                {photo.annotated && !photo.uploading ? (
                  <View style={styles.annotatedBadge}>
                    <MaterialCommunityIcons
                      name={'pencil' as any}
                      size={10}
                      color={themeColors.alwaysLight}
                    />
                  </View>
                ) : null}
              </Pressable>
            );
          })}

          {showAddTile ? (
            <Pressable
              testID="job-photo-strip-add"
              accessibilityRole="button"
              accessibilityLabel="Add photos"
              onPress={uploader.showAddOptions}
              disabled={uploader.hasAnyUploading}
              style={({ pressed }) => [
                styles.addTile,
                pressed && styles.thumbPressed,
                uploader.hasAnyUploading && styles.addTileDisabled,
              ]}
            >
              <MaterialCommunityIcons name={'plus' as any} size={26} color={themeColors.textMuted} />
            </Pressable>
          ) : null}
        </ScrollView>
      )}

      <Lightbox
        photos={imagePhotos}
        index={lightboxIndex}
        onClose={close}
        onAdvance={advance}
        onAnnotate={editable ? annotate : undefined}
        onRemove={editable ? remove : undefined}
      />

      {editable ? <PhotoUploaderModals uploader={uploader} /> : null}
    </View>
  );
}

function Lightbox({
  photos,
  index,
  onClose,
  onAdvance,
  onAnnotate,
  onRemove,
}: {
  photos: AggregatedPhoto[];
  index: number | null;
  onClose: () => void;
  onAdvance: (delta: number) => void;
  onAnnotate?: (entry: AggregatedPhoto) => void;
  onRemove?: (entry: AggregatedPhoto) => void;
}) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  if (index == null) return null;
  const entry = photos[index];
  if (!entry) return null;
  const { photo } = entry;

  const { width, height } = Dimensions.get('window');
  const canPrev = index > 0;
  const canNext = index < photos.length - 1;
  const editable = !!onAnnotate && !!onRemove && canEditPhoto(entry);

  return (
    <Modal
      visible={true}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.lightboxRoot}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <Image
          source={{ uri: photo.storageUrl }}
          style={{ width, height: height * 0.82 }}
          resizeMode="contain"
        />

        <View style={styles.lightboxTopBar}>
          <Text style={styles.lightboxCounter}>
            {index + 1} / {photos.length}
          </Text>
          <Pressable onPress={onClose} hitSlop={10} style={styles.lightboxClose}>
            <MaterialCommunityIcons name={'close' as any} size={22} color={themeColors.alwaysLight} />
          </Pressable>
        </View>

        {canPrev ? (
          <Pressable
            onPress={() => onAdvance(-1)}
            hitSlop={20}
            style={[styles.lightboxNav, styles.lightboxNavLeft]}
          >
            <MaterialCommunityIcons
              name={'chevron-left' as any}
              size={32}
              color={themeColors.alwaysLight}
            />
          </Pressable>
        ) : null}
        {canNext ? (
          <Pressable
            onPress={() => onAdvance(1)}
            hitSlop={20}
            style={[styles.lightboxNav, styles.lightboxNavRight]}
          >
            <MaterialCommunityIcons
              name={'chevron-right' as any}
              size={32}
              color={themeColors.alwaysLight}
            />
          </Pressable>
        ) : null}

        <View style={styles.lightboxBottomBar}>
          {editable ? (
            <>
              <Pressable
                testID="lightbox-annotate"
                accessibilityRole="button"
                onPress={() => onAnnotate?.(entry)}
                hitSlop={8}
                style={styles.lightboxAction}
              >
                <MaterialCommunityIcons name={'draw' as any} size={18} color={themeColors.alwaysLight} />
                <Text style={styles.lightboxActionLabel}>Annotate</Text>
              </Pressable>
              <Pressable
                testID="lightbox-remove"
                accessibilityRole="button"
                onPress={() => onRemove?.(entry)}
                hitSlop={8}
                style={styles.lightboxAction}
              >
                <MaterialCommunityIcons name={'trash-can-outline' as any} size={18} color={themeColors.alwaysLight} />
                <Text style={styles.lightboxActionLabel}>Remove</Text>
              </Pressable>
            </>
          ) : entry.owner.kind === 'document' ? (
            <Text testID="lightbox-caption" style={styles.lightboxCaption}>
              {entry.owner.label}
            </Text>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: 16,
    padding: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  heading: {
    fontSize: 15,
    fontWeight: '700',
    color: t.colors.text,
  },
  count: {
    fontSize: 12,
    fontWeight: '600',
    color: t.colors.textMuted,
  },
  scroll: {
    gap: 8,
    paddingRight: 4,
  },
  thumbWrap: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: t.colors.surfacePressed,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  thumbPressed: {
    opacity: 0.7,
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  pdfThumb: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  pdfThumbLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: t.colors.textMuted,
  },
  uploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  annotatedBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: t.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTile: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: t.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTileDisabled: {
    opacity: 0.5,
  },
  emptyTile: {
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: t.colors.border,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 4,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.text,
  },
  emptyHint: {
    fontSize: 12,
    color: t.colors.textMuted,
    textAlign: 'center',
  },
  lightboxRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxTopBar: {
    position: 'absolute',
    top: 40,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lightboxCounter: {
    fontSize: 13,
    fontWeight: '700',
    color: t.colors.alwaysLight,
    opacity: 0.8,
  },
  lightboxClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxNav: {
    position: 'absolute',
    top: '50%',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -22,
  },
  lightboxNavLeft: { left: 16 },
  lightboxNavRight: { right: 16 },
  lightboxBottomBar: {
    position: 'absolute',
    bottom: 40,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  lightboxAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  lightboxActionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.alwaysLight,
  },
  lightboxCaption: {
    fontSize: 12,
    fontWeight: '600',
    color: t.colors.alwaysLight,
    opacity: 0.8,
  },
}));
