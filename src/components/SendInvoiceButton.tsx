/**
 * SendInvoiceButton — thin compatibility wrapper around SendDocumentButton.
 * Kept for callers (InvoicePreviewScreen) that still operate on the typed
 * Invoice shape; new code should use SendDocumentButton directly.
 */

import React from 'react';
import { Invoice, BusinessSettings } from '../types';
import { invoiceToDocument } from '../types/documentAdapter';
import { SendDocumentButton } from './SendDocumentButton';

interface SendInvoiceButtonProps {
  invoice: Invoice;
  businessSettings: BusinessSettings | null;
  buttonMode?: 'contained' | 'outlined' | 'text';
  buttonLabel?: string;
  buttonIcon?: string;
  buttonStyle?: any;
}

export function SendInvoiceButton({
  invoice,
  businessSettings,
  buttonMode,
  buttonLabel,
  buttonIcon,
  buttonStyle,
}: SendInvoiceButtonProps) {
  return (
    <SendDocumentButton
      doc={invoiceToDocument(invoice)}
      businessSettings={businessSettings}
      buttonMode={buttonMode}
      buttonLabel={buttonLabel}
      buttonIcon={buttonIcon}
      buttonStyle={buttonStyle}
    />
  );
}
