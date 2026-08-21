/**
 * JobPhotoStrip
 *
 * Horizontal scroll of site-photo thumbnails for ViewJobScreen. Aggregates
 * photos from every attached Document plus any that live directly on the
 * Job (photos migrated at backfill / manually added later). Tap a thumb
 * to open a full-screen lightbox with the image.
 *
 * Read-only for now — adding / annotating happens in the quote wizard.
 * Once we have a "post-send" edit flow for a job, this is a natural place
 * to bolt a "+" tile on the end.
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
} from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import type { Job, JobPhoto } from '../../shared/job/types';
import type { Document } from '../types/document';
import { makeStyles, useThemeColors } from '../theme';
import { selectionTap } from '../utils/haptics';
import { isPdfUrl } from '../utils/imageMime';

interface JobPhotoStripProps {
  job: Job;
  documents: Document[];
}

const THUMB_SIZE = 80;

function aggregatePhotos(job: Job, documents: Document[]): JobPhoto[] {
  const seen = new Set<string>();
  const out: JobPhoto[] = [];

  const push = (p: JobPhoto | undefined | null) => {
    if (!p) return;
    const key = p.id || p.storageUrl;
    if (!key || seen.has(key)) return;
    seen.add(key);
    if (p.storageUrl) out.push(p);
  };

  // Job's own photos first (migrated / tradie-added)...
  for (const p of job.photos || []) push(p);
  // ...then every attached doc's photos (shape matches JobPhoto
  // structurally — QuotePhoto on the Document type).
  for (const doc of documents) {
    for (const p of (doc.photos as JobPhoto[] | undefined) || []) push(p);
  }
  return out;
}

export function JobPhotoStrip({ job, documents }: JobPhotoStripProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const photos = useMemo(() => aggregatePhotos(job, documents), [job, documents]);
  // The lightbox only pages through renderable images — PDF plans open in
  // the browser instead, so they'd be blank frames and dead chevrons there.
  const imagePhotos = useMemo(() => photos.filter(p => !isPdfUrl(p.storageUrl)), [photos]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (photos.length === 0) return null;

  const open = (i: number) => {
    selectionTap();
    const photo = photos[i];
    if (isPdfUrl(photo?.storageUrl)) {
      Linking.openURL(photo.storageUrl).catch(() => {});
      return;
    }
    const imageIndex = imagePhotos.indexOf(photo);
    if (imageIndex >= 0) setLightboxIndex(imageIndex);
  };
  const close = () => setLightboxIndex(null);
  const advance = (delta: number) => {
    if (lightboxIndex == null) return;
    const next = lightboxIndex + delta;
    if (next < 0 || next >= imagePhotos.length) return;
    setLightboxIndex(next);
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Photos</Text>
        <Text style={styles.count}>{photos.length}</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {photos.map((photo, idx) => (
          <Pressable
            key={photo.id || photo.storageUrl}
            onPress={() => open(idx)}
            style={({ pressed }) => [styles.thumbWrap, pressed && styles.thumbPressed]}
          >
            {isPdfUrl(photo.storageUrl) ? (
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
                source={{ uri: photo.thumbnailUrl || photo.storageUrl }}
                style={styles.thumb}
                resizeMode="cover"
              />
            )}
            {photo.annotated ? (
              <View style={styles.annotatedBadge}>
                <MaterialCommunityIcons
                  name={'pencil' as any}
                  size={10}
                  color={themeColors.alwaysLight}
                />
              </View>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>

      <Lightbox
        photos={imagePhotos}
        index={lightboxIndex}
        onClose={close}
        onAdvance={advance}
      />
    </View>
  );
}

function Lightbox({
  photos,
  index,
  onClose,
  onAdvance,
}: {
  photos: JobPhoto[];
  index: number | null;
  onClose: () => void;
  onAdvance: (delta: number) => void;
}) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  if (index == null) return null;
  const photo = photos[index];
  if (!photo) return null;

  const { width, height } = Dimensions.get('window');
  const canPrev = index > 0;
  const canNext = index < photos.length - 1;

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
}));
