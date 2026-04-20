/**
 * SendQuoteButton — thin compatibility wrapper around SendDocumentButton.
 * Kept for callers (QuotePreviewScreen) that still operate on the typed
 * Quote shape; new code should use SendDocumentButton directly.
 */

import React from 'react';
import { Quote, BusinessSettings } from '../types';
import { quoteToDocument } from '../types/documentAdapter';
import { SendDocumentButton } from './SendDocumentButton';

interface SendQuoteButtonProps {
  quote: Quote;
  businessSettings: BusinessSettings | null;
  buttonMode?: 'contained' | 'outlined' | 'text';
  buttonLabel?: string;
  buttonIcon?: string;
  buttonStyle?: any;
  onEmailDialogOpen?: (quote: Quote) => void;
}

export function SendQuoteButton({
  quote,
  businessSettings,
  buttonMode,
  buttonLabel,
  buttonIcon,
  buttonStyle,
}: SendQuoteButtonProps) {
  return (
    <SendDocumentButton
      doc={quoteToDocument(quote)}
      businessSettings={businessSettings}
      buttonMode={buttonMode}
      buttonLabel={buttonLabel}
      buttonIcon={buttonIcon}
      buttonStyle={buttonStyle}
    />
  );
}
