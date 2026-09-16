/**
 * JobPhotosCard — the PHOTOS row on the job page.
 *
 * A card in JobScopeCard's style with one ScopeRow (icon, small-caps label,
 * one-line summary, chevron). Tapping the row expands the photo strip
 * inline: the Before/After rows, the "+" tile, the pills, the lightbox —
 * all of JobPhotoStripBody, unchanged.
 *
 * Photos are job-level, not document-level: a job can carry a quote and an
 * invoice, after-photos are about the work, and a job with no document yet
 * still needs a home for them. So this card sits directly under the job
 * header, not inside the document card.
 *
 * Default state: open on a job with no photos (the Add tile is one tap
 * away), shut once it has some. The tradie's own taps hold for the screen
 * session only. The uploader lives here, above the collapse, so a batch
 * keeps uploading with its progress in the summary and its alerts on
 * screen while the row is shut.
 */

import React, { useState } from 'react';
import { View, LayoutAnimation } from 'react-native';

import type { Job, JobPhoto } from '../../shared/job/types';
import type { Document } from '../types/document';
import { makeStyles } from '../theme';
import { ScopeRow } from './ScopeRow';
import { JobPhotoStripBody, useJobPhotoUploader } from './JobPhotoStrip';
import { PhotoUploaderModals } from './PhotoUploaderModals';
import { aggregatePhotos, photoRowSummary } from './jobPhotoAggregate';

interface JobPhotosCardProps {
  job: Job;
  documents: Document[];
  /** As on JobPhotoStrip: without it the card is read-only and hides itself when empty. */
  onJobPhotosChange?: (photos: JobPhoto[]) => void;
  /** As on JobPhotoStrip: lets photos that live on a quote or invoice be edited. */
  onDocumentPhotosChange?: (documentId: string, photos: JobPhoto[]) => void;
}

export function JobPhotosCard(props: JobPhotosCardProps) {
  const { documents, onJobPhotosChange } = props;
  const styles = useStyles();
  const editable = !!onJobPhotosChange;
  const uploader = useJobPhotoUploader(props);
  const photos = aggregatePhotos(uploader.allPhotos, documents);
  // Decided once, on the first render; from then on only the row's own tap
  // moves it, so adding a first photo does not snap the strip shut.
  const [expanded, setExpanded] = useState(() => photos.length === 0);

  if (photos.length === 0 && !editable) return null;

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((v) => !v);
  };

  return (
    <View style={styles.card}>
      <View style={styles.block}>
        <ScopeRow
          icon="image-multiple"
          label="Photos"
          body={photoRowSummary(photos, uploader.uploadProgress)}
          muted={photos.length === 0}
          expanded={expanded}
          onPress={toggle}
          testID="job-photos-row"
          accessibilityLabel={expanded ? 'Hide photos' : 'Show photos'}
        />
        {expanded ? (
          <View testID="job-photos-body" style={styles.body}>
            <JobPhotoStripBody {...props} uploader={uploader} />
          </View>
        ) : null}
      </View>

      {editable ? <PhotoUploaderModals uploader={uploader} /> : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  // Same card as JobScopeCard, so the two read as one stack.
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: t.colors.surfaceRaised,
  },
  // Row and expanded body share one pressed-surface block, as the
  // DISPLAY & DEPOSIT row does in JobScopeCard.
  block: {
    borderRadius: 12,
    backgroundColor: t.colors.surfacePressed,
    overflow: 'hidden',
  },
  body: {
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
  },
}));
