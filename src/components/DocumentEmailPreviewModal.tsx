/**
 * DocumentEmailPreviewModal — unified entry point for the email preview/send
 * flow. Takes a Document and dispatches to the type-specific modal that
 * wraps the existing Brevo send pipeline. The two underlying modals
 * (EmailPreviewModal for quotes, InvoiceEmailPreviewModal for invoices)
 * remain in place for now because their internal flows are quite different
 * — quotes mint acceptance tokens, invoices attach PDFs and pull source-
 * quote photos, etc. Once those flows merge server-side, this wrapper can
 * fold into a single modal.
 */

import React from 'react';
import { BusinessSettings } from '../types';
import { Document } from '../types/document';
import { documentToQuote, documentToInvoice } from '../types/documentAdapter';
import { EmailPreviewModal } from './EmailPreviewModal';
import { InvoiceEmailPreviewModal } from './InvoiceEmailPreviewModal';
import { useStore } from '../store/useStore';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  doc: Document;
  businessSettings: BusinessSettings | null;
  emailBody: string;
  onEmailBodyChange: (body: string) => void;
  onRegenerate: () => void;
  isPro: boolean;
  isRegenerating: boolean;
}

export function DocumentEmailPreviewModal(props: Props) {
  const { doc, ...rest } = props;
  const { quotes } = useStore();

  if (doc.type === 'invoice') {
    const invoice = documentToInvoice(doc);
    const sourceQuotePhotos = invoice.sourceQuoteId
      ? quotes.find((q) => q.id === invoice.sourceQuoteId)?.photos || []
      : [];
    return (
      <InvoiceEmailPreviewModal
        {...rest}
        invoice={invoice}
        photoCount={sourceQuotePhotos.length}
      />
    );
  }
  return (
    <EmailPreviewModal
      {...rest}
      quote={documentToQuote(doc)}
    />
  );
}
