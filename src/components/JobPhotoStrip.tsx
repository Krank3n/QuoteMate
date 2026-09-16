/**
 * JobPhotoStrip
 *
 * Horizontal scroll of site-photo thumbnails for ViewJobScreen. Aggregates
 * photos from every attached Document plus any that live directly on the
 * Job. Tap a thumb to open a full-screen lightbox with the image.
 *
 * With `onJobPhotosChange` the strip is the place a tradie goes back to
 * after quoting: an "Add photos" tile when the job has none, a "+" tile at
 * the end otherwise, and Annotate / Remove in the lightbox. Adds always go
 * to `job.photos` through that callback. Photos that live on an attached
 * document are captioned with the document number in the lightbox; with
 * `onDocumentPhotosChange` they can be flipped, annotated and removed too,
 * and each of those writes goes back to the owning document's `photos`.
 * Without it they are view-only.
 *
 * Before and after: a photo added here is stamped with a stage picked from
 * the job's stage (see defaultStageForJob), and a one-tap pill on the tile
 * flips it. Once both stages have photos the strip splits into two labelled
 * rows and the lightbox pages within the tapped row; with one stage nothing
 * about the layout changes.
 *
 * The job page itself renders JobPhotosCard, which owns the uploader and
 * shows JobPhotoStripBody (everything below the heading) under a PHOTOS
 * row that expands inline. JobPhotoStrip is the same body with its own card
 * and heading, for any caller that wants the strip on its own.
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
import type { PhotoStage } from '../types';
import { makeStyles, useThemeColors } from '../theme';
import { selectionTap } from '../utils/haptics';
import { isPdfUrl } from '../utils/imageMime';
import {
  usePhotoUploader,
  type LocalPhoto,
  type PhotoTarget,
  type PhotoUploader,
} from './usePhotoUploader';
import { PhotoUploaderModals } from './PhotoUploaderModals';
import {
  aggregatePhotos,
  canEditPhoto,
  defaultStageForJob,
  documentOwnedCount,
  documentPhotoRemoveMessage,
  groupPhotosByStage,
  lightboxPhotos,
  photoStage,
  STAGE_LABEL,
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
  /**
   * Receives a document's new `photos` list after a flip, annotate or
   * remove on one of its photos. Only meaningful alongside
   * `onJobPhotosChange`; without it, document-owned photos are view-only.
   */
  onDocumentPhotosChange?: (documentId: string, photos: JobPhoto[]) => void;
}

const THUMB_SIZE = 80;
const EMPTY_PHOTOS: JobPhoto[] = [];
const noop = () => {};

/**
 * The uploader behind the job page's photos. Photos on attached documents
 * count against the cap, but an add never lands on a document, so they
 * ride along as extraCount rather than as the uploader's own list.
 *
 * Exported so JobPhotosCard can own the uploader above its collapse: a
 * batch keeps its pending tiles, progress and alerts while the row is shut.
 */
export function useJobPhotoUploader({
  job,
  documents,
  onJobPhotosChange,
}: Pick<JobPhotoStripProps, 'job' | 'documents' | 'onJobPhotosChange'>): PhotoUploader {
  const jobPhotos = job.photos ?? EMPTY_PHOTOS;
  const docPhotoCount = useMemo(
    () => documentOwnedCount(aggregatePhotos(jobPhotos, documents)),
    [jobPhotos, documents],
  );
  return usePhotoUploader({
    photos: jobPhotos,
    onPhotosChange: onJobPhotosChange ?? noop,
    extraCount: docPhotoCount,
    stageForNew: () => defaultStageForJob(job.stage),
  });
}

export function JobPhotoStrip(props: JobPhotoStripProps) {
  const { documents, onJobPhotosChange } = props;
  const styles = useStyles();
  const editable = !!onJobPhotosChange;
  const uploader = useJobPhotoUploader(props);
  const photos = aggregatePhotos(uploader.allPhotos, documents);

  if (photos.length === 0 && !editable) return null;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Photos</Text>
        <Text style={styles.count}>
          {uploader.progressLabel ?? (photos.length > 0 ? photos.length : '')}
        </Text>
      </View>

      <JobPhotoStripBody {...props} uploader={uploader} />

      {editable ? <PhotoUploaderModals uploader={uploader} /> : null}
    </View>
  );
}

export interface JobPhotoStripBodyProps extends JobPhotoStripProps {
  /** From useJobPhotoUploader, owned by whoever renders PhotoUploaderModals. */
  uploader: PhotoUploader;
}

