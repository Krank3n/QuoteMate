/**
 * Add Material Screen
 * Modern full-screen UX for adding materials with tabs for Search/Manual and Saved Items
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
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
import { useAddMaterialStyles } from './AddMaterial/styles';
import { ManualEntrySection } from './AddMaterial/ManualEntrySection';
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
import { savedItemsSelectable } from './supplierBookMode';
import { withOrigin } from '../../utils/materialOrigin';

import { useStore } from '../../store/useStore';
import { useCurrentDocument, useDocumentMode } from '../../utils/documentMode';
import { Material, FavoriteProductMapping } from '../../types';
import { useThemeColors} from '../../theme';
import { formatCurrency, supplierPriceForGstMode } from '../../utils/quoteCalculator';
import { keepSupplierPriceInclusive } from '../../../shared/document';
import { ProBadge } from '../../components/ProBadge';
import { getReeceConnectionStatus } from '../../services/reeceApi';
import {
  loadFavoritesFromLocal,
  saveFavoriteProduct,
  removeFavoriteProduct,
  getExistingPersonalRateSuppliers,
  deleteAllFavoritesByStore,
  syncFavoritesFromCloud,
} from '../../services/materialFavorites';
import { AlertModal } from '../../components/AlertModal';
import * as ImagePicker from 'expo-image-picker';
import { SupplierListReviewModal } from '../../components/SupplierListReviewModal';
import { SupplierListCaptureModal } from '../../components/SupplierListCaptureModal';
import { SpreadsheetColumnMapperModal } from '../../components/SpreadsheetColumnMapperModal';
import { InvoiceReviewModal, type InvoiceReviewRow } from '../../components/InvoiceReviewModal';
import { useSupplierListImport } from '../../hooks/useSupplierListImport';
import { useInvoiceImport } from '../../hooks/useInvoiceImport';
import { MaterialItemCard } from '../../components/MaterialItemCard';
import { BottomSheet } from '../../components/BottomSheet';
import { ActionSheet, type ActionSheetOption } from '../../components/ActionSheet';
import { Snackbar } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FixedBottomButton } from '../../components/FixedBottomButton';
import { WebContainer } from '../../components/WebContainer';
import { SwipeableCard } from '../../components/SwipeableCard';
import { SupplierGroup } from '../../types';
import { loadGroups, deleteGroup } from '../../services/supplierGroupService';
import { runMaterialSearch } from '../../services/materialSearch';
import { ContactActionsBar } from '../../components/document/ContactActionsBar';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { GridBackground } from '../../components/GridBackground';

type TabValue = 'search' | 'saved';

// Memoized row for the search-results FlatList. Pulled out so the parent's
// re-renders don't force every visible row to re-render — the row only changes
// when its `item` reference or selected/disabled props change.
interface SearchResultRowProps {
  item: any;
  onSelect: (item: any) => void;
}

const SearchResultRow = React.memo(function SearchResultRow({ item, onSelect }: SearchResultRowProps) {
  const styles = useAddMaterialStyles();
  return (
    <TouchableOpacity
      style={styles.resultItem}
      onPress={() => onSelect(item)}
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
  );
});

// Stable separator — the previous `() => <Divider />` inline literal created a
// new function every render, defeating FlatList's renderer cache.
const ResultDivider = () => <Divider />;

// Memoized row for the Saved Items SectionList. Lifted out of the parent so
// the synthetic Material can be useMemo'd per `item` — previously rebuilt on
// every parent render, which busted MaterialItemCard's React.memo. With this
// row stable, scroll/state changes elsewhere in AddMaterialScreen no longer
// re-render every saved row.
interface SavedItemRowProps {
  item: any;
  isExpanded: boolean;
  selectable: boolean;
  editRouteName: string;
  onToggleExpand: (key: string) => void;
  onSelect: (item: any) => void;
  onEdit: (key: string) => void;
  onDelete: (item: any) => void;
}

const SavedItemRow = React.memo(function SavedItemRow({
  item,
  isExpanded,
  selectable,
  editRouteName,
  onToggleExpand,
  onSelect,
  onEdit,
  onDelete,
}: SavedItemRowProps) {
  const themeColors = useThemeColors();
  const styles = useAddMaterialStyles();
  const synthetic: Material = useMemo(() => {
    const storeLower = (item.store || '').toLowerCase();
    const isReeceItem = storeLower.includes('reece');
    const isBunningsItem = storeLower.includes('bunnings');
    return {
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
      bunningsItemNumber: !item.isPersonalRate && isBunningsItem ? item.itemNumber : undefined,
      reeceItemNumber: !item.isPersonalRate && isReeceItem ? item.itemNumber : undefined,
      pricingSource: item.isPersonalRate ? 'manual' : 'scraper',
      favoriteProduct: item as FavoriteProductMapping,
    };
  }, [item]);

  return (
    <SwipeableCard
      rightActions={[
        {
          icon: 'delete-outline',
          label: 'Delete',
          color: themeColors.error,
          bgColor: themeColors.errorSubtle,
          onPress: () => onDelete(item),
        },
      ]}
    >
      <MaterialItemCard
        material={synthetic}
        readOnly
        isExpanded={isExpanded}
        onToggleExpand={() => onToggleExpand(item.key)}
        onPress={selectable ? () => onSelect(item) : undefined}
        onOpenInStore={item.productUrl ? () => Linking.openURL(item.productUrl) : undefined}
        onEdit={() => onEdit(item.key)}
        onDelete={() => onDelete(item)}
      />
    </SwipeableCard>
  );
});

export function AddMaterialScreen() {
  const styles = useAddMaterialStyles();
  const themeColors = useThemeColors();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const safeInsets = useSafeAreaInsets();
  const mode = useDocumentMode();
  const { document: currentDocument, update: updateDocument } = useCurrentDocument();
  const { businessSettings, subscriptionStatus } = useStore();
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


  // Saved items state
  const [savedItems, setSavedItems] = useState<any[]>([]);
  const [isLoadingSaved, setIsLoadingSaved] = useState(false);

  // Bulk-import (supplier price list) — most state is owned by useSupplierListImport.
  // We keep importSheetVisible (action sheet UI), importMode (drives the hook's
  // refresh-mode option), and importPrefilledSupplier (passed in when the user
  // opens the import sheet scoped to a specific supplier).
  const [importSheetVisible, setImportSheetVisible] = useState(false);
  const [importMode, setImportMode] = useState<'new' | 'refresh'>('new');
  const [importPrefilledSupplier, setImportPrefilledSupplier] = useState<string>('');
  // Invoice import (current quote) — separate state so the source picker and
  // follow-up "save to supplier book?" dialog don't collide with price-list import.
  const [invoiceSheetVisible, setInvoiceSheetVisible] = useState(false);
  const [savePostInvoiceDialog, setSavePostInvoiceDialog] = useState<{
    visible: boolean;
    supplierName: string;
    rows: InvoiceReviewRow[];
  }>({ visible: false, supplierName: '', rows: [] });
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
      // The book screen reads the local cache; make sure a reinstall's cloud
      // copy has been pulled into it first (once per session).
      await syncFavoritesFromCloud();
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

  const importer = useSupplierListImport({
    mode: importMode === 'refresh' ? 'refresh' : 'add',
    prefilledSupplierName: importPrefilledSupplier,
    // AMS uses Alert.alert for import errors — preserve that pattern.
    onError: (msg) => Alert.alert('Import Failed', msg),
    // No-items + contact found → route to EditSupplier so the user can save
    // the contact-only supplier with full UX. Returning true short-circuits
    // the hook's default contact-only auto-save.
    onNoItemsWithContact: ({ supplierName, contact }) => {
      navigation.navigate(
        'EditSupplier' as never,
        {
          supplierName: supplierName || undefined,
          prefill: {
            contactPerson: contact.contactPerson,
            phone: contact.phone,
            email: contact.email,
            address: contact.address,
            website: contact.website,
          },
        } as never,
      );
      return true;
    },
    onSaved: async (summary) => {
      const total = summary.itemCount;
      const label = summary.supplierName ? ` from ${summary.supplierName}` : '';
      const contactSuffix =
        summary.contactFieldsApplied > 0
          ? ` • Added ${summary.contactFieldsApplied} contact detail${summary.contactFieldsApplied === 1 ? '' : 's'}`
          : '';
      const msg =
        total > 0
          ? `Saved ${total} item${total === 1 ? '' : 's'}${label}${
              summary.unchanged ? ` (${summary.unchanged} unchanged)` : ''
            }${contactSuffix}`
          : `No changes${summary.unchanged ? ` (${summary.unchanged} unchanged)` : ''}${contactSuffix}`;
      setSnackbarMessage(msg);
      setSnackbarVisible(true);
      // Pull the latest groups so newly merged contact details surface in
      // the Supplier Book header icons immediately.
      const refreshed = await loadGroups();
      setSupplierGroups(refreshed);
      await loadSavedItems();
    },
  });

  // Backwards-compatible aliases used elsewhere in this file.
  const importLoading =
    importer.phase === 'capturing' || importer.phase === 'extracting';
  const importLoadingLabel = importer.loadingLabel;
  const savingImport = importer.saving;

  const openImportSheet = (prefilledSupplier?: string) => {
    // When scoped to a specific supplier, check if that supplier already has
    // items — if so, default to refresh mode so the review modal shows a diff.
    const hasImported = prefilledSupplier
      ? savedItems.some((s: any) => s.store === prefilledSupplier)
      : savedItems.some((s: any) => s.source === 'imported');
    setImportMode(hasImported ? 'refresh' : 'new');
    setImportPrefilledSupplier(prefilledSupplier ?? '');
    setImportSheetVisible(true);
  };

  const launchImport = (source: 'camera' | 'gallery' | 'pdf' | 'spreadsheet') => {
    setImportSheetVisible(false);
    importer.startImport(source);
  };

  const importSheetOptions: ActionSheetOption[] = [
    { icon: 'camera', label: 'Take photo', onPress: () => launchImport('camera') },
    { icon: 'image-multiple', label: 'Pick from gallery', onPress: () => launchImport('gallery') },
    { icon: 'file-pdf-box', label: 'Pick PDF', onPress: () => launchImport('pdf') },
    {
      icon: 'file-table-outline',
      label: 'Pick CSV / Excel',
      onPress: () => launchImport('spreadsheet'),
    },
  ];

  const cancelSearch = useCallback(() => {
    searchCancelledRef.current = true;
    setIsSearching(false);
    setHasSearched(false);
  }, []);

  const handleSearch = useCallback(async () => {
    if (!isPro) {
      navigation.navigate('Paywall' as never, { source: 'add_material' } as never);
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

    const outcome = await runMaterialSearch(searchQuery, {
      businessSettings,
      supplierGroups,
      selectedSupplierGroupId: selectedSupplierGroup,
      reeceConnected,
      onReeceReauthRequired: () => setReeceConnected(false),
    });

    if (searchCancelledRef.current) return;

    if (outcome.error) {
      Alert.alert('Search Error', 'Failed to search products. Please try again.');
    } else {
      setSearchResults(outcome.results);
    }
    setIsSearching(false);
    setHasSearched(true);
  }, [searchQuery, businessSettings, isPro, navigation, supplierGroups, selectedSupplierGroup, reeceConnected]);

  const handleSelectProductImpl = async (item: any) => {
    let newMaterial: Material;
    const inclusive = keepSupplierPriceInclusive(currentQuote ?? {});
    const adjustedPrice = supplierPriceForGstMode(item.price || 0, inclusive);

    if (item.isAiEstimate) {
      newMaterial = {
        id: generateId(),
        name: item.productName,
        quantity: 1,
        unit: 'each',
        price: adjustedPrice,
        totalPrice: adjustedPrice,
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
        price: adjustedPrice,
        totalPrice: adjustedPrice,
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
        price: adjustedPrice,
        totalPrice: adjustedPrice,
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
        price: adjustedPrice,
        totalPrice: adjustedPrice,
        manualPriceOverride: false,
        searchTerm: item.description,
        pricingSource: 'manual',
      };
    }

    // Selecting a product from search is a hand-add — mark it manual (covers
    // every branch above: AI estimate, local source, scraper/Reece, fallback).
    newMaterial = withOrigin(newMaterial, 'manual');

    // Ask if user wants to save as a favorite for future quotes
    setSaveFavoriteDialog({ visible: true, material: newMaterial, item });
  };
  // Latest-ref + stable wrapper so SearchResultRow's React.memo isn't busted by
  // a new function identity every parent render.
  const handleSelectProductRef = useRef(handleSelectProductImpl);
  handleSelectProductRef.current = handleSelectProductImpl;
  const handleSelectProduct = useCallback(
    (item: any) => handleSelectProductRef.current(item),
    [],
  );

  const renderSearchResult = useCallback(
    ({ item }: { item: any }) => (
      <SearchResultRow item={item} onSelect={handleSelectProduct} />
    ),
    [handleSelectProduct],
  );

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
      const newMaterial: Material = withOrigin({
        id: generateId(),
        name: manualName.trim(),
        quantity,
        unit: manualUnit,
        price,
        totalPrice: price * quantity,
        manualPriceOverride: true,
        pricingSource: 'manual',
        section: selectedSection || undefined,
      } as Material, 'manual');

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

  // Latest-ref pattern: keep handleSelectSavedItem stable for SavedItemRow's
  // memo, while still calling the latest closure (state/refs may change between
  // renders). Without this, every render of AddMaterialScreen would bust the
  // saved-rows memo via prop-identity churn.
  const handleSelectSavedItemImpl = async (item: any) => {
    // Standalone "manage supplier book" mode (opened from Settings) has no
    // active quote — tapping an item should open it for editing instead.
    // Opened from a quote section (routeSection present), tapping ADDS the
    // item to that section like the normal Saved tab.
    if (!savedItemsSelectable({ supplierBookOnly, hasQuoteSection: !!routeSection })) {
      (navigation as any).push(editRouteName, { savedItemKey: item.key });
      return;
    }
    // Create material from saved template
    const price = item.price || 0;
    const isPersonalRate = item.isPersonalRate === true;
    // Strip the local-cache `key` field — favoriteProduct stores the
    // original favorite shape so future edits can sync back.
    const { key: _key, ...favShape } = item;
    const newMaterial: Material = withOrigin({
      id: generateId(),
      name: item.productName,
      quantity: 1,
      unit: (item.unit || 'each') as Material['unit'],
      price: price,
      totalPrice: price * 1,
      manualPriceOverride: isPersonalRate,
      searchTerm: item.productName,
      productUrl: isPersonalRate ? undefined : item.productUrl,
      bunningsItemNumber: isPersonalRate ? undefined : item.itemNumber,
      imageUrl: item.imageUrl,
      pricingSource: isPersonalRate || item.store === 'manual' ? 'manual' : 'scraper',
      favoriteProduct: favShape as FavoriteProductMapping,
    } as Material, 'manual');

    addMaterialToQuote(newMaterial);
  };
  const handleSelectSavedItemRef = useRef(handleSelectSavedItemImpl);
  handleSelectSavedItemRef.current = handleSelectSavedItemImpl;
  const handleSelectSavedItem = useCallback(
    (item: any) => handleSelectSavedItemRef.current(item),
    [],
  );

  const handleSelectRecentMaterial = (material: Material) => {
    const newMaterial: Material = {
      ...material,
      id: generateId(),
      quantity: 1,
      totalPrice: material.price * 1,
    };
    addMaterialToQuote(newMaterial);
  };

  const handleDeleteSavedItem = useCallback((item: any) => {
    setDeleteItemDialog({ visible: true, item });
  }, []);

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

  // Invoice import — declared here (not next to useSupplierListImport) because
  // it needs `addMaterialToQuote` in its options. Hooks are order-stable across
  // renders, so placement inside the component body is fine.
  const invoiceImporter = useInvoiceImport({
    addMaterialToQuote: (material, opts) => addMaterialToQuote(material, opts),
    selectedSection,
    onError: (msg) => Alert.alert('Import Failed', msg),
    onAddedToQuote: async ({ supplierName, itemCount, rows, contact }) => {
      const label = supplierName ? ` from ${supplierName}` : '';
      setSnackbarMessage(
        itemCount > 0
          ? `Added ${itemCount} item${itemCount === 1 ? '' : 's'}${label} to quote`
          : 'No items added',
      );
      setSnackbarVisible(true);

      // Contact merge happens inside the hook — refresh groups so any new
      // contact icons surface in the Supplier Book tab immediately.
      if (contact && supplierName) {
        try {
          const refreshed = await loadGroups();
          setSupplierGroups(refreshed);
        } catch {
          /* non-blocking */
        }
      }

      // Offer to persist the line items themselves to the supplier book.
      if (itemCount > 0 && supplierName) {
        setSavePostInvoiceDialog({ visible: true, supplierName, rows });
      }
    },
  });

  const openInvoiceSheet = () => setInvoiceSheetVisible(true);

  const launchInvoiceImport = (source: 'camera' | 'gallery' | 'pdf') => {
    setInvoiceSheetVisible(false);
    invoiceImporter.startImport(source);
  };

  const invoiceSheetOptions: ActionSheetOption[] = [
    { icon: 'camera', label: 'Take photo', onPress: () => launchInvoiceImport('camera') },
    { icon: 'image-multiple', label: 'Pick from gallery', onPress: () => launchInvoiceImport('gallery') },
    { icon: 'file-pdf-box', label: 'Pick PDF', onPress: () => launchInvoiceImport('pdf') },
  ];

  const confirmSaveInvoiceItemsToBook = async () => {
    const { supplierName, rows } = savePostInvoiceDialog;
    setSavePostInvoiceDialog({ visible: false, supplierName: '', rows: [] });
    try {
      const result = await invoiceImporter.saveToSupplierBook(supplierName, rows);
      if (result.itemCount > 0) {
        setSnackbarMessage(
          `Saved ${result.itemCount} item${result.itemCount === 1 ? '' : 's'} to your supplier book`,
        );
        setSnackbarVisible(true);
        await loadSavedItems();
      }
    } catch (err: any) {
      Alert.alert('Save Failed', err?.message || 'Could not save items to your supplier book.');
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
    <View style={styles.section}>
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
          onPress={() => navigation.navigate('Paywall' as never, { source: 'add_material' } as never)}
        >
          <MaterialCommunityIcons name="lock-outline" size={20} color={themeColors.textSecondary} />
          <Text style={styles.proSearchPromptText}>
            Search real product prices from hardware stores
          </Text>
          <Text style={styles.proSearchPromptCta}>Upgrade to Pro</Text>
        </TouchableOpacity>
      ) : (
      <View style={styles.searchBarContainer}>
        <View style={styles.searchBarInputWrap}>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            mode="flat"
            placeholder={selectedSupplierGroup ? `Search ${supplierGroups.find(g => g.id === selectedSupplierGroup)?.name || 'supplier'}` : 'Material name'}
            placeholderTextColor={themeColors.textMuted}
            style={styles.searchBarInput}
            contentStyle={styles.searchBarInputContent}
            underlineStyle={{ display: 'none' }}
            onSubmitEditing={() => { Keyboard.dismiss(); handleSearch(); }}
            returnKeyType="search"
            editable={!isSearching}
          />
          <TouchableOpacity
            style={[
              styles.searchBarButton,
              isSearching
                ? styles.searchBarButtonCancel
                : searchQuery.trim()
                  ? styles.searchBarButtonActive
                  : styles.searchBarButtonIdle,
            ]}
            onPress={
              isSearching
                ? cancelSearch
                : () => { Keyboard.dismiss(); handleSearch(); }
            }
            disabled={!isSearching && !searchQuery.trim()}
            activeOpacity={0.7}
            accessibilityLabel={isSearching ? 'Cancel search' : 'Search supplier catalogs'}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            {isSearching ? (
              <ActivityIndicator size="small" color={themeColors.onAccent} />
            ) : (
              <MaterialCommunityIcons
                name="magnify"
                size={22}
                color={searchQuery.trim() ? '#FFFFFF' : themeColors.accent}
              />
            )}
          </TouchableOpacity>
        </View>
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
            removeClippedSubviews
            initialNumToRender={10}
            maxToRenderPerBatch={6}
            windowSize={5}
            renderItem={renderSearchResult}
            ItemSeparatorComponent={ResultDivider}
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
          <MaterialCommunityIcons name="plus-circle-outline" size={20} color={themeColors.accentText} />
          <Text style={styles.cantFindItText}>Can't find it? Add manually</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  // Manual entry section component
  const linkedToSupplierBook = isEditMode && !!editingMaterial?.favoriteProduct;

  const renderManualEntrySection = () => (
    <ManualEntrySection
      materialNameRef={materialNameRef}
      linkedToSupplierBook={linkedToSupplierBook}
      isEditMode={isEditMode}
      isSavedItemMode={isSavedItemMode}
      isPro={isPro}
      existingSections={existingSections}
      savedItemSupplierOptions={savedItemSupplierOptions}
      manualName={manualName}
      setManualName={setManualName}
      manualPrice={manualPrice}
      setManualPrice={setManualPrice}
      manualQuantity={manualQuantity}
      setManualQuantity={setManualQuantity}
      manualUnit={manualUnit}
      setManualUnit={setManualUnit}
      selectedSection={selectedSection}
      setSelectedSection={setSelectedSection}
      showSectionPicker={showSectionPicker}
      setShowSectionPicker={setShowSectionPicker}
      isPersonalRate={isPersonalRate}
      setIsPersonalRate={setIsPersonalRate}
      supplierName={supplierName}
      setSupplierName={setSupplierName}
      supplierPickerOpen={supplierPickerOpen}
      setSupplierPickerOpen={setSupplierPickerOpen}
      rateKeywords={rateKeywords}
      setRateKeywords={setRateKeywords}
      showCoverageOptions={showCoverageOptions}
      setShowCoverageOptions={setShowCoverageOptions}
      coveragePerUnit={coveragePerUnit}
      setCoveragePerUnit={setCoveragePerUnit}
      coverageUnit={coverageUnit}
      setCoverageUnit={setCoverageUnit}
    />
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
          {/* Persistent fallback actions — mirrors the inline-add row's
              labelled action strip so the two surfaces feel consistent. */}
          <View style={styles.searchActionsRow}>
            <TouchableOpacity
              style={styles.searchActionBtn}
              onPress={() => setManualEntrySheetVisible(true)}
              activeOpacity={0.7}
              accessibilityLabel="Add manually"
            >
              <MaterialCommunityIcons name="pencil-plus-outline" size={18} color={themeColors.accentText} />
              <Text style={styles.searchActionLabel} numberOfLines={1}>Add manually</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.searchActionBtn}
              onPress={openInvoiceSheet}
              disabled={invoiceImporter.phase === 'extracting' || invoiceImporter.phase === 'capturing'}
              activeOpacity={0.7}
              accessibilityLabel="Add from invoice"
            >
              {invoiceImporter.phase === 'extracting' ? (
                <ActivityIndicator size="small" color={themeColors.accentText} />
              ) : (
                <MaterialCommunityIcons name="receipt" size={18} color={themeColors.accentText} />
              )}
              <Text style={styles.searchActionLabel} numberOfLines={1}>
                {invoiceImporter.phase === 'extracting'
                  ? (invoiceImporter.loadingLabel || 'Reading…')
                  : 'Add from invoice'}
              </Text>
            </TouchableOpacity>
          </View>
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
          <ActivityIndicator size="small" color={themeColors.accentText} />
        ) : (
          <MaterialCommunityIcons
            name="cloud-upload-outline"
            size={28}
            color={themeColors.accentText}
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
          color={themeColors.textSecondary}
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
      <MaterialCommunityIcons name="plus-circle-outline" size={18} color={themeColors.accentText} />
      <Text style={styles.addManuallyLinkText}>Add an item manually</Text>
    </TouchableOpacity>
  );

  // Stable callbacks used by SavedItemRow. Keeping them out of the inline
  // renderItem lets React.memo on SavedItemRow actually skip re-renders.
  const handleToggleSavedExpand = useCallback((key: string) => {
    setExpandedSavedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleEditSavedItem = useCallback(
    (key: string) => {
      (navigation as any).push(editRouteName, { savedItemKey: key });
    },
    [navigation, editRouteName],
  );

  const renderSavedItem = useCallback(
    ({ item }: { item: any }) => (
      <SavedItemRow
        item={item}
        isExpanded={expandedSavedItems.has(item.key)}
        selectable={savedItemsSelectable({ supplierBookOnly, hasQuoteSection: !!routeSection })}
        editRouteName={editRouteName}
        onToggleExpand={handleToggleSavedExpand}
        onSelect={handleSelectSavedItem}
        onEdit={handleEditSavedItem}
        onDelete={handleDeleteSavedItem}
      />
    ),
    [expandedSavedItems, supplierBookOnly, routeSection, editRouteName, handleToggleSavedExpand, handleSelectSavedItem, handleEditSavedItem, handleDeleteSavedItem],
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
        <MaterialCommunityIcons name="store-search-outline" size={22} color={themeColors.accentText} style={{ marginRight: 10 }} />
        <Text style={styles.discoverCardText}>Discover Supplier Partners</Text>
        <MaterialCommunityIcons name="chevron-right" size={20} color={themeColors.textSecondary} />
      </TouchableOpacity>
      {renderAddManuallyLink()}
      {isLoadingSaved ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={themeColors.accentText} />
          <Text style={styles.loadingText}>Loading supplier book...</Text>
        </View>
      ) : savedItems.length === 0 && savedSections.length === 0 ? (
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="format-list-bulleted" size={64} color={themeColors.textSecondary} />
          <Text style={styles.emptyStateTitle}>Your supplier book is empty</Text>
          <Text style={styles.emptyStateText}>
            Snap a supplier's price sheet, or save items from the Search tab as you go — once it's stocked, every quote gets a head start.
          </Text>
        </View>
      ) : (
        <SectionList
          sections={savedSections}
          keyExtractor={(item) => item.key}
          contentContainerStyle={[styles.savedList, { paddingBottom: safeInsets.bottom + 24 }]}
          stickySectionHeadersEnabled={false}
          removeClippedSubviews
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          windowSize={7}
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
                      color={themeColors.textMuted}
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
                        <MaterialCommunityIcons name="sync" size={11} color={themeColors.accentText} />
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
                        <MaterialCommunityIcons name="camera-plus-outline" size={18} color={themeColors.textMuted} />
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
                        <MaterialCommunityIcons name="pencil-outline" size={18} color={themeColors.textMuted} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDeleteSupplier(title, count)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={styles.supplierHeaderActionBtn}
                      >
                        <MaterialCommunityIcons name="delete-outline" size={18} color={themeColors.textMuted} />
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
          renderItem={renderSavedItem}
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
                color={themeColors.text}
              />
            </TouchableOpacity>
          )
        : undefined,
    });
  }, [isEditMode, isSavedItemEditMode, isSavedItemCreateMode, supplierBookOnly, navigation]);

  return (
    <View style={styles.container}>
      <GridBackground />
      {/* Tab Selector - hidden in edit mode, saved-item modes, and supplier-book-only mode */}
      {!isEditMode && !isSavedItemMode && !supplierBookOnly && (
        <View style={styles.tabBar}>
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
                  color={activeTab === 'search' ? '#FFFFFF' : themeColors.textMuted}
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
                  color={activeTab === 'saved' ? '#FFFFFF' : themeColors.textMuted}
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
              mode="contained" buttonColor={themeColors.accent} textColor={themeColors.onAccent}
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
        subtitle={
          importMode === 'refresh'
            ? "Prices crept up again? Snap the new sheet and we'll refresh your book without you bashing in a single line."
            : "Snap your supplier's price sheet, drop in a PDF, or upload a CSV / Excel export — we'll sort it into your book so next time you're quoting, the prices are already in your pocket."
        }
        options={importSheetOptions}
      />

      {/* Multi-photo capture modal — replaces single-shot launchCameraAsync */}
      <SupplierListCaptureModal
        visible={importer.captureModalVisible}
        onCancel={importer.cancelCapture}
        onComplete={importer.handleCaptureComplete}
        processing={importer.phase === 'extracting'}
        processingLabel={importer.loadingLabel}
      />

      {/* Invoice/receipt source picker — separate from price-list import. */}
      <ActionSheet
        visible={invoiceSheetVisible}
        onDismiss={() => setInvoiceSheetVisible(false)}
        title="Add from invoice"
        options={invoiceSheetOptions}
      />

      {/* Invoice capture modal — same component, separate hook state. */}
      <SupplierListCaptureModal
        visible={invoiceImporter.captureModalVisible}
        onCancel={invoiceImporter.cancelCapture}
        onComplete={invoiceImporter.handleCaptureComplete}
        processing={invoiceImporter.phase === 'extracting'}
        processingLabel={invoiceImporter.loadingLabel}
      />

      {/* Invoice review modal — confirm extracted line items + quantities. */}
      <InvoiceReviewModal
        visible={invoiceImporter.reviewModalVisible}
        initialSupplierName={invoiceImporter.extractedSupplierName}
        initialItems={invoiceImporter.extractedItems}
        saving={invoiceImporter.saving}
        onCancel={invoiceImporter.cancelReview}
        onConfirm={invoiceImporter.handleAddToQuote}
      />

      {/* Post-invoice: offer to persist the items to the supplier book too. */}
      <AlertModal
        visible={savePostInvoiceDialog.visible}
        onDismiss={() =>
          setSavePostInvoiceDialog({ visible: false, supplierName: '', rows: [] })
        }
        type="info"
        icon="bookmark-outline"
        title="Save to supplier book?"
        message={`Also save these ${savePostInvoiceDialog.rows.length} item${
          savePostInvoiceDialog.rows.length === 1 ? '' : 's'
        } from ${savePostInvoiceDialog.supplierName || 'this supplier'} so they're available next time?`}
        primaryButtonText="Save"
        primaryButtonAction={confirmSaveInvoiceItemsToBook}
        secondaryButtonText="Not Now"
        secondaryButtonAction={() =>
          setSavePostInvoiceDialog({ visible: false, supplierName: '', rows: [] })
        }
        showConfetti={false}
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

      {/* Column mapper for CSV / XLSX imports when auto-detect fails */}
      <SpreadsheetColumnMapperModal
        visible={importer.columnMappingVisible}
        parsed={importer.parsedSpreadsheet}
        initialMapping={importer.autoDetectedMapping}
        onCancel={importer.cancelColumnMapping}
        onConfirm={importer.applyColumnMapping}
      />

      {/* Review modal for extracted items */}
      <SupplierListReviewModal
        visible={importer.reviewModalVisible}
        initialSupplierName={importer.extractedSupplierName}
        initialItems={importer.extractedItems}
        existingForDiff={importMode === 'refresh' ? importer.existingForDiff : undefined}
        existingSupplierNames={importer.existingSupplierNames}
        saving={importer.saving}
        onCancel={importer.cancelReview}
        onSave={importer.handleSaveImported}
      />

      {/* Snackbar for save confirmation */}
      <Snackbar
        visible={snackbarVisible}
        onDismiss={() => setSnackbarVisible(false)}
        duration={3500}
      >
        {snackbarMessage}
      </Snackbar>

    </View>
  );
}
