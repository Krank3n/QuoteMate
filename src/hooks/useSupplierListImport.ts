/**
 * useSupplierListImport
 *
 * Shared orchestration for the supplier-list import flow:
 *   1. Pick a source (camera / gallery / pdf)
 *   2. Capture or pick the file(s)
 *   3. Send to the extractor (Firebase Function via supplierListImporter)
 *   4. Show the review modal so the user can edit / select rows
 *   5. Save selected rows to materialFavorites + merge contact details into
 *      the matching SupplierGroup
 *
 * The orchestration was previously inline in AddMaterialScreen; lifting it
 * here lets the new onboarding "Add your first supplier" step share the
 * same pipeline without duplicating ~220 lines of business logic.
 *
 * The hook is UI-agnostic: it owns state and calls into services, but the
 * caller renders the source picker, capture modal, review modal, and any
 * success / error UI. Errors are surfaced via `errorMessage` — the caller
 * can choose to render an inline card or call Alert.alert via `onError`.
 */

import { useCallback, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

import { generateId } from '../utils/generateId';
import {
  extractFromPhotos,
  extractFromPdf,
  type ExtractedItem,
  type ExtractResult,
  type ExtractedSupplierContact,
} from '../services/supplierListImporter';
import {
  parseSpreadsheet,
  autoDetectMapping,
  assessMapping,
  buildExtractFromMapping,
  type ParsedSpreadsheet,
  type ColumnMapping,
} from '../services/spreadsheetParser';
import { suggestSupplierColumnMapping } from '../services/llmService';
import {
  bulkSaveFavorites,
  loadFavoritesFromLocal,
  removeFavoriteProduct,
  getExistingPersonalRateSuppliers,
} from '../services/materialFavorites';
import {
  loadGroups,
  getSupplierGroupByName,
  saveGroup,
} from '../services/supplierGroupService';
import type { FavoriteProductMapping, Material, SupplierGroup } from '../types';
import type { ReviewItemState } from '../components/SupplierListReviewModal';

export type ImportSource = 'camera' | 'gallery' | 'pdf' | 'spreadsheet';
export type ImportPhase =
  | 'idle'
  | 'capturing'
  | 'extracting'
  | 'mappingColumns'
  | 'reviewing'
  | 'saving';

export interface SaveSummary {
  supplierName: string;
  /** created + updated. */
  itemCount: number;
  /** Items that were already at this price (no change applied). */
  unchanged: number;
  contactFieldsApplied: number;
  /** First N (≤3) names of saved items, for use in success cards. */
  itemNames: string[];
}

export interface NoItemsContactInfo {
  supplierName: string;
  contact: ExtractedSupplierContact;
}

export interface UseSupplierListImportOptions {
  /** 'refresh' diffs against the existing list for this supplier. */
  mode?: 'add' | 'refresh';
  /** Pre-fill the supplier name on the review modal (e.g. when scoping to one supplier). */
  prefilledSupplierName?: string;
  /** Override loading labels per source. */
  loadingLabels?: Partial<Record<ImportSource | 'default', string>>;
  /** Called after a successful save (or contact-only save when items=0). */
  onSaved?: (summary: SaveSummary) => void;
  /**
   * Called when extraction returned no purchasable items but did extract
   * supplier contact details. Return `true` to indicate the host has handled
   * the situation (e.g. navigated to EditSupplier). Return falsy / omit the
   * callback entirely to let the hook auto-save a contact-only SupplierGroup
   * and fire `onSaved` with `itemCount: 0`.
   */
  onNoItemsWithContact?: (info: NoItemsContactInfo) => boolean | Promise<boolean>;
  /** Mirror `errorMessage` to a callback so legacy callers can use Alert.alert. */
  onError?: (message: string) => void;
}

export interface UseSupplierListImportResult {
  phase: ImportPhase;
  loadingLabel: string;
  captureModalVisible: boolean;
  reviewModalVisible: boolean;
  extractedSupplierName: string;
  extractedItems: ExtractedItem[];
  extractedSupplierContact?: ExtractedSupplierContact;
  existingForDiff?: Array<FavoriteProductMapping & { key: string }>;
  existingSupplierNames: string[];
  saving: boolean;
  errorMessage?: string;
  /**
   * Spreadsheet column-mapping state (populated only when the parsed file
   * couldn't be auto-mapped). The host renders a modal with these and calls
   * applyColumnMapping() / cancelColumnMapping().
   */
  columnMappingVisible: boolean;
  parsedSpreadsheet: ParsedSpreadsheet | null;
  autoDetectedMapping: Partial<ColumnMapping> | null;
  startImport: (source: ImportSource) => Promise<void>;
  handleCaptureComplete: (uris: string[]) => Promise<void>;
  handleSaveImported: (supplierName: string, rows: ReviewItemState[]) => Promise<void>;
  applyColumnMapping: (mapping: ColumnMapping) => Promise<void>;
  cancelColumnMapping: () => void;
  cancelCapture: () => void;
  cancelReview: () => void;
  clearError: () => void;
}

const DEFAULT_LABELS: Record<ImportSource | 'default', string> = {
  camera: 'Reading your receipt…',
  gallery: 'Reading your price list…',
  pdf: 'Reading your price list…',
  spreadsheet: 'Reading your spreadsheet…',
  default: 'Reading your price list…',
};

export function useSupplierListImport(
  opts: UseSupplierListImportOptions = {}
): UseSupplierListImportResult {
  const mode = opts.mode ?? 'add';

  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [activeSource, setActiveSource] = useState<ImportSource | null>(null);
  const [captureModalVisible, setCaptureModalVisible] = useState(false);
  const [reviewModalVisible, setReviewModalVisible] = useState(false);
  const [extractedItems, setExtractedItems] = useState<ExtractedItem[]>([]);
  const [extractedSupplierName, setExtractedSupplierName] = useState(
    opts.prefilledSupplierName ?? ''
  );
  const [extractedSupplierContact, setExtractedSupplierContact] =
    useState<ExtractedSupplierContact | undefined>(undefined);
  const [existingForDiff, setExistingForDiff] =
    useState<Array<FavoriteProductMapping & { key: string }> | undefined>(undefined);
  const [existingSupplierNames, setExistingSupplierNames] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [columnMappingVisible, setColumnMappingVisible] = useState(false);
  const [parsedSpreadsheet, setParsedSpreadsheet] =
    useState<ParsedSpreadsheet | null>(null);
  const [autoDetectedMapping, setAutoDetectedMapping] =
    useState<Partial<ColumnMapping> | null>(null);

  const labelFor = (source: ImportSource | null): string => {
    const labels = { ...DEFAULT_LABELS, ...(opts.loadingLabels ?? {}) };
    if (source && labels[source]) return labels[source]!;
    return labels.default;
  };

  const reportError = (msg: string) => {
    setErrorMessage(msg);
    opts.onError?.(msg);
  };

  const clearError = useCallback(() => setErrorMessage(undefined), []);

  /**
   * Decide what to do with an extraction result.
   *  - items > 0           → open review modal
   *  - items 0, contact    → caller's onNoItemsWithContact gets first refusal,
   *                          else hook auto-saves a contact-only SupplierGroup
   *  - items 0, no contact → set error
   */
  const handleExtractionResult = useCallback(
    async (result: ExtractResult) => {
      if (!result.items.length) {
        if (result.supplierContact) {
          const info: NoItemsContactInfo = {
            supplierName: result.supplierName || '',
            contact: result.supplierContact,
          };
          let handled = false;
          if (opts.onNoItemsWithContact) {
            const r = await opts.onNoItemsWithContact(info);
            handled = !!r;
          }
          if (handled) {
            setPhase('idle');
            return;
          }
          // Save contact-only SupplierGroup so the user gets *something* useful.
          if (info.supplierName) {
            try {
              const existing = await getSupplierGroupByName(info.supplierName);
              const now = new Date().toISOString();
              const record: SupplierGroup = existing
                ? {
                    ...existing,
                    contactPerson: existing.contactPerson || info.contact.contactPerson,
                    phone: existing.phone || info.contact.phone,
                    email: existing.email || info.contact.email,
                    address: existing.address || info.contact.address,
                    searchUrl: existing.searchUrl || info.contact.website,
                    updatedAt: now,
                  }
                : {
                    id: generateId(),
                    name: info.supplierName.trim(),
                    contactPerson: info.contact.contactPerson,
                    phone: info.contact.phone,
                    email: info.contact.email,
                    address: info.contact.address,
                    searchUrl: info.contact.website,
                    sortOrder: (await loadGroups()).length,
                    createdAt: now,
                    updatedAt: now,
                  };
              await saveGroup(record);
              const fieldsApplied = (
                ['contactPerson', 'phone', 'email', 'address', 'website'] as const
              ).filter(k => {
                if (k === 'website') return !!info.contact.website;
                return !!info.contact[k];
              }).length;
              opts.onSaved?.({
                supplierName: info.supplierName,
                itemCount: 0,
                unchanged: 0,
                contactFieldsApplied: fieldsApplied,
                itemNames: [],
              });
              setPhase('idle');
              return;
            } catch {
              // fall through to error
            }
          }
          reportError(
            `Couldn't read any prices, but found ${info.supplierName ? 'their contact details' : 'some contact info'}. Try a clearer photo of the price list.`
          );
          setPhase('idle');
          return;
        }
        reportError(
          'No prices recognised. Try a sharper photo, or upload a PDF price list.'
        );
        setPhase('idle');
        return;
      }

      if (mode === 'refresh') {
        try {
          const favorites = await loadFavoritesFromLocal();
          const existing = Object.entries(favorites).map(([key, fav]) => ({ key, ...fav }));
          setExistingForDiff(existing);
        } catch {
          setExistingForDiff(undefined);
        }
      } else {
        setExistingForDiff(undefined);
      }

      setExtractedItems(result.items);
      setExtractedSupplierName(result.supplierName || opts.prefilledSupplierName || '');
      setExtractedSupplierContact(result.supplierContact);
      try {
        const names = await getExistingPersonalRateSuppliers();
        setExistingSupplierNames(names);
      } catch {
        setExistingSupplierNames([]);
      }
      setReviewModalVisible(true);
      setPhase('reviewing');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, opts.prefilledSupplierName]
  );

  const startImport = useCallback(
    async (source: ImportSource) => {
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
            reportError('Photo library access is needed to pick a price list.');
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
          const result = await extractFromPhotos(picked.assets.map(a => a.uri));
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
          const result = await extractFromPdf(asset.uri);
          await handleExtractionResult(result);
        } else if (source === 'spreadsheet') {
          const picked = await DocumentPicker.getDocumentAsync({
            // RN DocumentPicker on Android is happiest with broad MIME hints;
            // we re-check the extension in the parser.
            type: [
              'text/csv',
              'text/comma-separated-values',
              'application/csv',
              'application/vnd.ms-excel',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              '*/*',
            ],
            multiple: false,
            copyToCacheDirectory: true,
          });
          if (picked.canceled || !picked.assets?.length) {
            setPhase('idle');
            return;
          }
          const asset = picked.assets[0];
          setPhase('extracting');
          const parsed = await parseSpreadsheet(asset.uri, asset.name, asset.mimeType);
          if (!parsed.headers.length || !parsed.rows.length) {
            reportError(
              "Couldn't read any rows from that file. Make sure it has column headers on the first row and at least one product row.",
            );
            setPhase('idle');
            return;
          }
          // Value-aware detection (sees sample rows, not just headers).
          const detected = autoDetectMapping(parsed.headers, parsed.rows);
          if (detected) {
            const { confidence } = assessMapping(detected, parsed.rows);
            if (confidence !== 'low') {
              const result = buildExtractFromMapping(parsed, detected, {
                supplierName: opts.prefilledSupplierName,
              });
              // High/medium confidence with usable rows → import straight through.
              if (result.items.length) {
                await handleExtractionResult(result);
                return;
              }
            }
          }
          // Low confidence, zero usable rows, or undetectable → never silently
          // import a wrong mapping. Pre-fill the column mapper with our best
          // guess (deterministic, then model-assisted) and let the user confirm.
          let suggestion: Partial<ColumnMapping> | null = detected;
          const needsModel = !detected || assessMapping(detected, parsed.rows).confidence === 'low';
          if (needsModel) {
            const modelMapping = await suggestSupplierColumnMapping({
              headers: parsed.headers,
              sampleRows: parsed.rows,
            });
            if (modelMapping) suggestion = { ...(suggestion || {}), ...modelMapping };
          }
          setParsedSpreadsheet(parsed);
          setAutoDetectedMapping(suggestion ?? null);
          setColumnMappingVisible(true);
          setPhase('mappingColumns');
        }
      } catch (err: any) {
        reportError(err?.message || 'Could not read the price list. Please try again.');
        setPhase('idle');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleExtractionResult]
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
        const result = await extractFromPhotos(uris);
        setCaptureModalVisible(false);
        await handleExtractionResult(result);
      } catch (err: any) {
        setCaptureModalVisible(false);
        reportError(err?.message || 'Could not read the receipt. Please try again.');
        setPhase('idle');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleExtractionResult]
  );

  const cancelCapture = useCallback(() => {
    setCaptureModalVisible(false);
    setPhase('idle');
  }, []);

  const applyColumnMapping = useCallback(
    async (mapping: ColumnMapping) => {
      if (!parsedSpreadsheet) return;
      setColumnMappingVisible(false);
      setPhase('extracting');
      try {
        const result = buildExtractFromMapping(parsedSpreadsheet, mapping, {
          supplierName: opts.prefilledSupplierName,
        });
        if (!result.items.length) {
          reportError(
            "Couldn't find any valid rows with that mapping. Double-check the price column — rows with no name or zero price are skipped.",
          );
          setPhase('idle');
          return;
        }
        await handleExtractionResult(result);
      } catch (err: any) {
        reportError(err?.message || 'Could not import the spreadsheet.');
        setPhase('idle');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parsedSpreadsheet, handleExtractionResult],
  );

  const cancelColumnMapping = useCallback(() => {
    setColumnMappingVisible(false);
    setParsedSpreadsheet(null);
    setAutoDetectedMapping(null);
    setPhase('idle');
  }, []);

  const cancelReview = useCallback(() => {
    if (saving) return;
    setReviewModalVisible(false);
    setExtractedItems([]);
    setExtractedSupplierContact(undefined);
    setExistingForDiff(undefined);
    setPhase('idle');
  }, [saving]);

  const handleSaveImported = useCallback(
    async (supplierName: string, rows: ReviewItemState[]) => {
      setSaving(true);
      setPhase('saving');
      try {
        const importBatchId = generateId();
        const nowIso = new Date().toISOString();
        const selected = rows.filter(r => r.selected && r.diffStatus !== 'removed');

        const toSave = selected.map(item => ({
          productName: item.name,
          store: supplierName || 'Supplier',
          unit: item.unit as Material['unit'],
          price: item.price,
          coveragePerUnit: item.coveragePerUnit,
          coverageUnit: item.coverageUnit,
          keywords: item.keywords,
          dimensions: item.dimensions,
          itemNumber: item.itemNumber,
          notes: item.notes,
          source: 'imported' as const,
          sourceRef: importBatchId,
          isPersonalRate: true,
          lastUpdatedAt: nowIso,
        }));

        const counts = await bulkSaveFavorites(toSave);

        const removalTargets = rows.filter(r => r.diffStatus === 'removed' && r.selected);
        for (const r of removalTargets) {
          try {
            await removeFavoriteProduct(r.name);
          } catch {
            /* ignore */
          }
        }

        let contactFieldsApplied = 0;
        if (extractedSupplierContact && supplierName) {
          try {
            const existing = await getSupplierGroupByName(supplierName);
            const pickIfMissing = (
              current: string | undefined,
              incoming: string | undefined
            ) => {
              if (current && current.trim()) return { value: current, applied: false };
              if (incoming && incoming.trim()) return { value: incoming.trim(), applied: true };
              return { value: current, applied: false };
            };

            const contactPerson = pickIfMissing(existing?.contactPerson, extractedSupplierContact.contactPerson);
            const phone = pickIfMissing(existing?.phone, extractedSupplierContact.phone);
            const email = pickIfMissing(existing?.email, extractedSupplierContact.email);
            const address = pickIfMissing(existing?.address, extractedSupplierContact.address);
            const website = pickIfMissing(existing?.searchUrl, extractedSupplierContact.website);

            contactFieldsApplied =
              (contactPerson.applied ? 1 : 0) +
              (phone.applied ? 1 : 0) +
              (email.applied ? 1 : 0) +
              (address.applied ? 1 : 0) +
              (website.applied ? 1 : 0);

            if (contactFieldsApplied > 0) {
              const now = new Date().toISOString();
              const record: SupplierGroup = existing
                ? {
                    ...existing,
                    contactPerson: contactPerson.value || undefined,
                    phone: phone.value || undefined,
                    email: email.value || undefined,
                    address: address.value || undefined,
                    searchUrl: website.value || undefined,
                    updatedAt: now,
                  }
                : {
                    id: generateId(),
                    name: supplierName.trim(),
                    contactPerson: contactPerson.value || undefined,
                    phone: phone.value || undefined,
                    email: email.value || undefined,
                    address: address.value || undefined,
                    searchUrl: website.value || undefined,
                    sortOrder: (await loadGroups()).length,
                    createdAt: now,
                    updatedAt: now,
                  };
              await saveGroup(record);
            }
          } catch {
            // Don't block — items are already saved.
          }
        }

        setReviewModalVisible(false);
        setExtractedItems([]);
        setExtractedSupplierContact(undefined);
        setExistingForDiff(undefined);

        const itemCount = counts.created + counts.updated;
        opts.onSaved?.({
          supplierName: supplierName || extractedSupplierName,
          itemCount,
          unchanged: counts.unchanged,
          contactFieldsApplied,
          itemNames: selected.map(s => s.name).slice(0, 3),
        });
        setPhase('idle');
      } catch (err: any) {
        reportError(err?.message || 'Could not save imported items.');
        setPhase('reviewing');
      } finally {
        setSaving(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [extractedSupplierContact, extractedSupplierName]
  );

  return {
    phase,
    loadingLabel: labelFor(activeSource),
    captureModalVisible,
    reviewModalVisible,
    extractedSupplierName,
    extractedItems,
    extractedSupplierContact,
    existingForDiff,
    existingSupplierNames,
    saving,
    errorMessage,
    columnMappingVisible,
    parsedSpreadsheet,
    autoDetectedMapping,
    startImport,
    handleCaptureComplete,
    handleSaveImported,
    applyColumnMapping,
    cancelColumnMapping,
    cancelCapture,
    cancelReview,
    clearError,
  };
}

// Re-export types so callers don't need to import from supplierListImporter directly.
export type { ExtractedItem, ExtractResult, ExtractedSupplierContact };
