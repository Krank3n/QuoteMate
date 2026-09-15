/**
 * PhotoUploaderModals
 *
 * The modal chrome every usePhotoUploader caller needs: the Take Photo /
 * Photo Library / Plan action sheet, the multi-shot camera, the annotator and
 * the alert. Rendered once next to whichever tiles the caller draws.
 */

import React from 'react';
import { PhotoAnnotator } from './PhotoAnnotator';
import { ActionSheet } from './ActionSheet';
import { SupplierListCaptureModal } from './SupplierListCaptureModal';
import { AlertModal } from './AlertModal';
import type { PhotoUploader } from './usePhotoUploader';

export const SITE_PHOTO_CAPTURE_TIPS = [
  'Capture each angle of the job site',
  'Get close to anything that needs work',
  'Snap measurements, fences, walls, gates',
  'Got a plan? Snap the whole thing and keep the scale bar or a known measurement in shot',
  'Include any obstacles or access issues',
  'Multiple shots? Take them all before hitting Done',
];

interface PhotoUploaderModalsProps {
  uploader: PhotoUploader;
}

export function PhotoUploaderModals({ uploader }: PhotoUploaderModalsProps) {
  return (
    <>
      {uploader.annotatingPhoto && (
        <PhotoAnnotator
          visible={true}
          imageUri={uploader.annotatingPhoto.localUri || uploader.annotatingPhoto.storageUrl}
          onSave={uploader.handleAnnotationSave}
          onCancel={() => uploader.setAnnotatingPhoto(null)}
        />
      )}

      <ActionSheet
        visible={uploader.photoSheetVisible}
        onDismiss={() => uploader.setPhotoSheetVisible(false)}
        title="Add Photo"
        options={uploader.photoSheetOptions}
      />

      <SupplierListCaptureModal
        visible={uploader.captureModalVisible}
        onCancel={() => uploader.setCaptureModalVisible(false)}
        onComplete={uploader.handleCaptureComplete}
        maxPhotos={uploader.remainingSlots}
        counterLabel="photos"
        tips={SITE_PHOTO_CAPTURE_TIPS}
      />

      <AlertModal
        visible={!!uploader.alertConfig}
        onDismiss={uploader.dismissAlert}
        type={uploader.alertConfig?.type ?? 'info'}
        title={uploader.alertConfig?.title ?? ''}
        message={uploader.alertConfig?.message ?? ''}
        primaryButtonText={uploader.alertConfig?.primaryButtonText}
        primaryButtonAction={uploader.alertConfig?.primaryButtonAction}
        secondaryButtonText={uploader.alertConfig?.secondaryButtonText}
        secondaryButtonAction={uploader.alertConfig?.secondaryButtonAction}
      />
    </>
  );
}