/**
 * The strip without its card and "Photos" heading: the Before/After rows,
 * the "+" and "Add photos" tiles, the stage pills and the lightbox. Renders
 * no uploader modals — the owner of `uploader` does that, so an alert or
 * the annotator can still appear when the body is not on screen.
 */
export function JobPhotoStripBody({
  job,
  documents,
  uploader,
  onJobPhotosChange,
  onDocumentPhotosChange,
}: JobPhotoStripBodyProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const editable = !!onJobPhotosChange;
  const documentsEditable = editable && !!onDocumentPhotosChange;
  const jobPhotos = job.photos ?? EMPTY_PHOTOS;

  // Job-owned photos (committed plus still-uploading) first, then documents.
  // Not memoised: allPhotos is rebuilt by the hook on every render and the
  // list is at most 30 entries.
  const photos = aggregatePhotos(uploader.allPhotos, documents);
  // The lightbox only pages through renderable images — PDF plans open in
  // the browser instead, so they'd be blank frames and dead chevrons there.
  const imagePhotos = lightboxPhotos(photos);
  // Two labelled rows once both stages have photos; one plain row otherwise.
  const groups = groupPhotosByStage(photos);
  // When grouped, the lightbox pages within the tapped group only.
  const [lightbox, setLightbox] = useState<{ group: PhotoStage | null; index: number } | null>(null);
  const lightboxList =
    lightbox?.group && groups.showHeadings ? lightboxPhotos(groups[lightbox.group]) : imagePhotos;

  const open = (i: number) => {
    selectionTap();
    const entry = photos[i];
    if (!entry || entry.photo.uploading) return;
    if (isPdfUrl(entry.photo.storageUrl)) {
      Linking.openURL(entry.photo.storageUrl).catch(() => {});
      return;
    }
    const group = groups.showHeadings ? photoStage(entry.photo) : null;
    const list = group ? lightboxPhotos(groups[group]) : imagePhotos;
    const imageIndex = list.indexOf(entry);
    if (imageIndex >= 0) setLightbox({ group, index: imageIndex });
  };
  const close = () => setLightbox(null);
  const advance = (delta: number) => {
    if (!lightbox) return;
    const next = lightbox.index + delta;
    if (next < 0 || next >= lightboxList.length) return;
    setLightbox({ ...lightbox, index: next });
  };

  const canEdit = (entry: AggregatedPhoto) => editable && canEditPhoto(entry, documentsEditable);

  // Where an edit to this photo is written: job.photos for a job-owned
  // photo (the uploader's own list, so no target), or the owning document's
  // photos for a document-owned one. Null when the owning document is no
  // longer attached, which leaves the photo alone rather than writing to
  // the wrong record.
  const targetFor = (entry: AggregatedPhoto): PhotoTarget | null | undefined => {
    if (entry.owner.kind !== 'document') return undefined;
    const { documentId } = entry.owner;
    const doc = documents.find(d => d.id === documentId);
    if (!doc || !onDocumentPhotosChange) return null;
    return {
      photos: doc.photos ?? [],
      onPhotosChange: photos => onDocumentPhotosChange(documentId, photos),
      removeMessage: documentPhotoRemoveMessage(doc),
    };
  };

  // The pill on a tile. Pending uploads are not in job.photos yet, so they
  // wait until the upload lands (the default stage is already right for
  // them in the common case). Stage is metadata a customer never sees, so a
  // document-owned photo flips just the same, on the document.
  const flipStage = (entry: AggregatedPhoto) => {
    if (!canEdit(entry) || entry.photo.uploading) return;
    const target = targetFor(entry);
    if (target === null) return;
    selectionTap();
    const next: PhotoStage = photoStage(entry.photo) === 'before' ? 'after' : 'before';
    const withStage = (list: JobPhoto[]) =>
      list.map(p => (p.id === entry.photo.id ? { ...p, stage: next } : p));
    if (target) target.onPhotosChange(withStage(target.photos));
    else onJobPhotosChange?.(withStage(jobPhotos));
  };

  // Both actions close the lightbox first: the annotator and the confirm
  // alert are modals of their own, and iOS shows one modal at a time.
  const annotate = (entry: AggregatedPhoto) => {
    if (!canEdit(entry)) return;
    const target = targetFor(entry);
    if (target === null) return;
    close();
    uploader.setAnnotatingPhoto(entry.photo as LocalPhoto, target);
  };
  const remove = (entry: AggregatedPhoto) => {
    if (!canEdit(entry)) return;
    const target = targetFor(entry);
    if (target === null) return;
    close();
    uploader.handleDelete(entry.photo.id, target);
  };

  const showAddTile = editable && !uploader.atCap;

  const renderTile = (entry: AggregatedPhoto) => {
    const { photo } = entry;
    const idx = photos.indexOf(entry);
    const isPdf = photo.localIsPdf || isPdfUrl(photo.storageUrl);
    const stage = photoStage(photo);
    const canFlip = canEdit(entry) && !photo.uploading;
    return (
      <Pressable
        key={photo.id || photo.storageUrl}
        testID={`job-photo-thumb-${idx}`}
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
        {canFlip ? (
          <Pressable
            testID={`job-photo-stage-${idx}`}
            accessibilityRole="button"
            accessibilityLabel={`Mark as ${STAGE_LABEL[stage === 'before' ? 'after' : 'before']}`}
            onPress={() => flipStage(entry)}
            hitSlop={6}
            style={styles.stagePill}
          >
            <Text style={styles.stagePillLabel}>{STAGE_LABEL[stage]}</Text>
          </Pressable>
        ) : null}
      </Pressable>
    );
  };

  const addTile = showAddTile ? (
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
  ) : null;

  const renderRow = (entries: AggregatedPhoto[], withAdd: boolean) => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scroll}
    >
      {entries.map(renderTile)}
      {withAdd ? addTile : null}
    </ScrollView>
  );

  // The "+" sits on the row a new photo would land in.
  const addStage = defaultStageForJob(job.stage);

  return (
    <>
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
      ) : groups.showHeadings ? (
        <>
          <Text testID="job-photo-group-before" style={styles.groupHeading}>
            {STAGE_LABEL.before}
          </Text>
          {renderRow(groups.before, addStage === 'before')}
          <Text testID="job-photo-group-after" style={[styles.groupHeading, styles.groupHeadingAfter]}>
            {STAGE_LABEL.after}
          </Text>
          {renderRow(groups.after, addStage === 'after')}
        </>
      ) : (
        renderRow(photos, true)
      )}

      <Lightbox
        photos={lightboxList}
        index={lightbox?.index ?? null}
        stageLabel={lightbox?.group && groups.showHeadings ? STAGE_LABEL[lightbox.group] : undefined}
        onClose={close}
        onAdvance={advance}
        onAnnotate={editable ? annotate : undefined}
        onRemove={editable ? remove : undefined}
        documentsEditable={documentsEditable}
      />
    </>
  );
}

