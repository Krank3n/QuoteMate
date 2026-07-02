/**
 * useInvoiceImport
 *
 * Sister flow to useSupplierListImport but the destination is the CURRENT
 * QUOTE, not the supplier book. The user snaps/uploads a supplier invoice
 * or receipt; Claude (via Firebase Function) extracts each line item with
 * a per-line quantity; the user reviews and tweaks; selected rows are
 * appended to `currentQuote.materials` via the host's `addMaterialToQuote`.
 *
 * After items land on the quote we always merge any extracted supplier
 * contact details into the matching SupplierGroup. Persisting the items
 * themselves to the supplier book is opt-in — the host shows a follow-up
 * "Also save these to your supplier book?" dialog and calls
 * `saveToSupplierBook` if the user accepts.
 */
import { useCallback, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

import {
  extractFromPhotos,
  extractFromPdf,
  persistImportToSupplierBook,
  type ExtractedItem,
  type ExtractResult,
  type ExtractedSupplierContact,
} from '../services/supplierListImporter';
import { generateId } from '../utils/generateId';
import { withOrigin } from '../utils/materialOrigin';
import type { Material } from '../types';
import type { InvoiceReviewRow } from '../components/InvoiceReviewModal';

export type InvoiceImportSource = 'camera' | 'gallery' | 'pdf';
export type InvoiceImportPhase =
  | 'idle'
  | 'capturing'
  | 'extracting'
  | 'reviewing'
  | 'saving';

export interface InvoiceAddSummary {
  supplierName: string;
  itemCount: number;
  rows: InvoiceReviewRow[];
  contact?: ExtractedSupplierContact;
}

export interface UseInvoiceImportOptions {
  addMaterialToQuote: (material: Material, opts?: { silent?: boolean }) => void;
  selectedSection?: string;
  loadingLabels?: Partial<Record<InvoiceImportSource | 'default', string>>;
  /** Called after items are appended to the quote. The host typically shows
   *  a snackbar and a "save to supplier book?" prompt. */
  onAddedToQuote?: (summary: InvoiceAddSummary) => void;
  onError?: (message: string) => void;
}

export interface UseInvoiceImportResult {
  phase: InvoiceImportPhase;
  loadingLabel: string;
  captureModalVisible: boolean;
  reviewModalVisible: boolean;
  extractedSupplierName: string;
  extractedItems: ExtractedItem[];
  extractedSupplierContact?: ExtractedSupplierContact;
  saving: boolean;
  errorMessage?: string;
  startImport: (source: InvoiceImportSource) => Promise<void>;
  handleCaptureComplete: (uris: string[]) => Promise<void>;
  handleAddToQuote: (supplierName: string, rows: InvoiceReviewRow[]) => Promise<void>;
  /** Persist a previously-added batch to the supplier book. Safe to call
   *  multiple times — duplicates are merged in bulkSaveFavorites. */
  saveToSupplierBook: (
    supplierName: string,
    rows: InvoiceReviewRow[],
  ) => Promise<{ itemCount: number }>;
  cancelCapture: () => void;
  cancelReview: () => void;
  clearError: () => void;
}

const DEFAULT_LABELS: Record<InvoiceImportSource | 'default', string> = {
  camera: 'Reading your receipt…',
  gallery: 'Reading your receipt…',
  pdf: 'Reading your invoice…',
  default: 'Reading your receipt…',
};

function buildMaterialFromRow(row: InvoiceReviewRow, section?: string): Material {
  const quantity = Math.max(1, Math.round(row.qty || 1));
  const price = Number.isFinite(row.price) ? row.price : 0;
  return withOrigin({
    id: generateId(),
    name: row.name,
    quantity,
    unit: row.unit as Material['unit'],
    requiredQty: quantity,
    price,
    totalPrice: price * quantity,
    manualPriceOverride: false,
    pricingSource: 'ai',
    priceConfidence: row.confidence,
    ...(section ? { section } : {}),
  } as Material, 'manual');
}

export function useInvoiceImport(opts: UseInvoiceImportOptions): UseInvoiceImportResult {
  const [phase, setPhase] = useState<InvoiceImportPhase>('idle');
  const [activeSource, setActiveSource] = useState<InvoiceImportSource | null>(null);
  const [captureModalVisible, setCaptureModalVisible] = useState(false);
  const [reviewModalVisible, setReviewModalVisible] = useState(false);
  const [extractedItems, setExtractedItems] = useState<ExtractedItem[]>([]);
  const [extractedSupplierName, setExtractedSupplierName] = useState('');
  const [extractedSupplierContact, setExtractedSupplierContact] =
    useState<ExtractedSupplierContact | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  const labelFor = (source: InvoiceImportSource | null): string => {
    const labels = { ...DEFAULT_LABELS, ...(opts.loadingLabels ?? {}) };
    if (source && labels[source]) return labels[source]!;
    return labels.default;
  };

  const reportError = (msg: string) => {
    setErrorMessage(msg);
    opts.onError?.(msg);
  };

  const clearError = useCallback(() => setErrorMessage(undefined), []);

  const handleExtractionResult = useCallback(
    async (result: ExtractResult) => {
      if (!result.items.length) {
        reportError(
          result.supplierContact
            ? "Couldn't read any line items, but found supplier contact details. Try a clearer photo of the receipt."
            : 'No line items recognised. Try a sharper photo of the receipt.',
        );
        setPhase('idle');
        return;
      }
      setExtractedItems(result.items);
      setExtractedSupplierName(result.supplierName || '');
      setExtractedSupplierContact(result.supplierContact);
      setReviewModalVisible(true);
      setPhase('reviewing');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const startImport = useCallback(
    async (source: InvoiceImportSource) => {
      setActiveSource(source);
      setErrorMessage(undefined);
      try {
        if (source === 'camera') {
          setCaptureModalVisible(true);
          setPhase('capturing');
          return;
        }
        if (source === 'gallery') {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (perm.status !== 'granted') {
            reportError('Photo library access is needed to pick a receipt.');
            setPhase('idle');
            return;
          }
          const picked = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 0.8,
            allowsMultipleSelection: true,
            selectionLimit: 10,
          });
          if (picked.canceled || !picked.assets?.length) {
            setPhase('idle');
            return;
          }
          setPhase('extracting');
          const result = await extractFromPhotos(
            picked.assets.map(a => a.uri),
            undefined,
            'invoice',
          );
          await handleExtractionResult(result);
        } else if (source === 'pdf') {
          const picked = await DocumentPicker.getDocumentAsync({
            type: 'application/pdf',
            multiple: false,
            copyToCacheDirectory: true,
          });
          if (picked.canceled || !picked.assets?.length) {
            setPhase('idle');
            return;
          }
          const asset = picked.assets[0];
          setPhase('extracting');
          const result = await extractFromPdf(asset.uri, undefined, 'invoice');
          await handleExtractionResult(result);
        }
      } catch (err: any) {
        reportError(err?.message || 'Could not read the receipt. Please try again.');
        setPhase('idle');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleExtractionResult],
  );

  const handleCaptureComplete = useCallback(
    async (uris: string[]) => {
      if (!uris.length) {
        setCaptureModalVisible(false);
        setPhase('idle');
        return;
      }
      setPhase('extracting');
      try {
        const result = await extractFromPhotos(uris, undefined, 'invoice');
        setCaptureModalVisible(false);
        await handleExtractionResult(result);
      } catch (err: any) {
        setCaptureModalVisible(false);
        reportError(err?.message || 'Could not read the receipt. Please try again.');
        setPhase('idle');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleExtractionResult],
  );

  const cancelCapture = useCallback(() => {
    setCaptureModalVisible(false);
    setPhase('idle');
  }, []);

  const cancelReview = useCallback(() => {
    if (saving) return;
    setReviewModalVisible(false);
    setExtractedItems([]);
    setExtractedSupplierContact(undefined);
    setPhase('idle');
  }, [saving]);

  const handleAddToQuote = useCallback(
    async (supplierName: string, rows: InvoiceReviewRow[]) => {
      setSaving(true);
      setPhase('saving');
      try {
        const selected = rows.filter(r => r.selected);
        for (const row of selected) {
          const material = buildMaterialFromRow(row, opts.selectedSection);
          opts.addMaterialToQuote(material, { silent: true });
        }

        // Always merge supplier contact (independent of supplier-book save).
        if (extractedSupplierContact && supplierName) {
          try {
            await persistImportToSupplierBook({
              supplierName,
              rows: [],
              contact: extractedSupplierContact,
            });
          } catch {
            /* non-blocking */
          }
        }

        setReviewModalVisible(false);
        setExtractedItems([]);
        setPhase('idle');

        opts.onAddedToQuote?.({
          supplierName,
          itemCount: selected.length,
          rows: selected,
          contact: extractedSupplierContact,
        });
      } catch (err: any) {
        reportError(err?.message || 'Could not add items to the quote.');
        setPhase('reviewing');
      } finally {
        setSaving(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [extractedSupplierContact, opts.addMaterialToQuote, opts.selectedSection],
  );

  const saveToSupplierBook = useCallback(
    async (supplierName: string, rows: InvoiceReviewRow[]) => {
      const summary = await persistImportToSupplierBook({
        supplierName,
        rows: rows.map(r => ({
          name: r.name,
          price: r.price,
          unit: r.unit,
          coveragePerUnit: r.coveragePerUnit,
          coverageUnit: r.coverageUnit,
          keywords: r.keywords,
        })),
        // Contact already merged at handleAddToQuote time.
      });
      return { itemCount: summary.itemCount };
    },
    [],
  );

  return {
    phase,
    loadingLabel: labelFor(activeSource),
    captureModalVisible,
    reviewModalVisible,
    extractedSupplierName,
    extractedItems,
    extractedSupplierContact,
    saving,
    errorMessage,
    startImport,
    handleCaptureComplete,
    handleAddToQuote,
    saveToSupplierBook,
    cancelCapture,
    cancelReview,
    clearError,
  };
}
