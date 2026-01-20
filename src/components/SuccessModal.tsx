/**
 * Success Modal Component
 * Wrapper around AlertModal for backwards compatibility
 */

import React from 'react';
import { Quote, Invoice, BusinessSettings } from '../types';
import { AlertModal } from './AlertModal';

interface SuccessModalProps {
  visible: boolean;
  onDismiss: () => void;
  title?: string;
  message?: string;
  buttonText?: string;
  icon?: string;
  quote?: Quote;
  invoice?: Invoice;
  businessSettings?: BusinessSettings | null;
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
  quote,
  invoice,
  businessSettings,
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
      quote={quote}
      invoice={invoice}
      businessSettings={businessSettings}
      secondaryButtonText={secondaryButtonText}
      secondaryButtonAction={secondaryOnPress}
      secondaryButtonLoading={secondaryLoading}
    />
  );
}