function Lightbox({
  photos,
  index,
  stageLabel,
  onClose,
  onAdvance,
  onAnnotate,
  onRemove,
  documentsEditable = false,
}: {
  photos: AggregatedPhoto[];
  index: number | null;
  /** "Before" / "After" when paging within one group; shown in the counter. */
  stageLabel?: string;
  onClose: () => void;
  onAdvance: (delta: number) => void;
  onAnnotate?: (entry: AggregatedPhoto) => void;
  onRemove?: (entry: AggregatedPhoto) => void;
  /** Whether Annotate / Remove also apply to document-owned photos. */
  documentsEditable?: boolean;
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
  const editable = !!onAnnotate && !!onRemove && canEditPhoto(entry, documentsEditable);

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
          <Text testID="lightbox-counter" style={styles.lightboxCounter}>
            {stageLabel ? `${stageLabel} · ` : ''}
            {index + 1} / {photos.length}
          </Text>
          <Pressable onPress={onClose} hitSlop={10} style={styles.lightboxClose}>
            <MaterialCommunityIcons name={'close' as any} size={22} color={themeColors.alwaysLight} />
          </Pressable>
        </View>

        {canPrev ? (
          <Pressable
            testID="lightbox-prev"
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
            testID="lightbox-next"
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

        {/* The document caption stays even when the photo is editable, so
            the tradie knows which quote a Remove here also touches. */}
        <View style={styles.lightboxBottomBar}>
          {entry.owner.kind === 'document' ? (
            <Text testID="lightbox-caption" style={styles.lightboxCaption}>
              {entry.owner.label}
            </Text>
          ) : null}
          {editable ? (
            <View style={styles.lightboxActions}>
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
            </View>
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
  groupHeading: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: t.colors.textMuted,
    marginBottom: 6,
  },
  groupHeadingAfter: {
    marginTop: 12,
  },
  stagePill: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  stagePillLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: t.colors.alwaysLight,
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
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  lightboxActions: {
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
