/**
 * Success Modal Component
 * Wrapper around AlertModal for backwards compatibility
 */

import React from 'react';
import { AlertModal } from './AlertModal';

interface SuccessModalProps {
  visible: boolean;
  onDismiss: () => void;
  title?: string;
  message?: string;
  buttonText?: string;
  icon?: string;
  secondaryActionComponent?: React.ReactNode;
  // Legacy props for backwards compatibility
  secondaryButtonText?: string;
  secondaryOnPress?: () => void;
  secondaryLoading?: boolean;
}

export function SuccessModal({
  visible,
  onDismiss,
  title = 'Success!',
  message = 'Your action was completed successfully.',
  buttonText = 'Done',
  icon = 'check-circle',
  secondaryActionComponent,
  secondaryButtonText,
  secondaryOnPress,
  secondaryLoading = false,
}: SuccessModalProps) {
  return (
    <AlertModal
      visible={visible}
      onDismiss={onDismiss}
      type="success"
      title={title}
      message={message}
      icon={icon}
      primaryButtonText={buttonText}
      secondaryActionComponent={secondaryActionComponent}
      secondaryButtonText={secondaryButtonText}
      secondaryButtonAction={secondaryOnPress}
      secondaryButtonLoading={secondaryLoading}
    />
  );
}
