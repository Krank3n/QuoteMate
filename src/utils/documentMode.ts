/**
 * Document Mode Utilities
 * Shared hook for determining whether we're creating/editing a quote or invoice
 */

import { useRoute } from '@react-navigation/native';
import { useStore } from '../store/useStore';
import { Quote, Invoice, Material } from '../types';

export type DocumentMode = 'quote' | 'invoice';

/**
 * Hook to get the current document mode from navigation params
 */
export function useDocumentMode(): DocumentMode {
  const route = useRoute<any>();
  return route.params?.mode || 'quote';
}

/**
 * Unified document type that works for both quotes and invoices.
 *
 * Quote.status and Invoice.status no longer overlap (quote payment statuses
 * were stripped — paid/partial/overdue belong on the invoice). Shared screens
 * pass spreads of currentDocument to saveDraft (typed as Quote), so we widen
 * status to Quote['status']. At runtime the mode gate ensures only Quotes go
 * through quote-shaped branches.
 */
export type UnifiedDocument = (Quote | Invoice) & {
  status: Quote['status'];
  // Common fields that exist on both
  id: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  jobAddress?: string;
  job: Quote['job'];
  materials: Material[];
  laborRate: number;
  laborHours: number;
  laborTotal: number;
  materialsSubtotal: number;
  markup: number;
  markupAmount: number;
  subtotal: number;
  gst: number;
  total: number;
  notes?: string;
  // Quote-only fields accessed by shared screens (e.g. LaborMarkupScreen)
  depositPercentage?: number;
  requireDeposit?: boolean;
};

/**
 * Hook to get the current document and update function based on mode
 * Returns the appropriate document (quote or invoice) and update function
 */
export function useCurrentDocument() {
  const mode = useDocumentMode();
  const {
    currentQuote,
    currentInvoice,
    updateQuote,
    updateInvoice
  } = useStore();

  if (mode === 'invoice') {
    return {
      document: currentInvoice as UnifiedDocument | null,
      update: updateInvoice as (doc: Partial<UnifiedDocument> & { materials: Material[] }) => void,
      mode,
    };
  }

  return {
    document: currentQuote as UnifiedDocument | null,
    update: updateQuote as (doc: Partial<UnifiedDocument> & { materials: Material[] }) => void,
    mode,
  };
}

/**
 * Hook to get the document list based on mode (for customer auto-complete)
 */
export function useDocumentList() {
  const mode = useDocumentMode();
  const { quotes, invoices } = useStore();

  if (mode === 'invoice') {
    // For invoices, combine quotes and invoices for customer lookup
    return [...quotes, ...invoices];
  }

  return quotes;
}

/**
 * Get screen title prefix based on mode
 */
export function getDocumentTypeLabel(mode: DocumentMode): string {
  return mode === 'invoice' ? 'Invoice' : 'Quote';
}

/**
 * Get the navigation target for the preview screen. Both quote and
 * invoice wizard flows land on the same `JobPreview` route now — the
 * mode param on the stack's earlier screens disambiguates. Old callers
 * passing `mode` are retained for API compatibility.
 */
export function getPreviewScreenName(_mode: DocumentMode): string {
  return 'JobPreview';
}
