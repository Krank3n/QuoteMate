/**
 * Add Material Screen
 * Modern full-screen UX for adding materials with tabs for Search/Manual and Saved Items
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  FlatList,
  SectionList,
  TouchableOpacity,
  Image,
  Alert,
  Platform,
  Linking,
  Keyboard,
} from 'react-native';
import {
  Text,
  TextInput,
  Button,
  ActivityIndicator,
  Divider,
  SegmentedButtons,
  Switch,
  IconButton,
  Chip,
} from 'react-native-paper';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { generateId } from '../../utils/generateId';

import { useStore } from '../../store/useStore';
import { useCurrentDocument, useDocumentMode } from '../../utils/documentMode';
import { Material, FavoriteProductMapping } from '../../types';
import { colors } from '../../theme';
import { formatCurrency } from '../../utils/quoteCalculator';
import { ProBadge } from '../../components/ProBadge';
import { searchMaterialPrice } from '../../services/webSearchPricing';
import {
  searchMaterialWithWebScraping,
  getBestMatch,
} from '../../services/webScrapingPricing';
import {
  searchBunningsProducts,
  type ScraperSearchResponse,
} from '../../services/bunningsScraperClient';
import {
  searchReeceMaterialPrice,
  getReeceConnectionStatus,
} from '../../services/reeceApi';
import {
  loadFavoritesFromLocal,
  saveFavoriteProduct,
  removeFavoriteProduct,
  bulkSaveFavorites,
  getExistingPersonalRateSuppliers,
  deleteAllFavoritesByStore,
} from '../../services/materialFavorites';
import { AlertModal } from '../../components/AlertModal';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import {
  extractFromPhotos,
  extractFromPdf,
  type ExtractedItem,
  type ExtractResult,
  type ExtractedSupplierContact,
} from '../../services/supplierListImporter';
import { SupplierListReviewModal, type ReviewItemState } from '../../components/SupplierListReviewModal';
import { SupplierListCaptureModal } from '../../components/SupplierListCaptureModal';
import { MaterialItemCard } from '../../components/MaterialItemCard';
import { BottomSheet } from '../../components/BottomSheet';
import { ActionSheet, type ActionSheetOption } from '../../components/ActionSheet';
import { Snackbar } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FixedBottomButton } from '../../components/FixedBottomButton';
import { WebContainer } from '../../components/WebContainer';
import { SwipeableCard } from '../../components/SwipeableCard';
import { SupplierGroup } from '../../types';
import { loadGroups, getSupplierGroupByName, saveGroup, deleteGroup } from '../../services/supplierGroupService';
import { searchLocalSources, type LocalSearchResult } from '../../services/localMaterialSearch';
import { ContactActionsBar } from '../../components/document/ContactActionsBar';
import { useTourRefs } from '../../components/tour/useTourRefs';
import { ScreenTour } from '../../components/tour/ScreenTour';
import { notifyScreenComplete, notifySkipRequest } from '../../components/tour/UnifiedTourController';
import { PHASE_STEP_OFFSETS, UNIFIED_TOUR_TOTAL_STEPS } from '../../components/tour/tourFlow';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';

type TabValue = 'search' | 'saved';

export function AddMaterialScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const safeInsets = useSafeAreaInsets();
  const mode = useDocumentMode();
  const { document: currentDocument, update: updateDocument } = useCurrentDocument();
  const { businessSettings, subscriptionStatus, unifiedTourActive, unifiedTourPhase } = useStore();
  const isTrialActive = !!(subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired);
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  // For compatibility, alias to currentQuote (used throughout this file)
  const currentQuote = currentDocument;
  const updateQuote = updateDocument;

  // Check if we're in edit mode, template mode, or have a pre-selected section
  const materialId = route.params?.materialId;
  const routeSection = route.params?.section as string | undefined;
  const templateMode = route.params?.templateMode === true;
  const editingTemplate = route.params?.editingTemplate === true;
  const savedItemKey = route.params?.savedItemKey as string | undefined;
  const createSavedItem = route.params?.createSavedItem === true;
  const supplierBookOnly = route.params?.supplierBookOnly === true;
  const isEditMode = !!materialId;
  const isSavedItemEditMode = !!savedItemKey;
  const isSavedItemCreateMode = createSavedItem === true;
  const isSavedItemMode = isSavedItemEditMode || isSavedItemCreateMode;
  const editingMaterial = isEditMode
    ? currentQuote?.materials.find(m => m.id === materialId)
    : null;

  // When editing a template material, read the pending material from store
  const { pendingTemplateMaterial: templateEditMaterial } = useStore();
  const prefillMaterial = editingMaterial || (editingTemplate ? templateEditMaterial : null);

  // Tab state — Search & Add is the primary tab and opens first.
  // Edit modes (material edit / saved-item edit) flip to 'search' in their
  // own effects since they show the manual entry form.
  // Supplier-book-only mode skips the tab bar entirely and always shows saved.
  const [activeTab, setActiveTab] = useState<TabValue>(supplierBookOnly ? 'saved' : 'search');

  // Search & Add tab state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [manualEntrySheetVisible, setManualEntrySheetVisible] = useState(false);
  const searchCancelledRef = useRef(false);

  // Whether the user has connected their Reece account. Drives the Reece
  // search step in handleSearch when their preferred store is Reece.
  // Reece is now always-on when connected (no longer gated on a single
  // selectedStore), so we check connection state once on mount and use it
  // alongside Bunnings throughout the search chain.
  const [reeceConnected, setReeceConnected] = useState<boolean>(false);
  useEffect(() => {
    let cancelled = false;
    getReeceConnectionStatus()
      .then((status) => {
        if (!cancelled) setReeceConnected(!!status.connected);
      })
      .catch(() => {
        if (!cancelled) setReeceConnected(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Manual entry state - initialize with editing material if in edit mode
  const [manualName, setManualName] = useState(prefillMaterial?.name || '');
  const [manualQuantity, setManualQuantity] = useState(
    prefillMaterial?.quantity.toString() || '1'
  );
  const [manualUnit, setManualUnit] = useState<Material['unit']>(
    prefillMaterial?.unit || 'each'
  );
  const [manualPrice, setManualPrice] = useState(
    prefillMaterial?.price.toString() || ''
  );

  // Personal supplier rate fields (revealed when isPersonalRate is true)
  const [isPersonalRate, setIsPersonalRate] = useState(false);
  const [coveragePerUnit, setCoveragePerUnit] = useState('');
  const [coverageUnit, setCoverageUnit] = useState<'m²' | 'm³' | 'm' | 'none'>('none');
  const [rateKeywords, setRateKeywords] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);
  const [showCoverageOptions, setShowCoverageOptions] = useState(false);
  const [savedItemSupplierOptions, setSavedItemSupplierOptions] = useState<string[]>([]);

  // Section picker — show existing sections from the quote
  const [selectedSection, setSelectedSection] = useState(editingMaterial?.section || routeSection || '');
  const [showSectionPicker, setShowSectionPicker] = useState(false);
  const existingSections = React.useMemo(() => {
    if (!currentQuote) return [];
    const sectionNames = new Set<string>();
    // From QuoteSection entries
    if (currentQuote.sections) {
      currentQuote.sections.forEach(s => sectionNames.add(s.name));
    }
    // From material section fields
    currentQuote.materials.forEach(m => {
      if (m.section) sectionNames.add(m.section);
    });
    return Array.from(sectionNames).sort();
  }, [currentQuote]);
  const [newSectionName, setNewSectionName] = useState('');

  // Supplier groups — used both as search filters and as the source of
  // contact details (phone/email/etc.) shown in the Supplier Book section
  // headers. Reloaded whenever the screen regains focus so edits made on
  // EditSupplierScreen are reflected on return.
  const [supplierGroups, setSupplierGroups] = useState<SupplierGroup[]>([]);
  const [selectedSupplierGroup, setSelectedSupplierGroup] = useState<string>('');

  useEffect(() => {
    loadGroups().then(setSupplierGroups);
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      loadGroups().then(setSupplierGroups);
    }, [])
  );

  // Ref for auto-focusing manual name input for non-pro users
  const materialNameRef = useRef<any>(null);

  // Auto-focus material name for non-pro users
  useEffect(() => {
    if (!isPro && !isEditMode && activeTab === 'search') {
      const timer = setTimeout(() => {
        materialNameRef.current?.focus();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isPro, isEditMode, activeTab]);

  // Update form when editing material changes
  React.useEffect(() => {
    if (editingMaterial) {
      setManualName(editingMaterial.name);
      setManualQuantity(editingMaterial.quantity.toString());
      setManualUnit(editingMaterial.unit);
      setManualPrice(editingMaterial.price.toString());
      setActiveTab('search'); // Start on manual entry area when editing

      // If the quote material was added from the supplier book, restore all
      // the original supplier-book details so the user can edit them and
      // sync changes back. The link is via `favoriteProduct` which carries
      // the saved favorite as captured at add-time.
      const linkedFav = editingMaterial.favoriteProduct;
      if (linkedFav) {
        setIsPersonalRate(true);
        setSupplierName(linkedFav.store && linkedFav.store !== 'manual' ? linkedFav.store : '');
        setRateKeywords((linkedFav as any).keywords?.join(', ') || '');
        const cov = (linkedFav as any).coveragePerUnit;
        setCoveragePerUnit(cov !== undefined ? String(cov) : '');
        setCoverageUnit(((linkedFav as any).coverageUnit as 'm²' | 'm³' | 'm') || 'none');
        setShowCoverageOptions(cov !== undefined && cov !== null);
      }
    }
  }, [editingMaterial]);

  // Load existing supplier names on screen mount so the supplier dropdown is
  // populated regardless of which mode we entered the screen in (regular
  // material edit, supplier-book edit, or fresh add). Cheap AsyncStorage read.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const names = await getExistingPersonalRateSuppliers();
        if (!cancelled) setSavedItemSupplierOptions(names);
      } catch {
        if (!cancelled) setSavedItemSupplierOptions([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Pre-fill form when editing or creating a supplier-book item.
  React.useEffect(() => {
    if (!isSavedItemMode) return;

    let cancelled = false;
    (async () => {
      if (isSavedItemCreateMode) {
        if (cancelled) return;
        setIsPersonalRate(true);
        setActiveTab('search');
        return;
      }
      if (!savedItemKey) return;
      const favorites = await loadFavoritesFromLocal();
      const fav = favorites[savedItemKey];
      if (cancelled || !fav) return;
      setManualName(fav.productName || '');
      setManualUnit((fav.unit as Material['unit']) || 'each');
      setManualPrice(fav.price !== undefined ? fav.price.toString() : '');
      setIsPersonalRate(true); // Supplier-book items are always personal rates in this flow
      const cov = fav.coveragePerUnit !== undefined ? fav.coveragePerUnit.toString() : '';
      setCoveragePerUnit(cov);
      setCoverageUnit((fav.coverageUnit as 'm²' | 'm³' | 'm') || 'none');
      setShowCoverageOptions(cov !== '' || (fav.coverageUnit !== undefined && fav.coverageUnit !== null));
      setRateKeywords(fav.keywords?.join(', ') || '');
      setSupplierName(fav.store && fav.store !== 'manual' ? fav.store : '');
      setActiveTab('search');
    })();
    return () => { cancelled = true; };
  }, [isSavedItemMode, isSavedItemEditMode, isSavedItemCreateMode, savedItemKey]);

  // ─────────────────────────────────────────────────────────────────────
  // Unsaved-changes guard
  //
  // Snapshot the manual-entry form fields whenever the screen settles into a
  // new "starting" state (mount, pre-fill from editing material, pre-fill from
  // saved item). isDirty diffs the live values against that snapshot. The
  // guard hooks beforeRemove and pops the standard confirmation modal.
  //
  // No onDiscard is needed: AddMaterialScreen never mutates currentQuote until
  // the user explicitly hits the Save button — the form lives entirely in
  // local component state, which is thrown away on unmount.
  // ─────────────────────────────────────────────────────────────────────
  const formSnapshotRef = useRef<string | null>(null);

  // Capture a fresh snapshot whenever the form is re-initialised (mount,
  // editingMaterial pre-fill, savedItem pre-fill). Run AFTER those effects so
  // we capture the *post-prefill* state, not the empty defaults.
  useEffect(() => {
    formSnapshotRef.current = JSON.stringify({
      manualName,
      manualQuantity,
      manualUnit,
      manualPrice,
      isPersonalRate,
      coveragePerUnit,
      coverageUnit,
      rateKeywords,
      supplierName,
      selectedSection,
    });
    // Intentionally only run when the *prefill source* changes — not on every
    // keystroke, otherwise the snapshot would constantly shift to match the
    // current state and isDirty would always be false.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingMaterial, savedItemKey, isSavedItemCreateMode]);

  const isDirty = useMemo(() => {
    if (!formSnapshotRef.current) return false;
    const current = JSON.stringify({
      manualName,
      manualQuantity,
      manualUnit,
      manualPrice,
      isPersonalRate,
      coveragePerUnit,
      coverageUnit,
      rateKeywords,
      supplierName,
      selectedSection,
    });
    return current !== formSnapshotRef.current;
  }, [
    manualName,
    manualQuantity,
    manualUnit,
    manualPrice,
    isPersonalRate,
    coveragePerUnit,
    coverageUnit,
    rateKeywords,
    supplierName,
    selectedSection,
  ]);

  const { unsavedModalProps, allowNextNavigation } = useUnsavedChangesGuard({
    isDirty,
    onSave: async () => {
      const ok = await handleAddManually({ silent: true });
      // If validation failed (returned false), keep the user on screen.
      return ok;
    },
  });

  // Tour refs
  const { registerRef } = useTourRefs();
  const savedItemsTabRef = useRef<View>(null);
  const searchSectionRef = useRef<View>(null);
  const manualEntrySectionRef = useRef<View>(null);

  useEffect(() => {
    if (savedItemsTabRef.current) registerRef('savedItemsTab', savedItemsTabRef.current);
    if (searchSectionRef.current) registerRef('searchSection', searchSectionRef.current);
    if (manualEntrySectionRef.current) registerRef('manualEntrySection', manualEntrySectionRef.current);
  });

  // Saved items state
  const [savedItems, setSavedItems] = useState<any[]>([]);
  const [isLoadingSaved, setIsLoadingSaved] = useState(false);

  // Bulk-import (supplier price list) state
  const [importSheetVisible, setImportSheetVisible] = useState(false);
  const [importMode, setImportMode] = useState<'new' | 'refresh'>('new');
  const [importLoading, setImportLoading] = useState(false);
  const [importLoadingLabel, setImportLoadingLabel] = useState('');
  const [captureModalVisible, setCaptureModalVisible] = useState(false);
  const [reviewModalVisible, setReviewModalVisible] = useState(false);
  const [extractedItems, setExtractedItems] = useState<ExtractedItem[]>([]);
  const [extractedSupplierName, setExtractedSupplierName] = useState('');
  // Optional contact details lifted from the supplier price list (header /
  // footer / letterhead) — applied to the matching SupplierGroup record on
  // save, but only for fields the user hasn't already filled in.
  const [extractedSupplierContact, setExtractedSupplierContact] = useState<ExtractedSupplierContact | undefined>(undefined);
  const [existingForDiff, setExistingForDiff] = useState<any[] | undefined>(undefined);
  const [existingSupplierNames, setExistingSupplierNames] = useState<string[]>([]);
  // Collapsed supplier sections in the Supplier Book tab
  const [collapsedSuppliers, setCollapsedSuppliers] = useState<Set<string>>(new Set());
  // Expanded saved items (for showing details like image, description, etc.)
  const [expandedSavedItems, setExpandedSavedItems] = useState<Set<string>>(new Set());
  // Delete confirmation dialogs
  const [deleteItemDialog, setDeleteItemDialog] = useState<{ visible: boolean; item: any | null }>({
    visible: false,
    item: null,
  });
  const [deleteSupplierDialog, setDeleteSupplierDialog] = useState<{ visible: boolean; supplier: string; count: number }>({
    visible: false,
    supplier: '',
    count: 0,
  });
  const [saveFavoriteDialog, setSaveFavoriteDialog] = useState<{
    visible: boolean;
    material: Material | null;
    item: any | null;
  }>({ visible: false, material: null, item: null });
  const [savingImport, setSavingImport] = useState(false);
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  // Recently used materials state
  const [recentMaterials, setRecentMaterials] = useState<Material[]>([]);

  const RECENT_MATERIALS_KEY = '@quotemate_recent_materials';
  const MAX_RECENT_MATERIALS = 8;

  // Load recently used materials on mount
  useEffect(() => {
    loadRecentMaterials();
  }, []);

  const loadRecentMaterials = async () => {
    try {
      const stored = await AsyncStorage.getItem(RECENT_MATERIALS_KEY);
      if (stored) {
        setRecentMaterials(JSON.parse(stored));
      }
    } catch (error) {
      // silently ignore
    }
  };

  const saveToRecentMaterials = async (material: Material) => {
    try {
      const stored = await AsyncStorage.getItem(RECENT_MATERIALS_KEY);
      let recents: Material[] = stored ? JSON.parse(stored) : [];

      // Remove duplicate by name (case-insensitive)
      recents = recents.filter(
        (m) => m.name.toLowerCase() !== material.name.toLowerCase()
      );

      // Add to front
      recents.unshift(material);

      // Keep only the most recent
      recents = recents.slice(0, MAX_RECENT_MATERIALS);

      await AsyncStorage.setItem(RECENT_MATERIALS_KEY, JSON.stringify(recents));
      setRecentMaterials(recents);
    } catch (error) {
      // silently ignore
    }
  };

  // Load saved items when switching to saved tab (or on mount in supplier-book-only mode).
  const shouldLoadSaved = activeTab === 'saved' || supplierBookOnly;
  useEffect(() => {
    if (shouldLoadSaved) {
      loadSavedItems();
    }
  }, [shouldLoadSaved]);

  // Re-fetch saved items whenever the screen regains focus, so changes made
  // in a child instance (saved-item edit/create) show up on return.
  useFocusEffect(
    React.useCallback(() => {
      if (shouldLoadSaved) {
        loadSavedItems();
      }
    }, [shouldLoadSaved])
  );

  const loadSavedItems = async () => {
    setIsLoadingSaved(true);
    try {
      const favorites = await loadFavoritesFromLocal();
      const items = Object.entries(favorites).map(([key, fav]) => ({
        key,
        ...fav,
      }));
      setSavedItems(items);
    } catch (error) {
      // silently ignore
    } finally {
      setIsLoadingSaved(false);
    }
  };

  // -------------------------------------------------------------------------
  // Bulk import from supplier price list (photos / PDF)
  // -------------------------------------------------------------------------

  const openImportSheet = (prefilledSupplier?: string) => {
    // When scoped to a specific supplier, check if that supplier already has
    // items — if so, default to refresh mode so the review modal shows a diff.
    const hasImported = prefilledSupplier
      ? savedItems.some((s: any) => s.store === prefilledSupplier)
      : savedItems.some((s: any) => s.source === 'imported');
    setImportMode(hasImported ? 'refresh' : 'new');
    if (prefilledSupplier) {
      setExtractedSupplierName(prefilledSupplier);
    }
    setImportSheetVisible(true);
  };

  const handleExtractionResult = async (result: ExtractResult) => {
    if (!result.items.length) {
      // No purchasable line items found — but the photo may have been a
      // contact card / business card. If the AI lifted any contact details,
      // route the user to the EditSupplier form pre-filled with what was
      // found, so they can review and save it as a supplier.
      if (result.supplierContact) {
        navigation.navigate(
          'EditSupplier' as never,
          {
            supplierName: result.supplierName || undefined,
            prefill: {
              contactPerson: result.supplierContact.contactPerson,
              phone: result.supplierContact.phone,
              email: result.supplierContact.email,
              address: result.supplierContact.address,
              website: result.supplierContact.website,
            },
          } as never,
        );
        return;
      }

      Alert.alert(
        'Nothing to import',
        'No line items or contact details were recognised. Try a clearer photo.'
      );
      return;
    }

    if (importMode === 'refresh') {
      // Load the current list so we can compute a diff by slug key.
      const favorites = await loadFavoritesFromLocal();
      const existing = Object.entries(favorites).map(([key, fav]) => ({ key, ...fav }));
      setExistingForDiff(existing);
    } else {
      setExistingForDiff(undefined);
    }

    setExtractedItems(result.items);
    setExtractedSupplierName(result.supplierName || '');
    setExtractedSupplierContact(result.supplierContact);
    // Load existing personal-rate supplier names so the modal can offer them
    // as one-tap consolidation chips.
    try {
      const names = await getExistingPersonalRateSuppliers();
      setExistingSupplierNames(names);
    } catch {
      setExistingSupplierNames([]);
    }
    setReviewModalVisible(true);
  };

  const runImport = async (source: 'camera' | 'gallery' | 'pdf') => {
    setImportSheetVisible(false);
    try {
      if (source === 'camera') {
        // Multi-photo capture flow — opens a custom CameraView modal so the
        // user can snap several pages of a price list in one session, then
        // hand them off as a single batch to the extractor.
        setCaptureModalVisible(true);
        return;
      } else if (source === 'gallery') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== 'granted') {
          Alert.alert('Photo Library Access Needed', 'Enable photo library access to pick a price list.');
          return;
        }
        const picked = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.8,
          allowsMultipleSelection: true,
          selectionLimit: 10,
        });
        if (picked.canceled || !picked.assets?.length) return;
        setImportLoading(true);
        setImportLoadingLabel('Reading your price list…');
        const result = await extractFromPhotos(picked.assets.map(a => a.uri));
        await handleExtractionResult(result);
      } else if (source === 'pdf') {
        const picked = await DocumentPicker.getDocumentAsync({
          type: 'application/pdf',
          multiple: false,
          copyToCacheDirectory: true,
        });
        if (picked.canceled || !picked.assets?.length) return;
        const asset = picked.assets[0];
        setImportLoading(true);
        setImportLoadingLabel('Reading your price list…');
        const result = await extractFromPdf(asset.uri);
        await handleExtractionResult(result);
      }
    } catch (err: any) {
      Alert.alert('Import Failed', err?.message || 'Could not read the price list. Please try again.');
    } finally {
      setImportLoading(false);
      setImportLoadingLabel('');
    }
  };

  const handleSaveImported = async (supplierName: string, rows: ReviewItemState[]) => {
    setSavingImport(true);
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
        source: 'imported' as const,
        sourceRef: importBatchId,
        isPersonalRate: true,
        lastUpdatedAt: nowIso,
      }));

      const counts = await bulkSaveFavorites(toSave);

      // Handle REMOVED rows flagged for deletion (selected = true means delete).
      const removalTargets = rows.filter(r => r.diffStatus === 'removed' && r.selected);
      for (const r of removalTargets) {
        try {
          await removeFavoriteProduct(r.name);
        } catch {
          /* ignore */
        }
      }

      // If the AI lifted contact details from the price list header/footer,
      // merge them into the matching SupplierGroup record. Only fill in fields
      // the user hasn't already set — never overwrite existing data.
      let contactFieldsApplied = 0;
      if (extractedSupplierContact && supplierName) {
        try {
          const existing = await getSupplierGroupByName(supplierName);
          const pickIfMissing = (current: string | undefined, incoming: string | undefined) => {
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
            const record = existing
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
            // Refresh local supplierGroups so the section header picks up
            // the new contact icons immediately.
            const refreshed = await loadGroups();
            setSupplierGroups(refreshed);
          }
        } catch {
          // Don't block the import if contact merge fails — items are already saved.
        }
      }

      const total = counts.created + counts.updated;
      const label = supplierName ? ` from ${supplierName}` : '';
      const contactSuffix = contactFieldsApplied > 0
        ? ` • Added ${contactFieldsApplied} contact detail${contactFieldsApplied === 1 ? '' : 's'}`
        : '';
      const msg =
        total > 0
          ? `Saved ${total} item${total === 1 ? '' : 's'}${label}${
              counts.unchanged ? ` (${counts.unchanged} unchanged)` : ''
            }${contactSuffix}`
          : `No changes${counts.unchanged ? ` (${counts.unchanged} unchanged)` : ''}${contactSuffix}`;
      setSnackbarMessage(msg);
      setSnackbarVisible(true);

      setReviewModalVisible(false);
      setExtractedItems([]);
      setExtractedSupplierContact(undefined);
      setExistingForDiff(undefined);
      await loadSavedItems();
    } catch (err: any) {
      Alert.alert('Save Failed', err?.message || 'Could not save imported items.');
    } finally {
      setSavingImport(false);
    }
  };

  const handleCaptureComplete = async (uris: string[]) => {
    if (!uris.length) {
      setCaptureModalVisible(false);
      return;
    }
    setImportLoading(true);
    setImportLoadingLabel('Reading your price list…');
    try {
      const result = await extractFromPhotos(uris);
      setCaptureModalVisible(false);
      await handleExtractionResult(result);
    } catch (err: any) {
      setCaptureModalVisible(false);
      Alert.alert('Import Failed', err?.message || 'Could not read the price list. Please try again.');
    } finally {
      setImportLoading(false);
      setImportLoadingLabel('');
    }
  };

  const importSheetOptions: ActionSheetOption[] = [
    { icon: 'camera', label: 'Take photo', onPress: () => runImport('camera') },
    { icon: 'image-multiple', label: 'Pick from gallery', onPress: () => runImport('gallery') },
    { icon: 'file-pdf-box', label: 'Pick PDF', onPress: () => runImport('pdf') },
  ];

  const cancelSearch = useCallback(() => {
    searchCancelledRef.current = true;
    setIsSearching(false);
    setHasSearched(false);
  }, []);

  const handleSearch = useCallback(async () => {
    if (!isPro) {
      navigation.navigate('Paywall' as never);
      return;
    }

    if (!searchQuery.trim()) {
      Alert.alert('Enter Search Term', 'Please enter a product name or description to search');
      return;
    }

    searchCancelledRef.current = false;
    setIsSearching(true);
    setSearchResults([]);
    setHasSearched(false);

    // Search order:
    //  1. Local sources — section templates + favorites scoped to the user's
    //     configured suppliers. Always tried first; the user's own prices
    //     beat any retail lookup.
    //  2. Bunnings scraper — only if Bunnings is in the supplier list, OR the
    //     user has no suppliers configured at all (default behavior).
    //  3. Web scraping — driven by the user's configured supplier websites,
    //     falling back to the legacy hardwareStores setting if none are set.
    //  4. AI estimation — last resort.
    //
    // Local results are always shown alongside remote ones so the user can
    // compare; remote results are appended below local hits.
    //
    // If a supplier chip is selected, the entire chain narrows to JUST that
    // supplier — local favorites tagged with it, and the appropriate remote
    // path for it (scraper if Bunnings, web-scrape its searchUrl otherwise).
    try {
      // Resolve scope from the selected chip (if any).
      const scopedSupplier = selectedSupplierGroup
        ? supplierGroups.find(g => g.id === selectedSupplierGroup) ?? null
        : null;
      const scopedToOne = !!scopedSupplier;
      const supplierScope = scopedSupplier ? [scopedSupplier] : supplierGroups;

      // ── Step 1: local sources ──
      let localResults: LocalSearchResult[] = [];
      try {
        // When narrowed to one supplier, skip templates — the user is asking
        // "what does THIS supplier carry", not "what bundles do I have".
        localResults = await searchLocalSources(searchQuery, supplierScope, {
          includeTemplates: !scopedToOne,
        });
        if (searchCancelledRef.current) return;
        if (localResults.length > 0) {
          setSearchResults(localResults);
        }
      } catch {
        // Local search must never block the remote fallback chain.
        localResults = [];
      }
      if (searchCancelledRef.current) return;

      // ── Step 2/3/4: remote fallback ──
      const hardwareStores = businessSettings?.hardwareStores || ['bunnings.com.au'];
      const fallbackStore = hardwareStores[0];

      // Bunnings scraper runs when:
      //  - the user is scoped to a supplier whose name contains "bunnings", OR
      //  - no chip is selected AND Bunnings is in their hardware stores or
      //    they have no suppliers configured at all.
      // When scoped to a non-Bunnings supplier, skip Bunnings entirely.
      const hasBunningsInHardwareStores = hardwareStores.some(s =>
        s.toLowerCase().includes('bunnings'));
      const scopedToBunnings = scopedSupplier
        ? scopedSupplier.name.toLowerCase().includes('bunnings')
        : false;
      const shouldTryBunnings = scopedToOne
        ? scopedToBunnings
        : (hasBunningsInHardwareStores || supplierGroups.length === 0);

      console.log('[search] shouldTryBunnings:', shouldTryBunnings,
        '| scopedToOne:', scopedToOne,
        '| hasBunningsInHardwareStores:', hasBunningsInHardwareStores,
        '| hardwareStores:', hardwareStores);

      // Web-scraping store list:
      //  - scoped: just the selected supplier's searchUrl (if it has one)
      //  - unscoped: all configured suppliers' websites, falling back to the
      //    hardwareStores setting only when nothing is configured.
      const scopedStores = scopedSupplier?.searchUrl?.trim()
        ? [scopedSupplier.searchUrl.trim()]
        : [];
      const supplierStores = supplierGroups
        .map(g => g.searchUrl?.trim())
        .filter((url): url is string => !!url);
      const storesToScrape = scopedToOne
        ? scopedStores
        : (supplierStores.length > 0 ? supplierStores : [fallbackStore]);

      let remoteResults: any[] = [];

      // ── Step 2 (Reece priority when connected): plumber's maX account ──
      // Reece runs alongside the Bunnings backbone. If the user has connected
      // their maX account, we fetch their trade-discounted price first. Reece
      // returns one best-match result, so this short-circuits the rest of the
      // chain when we get a hit; otherwise we fall through to Bunnings as
      // normal. Skipped when the user scoped the search to a specific
      // supplier chip — they're explicitly asking for that supplier's catalog.
      if (reeceConnected && !scopedToOne) {
        try {
          const reeceResult = await searchReeceMaterialPrice(searchQuery);
          if (searchCancelledRef.current) return;
          if (reeceResult.reauthRequired) {
            setReeceConnected(false);
          } else if (reeceResult.price && reeceResult.itemNumber) {
            remoteResults = [{
              productName: reeceResult.productName || searchQuery,
              description: 'Reece trade price',
              itemNumber: reeceResult.itemNumber,
              brand: '',
              price: reeceResult.price,
              productUrl: '',
              imageUrl: '',
              store: reeceResult.store || 'Reece Plumbing',
              isScraperResult: true,
              // Surface so the eventual Material write picks up Reece-specific
              // order identifiers without needing a re-query at order time.
              reeceItemNumber: reeceResult.itemNumber,
              reeceUnitOfMeasure: reeceResult.unitOfMeasure || null,
            }];
          }
        } catch {
          // Reece miss — fall through to the existing chain.
        }
      }
      if (searchCancelledRef.current) return;

      if (remoteResults.length === 0 && shouldTryBunnings) {
        // searchBunningsProducts throws on error; preserve the old null-on-
        // error contract so the fallback flow still kicks in.
        let scraperResponse: ScraperSearchResponse | null = null;
        try {
          scraperResponse = await searchBunningsProducts(searchQuery, 10);
        } catch {
          scraperResponse = null;
        }
        if (searchCancelledRef.current) return;

        if (scraperResponse && scraperResponse.success && scraperResponse.results.length > 0) {
          remoteResults = scraperResponse.results.map(product => ({
            productName: product.productName,
            description: product.description || '',
            itemNumber: product.itemNumber || '',
            brand: product.brand || '',
            price: product.price,
            productUrl: product.productUrl,
            imageUrl: product.imageUrl,
            store: 'bunnings.com.au',
            stockLevel: product.stockLevel,
            isScraperResult: true,
            confidence: product.confidence,
          }));
        }
      }
      if (searchCancelledRef.current) return;

      // Web scraping only runs if we have stores to scrape against. When the
      // user is scoped to a non-Bunnings supplier with no searchUrl, this
      // step is skipped and we fall straight through to AI estimation.
      if (remoteResults.length === 0 && storesToScrape.length > 0) {
        const scraperResults = await searchMaterialWithWebScraping(
          searchQuery,
          searchQuery,
          1,
          'each',
          storesToScrape
        );
        if (searchCancelledRef.current) return;

        remoteResults = scraperResults.flatMap(r => r.matches).map(match => ({
          productName: match.productName,
          description: match.description || '',
          itemNumber: match.itemNumber || '',
          brand: match.brand || '',
          price: match.price,
          productUrl: match.productUrl,
          imageUrl: match.imageUrl,
          store: match.store,
          isScraperResult: true,
        }));
      }
      if (searchCancelledRef.current) return;

      if (remoteResults.length === 0 && localResults.length === 0) {
        // Final fallback to AI estimation — only when we have nothing else.
        const aiStores = storesToScrape.length > 0 ? storesToScrape : [fallbackStore];
        const aiResult = await searchMaterialPrice(searchQuery, aiStores);
        if (searchCancelledRef.current) return;
        if (aiResult.price) {
          remoteResults = [{
            productName: aiResult.productName || searchQuery,
            description: 'AI reckons about this much',
            itemNumber: '',
            brand: '',
            price: aiResult.price,
            productUrl: undefined,
            imageUrl: undefined,
            store: aiResult.store || aiStores[0],
            isScraperResult: false,
            isAiEstimate: true,
          }];
        }
      }
      if (searchCancelledRef.current) return;

      setSearchResults([...localResults, ...remoteResults]);
    } catch (error) {
      if (searchCancelledRef.current) return;
      Alert.alert('Search Error', 'Failed to search products. Please try again.');
    } finally {
      if (!searchCancelledRef.current) {
        setIsSearching(false);
        setHasSearched(true);
      }
    }
  }, [searchQuery, businessSettings, isPro, navigation, supplierGroups, selectedSupplierGroup]);

  const handleSelectProduct = async (item: any) => {
    let newMaterial: Material;

    if (item.isAiEstimate) {
      newMaterial = {
        id: generateId(),
        name: item.productName,
        quantity: 1,
        unit: 'each',
        price: item.price || 0,
        totalPrice: item.price || 0,
        manualPriceOverride: false,
        searchTerm: item.productName,
        pricingSource: 'ai',
        description: item.description,
      };
    } else if (item.isLocalSource) {
      newMaterial = {
        id: generateId(),
        name: item.productName,
        quantity: 1,
        unit: (item.unit as Material['unit']) || 'each',
        price: item.price || 0,
        totalPrice: item.price || 0,
        manualPriceOverride: false,
        searchTerm: item.productName,
        pricingSource: 'manual',
        productUrl: item.productUrl,
        imageUrl: item.imageUrl,
        description: item.description,
      };
    } else if (item.isScraperResult) {
      // Reece-sourced rows carry both Bunnings-style metadata AND Reece order
      // identifiers — discriminator is `reeceItemNumber` being present.
      const isReeceResult = !!item.reeceItemNumber;
      newMaterial = {
        id: generateId(),
        name: item.productName,
        quantity: 1,
        unit: 'each',
        bunningsItemNumber: isReeceResult ? undefined : item.itemNumber,
        reeceItemNumber: isReeceResult ? item.reeceItemNumber : undefined,
        reeceUnitOfMeasure: isReeceResult ? (item.reeceUnitOfMeasure || undefined) : undefined,
        price: item.price || 0,
        totalPrice: item.price || 0,
        manualPriceOverride: false,
        searchTerm: item.productName,
        pricingSource: isReeceResult ? 'api' : 'scraper',
        // Preserve scraper confidence so the UI can flag low-confidence
        // results (Claude-guessed fallback) as "Est. — verify price".
        priceConfidence: item.confidence,
        productUrl: item.productUrl,
        imageUrl: item.imageUrl,
        description: item.description,
        brand: item.brand &&
               item.brand.toLowerCase() !== 'bunnings' &&
               item.brand.toLowerCase() !== 'bunnings.com.au'
          ? item.brand
          : undefined,
        stockLevel: item.stockLevel,
        stockCheckedAt: new Date().toISOString(),
      };
    } else {
      // Defensive fallback. After the PR1 search refactor, every result row
      // is one of: AI estimate, local source, or scraper result — so this
      // branch should be unreachable. We keep it as a "treat as manual" path
      // to avoid silently dropping a tap if something upstream changes shape.
      newMaterial = {
        id: generateId(),
        name: item.productName || item.description,
        quantity: 1,
        unit: 'each',
        bunningsItemNumber: item.itemNumber,
        price: item.price || 0,
        totalPrice: item.price || 0,
        manualPriceOverride: false,
        searchTerm: item.description,
        pricingSource: 'manual',
      };
    }

    // Ask if user wants to save as a favorite for future quotes
    setSaveFavoriteDialog({ visible: true, material: newMaterial, item });
  };

  const handleConfirmSaveFavorite = async () => {
    const { material, item } = saveFavoriteDialog;
    if (!material || !item) return;

    // Derive a human-readable supplier name from the store URL/field
    const rawStore = (item.store || '').trim();
    let storeName = rawStore;
    if (rawStore.toLowerCase().includes('bunnings')) {
      storeName = 'Bunnings';
    } else if (rawStore.toLowerCase().includes('reece')) {
      storeName = 'Reece';
    } else if (rawStore && rawStore.includes('.')) {
      // URL-like value — strip domain suffix for a cleaner label
      storeName = rawStore.replace(/\.com\.au$|\.com$/, '').replace(/^www\./, '');
      storeName = storeName.charAt(0).toUpperCase() + storeName.slice(1);
    }

    await saveFavoriteProduct(
      material.name,
      material.searchTerm,
      {
        productName: item.productName,
        store: storeName || 'Other',
        productUrl: item.productUrl,
        itemNumber: item.itemNumber,
        unit: material.unit,
        price: material.price,
        imageUrl: item.imageUrl,
      }
    );
    addMaterialToQuote(material);
    setSaveFavoriteDialog({ visible: false, material: null, item: null });
  };

  const handleDismissSaveFavorite = () => {
    const { material } = saveFavoriteDialog;
    if (material) addMaterialToQuote(material);
    setSaveFavoriteDialog({ visible: false, material: null, item: null });
  };

  // When called from the Save button (default), navigates back on success.
  // When called via the unsaved-changes guard with `{ silent: true }`, returns
  // a boolean and lets the hook handle navigation. Returns false on validation
  // failure so the guard can keep the user on screen instead of exiting.
  const handleAddManually = async (opts?: { silent?: boolean }): Promise<boolean> => {
    const silent = opts?.silent === true;

    if (!manualName.trim()) {
      Alert.alert('Enter Material Name', 'Please enter a material name');
      return false;
    }

    const quantity = parseFloat(manualQuantity) || 1;
    const price = parseFloat(manualPrice) || 0;

    // Saved-item create / edit mode: persist (or update) the favorite, then
    // pop back to the Saved tab. Never touch the current quote.
    if (isSavedItemMode) {
      const trimmedName = manualName.trim();
      if (!trimmedName) {
        Alert.alert('Missing name', 'Please enter a name for the supplier book item.');
        return false;
      }
      const parsedKeywords = rateKeywords
        .split(',')
        .map(k => k.trim())
        .filter(k => k.length > 0);
      const parsedCoverage = parseFloat(coveragePerUnit);

      const favoritePayload: FavoriteProductMapping = {
        productName: trimmedName,
        store: supplierName.trim() || 'manual',
        unit: manualUnit,
        price,
        ...(isPersonalRate && { isPersonalRate: true }),
        ...(isPersonalRate && !isNaN(parsedCoverage) && parsedCoverage > 0 && {
          coveragePerUnit: parsedCoverage,
        }),
        ...(isPersonalRate && coverageUnit !== 'none' && {
          coverageUnit: coverageUnit as 'm²' | 'm³' | 'm',
        }),
        ...(isPersonalRate && parsedKeywords.length > 0 && {
          keywords: parsedKeywords,
        }),
        source: 'manual',
        lastUpdatedAt: new Date().toISOString(),
      };

      // If the slug key changed (renamed), drop the old entry first so we
      // don't leave a stale duplicate behind.
      const newSlug = trimmedName.toLowerCase().trim().replace(/\s+/g, '_').replace(/\//g, '-');
      if (isSavedItemEditMode && savedItemKey && savedItemKey !== newSlug) {
        try { await removeFavoriteProduct(savedItemKey); } catch { /* ignore */ }
      }
      await saveFavoriteProduct(trimmedName, trimmedName, favoritePayload);
      if (!silent) {
        allowNextNavigation();
        navigation.goBack();
      }
      return true;
    }

    if (isEditMode && editingMaterial) {
      // Update existing material
      const updatedMaterial: Material = {
        ...editingMaterial,
        name: manualName.trim(),
        quantity,
        unit: manualUnit,
        price,
        totalPrice: price * quantity,
        manualPriceOverride: true,
        pricingSource: 'manual',
        section: selectedSection || undefined,
      };
      updateMaterialInQuote(updatedMaterial, { silent });

      // If this material was linked to a supplier book entry — and the user
      // hasn't disabled the link by toggling off "Save to my saved items" —
      // sync the changes back so the supplier book stays in step. Handles
      // renames by removing the old slug and writing the new one. Also picks
      // up edits to supplier/keywords/coverage from the form.
      const linkedFav = editingMaterial.favoriteProduct;
      if (linkedFav && isPersonalRate) {
        const newName = manualName.trim();
        const oldSlug = (linkedFav.productName || '').toLowerCase().trim().replace(/\s+/g, '_').replace(/\//g, '-');
        const newSlug = newName.toLowerCase().trim().replace(/\s+/g, '_').replace(/\//g, '-');
        const parsedKeywords = rateKeywords
          .split(',')
          .map(k => k.trim())
          .filter(k => k.length > 0);
        const parsedCoverage = parseFloat(coveragePerUnit);
        const updatedFavorite: FavoriteProductMapping = {
          ...linkedFav,
          productName: newName,
          store: supplierName.trim() || (linkedFav as any).store || 'manual',
          unit: manualUnit,
          price,
          ...(!isNaN(parsedCoverage) && parsedCoverage > 0
            ? { coveragePerUnit: parsedCoverage }
            : { coveragePerUnit: undefined as any }),
          ...(coverageUnit !== 'none'
            ? { coverageUnit: coverageUnit as 'm²' | 'm³' | 'm' }
            : { coverageUnit: undefined as any }),
          ...(parsedKeywords.length > 0
            ? { keywords: parsedKeywords }
            : { keywords: undefined as any }),
          isPersonalRate: true,
          lastUpdatedAt: new Date().toISOString(),
        };
        try {
          if (oldSlug && oldSlug !== newSlug) {
            await removeFavoriteProduct(oldSlug);
          }
          await saveFavoriteProduct(newName, newName, updatedFavorite);
        } catch {
          // Non-fatal — quote material is already updated
        }
      }
    } else {
      // Add new material
      const newMaterial: Material = {
        id: generateId(),
        name: manualName.trim(),
        quantity,
        unit: manualUnit,
        price,
        totalPrice: price * quantity,
        manualPriceOverride: true,
        pricingSource: 'manual',
        section: selectedSection || undefined,
      };

      if (isPersonalRate) {
        const parsedKeywords = rateKeywords
          .split(',')
          .map(k => k.trim())
          .filter(k => k.length > 0);
        const parsedCoverage = parseFloat(coveragePerUnit);
        const favoritePayload: FavoriteProductMapping = {
          productName: newMaterial.name,
          store: supplierName.trim() || 'manual',
          unit: newMaterial.unit,
          price: newMaterial.price,
          isPersonalRate: true,
          ...(!isNaN(parsedCoverage) && parsedCoverage > 0 && {
            coveragePerUnit: parsedCoverage,
          }),
          ...(coverageUnit !== 'none' && {
            coverageUnit: coverageUnit as 'm²' | 'm³' | 'm',
          }),
          ...(parsedKeywords.length > 0 && {
            keywords: parsedKeywords,
          }),
          source: 'manual' as const,
          lastUpdatedAt: new Date().toISOString(),
        };
        await saveFavoriteProduct(
          newMaterial.name,
          newMaterial.name,
          favoritePayload
        );
      }

      addMaterialToQuote(newMaterial, { silent });
    }

    return true;
  };

  // The screen is registered both as a nested route (`AddMaterial` inside the
  // new-quote stack) and as a root-level standalone (`AddMaterialStandalone`
  // for the Settings entry). Picking the right one means navigation.push
  // works in either context.
  const editRouteName = supplierBookOnly ? 'AddMaterialStandalone' : 'AddMaterial';

  const handleSelectSavedItem = async (item: any) => {
    // Standalone "manage supplier book" mode (opened from Settings) has no
    // active quote — tapping an item should open it for editing instead.
    if (supplierBookOnly) {
      (navigation as any).push(editRouteName, { savedItemKey: item.key });
      return;
    }
    // Create material from saved template
    const price = item.price || 0;
    const isPersonalRate = item.isPersonalRate === true;
    // Strip the local-cache `key` field — favoriteProduct stores the
    // original favorite shape so future edits can sync back.
    const { key: _key, ...favShape } = item;
    const newMaterial: Material = {
      id: generateId(),
      name: item.productName,
      quantity: 1,
      unit: (item.unit || 'each') as Material['unit'],
      price: price,
      totalPrice: price * 1,
      // Personal rates and imported supplier-list items must NOT be re-priced
      // against Bunnings/Reece — flag as a manual override so the pricing
      // fallback chain in MaterialsListScreen skips them.
      manualPriceOverride: isPersonalRate,
      searchTerm: item.productName,
      // Only retail product mappings carry productUrl / bunningsItemNumber.
      // Imported supplier-list items are not Bunnings products.
      productUrl: isPersonalRate ? undefined : item.productUrl,
      bunningsItemNumber: isPersonalRate ? undefined : item.itemNumber,
      imageUrl: item.imageUrl,
      pricingSource: isPersonalRate || item.store === 'manual' ? 'manual' : 'scraper',
      // Link back to the supplier book entry so editing this quote material
      // syncs the price/unit/etc changes back to the supplier book.
      favoriteProduct: favShape as FavoriteProductMapping,
    };

    addMaterialToQuote(newMaterial);
  };

  const handleSelectRecentMaterial = (material: Material) => {
    const newMaterial: Material = {
      ...material,
      id: generateId(),
      quantity: 1,
      totalPrice: material.price * 1,
    };
    addMaterialToQuote(newMaterial);
  };

  const handleDeleteSavedItem = (item: any) => {
    setDeleteItemDialog({ visible: true, item });
  };

  const confirmDeleteSavedItem = async () => {
    const item = deleteItemDialog.item;
    setDeleteItemDialog({ visible: false, item: null });
    if (!item) return;
    try {
      await removeFavoriteProduct(item.productName, item.productName);
      await loadSavedItems();
    } catch {
      // ignore — user can retry
    }
  };

  const toggleSupplierCollapsed = (supplier: string) => {
    setCollapsedSuppliers((prev) => {
      const next = new Set(prev);
      if (next.has(supplier)) next.delete(supplier);
      else next.add(supplier);
      return next;
    });
  };

  const handleDeleteSupplier = (supplier: string, count: number) => {
    setDeleteSupplierDialog({ visible: true, supplier, count });
  };

  const confirmDeleteSupplier = async () => {
    const { supplier } = deleteSupplierDialog;
    setDeleteSupplierDialog({ visible: false, supplier: '', count: 0 });
    if (!supplier) return;
    try {
      const removed = await deleteAllFavoritesByStore(supplier);

      // Also remove the SupplierGroup record so the section doesn't
      // reappear as an empty ghost after all items are deleted.
      const group = supplierGroups.find(
        g => g.name.trim().toLowerCase() === supplier.trim().toLowerCase()
      );
      if (group) {
        await deleteGroup(group.id);
        setSupplierGroups(prev => prev.filter(g => g.id !== group.id));
      }

      await loadSavedItems();
      if (removed > 0) {
        setSnackbarMessage(`Removed ${removed} item${removed === 1 ? '' : 's'} from ${supplier}`);
        setSnackbarVisible(true);
      }
    } catch {
      // ignore
    }
  };

  const { setPendingTemplateMaterial } = useStore();

  // `silent` skips the trailing navigation.goBack() so the unsaved-changes guard
  // can run persistence without double-firing the back transition.
  const addMaterialToQuote = (material: Material, opts?: { silent?: boolean }) => {
    // Template mode: store material in staging area and go back
    if (templateMode) {
      setPendingTemplateMaterial(material);
      if (!opts?.silent) {
        allowNextNavigation();
        navigation.goBack();
      }
      return;
    }

    if (!currentQuote) return;

    // Apply selected section to the material
    const materialWithSection = selectedSection
      ? { ...material, section: selectedSection }
      : material;

    updateQuote({
      ...currentQuote,
      materials: [...(currentQuote.materials || []), materialWithSection],
    });

    // Save to recently used
    saveToRecentMaterials(material);

    if (!opts?.silent) {
      allowNextNavigation();
      navigation.goBack();
    }
  };

  const updateMaterialInQuote = (updatedMaterial: Material, opts?: { silent?: boolean }) => {
    if (!currentQuote) return;

    const updatedMaterials = currentQuote.materials.map(m =>
      m.id === updatedMaterial.id ? updatedMaterial : m
    );

    updateQuote({
      ...currentQuote,
      materials: updatedMaterials,
    });

    if (!opts?.silent) {
      allowNextNavigation();
      navigation.goBack();
    }
  };

  // Search section component
  const renderSearchSection = () => (
    <View ref={searchSectionRef} style={styles.section}>
      <View style={styles.manualEntryHeader}>
        <View style={styles.manualEntryDividerLine} />
        <View style={styles.searchTitleRow}>
          <Text style={styles.manualEntryHeaderText}>Search Products</Text>
          {!isPro && <ProBadge size="small" />}
        </View>
        <View style={styles.manualEntryDividerLine} />
      </View>
      {/* Supplier group filter */}
      {supplierGroups.length > 0 && isPro && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.supplierChipsRow}>
          <TouchableOpacity
            style={[styles.supplierChip, !selectedSupplierGroup && styles.supplierChipActive]}
            onPress={() => setSelectedSupplierGroup('')}
          >
            <Text style={[styles.supplierChipText, !selectedSupplierGroup && styles.supplierChipTextActive]}>All</Text>
          </TouchableOpacity>
          {supplierGroups.map(g => (
            <TouchableOpacity
              key={g.id}
              style={[styles.supplierChip, selectedSupplierGroup === g.id && styles.supplierChipActive]}
              onPress={() => setSelectedSupplierGroup(selectedSupplierGroup === g.id ? '' : g.id)}
            >
              <Text style={[styles.supplierChipText, selectedSupplierGroup === g.id && styles.supplierChipTextActive]}>{g.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {!isPro ? (
        <TouchableOpacity
          style={styles.proSearchPrompt}
          onPress={() => navigation.navigate('Paywall' as never)}
        >
          <MaterialCommunityIcons name="lock-outline" size={20} color={colors.onSurface} />
          <Text style={styles.proSearchPromptText}>
            Search real product prices from hardware stores
          </Text>
          <Text style={styles.proSearchPromptCta}>Upgrade to Pro</Text>
        </TouchableOpacity>
      ) : (
      <View style={styles.searchBarContainer}>
        <View style={styles.searchBarInputWrap}>
          <MaterialCommunityIcons name="magnify" size={20} color={colors.textMuted} style={styles.searchBarIcon} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            mode="flat"
            placeholder={selectedSupplierGroup ? `Search ${supplierGroups.find(g => g.id === selectedSupplierGroup)?.name || 'supplier'}` : "Search for materials..."}
            placeholderTextColor={colors.textMuted}
            style={styles.searchBarInput}
            contentStyle={styles.searchBarInputContent}
            underlineStyle={{ display: 'none' }}
            onSubmitEditing={() => { Keyboard.dismiss(); handleSearch(); }}
            returnKeyType="search"
            editable={!isSearching}
          />
        </View>
        {isSearching ? (
          <TouchableOpacity
            style={[styles.searchBarButton, styles.searchBarButtonCancel]}
            onPress={cancelSearch}
            activeOpacity={0.7}
          >
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text style={styles.searchBarButtonText}>Cancel</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.searchBarButton}
            onPress={() => { Keyboard.dismiss(); handleSearch(); }}
            activeOpacity={0.7}
          >
            <Text style={styles.searchBarButtonText}>Search</Text>
          </TouchableOpacity>
        )}
      </View>
      )}

      {isPro && searchResults.length > 0 && (
        <View style={styles.resultsContainer}>
          <Text style={styles.resultsHeader}>
            Found {searchResults.length} products:
          </Text>
          <FlatList
            data={searchResults}
            keyExtractor={(item, index) => item.itemNumber || `result-${index}`}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.resultItem}
                onPress={() => handleSelectProduct(item)}
              >
                {item.imageUrl && (
                  <Image
                    source={{ uri: item.imageUrl }}
                    style={styles.resultImage}
                    resizeMode="contain"
                  />
                )}
                <View style={styles.resultInfo}>
                  <Text style={styles.resultName}>
                    {item.productName || item.description}
                  </Text>
                  <Text style={styles.resultDetails}>
                    {item.itemNumber && `Item #: ${item.itemNumber}`}
                    {item.brand && item.brand.toLowerCase() !== 'bunnings' && ` • ${item.brand}`}
                  </Text>
                  {item.price > 0 && (
                    <Text style={styles.resultPrice}>
                      {formatCurrency(item.price)}
                    </Text>
                  )}
                  {item.isAiEstimate && (
                    <Chip
                      icon="robot"
                      mode="outlined"
                      compact
                      style={styles.aiChip}
                      textStyle={styles.aiChipText}
                    >
                      AI Estimate
                    </Chip>
                  )}
                  {item.isLocalSource && (
                    <Chip
                      icon={item.localSource === 'template' ? 'shape-outline' : 'bookmark-outline'}
                      mode="outlined"
                      compact
                      style={styles.aiChip}
                      textStyle={styles.aiChipText}
                    >
                      {item.localSourceLabel}
                    </Chip>
                  )}
                </View>
                <IconButton icon="chevron-right" size={20} />
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={() => <Divider />}
          />
        </View>
      )}

      {/* "Can't find it?" prompt after a search yields zero results */}
      {isPro && hasSearched && !isSearching && searchResults.length === 0 && (
        <TouchableOpacity
          style={styles.cantFindItPrompt}
          onPress={() => setManualEntrySheetVisible(true)}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="plus-circle-outline" size={20} color={colors.primary} />
          <Text style={styles.cantFindItText}>Can't find it? Add manually</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  // Manual entry section component
  const linkedToSupplierBook = isEditMode && !!editingMaterial?.favoriteProduct;

  const renderManualEntrySection = () => (
    <View ref={manualEntrySectionRef} style={styles.section}>
      {linkedToSupplierBook && (
        <View style={styles.linkedBanner}>
          <MaterialCommunityIcons name="link-variant" size={16} color={colors.primary} />
          <Text style={styles.linkedBannerText}>
            Linked to your supplier book — changes save to both
          </Text>
        </View>
      )}
      {!isEditMode && !isSavedItemMode && (
        <View style={styles.manualEntryHeader}>
          <View style={styles.manualEntryDividerLine} />
          <Text style={styles.manualEntryHeaderText}>
            {isPro ? 'add manually' : 'Add Material'}
          </Text>
          <View style={styles.manualEntryDividerLine} />
        </View>
      )}

      <TextInput
        ref={materialNameRef}
        label={isSavedItemMode ? 'Item name *' : 'Material Name *'}
        value={manualName}
        onChangeText={setManualName}
        mode="outlined"
        style={styles.input}
        placeholder="e.g., Custom timber piece"
      />

      {isSavedItemMode ? (
        <TextInput
          label="Price per unit"
          value={manualPrice}
          onChangeText={setManualPrice}
          mode="outlined"
          keyboardType="decimal-pad"
          placeholder="Optional"
          left={<TextInput.Affix text="$" />}
          style={styles.input}
        />
      ) : (
        <View style={styles.row}>
          <View style={[styles.halfWidth, styles.quantityStepperContainer]}>
            <Text style={styles.quantityLabel}>Quantity *</Text>
            <View style={styles.quantityStepper}>
              <TouchableOpacity
                style={styles.stepperButton}
                onPress={() => {
                  const current = parseFloat(manualQuantity) || 1;
                  if (current > 1) setManualQuantity((current - 1).toString());
                }}
              >
                <MaterialCommunityIcons name="minus" size={20} color={colors.primary} />
              </TouchableOpacity>
              <TextInput
                value={manualQuantity}
                onChangeText={setManualQuantity}
                mode="flat"
                keyboardType="decimal-pad"
                style={styles.quantityInput}
                contentStyle={styles.quantityInputContent}
                underlineStyle={{ display: 'none' }}
              />
              <TouchableOpacity
                style={styles.stepperButton}
                onPress={() => {
                  const current = parseFloat(manualQuantity) || 0;
                  setManualQuantity((current + 1).toString());
                }}
              >
                <MaterialCommunityIcons name="plus" size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>
          </View>

          <TextInput
            label="Price per Unit"
            value={manualPrice}
            onChangeText={setManualPrice}
            mode="outlined"
            keyboardType="decimal-pad"
            placeholder="Optional"
            left={<TextInput.Affix text="$" />}
            style={[styles.input, styles.halfWidth]}
          />
        </View>
      )}

      <View style={styles.unitSelector}>
        <Text style={styles.unitLabel}>Unit</Text>
        <View style={styles.unitButtons}>
          <SegmentedButtons
            value={manualUnit}
            onValueChange={(value) => setManualUnit(value as Material['unit'])}
            buttons={[
              { value: 'each', label: 'Each' },
              { value: 'm', label: 'M' },
              { value: 'm²', label: 'm²' },
              { value: 'm³', label: 'm³' },
            ]}
            style={styles.unitRow}
          />
          <SegmentedButtons
            value={manualUnit}
            onValueChange={(value) => setManualUnit(value as Material['unit'])}
            buttons={[
              { value: 'L', label: 'L' },
              { value: 'kg', label: 'Kg' },
              { value: 'box', label: 'Box' },
              { value: 'pack', label: 'Pack' },
            ]}
            style={styles.unitRow}
          />
        </View>
      </View>


      {/* Section Picker */}
      {!isSavedItemMode && existingSections.length > 0 && (
        <View style={styles.categorySelector}>
          <Text style={styles.unitLabel}>Section (for grouping)</Text>
          <TouchableOpacity
            style={styles.categoryButton}
            onPress={() => setShowSectionPicker(!showSectionPicker)}
          >
            <MaterialCommunityIcons
              name="folder-outline"
              size={20}
              color={colors.primary}
            />
            <Text style={styles.categoryButtonText}>
              {selectedSection || 'No Section'}
            </Text>
            <MaterialCommunityIcons
              name={showSectionPicker ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={colors.onSurface}
            />
          </TouchableOpacity>
          {showSectionPicker && (
            <View style={styles.categoryList}>
              <TouchableOpacity
                style={[styles.categoryItem, !selectedSection && styles.categoryItemSelected]}
                onPress={() => { setSelectedSection(''); setShowSectionPicker(false); }}
              >
                <Text style={[styles.categoryItemText, !selectedSection && styles.categoryItemTextSelected]}>No Section</Text>
              </TouchableOpacity>
              {existingSections.map((name) => (
                <TouchableOpacity
                  key={name}
                  style={[styles.categoryItem, selectedSection === name && styles.categoryItemSelected]}
                  onPress={() => { setSelectedSection(name); setShowSectionPicker(false); }}
                >
                  <Text style={[styles.categoryItemText, selectedSection === name && styles.categoryItemTextSelected]}>{name}</Text>
                  {selectedSection === name && (
                    <MaterialCommunityIcons name="check" size={18} color={colors.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}

      {/* "Save to supplier book" toggle — only in normal add-to-quote mode.
          In supplier-book edit/create mode the form IS the supplier-book editor,
          so the toggle is redundant. */}
      {!isSavedItemMode && (
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Save to supplier book</Text>
          <Switch
            value={isPersonalRate}
            onValueChange={setIsPersonalRate}
            color={colors.primary}
          />
        </View>
      )}

      {(isPersonalRate || isSavedItemMode) && (
        <View style={isSavedItemMode ? undefined : styles.personalRateFields}>
          {!isSavedItemMode && (
            <Text style={styles.personalRateHelper}>
              When auto-generate sees a matching job, it will use this rate instead of searching retail.
            </Text>
          )}

          {/* Supplier picker — dropdown of existing suppliers, with free-text fallback */}
          <View style={styles.categorySelector}>
            <Text style={styles.unitLabel}>Supplier</Text>
            <TouchableOpacity
              style={styles.categoryButton}
              onPress={() => setSupplierPickerOpen(!supplierPickerOpen)}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="store-outline" size={20} color={colors.primary} />
              <Text style={styles.categoryButtonText}>
                {supplierName || 'Choose or type a supplier'}
              </Text>
              <MaterialCommunityIcons
                name={supplierPickerOpen ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={colors.onSurface}
              />
            </TouchableOpacity>
            {supplierPickerOpen && (
              <View style={styles.categoryList}>
                {savedItemSupplierOptions.length === 0 && (
                  <View style={styles.categoryItem}>
                    <Text style={[styles.categoryItemText, { color: colors.textMuted }]}>
                      No saved suppliers yet — type a name below
                    </Text>
                  </View>
                )}
                {savedItemSupplierOptions.map((name) => (
                  <TouchableOpacity
                    key={name}
                    style={[styles.categoryItem, supplierName === name && styles.categoryItemSelected]}
                    onPress={() => {
                      setSupplierName(name);
                      setSupplierPickerOpen(false);
                    }}
                  >
                    <Text style={[styles.categoryItemText, supplierName === name && styles.categoryItemTextSelected]}>
                      {name}
                    </Text>
                    {supplierName === name && (
                      <MaterialCommunityIcons name="check" size={18} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <TextInput
              value={supplierName}
              onChangeText={setSupplierName}
              mode="outlined"
              dense
              placeholder="Or type a new supplier name"
              style={[styles.input, { marginTop: 8 }]}
            />
          </View>

          <TextInput
            label="Match keywords (comma-separated)"
            value={rateKeywords}
            onChangeText={setRateKeywords}
            mode="outlined"
            placeholder="e.g. concrete, slab, footing"
            style={styles.input}
          />

          {/* Coverage is an advanced concept — only relevant when one purchasable
              unit contains a fixed amount of work-volume (e.g. a half-cube mulch
              bag, a 13 m² FC sheet). Hidden behind a disclosure to keep the form
              clean for the common case. */}
          <TouchableOpacity
            style={styles.advancedToggle}
            onPress={() => setShowCoverageOptions(!showCoverageOptions)}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name={showCoverageOptions ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.primary}
            />
            <Text style={styles.advancedToggleText}>
              {showCoverageOptions ? 'Hide' : 'Show'} coverage settings
            </Text>
          </TouchableOpacity>

          {showCoverageOptions && (
            <View>
              <Text style={styles.coverageHelper}>
                Use this only when one purchasable unit covers a fixed amount of work
                — e.g. a sheet that covers 13 m², or a bag that contains ½ m³ of mulch.
              </Text>
              <TextInput
                label="Coverage per unit"
                value={coveragePerUnit}
                onChangeText={setCoveragePerUnit}
                mode="outlined"
                keyboardType="decimal-pad"
                placeholder="e.g. 13"
                style={styles.input}
              />
              <Text style={styles.unitLabel}>Coverage unit</Text>
              <SegmentedButtons
                value={coverageUnit}
                onValueChange={(value) => setCoverageUnit(value as 'm²' | 'm³' | 'm' | 'none')}
                buttons={[
                  { value: 'm²', label: 'm²' },
                  { value: 'm³', label: 'm³' },
                  { value: 'm', label: 'm' },
                  { value: 'none', label: 'None' },
                ]}
                style={styles.unitRow}
              />
            </View>
          )}
        </View>
      )}
    </View>
  );

  // Recently Used section
  const renderRecentlyUsedSection = () => {
    if (recentMaterials.length === 0 || isEditMode || isSavedItemMode) return null;

    return (
      <View style={styles.section}>
        <View style={styles.manualEntryHeader}>
          <View style={styles.manualEntryDividerLine} />
          <Text style={styles.manualEntryHeaderText}>Recently Used</Text>
          <View style={styles.manualEntryDividerLine} />
        </View>
        <View style={styles.recentChipsContainer}>
          {recentMaterials.slice(0, 3).map((material, index) => (
            <TouchableOpacity
              key={`${material.name}-${index}`}
              style={styles.recentChip}
              onPress={() => handleSelectRecentMaterial(material)}
            >
              <Text style={styles.recentChipName} numberOfLines={1}>
                {material.name}
              </Text>
              {material.price > 0 && (
                <Text style={styles.recentChipPrice}>
                  {formatCurrency(material.price)}
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  // Render Search & Add Tab - search first, recently used below, manual entry in bottom sheet
  const renderSearchTab = () => (
    <ScrollView
      style={styles.tabContent}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <WebContainer>
      {isEditMode || isSavedItemMode ? (
        renderManualEntrySection()
      ) : (
        <>
          {renderSearchSection()}
          {renderRecentlyUsedSection()}
          {/* Persistent "Add manually" link at the bottom */}
          <TouchableOpacity
            style={styles.addManuallySearchLink}
            onPress={() => setManualEntrySheetVisible(true)}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="pencil-plus-outline" size={18} color={colors.primary} />
            <Text style={styles.addManuallySearchLinkText}>Add manually</Text>
          </TouchableOpacity>
        </>
      )}
      </WebContainer>
    </ScrollView>
  );

  // Render Saved Items Tab
  const renderImportBar = () => (
    <TouchableOpacity
      style={styles.importCard}
      onPress={() => openImportSheet()}
      disabled={importLoading}
      activeOpacity={0.85}
    >
      <View style={styles.importCardIconWrap}>
        {importLoading ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <MaterialCommunityIcons
            name="cloud-upload-outline"
            size={28}
            color={colors.primary}
          />
        )}
      </View>
      <View style={styles.importCardBody}>
        <Text style={styles.importCardTitle}>
          {importLoading ? (importLoadingLabel || 'Reading your price list…') : 'Import price list'}
        </Text>
        <Text style={styles.importCardSubtitle}>
          Snap a photo or upload a PDF of your supplier's list to add items in bulk
        </Text>
      </View>
      {!importLoading && (
        <MaterialCommunityIcons
          name="chevron-right"
          size={24}
          color={colors.onSurface}
          style={styles.importCardChevron}
        />
      )}
    </TouchableOpacity>
  );

  const renderAddManuallyLink = () => (
    <TouchableOpacity
      style={styles.addManuallyLink}
      onPress={() =>
        (navigation as any).push(editRouteName, { createSavedItem: true })
      }
      activeOpacity={0.7}
    >
      <MaterialCommunityIcons name="plus-circle-outline" size={18} color={colors.primary} />
      <Text style={styles.addManuallyLinkText}>Add an item manually</Text>
    </TouchableOpacity>
  );

  // Group saved items by supplier (`store`) for the SectionList. Personal-rate
  // suppliers come first (alphabetical), then any "manual" / unspecified bucket
  // last. Items within a section keep their original order. Collapsed sections
  // pass an empty `data` array so the SectionList just renders the header.
  type SavedSection = { title: string; data: any[]; totalCount: number };
  const savedSections: SavedSection[] = React.useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const item of savedItems) {
      const rawStore = (item.store || '').trim();
      const key = !rawStore || rawStore.toLowerCase() === 'manual' ? 'Other items' : rawStore;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    // Surface SupplierGroup records that have no saved items yet — users can
    // add a supplier (e.g. for contact details) before they've ever saved a
    // price from them, and we still want to see that supplier here.
    const lowerKeys = new Set(Array.from(groups.keys()).map(k => k.toLowerCase()));
    for (const sg of supplierGroups) {
      const name = sg.name.trim();
      if (!name) continue;
      if (name.toLowerCase() === 'other items') continue;
      if (!lowerKeys.has(name.toLowerCase())) {
        groups.set(name, []);
        lowerKeys.add(name.toLowerCase());
      }
    }
    const sections: SavedSection[] = [];
    const personalKeys: string[] = [];
    const otherKeys: string[] = [];
    for (const [key, items] of groups.entries()) {
      if (key === 'Other items') continue;
      if (items.some((it) => it.isPersonalRate)) personalKeys.push(key);
      else otherKeys.push(key);
    }
    personalKeys.sort();
    otherKeys.sort();
    const buildSection = (title: string): SavedSection => {
      const items = groups.get(title) || [];
      const isCollapsed = collapsedSuppliers.has(title);
      return { title, data: isCollapsed ? [] : items, totalCount: items.length };
    };
    for (const k of personalKeys) sections.push(buildSection(k));
    for (const k of otherKeys) sections.push(buildSection(k));
    if (groups.has('Other items')) sections.push(buildSection('Other items'));
    return sections;
  }, [savedItems, collapsedSuppliers, supplierGroups]);

  // Lookup helper: find the SupplierGroup record matching a section title
  // (case-insensitive). Used to render contact details / actions in the header.
  const findSupplierGroup = React.useCallback(
    (title: string) => {
      const target = title.trim().toLowerCase();
      return supplierGroups.find(g => g.name.trim().toLowerCase() === target);
    },
    [supplierGroups]
  );

  const renderSavedTab = () => (
    <View style={styles.tabContent}>
      {renderImportBar()}
      <TouchableOpacity
        style={styles.discoverCard}
        onPress={() => navigation.navigate('DiscoverSuppliers')}
        activeOpacity={0.85}
      >
        <MaterialCommunityIcons name="store-search-outline" size={22} color={colors.primary} style={{ marginRight: 10 }} />
        <Text style={styles.discoverCardText}>Discover Supplier Partners</Text>
        <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurface} />
      </TouchableOpacity>
      {renderAddManuallyLink()}
      {isLoadingSaved ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading supplier book...</Text>
        </View>
      ) : savedItems.length === 0 && savedSections.length === 0 ? (
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="format-list-bulleted" size={64} color={colors.onSurface} />
          <Text style={styles.emptyStateTitle}>Your supplier book is empty</Text>
          <Text style={styles.emptyStateText}>
            Import a supplier price list, or save materials from the Search tab, to build your supplier book
          </Text>
        </View>
      ) : (
        <SectionList
          sections={savedSections}
          keyExtractor={(item) => item.key}
          contentContainerStyle={[styles.savedList, { paddingBottom: safeInsets.bottom + 24 }]}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => {
            const title = section.title;
            const isEditable = title !== 'Other items';
            const isCollapsed = collapsedSuppliers.has(title);
            const count = (section as SavedSection).totalCount;
            const sg = isEditable ? findSupplierGroup(title) : undefined;
            const hasContactActions = !!(sg && (sg.phone || sg.email || sg.searchUrl));
            return (
              <View style={styles.supplierHeader}>
                <View style={styles.supplierHeaderTopRow}>
                  <TouchableOpacity
                    onPress={() => toggleSupplierCollapsed(title)}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                    style={styles.supplierHeaderChevron}
                  >
                    <MaterialCommunityIcons
                      name={isCollapsed ? 'chevron-right' : 'chevron-down'}
                      size={22}
                      color={colors.textMuted}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => toggleSupplierCollapsed(title)}
                    activeOpacity={0.7}
                    style={styles.supplierHeaderNameWrap}
                  >
                    <Text style={styles.supplierHeaderName} numberOfLines={1}>{title}</Text>
                    <Text style={styles.supplierHeaderCount}>
                      {count === 0 ? 'No saved items' : `${count} ${count === 1 ? 'item' : 'items'}`}
                    </Text>
                    {sg?.id?.startsWith('partner_') && (
                      <View style={styles.syncedBadge}>
                        <MaterialCommunityIcons name="sync" size={11} color={colors.primary} />
                        <Text style={styles.syncedBadgeText}>synced</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                  {isEditable && (
                    <View style={styles.supplierHeaderActions}>
                      <TouchableOpacity
                        onPress={() => openImportSheet(title)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={styles.supplierHeaderActionBtn}
                      >
                        <MaterialCommunityIcons name="camera-plus-outline" size={18} color={colors.textMuted} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() =>
                          navigation.navigate(
                            'EditSupplier' as never,
                            { supplierName: title } as never,
                          )
                        }
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={styles.supplierHeaderActionBtn}
                      >
                        <MaterialCommunityIcons name="pencil-outline" size={18} color={colors.textMuted} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDeleteSupplier(title, count)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={styles.supplierHeaderActionBtn}
                      >
                        <MaterialCommunityIcons name="delete-outline" size={18} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
                {hasContactActions && sg && (
                  <View style={styles.supplierHeaderContactRow}>
                    <ContactActionsBar
                      phone={sg.phone}
                      email={sg.email}
                      website={sg.searchUrl}
                      compact
                    />
                  </View>
                )}
              </View>
            );
          }}
          renderItem={({ item }) => {
            // Adapt the saved favorite to the Material shape MaterialItemCard
            // expects so the Saved tab renders consistently with the main
            // materials list (and any future card improvements land here too).
            const synthetic: Material = {
              id: item.key,
              name: item.productName,
              quantity: 1,
              unit: (item.unit || 'each') as Material['unit'],
              price: item.price ?? 0,
              totalPrice: item.price ?? 0,
              manualPriceOverride: item.isPersonalRate === true,
              searchTerm: item.productName,
              imageUrl: item.imageUrl,
              productUrl: item.productUrl,
              description: item.notes || undefined,
              brand: item.brand || undefined,
              bunningsItemNumber: item.isPersonalRate ? undefined : item.itemNumber,
              pricingSource: item.isPersonalRate ? 'manual' : 'scraper',
              favoriteProduct: item as FavoriteProductMapping,
            };
            return (
              <SwipeableCard
                rightActions={[
                  {
                    icon: 'delete-outline',
                    label: 'Delete',
                    color: colors.error,
                    bgColor: colors.error + '18',
                    onPress: () => handleDeleteSavedItem(item),
                  },
                ]}
              >
                <MaterialItemCard
                  material={synthetic}
                  readOnly
                  isExpanded={expandedSavedItems.has(item.key)}
                  onToggleExpand={() => setExpandedSavedItems(prev => {
                    const next = new Set(prev);
                    next.has(item.key) ? next.delete(item.key) : next.add(item.key);
                    return next;
                  })}
                  onPress={supplierBookOnly ? undefined : () => handleSelectSavedItem(item)}
                  onOpenInStore={item.productUrl ? () => Linking.openURL(item.productUrl) : undefined}
                  onEdit={() => (navigation as any).push(editRouteName, { savedItemKey: item.key })}
                  onDelete={() => handleDeleteSavedItem(item)}
                />
              </SwipeableCard>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.savedItemSeparator} />}
        />
      )}
    </View>
  );

  // Update screen title based on mode
  React.useEffect(() => {
    navigation.setOptions({
      title: isSavedItemEditMode
        ? 'Edit Supplier Book Item'
        : isSavedItemCreateMode
        ? 'New Supplier Book Item'
        : supplierBookOnly
        ? 'Supplier Book'
        : isEditMode
        ? 'Edit Material'
        : 'Add Material',
      // Inside the Supplier Book, expose a "+" header button to add a new
      // supplier (with optional contact details) before any items have been
      // saved against it.
      headerRight: supplierBookOnly
        ? () => (
            <TouchableOpacity
              onPress={() => navigation.navigate('EditSupplier' as never)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ marginRight: 12 }}
            >
              <MaterialCommunityIcons
                name="account-plus-outline"
                size={22}
                color={colors.white}
              />
            </TouchableOpacity>
          )
        : undefined,
    });
  }, [isEditMode, isSavedItemEditMode, isSavedItemCreateMode, supplierBookOnly, navigation]);

  return (
    <View style={styles.container}>
      {/* Tab Selector - hidden in edit mode, saved-item modes, and supplier-book-only mode */}
      {!isEditMode && !isSavedItemMode && !supplierBookOnly && (
        <View ref={savedItemsTabRef} style={styles.tabBar}>
          <WebContainer>
            <View style={styles.pillToggleRow}>
              <TouchableOpacity
                style={[styles.pillToggleBtn, activeTab === 'search' && styles.pillToggleBtnActive]}
                onPress={() => setActiveTab('search')}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name="magnify"
                  size={16}
                  color={activeTab === 'search' ? '#FFFFFF' : colors.textMuted}
                  style={styles.pillToggleIcon}
                />
                <Text style={[styles.pillToggleText, activeTab === 'search' && styles.pillToggleTextActive]}>
                  Search & Add
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pillToggleBtn, activeTab === 'saved' && styles.pillToggleBtnActive]}
                onPress={() => setActiveTab('saved')}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name="format-list-bulleted"
                  size={16}
                  color={activeTab === 'saved' ? '#FFFFFF' : colors.textMuted}
                  style={styles.pillToggleIcon}
                />
                <Text style={[styles.pillToggleText, activeTab === 'saved' && styles.pillToggleTextActive]}>
                  Supplier Book
                </Text>
              </TouchableOpacity>
            </View>
          </WebContainer>
        </View>
      )}

      {/* Tab Content */}
      {supplierBookOnly
        ? renderSavedTab()
        : isEditMode || isSavedItemMode
        ? renderSearchTab()
        : activeTab === 'search'
        ? renderSearchTab()
        : renderSavedTab()}

      {/* Fixed Bottom Button — only for edit / saved-item modes */}
      {!supplierBookOnly && (isEditMode || isSavedItemMode) && (
        <FixedBottomButton
          label={
            isSavedItemMode
              ? (isSavedItemEditMode ? 'Save Changes' : 'Add to Supplier Book')
              : 'Update Material'
          }
          onPress={handleAddManually}
          icon="check"
        />
      )}

      {/* Manual Entry Bottom Sheet */}
      <BottomSheet
        visible={manualEntrySheetVisible}
        onDismiss={() => setManualEntrySheetVisible(false)}
        title="Add Manually"
        scrollable
        maxHeightRatio={0.92}
        footer={
          <View style={styles.manualSheetFooter}>
            <Button
              mode="contained"
              onPress={async () => {
                const success = await handleAddManually();
                if (success) setManualEntrySheetVisible(false);
              }}
              icon="plus"
              style={styles.manualSheetButton}
              contentStyle={styles.manualSheetButtonContent}
            >
              Add to Quote
            </Button>
          </View>
        }
      >
        {renderManualEntrySection()}
      </BottomSheet>

      {/* Bulk import action sheet (source picker) */}
      <ActionSheet
        visible={importSheetVisible}
        onDismiss={() => setImportSheetVisible(false)}
        title={importMode === 'refresh' ? 'Refresh existing list' : 'Import price list'}
        options={importSheetOptions}
      />

      {/* Multi-photo capture modal — replaces single-shot launchCameraAsync */}
      <SupplierListCaptureModal
        visible={captureModalVisible}
        onCancel={() => setCaptureModalVisible(false)}
        onComplete={handleCaptureComplete}
        processing={importLoading}
        processingLabel={importLoadingLabel}
      />

      {/* Delete a single supplier book item */}
      <AlertModal
        visible={deleteItemDialog.visible}
        onDismiss={() => setDeleteItemDialog({ visible: false, item: null })}
        type="error"
        icon="delete"
        title="Remove from supplier book"
        message={`Remove "${deleteItemDialog.item?.productName ?? ''}" from your supplier book?`}
        primaryButtonText="Remove"
        primaryButtonAction={confirmDeleteSavedItem}
        secondaryButtonText="Cancel"
        secondaryButtonAction={() => setDeleteItemDialog({ visible: false, item: null })}
        showConfetti={false}
      />

      {/* Delete an entire supplier (all items) */}
      <AlertModal
        visible={deleteSupplierDialog.visible}
        onDismiss={() => setDeleteSupplierDialog({ visible: false, supplier: '', count: 0 })}
        type="error"
        icon="delete-sweep"
        title={`Delete ${deleteSupplierDialog.supplier}?`}
        message={`This will permanently remove ${deleteSupplierDialog.count} item${deleteSupplierDialog.count === 1 ? '' : 's'} from your supplier book.`}
        primaryButtonText="Delete all"
        primaryButtonAction={confirmDeleteSupplier}
        secondaryButtonText="Cancel"
        secondaryButtonAction={() => setDeleteSupplierDialog({ visible: false, supplier: '', count: 0 })}
        showConfetti={false}
      />

      {/* Save as favorite after selecting a search result */}
      <AlertModal
        visible={saveFavoriteDialog.visible}
        onDismiss={handleDismissSaveFavorite}
        type="info"
        icon="bookmark-outline"
        title="Material Added"
        message="Save this product so it's used automatically next time?"
        primaryButtonText="Save"
        primaryButtonAction={handleConfirmSaveFavorite}
        secondaryButtonText="Not Now"
        secondaryButtonAction={handleDismissSaveFavorite}
        showConfetti={false}
      />

      {/* Unsaved-changes confirmation when navigating away */}
      <AlertModal {...unsavedModalProps} />

      {/* Review modal for extracted items */}
      <SupplierListReviewModal
        visible={reviewModalVisible}
        initialSupplierName={extractedSupplierName}
        initialItems={extractedItems}
        existingForDiff={importMode === 'refresh' ? existingForDiff : undefined}
        existingSupplierNames={existingSupplierNames}
        saving={savingImport}
        onCancel={() => {
          if (!savingImport) {
            setReviewModalVisible(false);
            setExtractedItems([]);
            setExtractedSupplierContact(undefined);
            setExistingForDiff(undefined);
          }
        }}
        onSave={handleSaveImported}
      />

      {/* Snackbar for save confirmation */}
      <Snackbar
        visible={snackbarVisible}
        onDismiss={() => setSnackbarVisible(false)}
        duration={3500}
      >
        {snackbarMessage}
      </Snackbar>

      {/* Screen Tour */}
      {!isEditMode && unifiedTourActive && unifiedTourPhase === 'addMaterial' && (
        <ScreenTour
          tourId="addMaterial"
          unifiedMode={true}
          onScreenComplete={() => notifyScreenComplete('addMaterial')}
          onSkipRequest={notifySkipRequest}
          stepOffset={PHASE_STEP_OFFSETS.addMaterial}
          globalTotalSteps={UNIFIED_TOUR_TOTAL_STEPS}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  tabBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tabContent: {
    flex: 1,
  },
  syncedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.primary + '1A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 6,
  },
  syncedBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.primary,
  },
  discoverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderRadius: 10,
  },
  discoverCardText: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
  },
  importCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: colors.primary + '14',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.primary + '38',
  },
  importCardIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.primary + '22',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  importCardBody: {
    flex: 1,
  },
  importCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.onSurface,
  },
  importCardSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textMuted,
  },
  importCardChevron: {
    marginLeft: 4,
  },
  addManuallyLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 4,
  },
  addManuallyLinkText: {
    marginLeft: 6,
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  advancedToggleText: {
    marginLeft: 4,
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  coverageHelper: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 8,
    lineHeight: 16,
  },
  linkedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary + '14',
    borderColor: colors.primary + '38',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  linkedBannerText: {
    flex: 1,
    marginLeft: 8,
    fontSize: 12,
    color: colors.text,
    fontWeight: '500',
  },
  // Pill toggle — same shape as the Hours/Days control on the labor screen.
  pillToggleRow: {
    flexDirection: 'row',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  pillToggleBtn: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  pillToggleIcon: {
    marginRight: 6,
  },
  pillToggleBtnActive: {
    backgroundColor: colors.primary,
  },
  pillToggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  pillToggleTextActive: {
    color: '#FFFFFF',
  },
  // Supplier section header — modeled on the materials-list section card header
  supplierHeader: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginTop: 12,
    marginBottom: 8,
    backgroundColor: colors.surface,
    borderRadius: 12,
  },
  supplierHeaderTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  supplierHeaderContactRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  supplierHeaderChevron: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supplierHeaderNameWrap: {
    flex: 1,
    paddingHorizontal: 4,
  },
  supplierHeaderName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  supplierHeaderCount: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  supplierHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  supplierHeaderActionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  savedItemSeparator: {
    height: 0,
  },
  scrollContent: {
    paddingBottom: 140,
  },
  section: {
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  manualEntryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  manualEntryDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  manualEntryHeaderText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.onSurface,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  searchTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  proSearchPrompt: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    gap: 8,
  },
  proSearchPromptText: {
    fontSize: 14,
    color: colors.onSurface,
    textAlign: 'center',
  },
  proSearchPromptCta: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  searchInput: {
    marginBottom: 16,
  },
  searchBarContainer: {
    marginBottom: 16,
    gap: 10,
  },
  searchBarInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingLeft: 12,
  },
  searchBarIcon: {
    marginRight: 4,
  },
  searchBarInput: {
    flex: 1,
    backgroundColor: 'transparent',
    height: 48,
  },
  searchBarInputContent: {
    paddingLeft: 0,
  },
  searchBarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    gap: 8,
  },
  searchBarButtonCancel: {
    backgroundColor: colors.textMuted,
  },
  searchBarButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  supplierChipsRow: {
    flexDirection: 'row',
    marginBottom: 12,
    maxHeight: 36,
  },
  supplierChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginRight: 8,
  },
  supplierChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  supplierChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textMuted,
  },
  supplierChipTextActive: {
    color: '#FFFFFF',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  loadingText: {
    marginLeft: 12,
    fontSize: 14,
    color: colors.onSurface,
  },
  resultsContainer: {
    marginTop: 8,
  },
  resultsHeader: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
    color: colors.onSurface,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  resultImage: {
    width: 60,
    height: 60,
    marginRight: 12,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resultInfo: {
    flex: 1,
  },
  resultName: {
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 4,
    color: colors.text,
  },
  resultDetails: {
    fontSize: 12,
    color: colors.onSurface,
    marginBottom: 4,
  },
  resultPrice: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: 4,
  },
  aiChip: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  aiChipText: {
    fontSize: 10,
  },
  recentChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  recentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    gap: 6,
  },
  recentChipName: {
    fontSize: 13,
    color: colors.text,
    maxWidth: 150,
  },
  recentChipPrice: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  divider: {
    marginVertical: 8,
  },
  input: {
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfWidth: {
    flex: 1,
  },
  quantityStepperContainer: {
    marginBottom: 12,
  },
  quantityLabel: {
    fontSize: 12,
    color: colors.onSurface,
    marginBottom: 6,
    marginLeft: 4,
  },
  quantityStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
    height: 48,
  },
  stepperButton: {
    width: 44,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityInput: {
    flex: 1,
    textAlign: 'center',
    backgroundColor: 'transparent',
    height: 48,
  },
  quantityInputContent: {
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
  },
  unitSelector: {
    marginBottom: 16,
  },
  unitLabel: {
    fontSize: 12,
    color: colors.onSurface,
    marginBottom: 8,
    marginLeft: 4,
  },
  unitButtons: {
    gap: 8,
  },
  unitRow: {
    marginBottom: 4,
  },
  categorySelector: {
    marginBottom: 16,
  },
  categoryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
  categoryButtonText: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
  },
  categoryList: {
    marginTop: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    maxHeight: 250,
    overflow: 'hidden',
  },
  categoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  categoryItemSelected: {
    backgroundColor: colors.primaryBg,
  },
  categoryItemText: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
  },
  categoryItemTextSelected: {
    color: colors.primary,
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingVertical: 8,
  },
  toggleLabel: {
    fontSize: 14,
    color: colors.text,
    flex: 1,
    marginRight: 12,
  },
  savedList: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  savedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginBottom: 8,
    borderRadius: 8,
    overflow: 'hidden',
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  savedIcon: {
    marginRight: 12,
  },
  savedItemImage: {
    width: 50,
    height: 50,
    marginRight: 12,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  savedInfo: {
    flex: 1,
  },
  savedNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  savedName: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
    flexShrink: 1,
  },
  myRateChip: {
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  myRateChipText: {
    color: colors.surface,
    fontSize: 11,
    fontWeight: '600',
  },
  personalRateFields: {
    marginTop: 4,
    marginBottom: 8,
    padding: 12,
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
    gap: 8,
  },
  personalRateHelper: {
    fontSize: 12,
    color: colors.onSurface,
    marginBottom: 4,
    lineHeight: 16,
  },
  savedDetails: {
    fontSize: 12,
    color: colors.onSurface,
    marginBottom: 2,
  },
  savedPrice: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: colors.onSurface,
    textAlign: 'center',
    lineHeight: 20,
  },
  cantFindItPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  cantFindItText: {
    marginLeft: 8,
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  addManuallySearchLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  addManuallySearchLinkText: {
    marginLeft: 8,
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  manualSheetFooter: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  manualSheetButton: {
    borderRadius: 12,
  },
  manualSheetButtonContent: {
    paddingVertical: 6,
  },
});
