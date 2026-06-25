/**
 * Materials List Screen
 * View, edit, add, and delete materials with Bunnings pricing
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Platform,
  Linking,
  Animated,
  TextInput as RNTextInput,
  Alert,
  FlatList,
} from 'react-native';
import {
  Text,
  Button,
  List,
  IconButton,
  Portal,
  Modal,
  TextInput,
  ActivityIndicator,
  Surface,
  Snackbar,
} from 'react-native-paper';
import { useNavigation, useIsFocused, useRoute } from '@react-navigation/native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import LottieView from 'lottie-react-native';
import { generateId } from '../../utils/generateId';
import { lightTap } from '../../utils/haptics';

import { useStore } from '../../store/useStore';
import { useCurrentDocument, useDocumentMode, usePersistDocument, UnifiedDocument } from '../../utils/documentMode';
import { Material, QuoteSection, LaborUnit, SectionTemplate, FavoriteProductMapping, SupplierGroup } from '../../types';
import { loadTemplates, saveTemplate, matchTemplatesByKeywords, extractQuantityForKeyword, suggestKeywordsFromName } from '../../services/sectionTemplateService';
import { colors } from '../../theme';
import { formatCurrency, updateMaterialTotalPrice, supplierPriceForGstMode } from '../../utils/quoteCalculator';
import { parsePackInfo } from '../../utils/parsePackInfo';
import { applyPackAwarePricing } from '../../utils/packAwarePricing';
import {
  generateMaterialsForQuote,
  fetchPricesForQuote,
  PipelineCancelled,
} from '../../services/materialsPipeline';
import { searchMaterialPrice } from '../../services/webSearchPricing';
import { searchReeceMaterialPrice, searchReeceMaterialCandidates, getReeceConnectionStatus } from '../../services/reeceApi';
import { shouldRunReeceFirst } from '../../services/supplierPriority';
// llmService is lazy-imported inside the handlers that need it to keep this
// screen's mount cheap — see Phase 7 of the perf plan.
import { getTradeCategoryById, getTradeNicheById, TRADE_CATEGORIES } from '../../constants/tradeCategories';
import { MaterialItemCard } from '../../components/MaterialItemCard';
import { FloorplanTakeoffCard } from '../../components/FloorplanTakeoffCard';
import { InlineAddMaterialRow } from '../../components/InlineAddMaterialRow';
import { ActionSheet, type ActionSheetOption } from '../../components/ActionSheet';
import { SupplierListCaptureModal } from '../../components/SupplierListCaptureModal';
import { InvoiceReviewModal } from '../../components/InvoiceReviewModal';
import { useInvoiceImport } from '../../hooks/useInvoiceImport';
import { CollapsibleSection } from '../../components/CollapsibleSection';
import { notificationService } from '../../services/notificationService';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';

// Row item shape consumed by the materials list renderer. Lifted to module
// scope so React.memo'd row components can refer to it without rebuilding
// the type each render.
type FlatItem =
  | { type: 'header'; key: string; sectionName: string }
  | { type: 'material'; key: string; material: Material }
  | { type: 'footer'; key: string; sectionName: string; subtotal: number };

// Helper to get section display info
function getSectionInfo(sectionName: string | undefined): { name: string; color: string } {
  if (!sectionName) {
    return { name: 'General', color: colors.onSurface };
  }
  return { name: sectionName, color: colors.primary };
}

// Legacy helper for trade category grouping
function getCategoryInfo(categoryId: string | undefined): { name: string; color: string } {
  if (!categoryId) {
    return { name: 'General', color: colors.onSurface };
  }
  const category = TRADE_CATEGORIES.find(c => c.id === categoryId);
  if (category) {
    return { name: category.name, color: category.color };
  }
  return { name: 'General', color: colors.onSurface };
}

// Helper to group materials by section (preferred) or category (fallback)
function groupMaterialsByCategory(materials: Material[]): Map<string, { info: { name: string; color: string }; materials: Material[] }> {
  // Determine if we should group by section or category
  const hasAnySections = materials.some(m => m.section);

  const grouped = new Map<string, Material[]>();

  materials.forEach(material => {
    const groupKey = hasAnySections
      ? (material.section || '')
      : (material.category || '');
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, []);
    }
    grouped.get(groupKey)!.push(material);
  });

  // Sort: grouped items first (alphabetically), then ungrouped
  const sortedKeys = Array.from(grouped.keys()).sort((a, b) => {
    if (a === '' && b !== '') return 1;
    if (a !== '' && b === '') return -1;
    return a.localeCompare(b);
  });

  const result = new Map<string, { info: { name: string; color: string }; materials: Material[] }>();
  sortedKeys.forEach(key => {
    const info = hasAnySections ? getSectionInfo(key) : getCategoryInfo(key);
    result.set(key, { info, materials: grouped.get(key)! });
  });

  return result;
}
import {
  searchMaterialWithWebScraping,
  ProductMatch,
  getBestMatch,
} from '../../services/webScrapingPricing';
import {
  getFavoriteProduct,
  saveFavoriteProduct,
  loadAllFavoritesForLLM,
  loadFavoritesFromLocal,
} from '../../services/materialFavorites';
import { searchLocalSources, type LocalSearchResult } from '../../services/localMaterialSearch';
import { loadGroups as loadSupplierGroups } from '../../services/supplierGroupService';
import MaterialMatchSelector from '../../components/MaterialMatchSelector';
import {
  findBestMatchForMaterial,
  findCandidatesForMaterial,
  ScraperProduct,
  batchFindBestMatchesProgressive,
} from '../../services/bunningsScraperClient';
import { FixedBottomButton } from '../../components/FixedBottomButton';
import { WebContainer } from '../../components/WebContainer';
import { AlertModal } from '../../components/AlertModal';
import { ProBadge } from '../../components/ProBadge';

/**
 * Recompute material qty/total from a priced product, dividing by pack size
 * when the product is sold as a pack/length/roll. Without this, a quote that
 * needs 750 individual screws and pulls back the price of a 500-pack
 * multiplies $73 × 750 — the bug that turned a $20k deck into $200k.
 *
 * Captures the original requirement into `requiredQty` on first pricing so
 * subsequent re-prices can recompute pack counts from the true need rather
 * than from a stale pack count.
 *
 * Only applies pack division when the requirement unit is compatible with the
 * pack unit (each↔each, m↔m, m²↔m², m³↔m³, kg↔kg, L↔L). Without this guard,
 * a "60 each" concrete-bag requirement priced against a "20kg" SKU would
 * divide 60/20=3 bags — wrong, because "60 each" already means 60 bags. With
 * the guard, a "1275 kg" bedding-sand requirement priced against a "20kg bag"
 * SKU divides to 64 bags (correct).
 */
// AI Analysis Loading State with Lottie Animation and scrolling progress steps
const AI_STEPS = [
  { icon: 'file-document-outline', text: 'Reading job description...' },
  { icon: 'head-cog-outline', text: 'Understanding scope of work...' },
  { icon: 'clipboard-list-outline', text: 'Generating materials list...' },
  { icon: 'tape-measure', text: 'Calculating quantities...' },
  { icon: 'group', text: 'Grouping by work sections...' },
  { icon: 'check-circle-outline', text: 'Finalizing materials...' },
];

const STEP_HEIGHT = 32;
const VISIBLE_STEPS = 3;
const STEP_INTERVAL = 2500;

function AiAnalyzingState() {
  const animationRef = React.useRef<LottieView>(null);
  const [currentStep, setCurrentStep] = React.useState(0);
  const scrollAnim = React.useRef(new Animated.Value(0)).current;
  const stepOpacities = React.useRef(AI_STEPS.map((_, i) => new Animated.Value(i === 0 ? 1 : 0))).current;

  React.useEffect(() => {
    if (animationRef.current) {
      animationRef.current.play();
    }
  }, []);

  React.useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    AI_STEPS.forEach((_, index) => {
      if (index === 0) return;
      const timer = setTimeout(() => {
        setCurrentStep(index);

        // Fade in the new step
        Animated.timing(stepOpacities[index], {
          toValue: 1,
          duration: 350,
          useNativeDriver: true,
        }).start();

        // Scroll up once we have more than VISIBLE_STEPS
        if (index >= VISIBLE_STEPS) {
          Animated.timing(scrollAnim, {
            toValue: (index - VISIBLE_STEPS + 1) * STEP_HEIGHT,
            duration: 400,
            useNativeDriver: true,
          }).start();

          // Fade out the step that's scrolling off the top
          const fadeOutIndex = index - VISIBLE_STEPS;
          if (fadeOutIndex >= 0) {
            Animated.timing(stepOpacities[fadeOutIndex], {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }).start();
          }
        }
      }, index * STEP_INTERVAL);
      timers.push(timer);
    });

    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <View style={styles.aiAnalyzingContainer}>
      <View style={styles.lottieWrapper}>
        <LottieView
          ref={animationRef}
          source={require('../../../assets/materials-loading.json')}
          autoPlay={true}
          loop={true}
          speed={1}
          style={styles.lottieAnimation}
          resizeMode="contain"
        />
      </View>

      <Text style={styles.aiAnalyzingTitle}>Analysing your job...</Text>

      <View style={styles.stepsWindow}>
        <Animated.View
          style={[
            styles.stepsTrack,
            { transform: [{ translateY: Animated.multiply(scrollAnim, -1) }] },
          ]}
        >
          {AI_STEPS.map((step, index) => (
            <Animated.View
              key={index}
              style={[
                styles.stepRow,
                { opacity: stepOpacities[index] },
              ]}
            >
              <MaterialCommunityIcons
                name={index < currentStep ? 'check-circle' as any : step.icon as any}
                size={16}
                color={index < currentStep ? colors.success : index === currentStep ? colors.primary : colors.textMuted}
              />
              <Text
                style={[
                  styles.stepText,
                  index < currentStep && styles.stepTextDone,
                  index === currentStep && styles.stepTextActive,
                ]}
                numberOfLines={1}
              >
                {step.text}
              </Text>
            </Animated.View>
          ))}
        </Animated.View>
      </View>

    </View>
  );
}

// Format time ago helper
function formatTimeAgo(isoTimestamp: string): string {
  const now = new Date();
  const then = new Date(isoTimestamp);
  const secondsAgo = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (secondsAgo < 60) {
    return 'Just now';
  } else if (secondsAgo < 3600) {
    const minutes = Math.floor(secondsAgo / 60);
    return `${minutes} min${minutes > 1 ? 's' : ''} ago`;
  } else if (secondsAgo < 86400) {
    const hours = Math.floor(secondsAgo / 3600);
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  } else {
    const days = Math.floor(secondsAgo / 86400);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }
}


const CHASING_TITLES = [
  'Chasing Prices',
  'Hunting Bargains',
  'Shaking Down Suppliers',
  'Price Snooping',
  'Deal Detective',
  'Bargain Patrol',
];

const CHASING_SUBTITLES = [
  'Haggling item',
  'Interrogating',
  'Sweet-talking',
  'Arm-wrestling over',
  'Running down',
  'Squeezing a deal on',
];

const TIME_FUN_FACTS = [
  { minSeconds: 10, text: 'Enough time to crack your knuckles' },
  { minSeconds: 20, text: 'You could do 20 star jumps right now' },
  { minSeconds: 30, text: 'Perfect time to stretch your legs' },
  { minSeconds: 45, text: 'You could make a cup of tea' },
  { minSeconds: 60, text: 'Long enough to practise your invoice voice' },
  { minSeconds: 90, text: 'You could microwave a pie' },
  { minSeconds: 120, text: 'Enough time to scroll TikTok... but don\'t' },
  { minSeconds: 180, text: 'You could soft-boil an egg' },
  { minSeconds: 240, text: 'Time to reorganise your ute' },
  { minSeconds: 300, text: 'You could mow half the front lawn' },
];

function getTimeFunFact(seconds: number): string | null {
  // Find the highest threshold that the time exceeds
  let best: string | null = null;
  for (const fact of TIME_FUN_FACTS) {
    if (seconds >= fact.minSeconds) best = fact.text;
  }
  return best;
}

const EMPTY_MATERIALS_MESSAGES = [
  { title: 'Nothing to build with', subtitle: 'Pick how you want to load up' },
  { title: "Bare bones over here", subtitle: "Let's get some materials on the list" },
  { title: 'Empty toolbox', subtitle: 'Time to stock up' },
  { title: "Where's the gear?", subtitle: 'Add some materials to get rolling' },
  { title: 'Starting from scratch', subtitle: 'Every great build starts here' },
];

export function MaterialsListScreen() {
  const emptyMessage = useMemo(() => EMPTY_MATERIALS_MESSAGES[Math.floor(Math.random() * EMPTY_MATERIALS_MESSAGES.length)], []);
  const chasingTitle = useMemo(() => CHASING_TITLES[Math.floor(Math.random() * CHASING_TITLES.length)], []);
  const chasingSubtitle = useMemo(() => CHASING_SUBTITLES[Math.floor(Math.random() * CHASING_SUBTITLES.length)], []);
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const isEditFromPreview = route.params?.editing === true;
  const isFocused = useIsFocused();
  const mode = useDocumentMode();
  const { document: currentDocument, update: updateDocument } = useCurrentDocument();
  // Per-field selectors so MaterialsListScreen only re-renders when its
  // actual reads change — not on every quote/invoice/contact store write.
  const businessSettings = useStore((s) => s.businessSettings);
  const subscriptionStatus = useStore((s) => s.subscriptionStatus);
  const saveDraft = usePersistDocument();
  const storeUpdateQuote = useStore((s) => s.updateQuote);
  const isTrialActive = !!(subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired);
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  // For compatibility, alias to currentQuote (used throughout this file)
  const currentQuote = currentDocument;
  const updateQuote = updateDocument;

  const [isFetchingPrices, setIsFetchingPrices] = useState(false);
  const [fetchingMaterialId, setFetchingMaterialId] = useState<string | null>(null);
  const [fetchProgress, setFetchProgress] = useState({ current: 0, total: 0 });
  const [fetchedItemNames, setFetchedItemNames] = useState<{ name: string; success: boolean }[]>([]);
  const [currentFetchingName, setCurrentFetchingName] = useState<string>('');
  const [fetchPhase, setFetchPhase] = useState<'idle' | 'batch' | 'applying' | 'individual'>('idle');
  const [batchItemStatuses, setBatchItemStatuses] = useState<Map<string, 'pending' | 'searching' | 'done' | 'failed'>>(new Map());
  const [batchChunkProgress, setBatchChunkProgress] = useState({ current: 0, total: 0 });

  // True when this material is currently being fetched, whether via:
  //  - a single-material refresh (fetchingMaterialId), or
  //  - a batch chunk that includes this material (batchItemStatuses === 'searching')
  // Used to drive the per-row spinner so the user sees activity on every item
  // currently in flight, not just one at a time.
  const isMaterialFetching = useCallback(
    (material: { id: string; searchTerm?: string; name: string }): boolean => {
      if (fetchingMaterialId === material.id) return true;
      if (fetchPhase !== 'batch') return false;
      const term = material.searchTerm || material.name;
      return batchItemStatuses.get(term) === 'searching';
    },
    [fetchingMaterialId, fetchPhase, batchItemStatuses],
  );
  const cancelFetchRef = useRef(false);
  const cancelFetchResolverRef = useRef<(() => void) | null>(null);
  const [recentlyPricedIds, setRecentlyPricedIds] = useState<Set<string>>(new Set());
  const priceFlashAnims = useRef<Map<string, Animated.Value>>(new Map());
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [initialMaterialCount, setInitialMaterialCount] = useState(0);
  const [cancelGeneration, setCancelGeneration] = useState(false);
  // Mirror cancelGeneration as a ref so the running pipeline's shouldCancel
  // callback can see the latest value — reading the state directly inside
  // an in-flight async closure always returns the value captured at call time
  // (always false here, since we setCancelGeneration(false) immediately
  // before invoking the pipeline). The ref bridges that gap.
  const cancelGenerationRef = useRef(false);
  useEffect(() => {
    cancelGenerationRef.current = cancelGeneration;
  }, [cancelGeneration]);

  // Whether the user has connected their Reece account. Drives the Reece
  // pricing branch in fetchPrices() and the "Connect Reece" banner shown
  // when Reece is selected as the store but no connection exists yet.
  const [reeceConnected, setReeceConnected] = useState<boolean | null>(null);
  const [reeceReauthNeeded, setReeceReauthNeeded] = useState(false);
  // Reece is now an always-on overlay for any user who has connected — not
  // gated on a single hardware-store setting. Refresh on focus so returning
  // from the Reece settings screen reflects the new connection state.
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
  }, [isFocused]);

  // Supplier groups powering the inline-add row's catalog search and the
  // invoice-importer's per-supplier review. Loaded once on focus so new
  // suppliers added on the settings screen reflect when returning.
  const [supplierGroups, setSupplierGroups] = useState<SupplierGroup[]>([]);
  useEffect(() => {
    let cancelled = false;
    loadSupplierGroups()
      .then((groups) => {
        if (!cancelled) setSupplierGroups(groups);
      })
      .catch(() => {
        /* non-blocking */
      });
    return () => {
      cancelled = true;
    };
  }, [isFocused]);

  // Invoice import — surfaces a 📄 button next to each section's inline add
  // row. The targeted section is captured before opening the ActionSheet so
  // the extracted line items land in the section they were triggered from.
  const [invoiceSheetVisible, setInvoiceSheetVisible] = useState(false);
  const [invoiceTargetSection, setInvoiceTargetSection] = useState<string | undefined>(undefined);
  const [invoiceSnackbar, setInvoiceSnackbar] = useState<string | null>(null);

  // The material currently being edited in-place (its row swaps from
  // MaterialItemCard to InlineAddMaterialRow in edit mode). null = no row
  // is being edited.
  const [editingMaterialId, setEditingMaterialId] = useState<string | null>(null);

  // Shared "append a material to the current quote" used by both the inline
  // quick-add row and the invoice importer. Spread pattern matches every
  // other mutation in this screen so the same React-batched update flow
  // applies.
  const addMaterialToQuoteInline = useCallback((material: Material) => {
    if (!currentQuote) return;
    updateQuote({
      ...currentQuote,
      materials: [...(currentQuote.materials || []), material],
    });
  }, [currentQuote, updateQuote]);

  const invoiceImporter = useInvoiceImport({
    addMaterialToQuote: (material) => addMaterialToQuoteInline(material),
    selectedSection: invoiceTargetSection,
    onError: (msg) => Alert.alert('Import Failed', msg),
    onAddedToQuote: ({ supplierName, itemCount }) => {
      const label = supplierName ? ` from ${supplierName}` : '';
      setInvoiceSnackbar(
        itemCount > 0
          ? `Added ${itemCount} item${itemCount === 1 ? '' : 's'}${label} to quote`
          : 'No items added',
      );
    },
  });

  const launchInvoiceImport = useCallback((source: 'camera' | 'gallery' | 'pdf') => {
    setInvoiceSheetVisible(false);
    invoiceImporter.startImport(source);
  }, [invoiceImporter]);

  const invoiceSheetOptions: ActionSheetOption[] = [
    { icon: 'camera', label: 'Take photo', onPress: () => launchInvoiceImport('camera') },
    { icon: 'image-multiple', label: 'Pick from gallery', onPress: () => launchInvoiceImport('gallery') },
    { icon: 'file-pdf-box', label: 'Pick PDF', onPress: () => launchInvoiceImport('pdf') },
  ];

  const openInvoiceForSection = useCallback((sectionName: string) => {
    setInvoiceTargetSection(sectionName || undefined);
    setInvoiceSheetVisible(true);
  }, []);

  const openSupplierBookForSection = useCallback((sectionName: string) => {
    navigation.navigate('AddMaterial', {
      section: sectionName,
      supplierBookOnly: true,
    });
  }, [navigation]);

  // Stable handler for the rare Reece-reauth case — passing the setter
  // directly would be unstable on every render. Tradies don't hit this
  // often but the memoized inline-add row relies on identity stability.
  const handleReeceReauthRequired = useCallback(() => setReeceConnected(false), []);

  // ─────────────────────────────────────────────────────────────────────
  // Unsaved-changes guard
  //
  // Materials editing trickles many tiny mutations into currentQuote via
  // inline updateQuote calls — quantities, prices, sections, ordering, etc.
  // Without a guard, swiping back would carry all those changes through to
  // wherever currentQuote is read next, even if the user changed their mind.
  //
  // Snapshot the document on first focus so we can:
  //   - "Save" → persist via saveDraft (the same flow as the explicit Next/Back buttons)
  //   - "Discard" → revert currentQuote to the snapshot, throwing away the edits
  // ─────────────────────────────────────────────────────────────────────
  const documentSnapshotRef = useRef<string | null>(null);
  const documentSnapshotObjRef = useRef<UnifiedDocument | null>(null);

  // Capture once on mount, then leave alone — subsequent edits are exactly
  // what we want to diff against this baseline.
  useEffect(() => {
    if (!documentSnapshotRef.current && currentQuote) {
      documentSnapshotRef.current = JSON.stringify(currentQuote);
      documentSnapshotObjRef.current = currentQuote;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuote?.id]);

  const isDirty = useMemo(() => {
    if (!documentSnapshotRef.current || !currentQuote) return false;
    return JSON.stringify(currentQuote) !== documentSnapshotRef.current;
  }, [currentQuote]);

  const { unsavedModalProps, allowNextNavigation } = useUnsavedChangesGuard({
    isDirty,
    onSave: async () => {
      if (!currentQuote) return true;
      // MUST await saveDraft. saveDraft does `await AsyncStorage.setItem(...)`
      // BEFORE calling `set({ quotes, currentQuote })`. If we don't await here,
      // the hook will navigate away before that set() runs, and the destination
      // screen (e.g. ViewQuoteScreen) reads a stale `quotes` array and shows
      // pre-edit data — making the save look like it didn't happen.
      // The Firestore portion stays fire-and-forget (saveDraft handles it
      // internally with the pending-write tracking from Commit B).
      await saveDraft(currentQuote);
      return true;
    },
    onDiscard: () => {
      // Revert currentQuote to the on-mount snapshot so the in-memory edits
      // disappear before the destination screen renders.
      const snapshot = documentSnapshotObjRef.current;
      if (snapshot) {
        updateQuote(snapshot);
      }
    },
  });

  // Product search state - REMOVED: Now handled by AddMaterialScreen

  // Delete confirmation dialog state
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [materialToDelete, setMaterialToDelete] = useState<string | null>(null);

  // Unpriced materials warning dialog state
  const [unpricedDialogVisible, setUnpricedDialogVisible] = useState(false);

  // Success modal state
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [successTitle, setSuccessTitle] = useState('Success!');
  const [successType, setSuccessType] = useState<'success' | 'warning' | 'error' | 'info'>('success');
  const [successShowFetchPrices, setSuccessShowFetchPrices] = useState(false);

  // Fetch time estimate modal state
  const [showFetchEstimateModal, setShowFetchEstimateModal] = useState(false);
  const [fetchMinimized, setFetchMinimized] = useState(false);
  const [notifyWhenDone, setNotifyWhenDone] = useState(false);
  const notifyWhenDoneRef = useRef(false);
  const isFocusedRef = useRef(isFocused);
  useEffect(() => { isFocusedRef.current = isFocused; }, [isFocused]);
  const [fetchEstimateSeconds, setFetchEstimateSeconds] = useState(0);
  const fetchCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchStartTimeRef = useRef<number>(0);

  // Match selector state for web scraping pricing
  const [matchSelectorVisible, setMatchSelectorVisible] = useState(false);
  const [pendingMatches, setPendingMatches] = useState<ProductMatch[]>([]);
  const [pendingMaterialIndex, setPendingMaterialIndex] = useState<number>(-1);
  const [pendingMaterialName, setPendingMaterialName] = useState<string>('');

  // Expanded materials state for accordion
  const [expandedMaterials, setExpandedMaterials] = useState<Set<string>>(new Set());

  // Section management
  const [showNewSectionModal, setShowNewSectionModal] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [newSectionLaborHours, setNewSectionLaborHours] = useState('');
  const [renamingSectionKey, setRenamingSectionKey] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  // Save section as template modal
  const [saveTemplateModalVisible, setSaveTemplateModalVisible] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState('');
  const [saveTemplateLaborHours, setSaveTemplateLaborHours] = useState('');
  const [saveTemplateSectionName, setSaveTemplateSectionName] = useState('');
  const [saveTemplateKeywords, setSaveTemplateKeywords] = useState<string[]>([]);
  const [saveTemplateKeywordInput, setSaveTemplateKeywordInput] = useState('');

  // Delete section confirm modal
  const [deleteSectionModalVisible, setDeleteSectionModalVisible] = useState(false);
  const [deleteSectionName, setDeleteSectionName] = useState('');

  // Template picker modal
  const [templatePickerVisible, setTemplatePickerVisible] = useState(false);
  const [availableTemplates, setAvailableTemplates] = useState<SectionTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<SectionTemplate | null>(null);

  // Template suggestions for empty state
  const [allTemplates, setAllTemplates] = useState<SectionTemplate[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [suggestedTemplateIds, setSuggestedTemplateIds] = useState<Set<string>>(new Set());
  const [checkedTemplateIds, setCheckedTemplateIds] = useState<Set<string>>(new Set());
  const [templateQuantities, setTemplateQuantities] = useState<Record<string, number>>({});
  const [isLoadingWithGaps, setIsLoadingWithGaps] = useState(false);

  // Optimistic quantity overrides — shown instantly before store re-render
  const [localQuantities, setLocalQuantities] = useState<Record<string, number>>({});



  // Load templates and match by keywords (instant, no API calls)
  useEffect(() => {
    loadTemplates().then(templates => {
      setAllTemplates(templates);
      setTemplatesLoaded(true);

      if (templates.length === 0) return;

      const jobText = [currentQuote?.job?.name || '', currentQuote?.job?.description || ''].join(' ');
      const matches = matchTemplatesByKeywords(templates, jobText);

      const suggested = new Set(matches.map(m => m.templateId));
      const quantities: Record<string, number> = {};
      templates.forEach(t => { quantities[t.id] = 1; });

      // Extract quantities from job text for matched templates
      matches.forEach(m => {
        const qty = extractQuantityForKeyword(jobText, m.matchedKeyword);
        if (qty) quantities[m.templateId] = qty;
      });

      setSuggestedTemplateIds(suggested);
      setCheckedTemplateIds(new Set(suggested));
      setTemplateQuantities(quantities);
    });
  }, [currentQuote?.job?.description]);

  // Load selected templates into quote (with optional quantity multiplier)
  const loadSelectedTemplatesIntoQuote = () => {
    if (!currentQuote) return;

    const HOURS_PER_DAY = 8;
    let newMaterials: Material[] = [];
    let newSections: QuoteSection[] = [...(currentQuote.sections || [])];
    let additionalLaborHours = 0;
    let laborRate = currentQuote.laborRate;
    const isDefaultRate = laborRate === (businessSettings?.defaultLaborRate || 85) && currentQuote.laborHours === 0;

    const selectedTemplates = allTemplates.filter(t => checkedTemplateIds.has(t.id));

    selectedTemplates.forEach(template => {
      const qty = templateQuantities[template.id] || 1;
      // Use AI-suggested contextual name if available
      const suggestion = (currentQuote as any)?.templateSuggestions?.find((s: any) => s.templateId === template.id);
      const baseName = suggestion?.suggestedSectionName || template.name;
      const sectionName = getUniqueSectionName(baseName);

      // Add materials with base quantities and multiplied totals
      const templateMaterials: Material[] = template.materials.map((m) => ({
        ...m,
        id: generateId(),
        section: sectionName,
        templateBaseQuantity: m.quantity,
        quantity: m.quantity * qty,
        totalPrice: (m.quantity * qty) * m.price,
        manualPriceOverride: m.manualPriceOverride ?? true,
        favoriteProduct: (m as any).favoriteProduct,
      }));
      newMaterials = [...newMaterials, ...templateMaterials];

      // Create QuoteSection with multiplier
      newSections.push({
        id: `section-${Date.now()}-${template.id}`,
        name: sectionName,
        multiplier: qty,
        sourceTemplateId: template.id,
        laborHours: template.laborHours,
        laborRate: template.laborRate,
        laborUnit: template.laborUnit,
        laborTotal: template.laborHours * template.laborRate * qty,
        sortOrder: newSections.length,
      });

      // Accumulate labor (convert to hours)
      const templateHours = template.laborUnit === 'days'
        ? template.laborHours * HOURS_PER_DAY * qty
        : template.laborHours * qty;
      additionalLaborHours += templateHours;

      // Use first template's rate if quote has no labor set
      if (isDefaultRate && template.laborRate > 0) {
        laborRate = template.laborUnit === 'days'
          ? template.laborRate / HOURS_PER_DAY
          : template.laborRate;
      }
    });

    updateQuote({
      ...currentQuote,
      materials: [...currentQuote.materials, ...newMaterials],
      sections: newSections,
      laborHours: currentQuote.laborHours + additionalLaborHours,
      laborRate,
    });
  };

  // Cleanup fetch countdown on unmount
  useEffect(() => {
    return () => {
      if (fetchCountdownRef.current) clearInterval(fetchCountdownRef.current);
    };
  }, []);

  // Get materials safely - before any hooks that depend on it
  const materials = currentQuote?.materials || [];

  // Memoize expensive computations
  const materialsSubtotal = React.useMemo(
    () => (materials && Array.isArray(materials)) ? materials.reduce((sum, m) => sum + m.totalPrice, 0) : 0,
    [materials]
  );

  const hasUnpricedMaterials = React.useMemo(
    () => (materials && Array.isArray(materials)) ? materials.some((m) => m.price === 0) : false,
    [materials]
  );

  // ── Materials list shape: memoized so the IIFE inside the JSX doesn't
  // rebuild on every parent render (the renderer was the hot path on
  // Android with 15+ items). Recomputes only when the underlying data —
  // materials, sections, or which sections are collapsed — actually
  // changes. `renderFlatItem` (and its inline JSX for header/footer) is
  // still rebuilt each render because it captures lots of mutable state;
  // memoizing the data alone is the safe, high-leverage win.
  const quoteSections = currentQuote?.sections;
  const flatData: FlatItem[] = React.useMemo(() => {
    const groupedMaterials = groupMaterialsByCategory(materials);

    const sectionedGroups = Array.from(groupedMaterials.entries()).filter(([key]) => key !== '');
    const unsectionedGroup = groupedMaterials.get('');
    const existingSectionNames = new Set(sectionedGroups.map(([key]) => key));
    if (quoteSections) {
      quoteSections.forEach(s => {
        if (!existingSectionNames.has(s.name)) {
          sectionedGroups.push([s.name, { info: { name: s.name, color: colors.primary }, materials: [] }]);
        }
      });
    }

    const sortOrderByName = new Map(
      (quoteSections || []).map(s => [s.name, s.sortOrder ?? 999])
    );
    sectionedGroups.sort(([a], [b]) => {
      const oa = sortOrderByName.get(a) ?? 999;
      const ob = sortOrderByName.get(b) ?? 999;
      if (oa !== ob) return oa - ob;
      return a.localeCompare(b);
    });

    const out: FlatItem[] = [];
    sectionedGroups.forEach(([groupKey, group]) => {
      const subtotal = group.materials.reduce((sum, m) => sum + m.totalPrice, 0);
      out.push({ type: 'header', key: `h-${groupKey}`, sectionName: groupKey });
      if (!collapsedSections.has(groupKey)) {
        group.materials.forEach(m => out.push({ type: 'material', key: m.id, material: m }));
      }
      out.push({ type: 'footer', key: `f-${groupKey}`, sectionName: groupKey, subtotal });
    });
    if (unsectionedGroup) {
      unsectionedGroup.materials.forEach(m => out.push({ type: 'material', key: m.id, material: m }));
    }
    return out;
  }, [materials, quoteSections, collapsedSections]);

  // Stable list of section names used by the per-card "Move to section"
  // dropdown. Memoised so MaterialItemCard's memo comparator (which checks
  // ref equality) doesn't re-render every card on unrelated state changes.
  const availableSections = useMemo(() => {
    const names = new Set<string>();
    (quoteSections || []).forEach(s => names.add(s.name));
    materials.forEach(m => { if (m.section) names.add(m.section); });
    return Array.from(names).sort();
  }, [quoteSections, materials]);

  const toggleSectionCollapsed = useCallback((sectionName: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionName)) next.delete(sectionName);
      else next.add(sectionName);
      return next;
    });
  }, []);

  const triggerPriceFlash = useCallback((materialId: string) => {
    // Add to recently priced set
    setRecentlyPricedIds(prev => new Set(prev).add(materialId));

    // Create or reset animation value
    if (!priceFlashAnims.current.has(materialId)) {
      priceFlashAnims.current.set(materialId, new Animated.Value(1));
    }
    const anim = priceFlashAnims.current.get(materialId)!;
    anim.setValue(1);

    // Animate: hold briefly then fade out
    Animated.sequence([
      Animated.delay(800),
      Animated.timing(anim, {
        toValue: 0,
        duration: 1200,
        useNativeDriver: false,
      }),
    ]).start(() => {
      setRecentlyPricedIds(prev => {
        const next = new Set(prev);
        next.delete(materialId);
        return next;
      });
      priceFlashAnims.current.delete(materialId);
    });
  }, []);

  const toggleMaterialExpanded = useCallback((materialId: string) => {
    setExpandedMaterials(prev => {
      const newSet = new Set(prev);
      if (newSet.has(materialId)) {
        newSet.delete(materialId);
      } else {
        newSet.add(materialId);
      }
      return newSet;
    });
  }, []);

  const handleGenerateMaterialsList = async () => {
    if (!currentQuote || !currentQuote.job.description) {
      setSuccessType('info');
      setSuccessTitle('No Description');
      setSuccessMessage('Please go back and add a job description first.');
      setShowSuccessModal(true);
      return;
    }

    setCancelGeneration(false);
    setIsAiAnalyzing(true);

    try {
      // Pipeline orchestration now lives in src/services/materialsPipeline.ts
      // so Mate's chat-side apply path can stream the same events. This
      // screen just feeds it the dependencies, polls cancelGeneration via the
      // shouldCancel callback, then persists the result via saveDraft.
      const result = await generateMaterialsForQuote(
        {
          quote: currentQuote,
          businessSettings,
          isPro,
          templates: allTemplates,
        },
        {
          shouldCancel: () => cancelGenerationRef.current,
        },
      ).catch((err) => {
        if (err instanceof PipelineCancelled) return null;
        throw err;
      });

      if (!result) return; // cancelled

      // Persist immediately rather than just updating local state. saveDraft:
      //   1. writes to AsyncStorage BEFORE calling set({ quotes, currentQuote }),
      //      so the next render sees the fully-populated list;
      //   2. sets pendingQuoteWrites[id] before the Firestore listener can
      //      echo a pre-generation snapshot back over local state;
      //   3. keeps quotes[] in sync with currentQuote for downstream nav.
      await saveDraft(result.updatedQuote);

      setSuccessTitle('Materials Generated!');
      setSuccessMessage(`Generated ${result.generatedMaterialCount} material${result.generatedMaterialCount !== 1 ? 's' : ''} from your job description.`);
      setSuccessShowFetchPrices(true);
      setShowSuccessModal(true);
    } catch (error: any) {
      console.error('[MaterialsListScreen] Generation failed:', error);
      const message = String(error?.message || error || '');
      const isNetworkError =
        error?.name === 'TypeError' ||
        /network request failed|failed to fetch|network error|offline|timeout|timed out/i.test(message);
      setSuccessType('error');
      if (isNetworkError) {
        setSuccessTitle('No Internet Connection');
        setSuccessMessage('Generating materials needs an internet connection. Please check your connection and try again.');
      } else {
        setSuccessTitle('Generation Failed');
        setSuccessMessage('Could not generate materials list. Please add materials manually or try again.');
      }
      setShowSuccessModal(true);
    } finally {
      setIsAiAnalyzing(false);
      setCancelGeneration(false);
    }
  };

  // Auto-trigger entry points used by Mate's apply path.
  //   autoGenerate     → empty quote + description → call Get Recommended Gear
  //   autoFetchPrices  → materials already populated → call Fetch Prices
  // Each runs at most once per mount via a ref guard.
  const autoGenTriggeredRef = useRef(false);
  useEffect(() => {
    if (autoGenTriggeredRef.current) return;
    if (!route.params || (route.params as any).autoGenerate !== true) return;
    if (!currentQuote?.job?.description) return;
    if (materials.length > 0) return;
    if (isAiAnalyzing) return;
    autoGenTriggeredRef.current = true;
    handleGenerateMaterialsList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params, currentQuote?.job?.description, materials.length, isAiAnalyzing]);

  const autoFetchTriggeredRef = useRef(false);
  useEffect(() => {
    if (autoFetchTriggeredRef.current) return;
    if (!route.params || (route.params as any).autoFetchPrices !== true) return;
    if (!currentQuote) return;
    if (materials.length === 0) return;
    if (isFetchingPrices) return;
    autoFetchTriggeredRef.current = true;
    handleFetchPrices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params, currentQuote?.id, materials.length, isFetchingPrices]);

  const handleCancelGeneration = () => {
    setCancelGeneration(true);
    setIsAiAnalyzing(false);
    setSuccessType('info');
    setSuccessTitle('Cancelled');
    setSuccessMessage('Material generation cancelled. You can add materials manually or try again.');
    setShowSuccessModal(true);
  };

  // Start the countdown timer for the fetch estimate modal
  const fetchEstimateSecondsRef = useRef(0);
  const startFetchCountdown = (totalSeconds: number) => {
    fetchEstimateSecondsRef.current = totalSeconds;
    setFetchEstimateSeconds(totalSeconds);
    setShowFetchEstimateModal(true);
    setFetchMinimized(false);
    fetchStartTimeRef.current = Date.now();
    if (fetchCountdownRef.current) clearInterval(fetchCountdownRef.current);
    fetchCountdownRef.current = setInterval(() => {
      fetchEstimateSecondsRef.current -= 1;
      const next = Math.max(fetchEstimateSecondsRef.current, 0);
      fetchEstimateSecondsRef.current = next;
      setFetchEstimateSeconds(next);
      // Don't hide the modal when countdown hits 0 — items may still be fetching.
      // The modal is hidden when the fetch loop finishes (stopFetchCountdown).
    }, 1000);
  };

  // Stop the countdown timer
  const stopFetchCountdown = () => {
    if (fetchCountdownRef.current) {
      clearInterval(fetchCountdownRef.current);
      fetchCountdownRef.current = null;
    }
    setShowFetchEstimateModal(false);
    setFetchMinimized(false);
  };

  const handleFetchPrices = async () => {
    if (isFetchingPrices) return; // Prevent double-fire
    if (materials.length === 0) {
      setSuccessType('info');
      setSuccessTitle('Nothing to Price');
      setSuccessMessage('Chuck some materials in first, legend.');
      setShowSuccessModal(true);
      return;
    }

    // Pricing orchestration now lives in src/services/materialsPipeline.ts as
    // fetchPricesForQuote. This screen handler:
    //   - Sets up the wizard's UI state (modal, countdown, batch grid, etc.)
    //   - Maps PricingEvents back to that state via the onEvent callback
    //   - Persists the result via saveDraft
    //   - Surfaces success/error modals based on the returned counts
    // Mate's chat-side apply path calls the same service and renders the same
    // events into its working card.

    const materialsNeedingPrices = materials.filter(m => !(m.price > 0 && !m.manualPriceOverride));
    const estimatedSeconds = Math.max(Math.ceil(materialsNeedingPrices.length / 3) * 35, 35);
    setFetchedItemNames([]);
    setFetchPhase('idle');
    setCurrentFetchingName('');
    startFetchCountdown(estimatedSeconds);

    setIsFetchingPrices(true);
    setNotifyWhenDone(false);
    cancelFetchRef.current = false;

    let fetchedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    // Run the pricing pipeline. Events stream UI state updates back here
    // (batch grid, per-item progress, countdown). Persistence and the
    // success modal stay below.

    let updatedMaterials = [...materials];
    let cancelled = false;
    try {
      const result = await fetchPricesForQuote(
        {
          quote: currentQuote!,
          businessSettings,
          reeceConnected,
        },
        {
          shouldCancel: () => cancelFetchRef.current,
          onEvent: (event) => {
            if (event.kind === 'phase-start') {
              if (event.phase === 'batch') setFetchPhase('batch');
              else if (event.phase === 'individual') setFetchPhase('individual');
              else if (event.phase === 'reconcile') setCurrentFetchingName(event.status);
              else setCurrentFetchingName(event.status);
            } else if (event.kind === 'batch-chunk') {
              setBatchItemStatuses(new Map(event.termStatuses));
              setBatchChunkProgress({ current: event.chunkIndex, total: event.totalChunks });
              setFetchProgress(event.progress);
              if (event.currentName) setCurrentFetchingName(event.currentName);
              // Re-estimate countdown based on actual chunk pace.
              if (fetchCountdownRef.current) {
                const chunksRemaining = event.totalChunks - event.chunkIndex;
                if (chunksRemaining <= 0) {
                  fetchEstimateSecondsRef.current = 0;
                  setFetchEstimateSeconds(0);
                } else {
                  const elapsedMs = Date.now() - fetchStartTimeRef.current;
                  const avgMsPerChunk = elapsedMs / Math.max(event.chunkIndex, 1);
                  const newEstimate = Math.ceil((avgMsPerChunk * chunksRemaining) / 1000);
                  fetchEstimateSecondsRef.current = newEstimate;
                  setFetchEstimateSeconds(newEstimate);
                }
              }
              // (Intermediate materials snapshot intentionally omitted —
              // see Phase 2 notes. The price-flash animation per item still
              // gives the user feedback during the fetch.)
            } else if (event.kind === 'item-priced') {
              setFetchingMaterialId(event.materialId);
              setCurrentFetchingName(event.name);
              setFetchedItemNames(prev => [...prev, { name: event.name, success: event.success }]);
              if (event.success) triggerPriceFlash(event.materialId);
              if (event.progress) setFetchProgress(event.progress);
            } else if (event.kind === 'reece-reauth') {
              setReeceReauthNeeded(true);
              setReeceConnected(false);
            } else if (event.kind === 'reconcile-start') {
              setFetchPhase('applying');
              setCurrentFetchingName('Reconciling pack sizes...');
            } else if (event.kind === 'complete') {
              fetchedCount = event.fetched;
              failedCount = event.failed;
              skippedCount = event.skipped;
              cancelled = event.cancelled;
            }
          },
        },
      );
      updatedMaterials = result.updatedQuote.materials;
      fetchedCount = result.fetchedCount;
      failedCount = result.failedCount;
      skippedCount = result.skippedCount;
      cancelled = result.cancelled;
      if (result.reeceReauthNeeded) {
        setReeceReauthNeeded(true);
        setReeceConnected(false);
      }
    } catch (err: any) {
      // Pipeline-level error (auth, network, etc.). Fall through to the
      // catch handler below by re-throwing with the same message shape the
      // original code surfaced.
      throw err;
    }

    try {
      // Mark cancelled as a thrown sentinel so the existing catch branch
      // handles partial-progress save + success message.
      if (cancelled) throw new Error('__FETCH_CANCELLED__');

            // Final persist to ensure all fetched prices reach Firestore. The
      // intermediate chunk-callback updateQuote() calls only mutate local
      // state; without saveDraft here a screen close / app restart loses
      // every price we just scraped (Firestore would still show $0 for
      // every material). Same pattern as the post-generation save.
      if (currentQuote) {
        await saveDraft({
          ...currentQuote,
          materials: [...updatedMaterials],
        } as any);
      }

      // Show appropriate message based on results
      if (cancelFetchRef.current) {
        if (fetchedCount > 0) {
          setSuccessTitle('No Dramas');
          setSuccessMessage(`Grabbed ${fetchedCount} price${fetchedCount > 1 ? 's' : ''} before pulling the pin.`);
          setShowSuccessModal(true);
        }
      } else if (fetchedCount === 0 && failedCount === 0 && skippedCount > 0) {
        setSuccessType('info');
        setSuccessTitle('Already Sorted');
        setSuccessMessage('All your materials already have prices. No worries!');
        setShowSuccessModal(true);
      } else if (fetchedCount === 0 && failedCount > 0) {
        setSuccessType('warning');
        setSuccessTitle('No Luck, Mate');
        setSuccessMessage(`Couldn't track down prices for ${failedCount} item${failedCount > 1 ? 's' : ''}.\n\nGive these a crack:\n• Tweak material names to match what's on the shelf\n• Punch in prices manually\n• Try a different hardware store in Settings\n• Have another go later`);
        setShowSuccessModal(true);
      } else if (fetchedCount > 0 && failedCount === 0) {
        setSuccessTitle('Beauty!');
        setSuccessMessage(`Scored ${fetchedCount} price${fetchedCount > 1 ? 's' : ''}. Too easy!`);
        setShowSuccessModal(true);
      } else if (fetchedCount > 0 && failedCount > 0) {
        setSuccessTitle('Nearly There');
        setSuccessMessage(`Got ${fetchedCount} price${fetchedCount > 1 ? 's' : ''}, but ${failedCount} item${failedCount > 1 ? 's' : ''} gave us the slip. Try tweaking material names or switching stores in Settings.`);
        setShowSuccessModal(true);
      } else {
        setSuccessTitle('All Done');
        setSuccessMessage('Prices are sorted. Time for a cuppa!');
        setShowSuccessModal(true);
      }
    } catch (error: any) {
      if (error?.message === '__FETCH_CANCELLED__') {
        // Cancelled via the cancel promise — persist any partial progress
        // so the user doesn't lose prices that did come through. Same
        // saveDraft reasoning as the success-path persist above.
        if (currentQuote) {
          await saveDraft({
            ...currentQuote,
            materials: [...updatedMaterials],
          } as any);
        }
        if (fetchedCount > 0) {
          setSuccessTitle('No Dramas');
          setSuccessMessage(`Grabbed ${fetchedCount} price${fetchedCount > 1 ? 's' : ''} before pulling the pin.`);
          setShowSuccessModal(true);
        }
      } else {
        setSuccessType('error');
        setSuccessTitle('Crikey!');
        setSuccessMessage(`Something went wrong fetching prices. The price service might be taking a sickie, or your internet's gone walkabout. Give it another crack later.`);
        setShowSuccessModal(true);
      }
    } finally {
      // Send push notification if user chose "Fetch in Background" and screen is not focused
      if (notifyWhenDoneRef.current && !isFocusedRef.current) {
        const total = fetchedCount + failedCount + skippedCount;
        const notifTitle = failedCount === 0 ? 'Prices are sorted!' : 'Price fetch finished';
        const notifBody = fetchedCount > 0
          ? `Got ${fetchedCount} of ${total} price${total > 1 ? 's' : ''}. Tap to check it out.`
          : 'Done fetching prices. Tap to have a squiz.';
        notificationService.scheduleLocalNotification(notifTitle, notifBody, { screen: 'MaterialsList' });
        notifyWhenDoneRef.current = false;
        setNotifyWhenDone(false);
      }
      cancelFetchResolverRef.current = null;
      stopFetchCountdown();
      setCurrentFetchingName('');
      setIsFetchingPrices(false);
      setFetchingMaterialId(null);
      setFetchProgress({ current: 0, total: 0 });
      setFetchPhase('idle');
      setBatchItemStatuses(new Map());
      setBatchChunkProgress({ current: 0, total: 0 });
    }
  };

  const handleCancelFetchPrices = () => {
    cancelFetchRef.current = true;
    // Immediately reject any in-flight request so cancellation feels instant
    if (cancelFetchResolverRef.current) {
      cancelFetchResolverRef.current();
      cancelFetchResolverRef.current = null;
    }
  };

  const handleMatchSelected = async (match: ProductMatch, saveAsFavorite: boolean) => {
    setMatchSelectorVisible(false);

    // Apply the selected match to the pending material
    const updatedMaterials = [...materials];
    const material = updatedMaterials[pendingMaterialIndex];

    if (material) {
      material.price = match.price;
      material.totalPrice = match.price * material.quantity;
      material.manualPriceOverride = false;
      material.pricingSource = 'scraper';

      if (match.itemNumber) {
        material.bunningsItemNumber = match.itemNumber;
      }
      if (match.productUrl) {
        material.productUrl = match.productUrl;
      }
      if (match.description) {
        material.description = match.description;
      }
      // Only save brand if it's not just the store name
      if (match.brand &&
          match.brand.toLowerCase() !== 'bunnings' &&
          match.brand.toLowerCase() !== 'bunnings.com.au' &&
          match.brand.toLowerCase() !== 'reece' &&
          match.brand.toLowerCase() !== 'mitre 10') {
        material.brand = match.brand;
      }
      if (match.stockCheckedAt) {
        material.stockCheckedAt = match.stockCheckedAt;
      }

      // Save as favorite if requested
      if (saveAsFavorite) {
        const favoriteMapping: FavoriteProductMapping = {
          productName: match.productName,
          store: match.store,
          productUrl: match.productUrl,
          itemNumber: match.itemNumber,
          dimensions: match.dimensions,
          unit: match.unit as Material['unit'] | undefined,
        };
        material.favoriteProduct = favoriteMapping;
        await saveFavoriteProduct(material.name, material.searchTerm, favoriteMapping);
      }

      if (currentQuote) {
        updateQuote({
          ...currentQuote,
          materials: updatedMaterials,
        } as any);
      }

      setSuccessType('success');
      setSuccessTitle('Price Updated');
      setSuccessMessage(`${match.productName} - ${formatCurrency(match.price)}`);
      setShowSuccessModal(true);
    }

    // Resume fetching remaining materials
    // Note: This is simplified - in production you'd want to resume from where you left off
    setPendingMatches([]);
    setPendingMaterialIndex(-1);
    setPendingMaterialName('');
  };

  const handleMatchCanceled = useCallback(() => {
    setMatchSelectorVisible(false);
    setPendingMatches([]);
    setPendingMaterialIndex(-1);
    setPendingMaterialName('');
  }, []);

  // Tracks the "I'll build it myself" rapid-entry mode: while true, saving a
  // material in inline-edit immediately spawns a fresh blank draft and rolls
  // the inline-edit form onto that one, so the user can keep typing line
  // after line without round-tripping through Cancel.
  const buildModeRef = useRef(false);
  // Set by handleUpdateMaterial when it chains a new draft in buildMode, so
  // the immediately-following onExitEdit (called by InlineAddMaterialRow's
  // edit-mode save flow) knows to NOT clear editingMaterialId — the chain
  // already advanced it to the new draft.
  const buildModeJustChainedRef = useRef(false);

  const createBlankDraftMaterial = useCallback((): Material => ({
    id: generateId(),
    name: '',
    quantity: 1,
    unit: 'each',
    price: 0,
    totalPrice: 0,
    manualPriceOverride: true,
    pricingSource: 'manual',
  } as Material), []);

  // "I'll build it myself" on the empty-state card — instead of jumping to
  // the full AddMaterial screen, drop a blank material into the quote and
  // open it inline in edit mode. The user can fill name/qty/price right
  // there. If they cancel without typing a name, exitEdit cleans up the
  // dangling row so the list doesn't end up with an empty line.
  const handleStartManualBuild = useCallback(() => {
    if (!currentQuote) return;
    buildModeRef.current = true;
    const draft = createBlankDraftMaterial();
    updateQuote({
      ...currentQuote,
      materials: [...(currentQuote.materials || []), draft],
    });
    setEditingMaterialId(draft.id);
  }, [currentQuote, updateQuote, createBlankDraftMaterial]);

  const handleCreateSection = () => {
    if (!newSectionName.trim() || !currentQuote) return;
    const hours = parseFloat(newSectionLaborHours) || 0;
    if (hours <= 0) return; // labour hours required — Create button is disabled in this state
    // Create a QuoteSection entry and add to quote
    const defaultRate = currentQuote.laborRate || businessSettings?.defaultLaborRate || 85;
    const existingSections = currentQuote.sections || [];
    const section: QuoteSection = {
      id: `section-${Date.now()}`,
      name: newSectionName.trim(),
      multiplier: 1,
      laborHours: hours,
      laborRate: defaultRate,
      laborUnit: 'hours' as LaborUnit,
      laborTotal: hours * defaultRate,
      sortOrder: existingSections.length,
    };
    updateQuote({
      ...currentQuote,
      sections: [...existingSections, section],
    });
    setNewSectionName('');
    setNewSectionLaborHours('');
    setShowNewSectionModal(false);
  };

  const handleRenameSection = (oldName: string) => {
    if (!renameValue.trim() || !currentQuote || renameValue.trim() === oldName) {
      setRenamingSectionKey(null);
      return;
    }
    const newName = renameValue.trim();
    // Rename on all materials
    const updatedMaterials = currentQuote.materials.map(m =>
      m.section === oldName ? { ...m, section: newName } : m
    );
    // Rename in sections array
    const updatedSections = (currentQuote.sections || []).map(s =>
      s.name === oldName ? { ...s, name: newName } : s
    );
    updateQuote({
      ...currentQuote,
      materials: updatedMaterials,
      sections: updatedSections,
    });
    setRenamingSectionKey(null);
  };

  const handleSaveSectionAsTemplate = (sectionName: string) => {
    if (!currentQuote) return;
    const sectionData = (currentQuote.sections || []).find(s => s.name === sectionName);
    setSaveTemplateSectionName(sectionName);
    setSaveTemplateName(sectionName);
    setSaveTemplateLaborHours(String(sectionData?.laborHours || 0));
    setSaveTemplateKeywords(suggestKeywordsFromName(sectionName));
    setSaveTemplateKeywordInput('');
    setSaveTemplateModalVisible(true);
  };

  const handleConfirmSaveTemplate = async () => {
    if (!currentQuote || !saveTemplateSectionName) return;
    const sectionMaterials = currentQuote.materials.filter(m => m.section === saveTemplateSectionName);
    const sectionData = (currentQuote.sections || []).find(s => s.name === saveTemplateSectionName);
    const laborHours = parseFloat(saveTemplateLaborHours) || 0;
    const finalKeywords = saveTemplateKeywords.length > 0 ? saveTemplateKeywords : suggestKeywordsFromName(saveTemplateName || saveTemplateSectionName);
    const template: SectionTemplate = {
      id: `tpl-${Date.now()}`,
      name: saveTemplateName.trim() || saveTemplateSectionName,
      keywords: finalKeywords.length > 0 ? finalKeywords : undefined,
      materials: sectionMaterials.map(({ id, ...rest }) => rest),
      laborHours,
      laborRate: sectionData?.laborRate || currentQuote.laborRate || 85,
      laborUnit: sectionData?.laborUnit || currentQuote.laborUnit || 'hours',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveTemplate(template);
    setSaveTemplateModalVisible(false);
    setSuccessTitle('Bloody Ripper!');
    setSuccessMessage(`"${template.name}" saved as a template. Chuck it on any future quote, easy as.`);
    setSuccessType('success');
    setShowSuccessModal(true);
  };

  const getUniqueSectionName = (baseName: string): string => {
    if (!currentQuote) return baseName;
    const existingNames = new Set<string>();
    currentQuote.materials.forEach(m => { if (m.section) existingNames.add(m.section); });
    (currentQuote.sections || []).forEach(s => existingNames.add(s.name));
    if (!existingNames.has(baseName)) return baseName;
    let counter = 2;
    while (existingNames.has(`${baseName} (${counter})`)) counter++;
    return `${baseName} (${counter})`;
  };

  const handleLoadTemplate = async () => {
    const templates = await loadTemplates();
    if (templates.length === 0) {
      Alert.alert('No Templates', 'Save a section as a template first, or create one in Settings > Section Templates.');
      return;
    }
    setAvailableTemplates(templates);
    setSelectedTemplate(null);
    setTemplatePickerVisible(true);
  };

  const handleConfirmLoadTemplate = (template: SectionTemplate) => {
    if (!currentQuote) return;
    const sectionName = getUniqueSectionName(template.name);
    const newMaterials: Material[] = template.materials.map((m) => ({
      ...m,
      id: generateId(),
      section: sectionName,
      templateBaseQuantity: m.quantity,
      manualPriceOverride: m.manualPriceOverride ?? true,
      favoriteProduct: (m as any).favoriteProduct,
    }));

    const existingSections = currentQuote.sections || [];
    const newSection: QuoteSection = {
      id: `section-${Date.now()}`,
      name: sectionName,
      multiplier: 1,
      sourceTemplateId: template.id,
      laborHours: template.laborHours,
      laborRate: template.laborRate,
      laborUnit: template.laborUnit,
      laborTotal: template.laborHours * template.laborRate,
      sortOrder: existingSections.length,
    };

    const HOURS_PER_DAY = 8;
    const templateLaborInHours = template.laborUnit === 'days'
      ? template.laborHours * HOURS_PER_DAY
      : template.laborHours;

    const newLaborRate = currentQuote.laborHours === 0 && currentQuote.laborRate === (businessSettings?.defaultLaborRate || 85)
      ? (template.laborUnit === 'days' ? template.laborRate / HOURS_PER_DAY : template.laborRate)
      : currentQuote.laborRate;

    updateQuote({
      ...currentQuote,
      materials: [...currentQuote.materials, ...newMaterials],
      sections: [...existingSections, newSection],
      laborHours: currentQuote.laborHours + templateLaborInHours,
      laborRate: newLaborRate,
    });
    setTemplatePickerVisible(false);
    setSelectedTemplate(null);
  };

  const handleSectionMultiplierChange = (sectionName: string, newMultiplier: number) => {
    if (!currentQuote || newMultiplier < 1) return;
    const updatedSections = (currentQuote.sections || []).map(s =>
      s.name === sectionName ? { ...s, multiplier: newMultiplier, laborTotal: s.laborHours * s.laborRate * newMultiplier } : s
    );
    const updatedMaterials = currentQuote.materials.map(m => {
      if (m.section !== sectionName || !m.templateBaseQuantity) return m;
      const newQty = m.templateBaseQuantity * newMultiplier;
      return { ...m, quantity: newQty, totalPrice: newQty * m.price };
    });
    updateQuote({ ...currentQuote, sections: updatedSections, materials: updatedMaterials });
  };

  const handleDeleteSection = (sectionName: string) => {
    if (!currentQuote) return;
    setDeleteSectionName(sectionName);
    setDeleteSectionModalVisible(true);
  };

  const handleConfirmDeleteSection = () => {
    if (!currentQuote || !deleteSectionName) return;
    const updatedMaterials = currentQuote.materials.filter(m => m.section !== deleteSectionName);
    const updatedSections = (currentQuote.sections || []).filter(s => s.name !== deleteSectionName);
    updateQuote({ ...currentQuote, materials: updatedMaterials, sections: updatedSections });
    setDeleteSectionModalVisible(false);
  };

  // Move a material to a different section. Driven by the box-icon dropdown
  // on each MaterialItemCard (previously this was a native Alert with a list
  // of buttons; the dropdown is the replacement for the removed drag-handle).
  // `targetSection === null` means "Unsectioned".
  const handleMoveMaterialToSection = useCallback((materialId: string, targetSection: string | null) => {
    if (!currentQuote) return;
    const updatedMaterials = currentQuote.materials.map(m =>
      m.id === materialId
        ? { ...m, section: targetSection ?? undefined, templateBaseQuantity: undefined }
        : m
    );
    updateQuote({ ...currentQuote, materials: updatedMaterials });
  }, [currentQuote, updateQuote]);


  const handleOpenInStore = (material: Material) => {
    // If we have a direct product URL (from scraper or API), use it!
    if (material.productUrl) {
      if (Platform.OS === 'web') {
        window.open(material.productUrl, '_blank');
      } else {
        Linking.openURL(material.productUrl).catch((err) => {
          setSuccessType('error');
          setSuccessTitle('Error');
          setSuccessMessage('Could not open product link.');
          setShowSuccessModal(true);
        });
      }
      return;
    }

    // Otherwise, construct a search URL as fallback
    const stores = businessSettings?.hardwareStores || ['bunnings.com.au'];
    const firstStore = stores[0];

    // Determine search term — prefer the Reece item number when present so the
    // Reece search lands on the exact product, not a category page.
    const searchTerm = material.reeceItemNumber || material.searchTerm || material.name;
    const encodedSearch = encodeURIComponent(searchTerm);

    // Generate store URL based on the store domain. Reece items always go to
    // Reece regardless of the user's primary hardware store — the supplier is
    // intrinsic to the item, not a user setting.
    let storeUrl = '';

    if (material.reeceItemNumber) {
      storeUrl = `https://www.reece.com.au/search?query=${encodedSearch}`;
    } else if (firstStore.includes('bunnings.com.au')) {
      storeUrl = `https://www.bunnings.com.au/search/products?q=${encodedSearch}`;
    } else if (firstStore.includes('reece.com.au')) {
      storeUrl = `https://www.reece.com.au/search?q=${encodedSearch}`;
    } else if (firstStore.includes('mitre10.com.au')) {
      storeUrl = `https://www.mitre10.com.au/catalogsearch/result?q=${encodedSearch}&viewType=GRID&flag=product`;
    } else if (firstStore.includes('flexihire.com.au')) {
      storeUrl = `https://www.flexihire.com.au/equipment?q=${encodedSearch}`;
    } else {
      // Generic store - use Google search
      storeUrl = `https://www.google.com/search?q=${encodedSearch}+site:${firstStore}`;
    }

    // Open URL
    if (Platform.OS === 'web') {
      window.open(storeUrl, '_blank');
    } else {
      Linking.openURL(storeUrl).catch((err) => {
        setSuccessType('error');
        setSuccessTitle('Error');
        setSuccessMessage('Could not open store link.');
        setShowSuccessModal(true);
      });
    }
  };

  const handleEditMaterial = (material: Material) => {
    // Edit in place — swap the row's MaterialItemCard for the inline form.
    // The full-screen edit on AddMaterialScreen is still reachable via a
    // long-press on the row if/when we want a deeper edit surface.
    setEditingMaterialId(material.id);
  };

  const handleUpdateMaterial = useCallback((updated: Material) => {
    if (!currentQuote) return;
    const nextMaterials = currentQuote.materials.map(m =>
      m.id === updated.id ? updated : m,
    );
    if (buildModeRef.current) {
      // Rapid-entry: the user just saved a material via the "I'll build it
      // myself" flow. Spawn a fresh blank draft and roll the inline-edit
      // onto it so they can keep typing without dismissing.
      const draft = createBlankDraftMaterial();
      updateQuote({
        ...currentQuote,
        materials: [...nextMaterials, draft],
      });
      setEditingMaterialId(draft.id);
      // Signal to the immediately-following exitEdit (InlineAddMaterialRow's
      // edit-mode save flow calls onUpdate then onExitEdit) to leave the
      // editingMaterialId alone — we already advanced it.
      buildModeJustChainedRef.current = true;
      return;
    }
    updateQuote({ ...currentQuote, materials: nextMaterials });
  }, [currentQuote, updateQuote, createBlankDraftMaterial]);

  // Exit inline edit. Three paths:
  //   1. Build-mode save just chained → noop (keep the new draft id).
  //   2. Build-mode cancel on a nameless draft → drop the draft, exit
  //      build mode, clear editingMaterialId.
  //   3. Regular edit exit → clear editingMaterialId. If the row is still
  //      nameless (e.g. the one-shot "build it myself" draft), drop it.
  const exitEdit = useCallback(() => {
    if (buildModeJustChainedRef.current) {
      buildModeJustChainedRef.current = false;
      return;
    }
    setEditingMaterialId(prev => {
      if (prev && currentQuote) {
        const target = currentQuote.materials.find(m => m.id === prev);
        if (target && !target.name?.trim()) {
          updateQuote({
            ...currentQuote,
            materials: currentQuote.materials.filter(m => m.id !== prev),
          });
        }
      }
      buildModeRef.current = false;
      return null;
    });
  }, [currentQuote, updateQuote]);


  const handleQuickQuantityUpdate = useCallback((materialId: string, delta: number) => {
    if (!currentQuote) return;
    const material = materials.find(m => m.id === materialId);
    if (!material) return;
    const currentQty = localQuantities[materialId] ?? material.quantity;
    const newQty = Math.max(1, currentQty + delta);
    // Update local state instantly for immediate UI feedback
    setLocalQuantities(prev => ({ ...prev, [materialId]: newQty }));
    // Then update the store
    const updatedMaterials = materials.map(m => {
      if (m.id === materialId) {
        // Break template link — user manually changed qty
        return updateMaterialTotalPrice({ ...m, quantity: newQty, templateBaseQuantity: undefined });
      }
      return m;
    });
    updateQuote({ ...currentQuote, materials: updatedMaterials } as any);
  }, [currentQuote, materials, updateQuote, localQuantities]);

  const handleQuantityBlur = useCallback((materialId: string, value: string) => {
    if (!currentQuote) return;
    const parsed = parseInt(value, 10);
    const newQty = isNaN(parsed) || parsed < 1 ? 1 : parsed;
    setLocalQuantities(prev => ({ ...prev, [materialId]: newQty }));
    const updatedMaterials = materials.map(m => {
      if (m.id === materialId) {
        // Break template link — user manually changed qty
        return updateMaterialTotalPrice({ ...m, quantity: newQty, templateBaseQuantity: undefined });
      }
      return m;
    });
    updateQuote({ ...currentQuote, materials: updatedMaterials } as any);
  }, [currentQuote, materials, updateQuote]);

  const handleDeleteMaterial = (materialId: string) => {
    setMaterialToDelete(materialId);
    setDeleteDialogVisible(true);
  };

  const confirmDeleteMaterial = () => {
    if (materialToDelete && currentQuote) {
      const updatedMaterials = materials.filter((m) => m.id !== materialToDelete);
      updateQuote({
        ...currentQuote,
        materials: updatedMaterials,
      } as any);
    }
    setDeleteDialogVisible(false);
    setMaterialToDelete(null);
  };


  const handleSaveAndReturn = useCallback(() => {
    if (currentQuote) {
      updateQuote(currentQuote);
      saveDraft(currentQuote);
    }
    // Bypass the unsaved-changes guard — we just saved.
    allowNextNavigation();
    navigation.goBack();
  }, [currentQuote, updateQuote, saveDraft, navigation, allowNextNavigation]);

  const handleNext = useCallback(() => {
    // Allow proceeding with no materials (labor-only quotes)
    if (hasUnpricedMaterials) {
      setUnpricedDialogVisible(true);
    } else {
      if (currentQuote) {
        const draftQuote = { ...currentQuote, draftStep: 'LaborMarkup' };
        updateQuote(draftQuote);
        saveDraft(draftQuote);
      }
      // Bypass the unsaved-changes guard — we just saved.
      allowNextNavigation();
      navigation.navigate('LaborMarkup');
    }
  }, [hasUnpricedMaterials, navigation, currentQuote, updateQuote, saveDraft, allowNextNavigation]);

  const proceedWithUnpricedMaterials = () => {
    setUnpricedDialogVisible(false);
    if (currentQuote) {
      const draftQuote = { ...currentQuote, draftStep: 'LaborMarkup' };
      updateQuote(draftQuote);
      saveDraft(draftQuote);
    }
    allowNextNavigation();
    navigation.navigate('LaborMarkup');
  };

  // Handle null currentQuote case
  if (!currentQuote) {
    return null;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Materials list — virtualised FlatList.
  //
  // Previously this screen used NestableScrollContainer wrapping a
  // NestableDraggableFlatList, which disabled virtualisation on the inner
  // list (the parent scroll handled scrolling, so the nested list ran with
  // scrollEnabled=false). At ~20+ items every MaterialItemCard sat mounted
  // in the native view tree and Android scroll got janky.
  //
  // Drag-and-drop reorder was removed (per-card "Move to section" still
  // covers the cross-section flow), letting us collapse to a single
  // virtualising FlatList. Stuff above the list moves into
  // ListHeaderComponent, stuff below into ListFooterComponent, and the
  // empty/loading/analyzing states into ListEmptyComponent.
  // ───────────────────────────────────────────────────────────────────────
  const renderFlatItem = ({ item, index }: { item: FlatItem; index: number }) => {
    // First / last material in the current section — adds top/bottom
    // breathing at the section edges (cards already have 10px marginBottom
    // from listItem, but the first card has no marginTop). `undefined`
    // covers the unsectioned-only path (e.g. the "I'll build it myself"
    // draft) where a lone material sits in flatData with no header above
    // and no footer below.
    const prevType = flatData[index - 1]?.type;
    const nextType = flatData[index + 1]?.type;
    const isFirstMaterialInSection =
      item.type === 'material' && (prevType === 'header' || prevType === undefined);
    const isLastMaterialInSection =
      item.type === 'material' && (nextType === 'footer' || nextType === undefined);
    if (item.type === 'header') {
      const sd = currentQuote?.sections?.find(s => s.name === item.sectionName);
      const sectionMats = materials.filter(m => m.section === item.sectionName);
      const showMultiplier = sd && sd.multiplier > 0 && sectionMats.some(m => m.templateBaseQuantity);
      const isCollapsed = collapsedSections.has(item.sectionName);
      return (
        <View collapsable={false}>
          <View style={[
            styles.sectionCardHeaderStandalone,
            isCollapsed && styles.sectionCardHeaderCollapsed,
          ]}>
            <TouchableOpacity onPress={() => toggleSectionCollapsed(item.sectionName)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }} style={{ marginRight: 8 }}>
              <MaterialCommunityIcons name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={22} color={colors.textMuted} />
            </TouchableOpacity>
            {renamingSectionKey === item.sectionName ? (
              <RNTextInput
                style={styles.sectionCardNameInput}
                value={renameValue}
                onChangeText={setRenameValue}
                onSubmitEditing={() => handleRenameSection(item.sectionName)}
                onBlur={() => handleRenameSection(item.sectionName)}
                autoFocus selectTextOnFocus returnKeyType="done"
              />
            ) : (
              <TouchableOpacity onPress={() => { setRenamingSectionKey(item.sectionName); setRenameValue(item.sectionName); }} activeOpacity={0.7} style={styles.sectionCardNameRow}>
                <Text style={styles.sectionCardName}>{item.sectionName}</Text>
              </TouchableOpacity>
            )}
            {showMultiplier && (
              <View style={styles.multiplierStepper}>
                <Pressable style={({ pressed }) => [styles.multiplierBtn, pressed && { opacity: 0.6 }]} onPress={() => handleSectionMultiplierChange(item.sectionName, (sd?.multiplier || 1) - 1)}>
                  <MaterialCommunityIcons name="minus" size={14} color={colors.text} />
                </Pressable>
                <Text style={styles.multiplierValue}>{sd?.multiplier || 1}</Text>
                <Pressable style={({ pressed }) => [styles.multiplierBtn, pressed && { opacity: 0.6 }]} onPress={() => handleSectionMultiplierChange(item.sectionName, (sd?.multiplier || 1) + 1)}>
                  <MaterialCommunityIcons name="plus" size={14} color={colors.text} />
                </Pressable>
              </View>
            )}
            <View style={styles.sectionCardActions}>
              <TouchableOpacity onPress={() => handleSaveSectionAsTemplate(item.sectionName)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <MaterialCommunityIcons name="content-save-outline" size={18} color={colors.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleDeleteSection(item.sectionName)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <MaterialCommunityIcons name="delete-outline" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      );
    }

    if (item.type === 'footer') {
      const isCollapsed = collapsedSections.has(item.sectionName);
      return (
        <View collapsable={false}>
          <View style={[
            styles.sectionCardFooterStandalone,
            isCollapsed && styles.sectionCardFooterCollapsed,
          ]}>
            {!isCollapsed && (
              <View style={styles.inlineAddRow}>
                <InlineAddMaterialRow
                  sectionName={item.sectionName}
                  onAdd={addMaterialToQuoteInline}
                  pricesIncludeGst={currentQuote?.pricesIncludeGst === true}
                  businessSettings={businessSettings}
                  supplierGroups={supplierGroups}
                  reeceConnected={reeceConnected === true}
                  onReeceReauthRequired={handleReeceReauthRequired}
                  onInvoicePress={openInvoiceForSection}
                  onSupplierBookPress={openSupplierBookForSection}
                />
              </View>
            )}
            <View style={styles.sectionCardFooter}>
              <Text style={styles.sectionCardFooterLabel}>
                {isCollapsed ? `${materials.filter(m => m.section === item.sectionName).length} items` : 'Section Total'}
              </Text>
              <Text style={styles.sectionCardFooterValue}>{formatCurrency(item.subtotal)}</Text>
            </View>
          </View>
        </View>
      );
    }

    // Unsectioned materials live at the bottom of the list with no section
    // header/footer, so skip the section-tinted wrap that would otherwise
    // paint a "ghost section" background around them.
    const isUnsectioned = !item.material.section;

    // Material card — while being edited the row swaps to the inline edit card.
    if (editingMaterialId === item.material.id) {
      return (
        <View
          collapsable={false}
          style={
            isUnsectioned
              ? styles.inlineEditWrapUnsectioned
              : [styles.materialItemWrap, styles.inlineEditWrap]
          }
        >
          <InlineAddMaterialRow
            sectionName={item.material.section || ''}
            mode="edit"
            initialMaterial={item.material}
            onAdd={() => { /* unused in edit mode */ }}
            onUpdate={handleUpdateMaterial}
            onExitEdit={exitEdit}
            pricesIncludeGst={currentQuote?.pricesIncludeGst === true}
            businessSettings={businessSettings}
            supplierGroups={supplierGroups}
            reeceConnected={reeceConnected === true}
            onReeceReauthRequired={handleReeceReauthRequired}
          />
        </View>
      );
    }
    return (
      <View
        collapsable={false}
        style={
          isUnsectioned
            ? undefined
            : [
                styles.materialItemWrap,
                isFirstMaterialInSection && styles.materialItemWrapFirst,
                isLastMaterialInSection && styles.materialItemWrapLast,
              ]
        }
      >
        <MaterialItemCard
          material={item.material}
          isExpanded={expandedMaterials.has(item.material.id)}
          isFetching={isMaterialFetching(item.material)}
          isRecentlyPriced={recentlyPricedIds.has(item.material.id)}
          localQuantity={localQuantities[item.material.id]}
          onToggleExpand={() => toggleMaterialExpanded(item.material.id)}
          onQuantityUpdate={(delta) => handleQuickQuantityUpdate(item.material.id, delta)}
          onQuantityBlur={(value) => handleQuantityBlur(item.material.id, value)}
          onMoveToSection={(target) => handleMoveMaterialToSection(item.material.id, target)}
          availableSections={availableSections}
          onOpenInStore={() => handleOpenInStore(item.material)}
          onEdit={() => handleEditMaterial(item.material)}
          onDelete={() => handleDeleteMaterial(item.material.id)}
        />
      </View>
    );
  };

  const showMaterialsList = !isAiAnalyzing && materials.length > 0;

  const reeceBanner = (businessSettings?.tradeCategories?.includes('plumbing') || reeceReauthNeeded) &&
    (reeceConnected === false || reeceReauthNeeded) ? (
    <TouchableOpacity
      style={styles.reeceBanner}
      onPress={() => navigation.navigate('ReeceIntegration' as never)}
      activeOpacity={0.7}
    >
      <MaterialCommunityIcons name="link-variant-off" size={20} color={colors.primary} />
      <View style={styles.reeceBannerText}>
        <Text style={styles.reeceBannerTitle}>
          {reeceReauthNeeded ? 'Reconnect Reece' : 'Connect your Reece account'}
        </Text>
        <Text style={styles.reeceBannerSubtitle}>
          {reeceReauthNeeded
            ? 'Your Reece sign-in expired. Reconnect to keep getting trade prices.'
            : 'Get your real Reece trade prices flowing into every quote.'}
        </Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
    </TouchableOpacity>
  ) : null;

  const listHeader = (
    <WebContainer>
      {currentQuote?.job?.floorplanAnalysis?.detected && (
        <FloorplanTakeoffCard analysis={currentQuote.job.floorplanAnalysis} />
      )}
      {reeceBanner}
    </WebContainer>
  );

  const listEmpty = (
    <WebContainer>
      {isAiAnalyzing ? (
        <AiAnalyzingState />
      ) : materials.length === 0 && !templatesLoaded ? (
        <View style={styles.emptyState}>
          <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 40 }} />
        </View>
      ) : materials.length === 0 ? (
        <View style={styles.emptyState}>
          <TouchableOpacity style={styles.emptyActionCard} onPress={() => {
            if (!isPro) { navigation.navigate('Paywall' as never); return; }
            handleGenerateMaterialsList();
          }} activeOpacity={0.7}>
            <View style={styles.emptyActionIconWrap}>
              <MaterialCommunityIcons name="auto-fix" size={28} color={colors.primary} />
            </View>
            <View style={styles.emptyActionContent}>
              <View style={styles.emptyActionTitleRow}>
                <Text style={styles.emptyActionTitle}>Get recommended gear</Text>
                {!isPro && <ProBadge size="small" />}
              </View>
              <Text style={styles.emptyActionDesc}>
                We'll read your notes and pull the right gear, templates, and local suppliers.
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color={colors.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.emptyActionCard} onPress={handleStartManualBuild} activeOpacity={0.7}>
            <View style={[styles.emptyActionIconWrap, { backgroundColor: colors.surfaceLight }]}>
              <MaterialCommunityIcons name="plus" size={28} color={colors.onSurface} />
            </View>
            <View style={styles.emptyActionContent}>
              <Text style={styles.emptyActionTitle}>I'll build it myself</Text>
              <Text style={styles.emptyActionDesc}>
                Start empty and pull from your templates and local suppliers by hand.
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color={colors.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.skipMaterialsButton}
            onPress={handleNext}
            activeOpacity={0.6}
            hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
          >
            <Text style={styles.skipMaterialsText}>Labour only · skip materials</Text>
            <MaterialCommunityIcons name="arrow-right" size={16} color={colors.primary} />
          </TouchableOpacity>
        </View>
      ) : null}
    </WebContainer>
  );

  const listFooter = (
    <WebContainer>
      {showMaterialsList && (
        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>Materials Subtotal:</Text>
          <Text style={styles.summaryValue}>
            {formatCurrency(materialsSubtotal)}
          </Text>
        </View>
      )}

      {showMaterialsList && (
        <View style={styles.materialsActionRow}>
          {/* Inline quick-add for an unsectioned material. Same component
              used in each section's footer — the collapsed state mirrors
              the old dashed "Add Material" pill, so the UI shape is
              unchanged until tapped. */}
          <View>
            <InlineAddMaterialRow
              sectionName=""
              onAdd={addMaterialToQuoteInline}
              pricesIncludeGst={currentQuote?.pricesIncludeGst === true}
              businessSettings={businessSettings}
              supplierGroups={supplierGroups}
              reeceConnected={reeceConnected === true}
              onReeceReauthRequired={handleReeceReauthRequired}
              onInvoicePress={openInvoiceForSection}
              onSupplierBookPress={openSupplierBookForSection}
            />
          </View>
          <View style={styles.materialsActionHalfRow}>
            <TouchableOpacity style={styles.addMaterialButtonHalf} onPress={() => { lightTap(); handleLoadTemplate(); }}>
              <MaterialCommunityIcons name="puzzle-outline" size={18} color={colors.primary} />
              <Text style={styles.addMaterialButtonText}>Load Template</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addMaterialButtonHalf} onPress={() => { lightTap(); setNewSectionName(''); setShowNewSectionModal(true); }}>
              <MaterialCommunityIcons name="folder-plus-outline" size={18} color={colors.primary} />
              <Text style={styles.addMaterialButtonText}>New Section</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Spacer for fixed bottom button */}
      <View style={{ height: 120 }} />
    </WebContainer>
  );

  return (
    <View style={styles.container}>
      <FlatList
          data={showMaterialsList ? flatData : []}
          keyExtractor={(item) => item.key}
          renderItem={renderFlatItem}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          windowSize={5}
          initialNumToRender={50}
          maxToRenderPerBatch={16}
          removeClippedSubviews
          ListHeaderComponent={listHeader}
          ListEmptyComponent={listEmpty}
          ListFooterComponent={listFooter}
      />

      <FixedBottomButton
        label={isAiAnalyzing ? "Cancel" : (isEditFromPreview ? "Save" : "Next: Labor & Markup")}
        onPress={isAiAnalyzing ? handleCancelGeneration : (isEditFromPreview ? handleSaveAndReturn : handleNext)}
        mode={isAiAnalyzing ? "outlined" : "contained"}
        buttonStyle={isAiAnalyzing ? { borderColor: colors.error, borderWidth: 2 } : undefined}
        labelStyle={isAiAnalyzing ? { color: colors.error } : undefined}
        secondaryLabel={materials.length > 0 && !isAiAnalyzing ? "Fetch Prices" : undefined}
        secondaryOnPress={materials.length > 0 && !isAiAnalyzing ? handleFetchPrices : undefined}
        secondaryLoading={isFetchingPrices}
        secondaryDisabled={isFetchingPrices}
        secondaryLoadingText={isFetchingPrices ? (fetchPhase === 'batch' ? `Searching ${fetchProgress.total || ''} items...` : fetchProgress.total > 0 ? `${chasingTitle.split(' ')[0]} ${fetchProgress.current} of ${fetchProgress.total}...` : undefined) : undefined}
        secondaryLoadingOnPress={isFetchingPrices ? handleCancelFetchPrices : undefined}
      />

      {/* New Section Modal — conditional render so the form's children aren't
          sitting in memory while hidden. */}
      {showNewSectionModal && (
      <Portal>
        <Modal
          visible={showNewSectionModal}
          onDismiss={() => {
            setShowNewSectionModal(false);
            setNewSectionName('');
            setNewSectionLaborHours('');
          }}
          contentContainerStyle={styles.newSectionModal}
        >
          <Text style={styles.newSectionModalTitle}>New Section</Text>
          <TextInput
            label="Section Name"
            value={newSectionName}
            onChangeText={setNewSectionName}
            mode="outlined"
            style={{ marginBottom: 12 }}
            placeholder="e.g. Fence Bay, Gate, Footings"
            autoFocus
          />
          <TextInput
            label="Labour Hours"
            value={newSectionLaborHours}
            onChangeText={setNewSectionLaborHours}
            mode="outlined"
            keyboardType="decimal-pad"
            placeholder="e.g. 2.5"
            right={<TextInput.Affix text="hrs" />}
            style={{ marginBottom: 16 }}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
            <TouchableOpacity
              style={styles.newSectionCancelBtn}
              onPress={() => {
                setShowNewSectionModal(false);
                setNewSectionName('');
                setNewSectionLaborHours('');
              }}
            >
              <Text style={styles.newSectionCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.newSectionSaveBtn,
                (!newSectionName.trim() || !(parseFloat(newSectionLaborHours) > 0)) && { opacity: 0.5 },
              ]}
              disabled={!newSectionName.trim() || !(parseFloat(newSectionLaborHours) > 0)}
              onPress={handleCreateSection}
            >
              <Text style={styles.newSectionSaveText}>Create</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      </Portal>
      )}

      {/* Template Picker Modal */}
      {templatePickerVisible && (
      <Portal>
        <Modal
          visible={templatePickerVisible}
          onDismiss={() => { setTemplatePickerVisible(false); setSelectedTemplate(null); }}
          contentContainerStyle={styles.templatePickerModal}
        >
          {!selectedTemplate ? (
            <>
              <Text style={styles.templatePickerTitle}>Load Section Template</Text>
              <ScrollView style={{ maxHeight: 400 }}>
                {availableTemplates.map(t => {
                  const matCost = t.materials.reduce((sum, m) => sum + (m.quantity * m.price), 0);
                  const laborCost = t.laborHours * t.laborRate;
                  return (
                    <TouchableOpacity
                      key={t.id}
                      style={styles.templatePickerCard}
                      onPress={() => setSelectedTemplate(t)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.templatePickerCardName}>{t.name}</Text>
                      <Text style={styles.templatePickerCardInfo}>
                        {t.materials.length} material{t.materials.length !== 1 ? 's' : ''} · {formatCurrency(matCost + laborCost)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <TouchableOpacity
                style={styles.newSectionCancelBtn}
                onPress={() => setTemplatePickerVisible(false)}
              >
                <Text style={styles.newSectionCancelText}>Cancel</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.templatePickerTitle}>{selectedTemplate.name}</Text>
              {selectedTemplate.description && (
                <Text style={styles.templatePickerDesc}>{selectedTemplate.description}</Text>
              )}
              <ScrollView style={{ maxHeight: 300 }}>
                {selectedTemplate.materials.map((m, i) => (
                  <MaterialItemCard
                    key={`preview-${i}`}
                    material={{ ...m, id: `preview-${i}` } as Material}
                  />
                ))}
              </ScrollView>
              <View style={styles.templatePreviewLabor}>
                <Text style={styles.templatePreviewLaborText}>
                  Labor: {selectedTemplate.laborHours} {selectedTemplate.laborUnit === 'days' ? 'days' : 'hrs'} @ {formatCurrency(selectedTemplate.laborRate)}{selectedTemplate.laborUnit === 'days' ? '/day' : '/hr'}
                </Text>
                <Text style={styles.templatePreviewLaborTotal}>
                  {formatCurrency(selectedTemplate.laborHours * selectedTemplate.laborRate)}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                <TouchableOpacity
                  style={styles.newSectionCancelBtn}
                  onPress={() => setSelectedTemplate(null)}
                >
                  <Text style={styles.newSectionCancelText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.newSectionSaveBtn}
                  onPress={() => handleConfirmLoadTemplate(selectedTemplate)}
                >
                  <Text style={styles.newSectionSaveText}>Add to Quote</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </Modal>
      </Portal>
      )}

      {/* Delete Material Confirmation */}
      <AlertModal
        visible={deleteDialogVisible}
        onDismiss={() => setDeleteDialogVisible(false)}
        type="error"
        icon="delete"
        title="Delete Material"
        message="Are you sure you want to remove this material?"
        primaryButtonText="Delete"
        primaryButtonAction={confirmDeleteMaterial}
        secondaryButtonText="Cancel"
        secondaryButtonAction={() => setDeleteDialogVisible(false)}
        showConfetti={false}
      />

      {/* Unpriced Materials Warning */}
      <AlertModal
        visible={unpricedDialogVisible}
        onDismiss={() => setUnpricedDialogVisible(false)}
        type="warning"
        title="Unpriced Materials"
        message="Some materials don't have prices yet. You can continue anyway and add prices later, or go back to add them now."
        primaryButtonText="Continue Anyway"
        primaryButtonAction={proceedWithUnpricedMaterials}
        secondaryButtonText="Go Back"
        secondaryButtonAction={() => setUnpricedDialogVisible(false)}
        showConfetti={false}
      />

      {/* Material Match Selector Modal */}
      <MaterialMatchSelector
        visible={matchSelectorVisible}
        materialName={pendingMaterialName}
        matches={pendingMatches}
        quantityAdjustment={undefined}
        onSelect={handleMatchSelected}
        onCancel={handleMatchCanceled}
      />

      {/* Fetch Time Estimate Modal — heaviest of the bunch, keeps a list of
          per-item status rows. Conditional render means it doesn't sit in
          memory after fetch completes. */}
      {showFetchEstimateModal && (
      <Portal>
        <Modal
          visible={showFetchEstimateModal}
          onDismiss={() => { setShowFetchEstimateModal(false); setFetchMinimized(true); }}
          dismissable={true}
          contentContainerStyle={styles.fetchEstimateModalContainer}
        >
          <View style={styles.fetchEstimateCard}>
            <IconButton
              icon="truck-fast-outline"
              iconColor={colors.primary}
              size={48}
              style={styles.fetchEstimateIcon}
            />
            <Text style={styles.fetchEstimateTitle}>{chasingTitle}</Text>
            <Text style={styles.fetchEstimateTime}>
              {Math.floor(fetchEstimateSeconds / 60)}:{String(fetchEstimateSeconds % 60).padStart(2, '0')}
            </Text>
            {fetchEstimateSeconds >= 10 && getTimeFunFact(fetchEstimateSeconds) ? (
              <Text style={styles.fetchFunFact}>
                {getTimeFunFact(fetchEstimateSeconds)}
              </Text>
            ) : null}

            {/* Progress bar - determinate during batch, shows chunk progress */}
            {(fetchPhase === 'batch' || fetchProgress.total > 0) ? (
              <View style={styles.progressBarContainer}>
                <View style={[styles.progressBarFill, {
                  width: fetchPhase === 'batch'
                    ? `${batchChunkProgress.total > 0 ? (batchChunkProgress.current / batchChunkProgress.total) * 100 : 0}%`
                    : `${(fetchProgress.current / fetchProgress.total) * 100}%`,
                }]} />
              </View>
            ) : null}

            <Text style={styles.fetchEstimateSubtext}>
              {fetchPhase === 'batch'
                ? `Batch ${Math.min(batchChunkProgress.current + 1, batchChunkProgress.total)} of ${batchChunkProgress.total} (${fetchProgress.current} of ${fetchProgress.total} done)`
                : fetchProgress.total > 0 && currentFetchingName
                ? `${chasingSubtitle} ${fetchProgress.current} of ${fetchProgress.total}`
                : 'Warming up the ute...'}
            </Text>
            {/* Item list - during batch show per-item status, otherwise show last 2 + current */}
            <View style={[styles.fetchItemsWindow, fetchPhase === 'batch' && { maxHeight: 200 }]}>
              <ScrollView style={{ flex: 1 }} nestedScrollEnabled>
                <View style={styles.fetchItemsContent}>
                  {fetchPhase === 'batch' && batchItemStatuses.size > 0 ? (
                    // Show all items with per-item status icons
                    Array.from(batchItemStatuses.entries()).map(([term, status], index) => (
                      <View key={index} style={styles.fetchItemRow}>
                        {status === 'searching' ? (
                          <ActivityIndicator size={14} color={colors.primary} />
                        ) : status === 'done' ? (
                          <MaterialCommunityIcons name={'check-circle' as any} size={16} color={colors.success} />
                        ) : status === 'failed' ? (
                          <MaterialCommunityIcons name={'close-circle' as any} size={16} color={colors.error} />
                        ) : (
                          <MaterialCommunityIcons name={'clock-outline' as any} size={16} color={colors.textMuted} />
                        )}
                        <Text
                          style={[
                            styles.fetchItemText,
                            status === 'searching' ? styles.fetchItemActive :
                            status === 'done' ? styles.fetchItemDone :
                            status === 'failed' ? styles.fetchItemFailed :
                            { color: colors.textMuted },
                          ]}
                          numberOfLines={1}
                        >
                          {term}
                        </Text>
                      </View>
                    ))
                  ) : (
                    <>
                      {fetchedItemNames.slice(-2).map((item, index) => (
                        <View key={index} style={styles.fetchItemRow}>
                          <MaterialCommunityIcons
                            name={item.success ? 'check-circle' as any : 'close-circle' as any}
                            size={16}
                            color={item.success ? colors.success : colors.error}
                          />
                          <Text
                            style={[
                              styles.fetchItemText,
                              item.success ? styles.fetchItemDone : styles.fetchItemFailed,
                            ]}
                            numberOfLines={1}
                          >
                            {item.name}
                          </Text>
                        </View>
                      ))}
                      {currentFetchingName ? (
                        <View style={styles.fetchItemRow}>
                          <ActivityIndicator size={14} color={colors.primary} />
                          <Text style={[styles.fetchItemText, styles.fetchItemActive]} numberOfLines={1}>
                            {currentFetchingName}
                          </Text>
                        </View>
                      ) : null}
                    </>
                  )}
                </View>
              </ScrollView>
            </View>

            <View style={styles.fetchEstimateButtonRow}>
              <Button
                mode="outlined"
                onPress={() => {
                  setShowFetchEstimateModal(false);
                  setFetchMinimized(true);
                }}
                style={[styles.fetchEstimateCloseButton, { flex: 1 }]}
                textColor={colors.textMuted}
                icon="chevron-down"
              >
                Minimize
              </Button>
            </View>
            <Button
              mode="contained"
              onPress={() => {
                notifyWhenDoneRef.current = true;
                setNotifyWhenDone(true);
                setShowFetchEstimateModal(false);
                setFetchMinimized(true);
              }}
              style={[styles.fetchEstimateCloseButton, { width: '100%', marginTop: 10 }]}
              buttonColor={colors.primary}
              icon="bell-ring-outline"
            >
              Notify When Done
            </Button>
          </View>
        </Modal>
      </Portal>
      )}

      {/* Minimized fetch progress pill */}
      {fetchMinimized && isFetchingPrices && (
        <TouchableOpacity
          style={styles.fetchMinimizedPill}
          onPress={() => {
            setFetchMinimized(false);
            setShowFetchEstimateModal(true);
          }}
          activeOpacity={0.8}
        >
          <ActivityIndicator size={14} color={colors.primary} />
          <Text style={styles.fetchMinimizedText} numberOfLines={1}>
            {fetchPhase === 'batch'
              ? `${fetchProgress.current}/${fetchProgress.total}`
              : fetchProgress.total > 0
              ? `${fetchProgress.current}/${fetchProgress.total}`
              : 'Fetching...'}
          </Text>
          <View style={styles.fetchMinimizedProgressBg}>
            <View style={[styles.fetchMinimizedProgressFill, {
              width: fetchProgress.total > 0
                ? `${(fetchProgress.current / fetchProgress.total) * 100}%`
                : '0%',
            }]} />
          </View>
          {notifyWhenDone && <MaterialCommunityIcons name="bell-ring-outline" size={14} color={colors.primary} />}
          <MaterialCommunityIcons name="chevron-up" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      )}

      {/* Save Section as Template Modal */}
      {saveTemplateModalVisible && (
      <Portal>
        <Modal
          visible={saveTemplateModalVisible}
          onDismiss={() => setSaveTemplateModalVisible(false)}
          contentContainerStyle={styles.newSectionModal}
        >
          <Text style={styles.newSectionModalTitle}>Save as Template</Text>
          <Text style={{ color: colors.textMuted, fontSize: 13, marginBottom: 16 }}>
            Save this section so you can chuck it on future quotes, no worries.
          </Text>
          <TextInput
            label="Template Name"
            value={saveTemplateName}
            onChangeText={setSaveTemplateName}
            mode="outlined"
            style={{ marginBottom: 12 }}
            placeholder="e.g. Standard Fence Bay"
          />
          <TextInput
            label="Labour Hours (per 1 unit)"
            value={saveTemplateLaborHours}
            onChangeText={setSaveTemplateLaborHours}
            mode="outlined"
            keyboardType="numeric"
            style={{ marginBottom: 12 }}
            placeholder="e.g. 2.5"
          />
          <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 6 }}>
            Keywords (for matching to job descriptions)
          </Text>
          {saveTemplateKeywords.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {saveTemplateKeywords.map((kw, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, backgroundColor: colors.surfaceDark, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ fontSize: 12, color: colors.text }}>{kw}</Text>
                  <Pressable onPress={() => setSaveTemplateKeywords(prev => prev.filter((_, idx) => idx !== i))} hitSlop={6}>
                    <MaterialCommunityIcons name="close-circle" size={14} color={colors.textMuted} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          <TextInput
            label="Add keyword"
            value={saveTemplateKeywordInput}
            onChangeText={(text) => {
              if (text.endsWith(',')) {
                const kw = text.slice(0, -1).trim().toLowerCase();
                if (kw && !saveTemplateKeywords.includes(kw)) setSaveTemplateKeywords(prev => [...prev, kw]);
                setSaveTemplateKeywordInput('');
              } else {
                setSaveTemplateKeywordInput(text);
              }
            }}
            onSubmitEditing={() => {
              const kw = saveTemplateKeywordInput.trim().toLowerCase();
              if (kw && !saveTemplateKeywords.includes(kw)) setSaveTemplateKeywords(prev => [...prev, kw]);
              setSaveTemplateKeywordInput('');
            }}
            mode="outlined"
            style={{ marginBottom: 16 }}
            placeholder='e.g. fence bay, colorbond fence'
          />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
            <TouchableOpacity
              style={styles.newSectionCancelBtn}
              onPress={() => setSaveTemplateModalVisible(false)}
            >
              <Text style={styles.newSectionCancelText}>Nah</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.newSectionSaveBtn}
              onPress={handleConfirmSaveTemplate}
            >
              <Text style={styles.newSectionSaveText}>Save It</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      </Portal>
      )}

      {/* Delete Section Confirmation Modal */}
      <AlertModal
        visible={deleteSectionModalVisible}
        onDismiss={() => setDeleteSectionModalVisible(false)}
        type="warning"
        title="Ditch This Section?"
        message={`Gonna chuck "${deleteSectionName}" and all the materials in it. This can't be undone, mate.`}
        icon="delete-outline"
        showConfetti={false}
        primaryButtonText="Yeah, Ditch It"
        primaryButtonAction={handleConfirmDeleteSection}
        secondaryButtonText="Nah, Keep It"
        secondaryButtonAction={() => setDeleteSectionModalVisible(false)}
      />

      {/* Success Modal */}
      <AlertModal
        visible={showSuccessModal}
        onDismiss={() => { setShowSuccessModal(false); setSuccessType('success'); setSuccessShowFetchPrices(false); }}
        type={successType}
        title={successTitle}
        message={successMessage}
        primaryButtonText={successShowFetchPrices ? 'Fetch Prices' : undefined}
        primaryButtonAction={successShowFetchPrices ? () => {
          setShowSuccessModal(false);
          setSuccessType('success');
          setSuccessShowFetchPrices(false);
          handleFetchPrices();
        } : undefined}
        secondaryButtonText={successShowFetchPrices ? 'Close' : undefined}
        secondaryButtonAction={successShowFetchPrices ? () => {
          setShowSuccessModal(false);
          setSuccessType('success');
          setSuccessShowFetchPrices(false);
        } : undefined}
      />

      {/* Invoice/receipt source picker — fires from the 📄 icon button on
          each section's inline-add row. */}
      <ActionSheet
        visible={invoiceSheetVisible}
        onDismiss={() => setInvoiceSheetVisible(false)}
        title="Add from invoice"
        subtitle="Snap any supplier docket — even the crumpled one from the ute floor. We'll squint at it and pull out the line items so you're not bashing them in one by one."
        options={invoiceSheetOptions}
      />
      <SupplierListCaptureModal
        visible={invoiceImporter.captureModalVisible}
        onCancel={invoiceImporter.cancelCapture}
        onComplete={invoiceImporter.handleCaptureComplete}
        processing={invoiceImporter.phase === 'extracting'}
        processingLabel={invoiceImporter.loadingLabel}
      />
      <InvoiceReviewModal
        visible={invoiceImporter.reviewModalVisible}
        initialSupplierName={invoiceImporter.extractedSupplierName}
        initialItems={invoiceImporter.extractedItems}
        saving={invoiceImporter.saving}
        onCancel={invoiceImporter.cancelReview}
        onConfirm={invoiceImporter.handleAddToQuote}
      />
      <Snackbar
        visible={!!invoiceSnackbar}
        onDismiss={() => setInvoiceSnackbar(null)}
        duration={3000}
      >
        {invoiceSnackbar ?? ''}
      </Snackbar>

      {/* Unsaved-changes confirmation when navigating away */}
      <AlertModal {...unsavedModalProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    ...(Platform.OS === 'web' && {
      display: 'flex' as any,
      flexDirection: 'column' as any,
      height: '100%' as any,
      overflow: 'hidden' as any,
    }),
  },
  scrollView: {
    flex: 1,
    ...(Platform.OS === 'web' && {
      overflow: 'auto' as any,
      flexShrink: 1,
    }),
  },
  scrollContent: {
    // Top breathing room so the first item (section header, unsectioned
    // card, or an inline edit form) doesn't sit flush against the screen
    // header — applies uniformly regardless of what row 0 happens to be.
    paddingTop: 12,
    paddingBottom: 140,
    flexGrow: 1,
    // Cap the materials list on iPad/large screens (and web) so cards don't
    // stretch edge-to-edge on landscape tablets. Matches WebContainer's 800px
    // default — set on the FlatList's contentContainerStyle so it applies to
    // the rows themselves, not just the header/empty/footer slots.
    width: '100%',
    maxWidth: 800,
    alignSelf: 'center',
    ...(Platform.OS === 'web' && {
      height: '0px' as any,
    }),
  },
  listView: {
  },
  listItem: {
    backgroundColor: colors.surface,
    marginHorizontal: 12,
    marginBottom: 10,
    borderRadius: 12,
    overflow: 'hidden',
  },
  listItemFetching: {
    backgroundColor: colors.surface,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 4,
    gap: 10,
  },
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  categoryTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  categoryCount: {
    fontSize: 12,
    color: colors.textMuted,
  },
  itemTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 4,
  },
  itemStatusIcon: {
    width: 28,
    marginTop: 2,
  },
  itemNameWrap: {
    flex: 1,
    marginRight: 12,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 20,
  },
  itemUnitPrice: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  itemPriceWrap: {
    alignItems: 'flex-end',
    marginTop: 2,
  },
  itemTotal: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
  },
  itemBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 12,
    paddingTop: 6,
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  qtyStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  qtyBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  qtyBtnPressed: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    transform: [{ scale: 0.9 }],
  },
  qtyInput: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    minWidth: 36,
    textAlign: 'center',
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
  qtyUnit: {
    fontSize: 13,
    color: colors.textMuted,
    marginLeft: 8,
  },
  itemActions: {
    flexDirection: 'row',
    gap: 4,
  },
  actionBtn: {
    padding: 8,
    borderRadius: 8,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: '30%',
  },
  emptyText: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 28,
  },
  emptyActionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reeceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.primaryBg,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  reeceBannerText: {
    flex: 1,
  },
  reeceBannerTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  reeceBannerSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  emptyActionIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  emptyActionContent: {
    flex: 1,
  },
  emptyActionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  emptyActionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 3,
  },
  emptyActionDesc: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
  skipMaterialsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 4,
  },
  skipMaterialsText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  generateButton: {
    marginTop: 8,
  },
  // Template suggestion styles
  suggestionsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
    alignSelf: 'flex-start',
  },
  suggestionCard: {
    width: '100%',
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  suggestionCardChecked: {
    borderColor: colors.primary,
  },
  suggestionCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  suggestionInfo: {
    flex: 1,
  },
  suggestionName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  suggestionMeta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  suggestionReasoning: {
    fontSize: 11,
    color: colors.primary,
    fontStyle: 'italic',
    marginTop: 3,
  },
  suggestionCompactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  suggestionQtyBadge: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  suggestionUnitCost: {
    fontSize: 12,
    color: colors.textMuted,
    marginLeft: 'auto',
  },
  suggestionMatchHint: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  fillGapsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  fillGapsToggleText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textMuted,
  },
  secondaryActionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    marginTop: 4,
  },
  secondaryActionLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
  },
  secondaryActionText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.primary,
  },
  suggestionQtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 12,
    paddingTop: 4,
    gap: 10,
  },
  suggestionQtyLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textMuted,
  },
  suggestionStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  suggestionStepperBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  suggestionStepperValue: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    minWidth: 30,
    textAlign: 'center',
    paddingVertical: 4,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
  suggestionQtyTotal: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
    marginLeft: 'auto',
  },
  suggestionActions: {
    width: '100%',
    gap: 8,
    marginTop: 8,
    marginBottom: 4,
  },
  loadAndFillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  loadAndFillBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  loadOnlyBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  loadOnlyBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  orDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginVertical: 16,
    gap: 12,
  },
  orDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  orDividerText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  // Section Card styles
  sectionCard: {
    borderRadius: 12,
    marginHorizontal: 4,
    marginBottom: 16,
    backgroundColor: colors.surfaceDark,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionCardHeaderStandalone: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginHorizontal: 4,
    marginTop: 16,
    // No marginBottom — material rows below share the same section tint and
    // sit flush against the header, so the whole section reads as one block.
    backgroundColor: colors.surfaceDark,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sectionCardHeaderCollapsed: {
    borderBottomWidth: 0,
  },
  sectionCardFooterStandalone: {
    marginHorizontal: 4,
    marginBottom: 8,
    paddingTop: 4,
    backgroundColor: colors.surfaceDark,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  sectionCardFooterCollapsed: {
    paddingTop: 0,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  },
  sectionCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 10,
    backgroundColor: colors.primary + '18',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sectionCardNameRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionCardName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  sectionCardNameInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 6,
    backgroundColor: colors.surface,
  },
  multiplierStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    marginHorizontal: 8,
  },
  multiplierBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  multiplierValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    minWidth: 24,
    textAlign: 'center',
    paddingVertical: 3,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
  sectionCardActions: {
    flexDirection: 'row',
    gap: 12,
  },
  inlineAddRow: {
    marginHorizontal: 12,
    // Tightened from 8 so the gap above the dashed Add Material pill matches
    // the gap between material cards inside the section (last card's
    // marginBottom + footer paddingTop already supply enough breathing).
    marginTop: 2,
    marginBottom: 8,
  },
  inlineEditWrap: {
    // Horizontal margin comes from materialItemWrap (section tint), so just
    // pad to give the edit form roughly the same inset as a regular card.
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  // Unsectioned edit — no surrounding tint, so own the horizontal margin
  // so the card lines up with a regular MaterialItemCard (listItem uses
  // marginHorizontal: 12, marginBottom: 10).
  inlineEditWrapUnsectioned: {
    marginHorizontal: 12,
    marginBottom: 10,
  },
  // Wraps each material row inside a section. Shares colors.surfaceDark
  // with the section header/footer so the whole group reads as a single
  // rounded container instead of cards floating on the dark screen.
  materialItemWrap: {
    marginHorizontal: 4,
    backgroundColor: colors.surfaceDark,
  },
  // First material in a section — listItem has no marginTop, so without
  // this the card sits flush against the header's bottom divider.
  materialItemWrapFirst: {
    paddingTop: 10,
  },
  // Last material in a section — keeps the gap above the inline-add row
  // matching the gap between cards (listItem already has marginBottom: 10).
  // No padding here because the card's own marginBottom carries the space;
  // kept as a hook so we can dial it independently if the design shifts.
  materialItemWrapLast: {},
  sectionAddMaterialBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: 12,
    marginVertical: 8,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: 'dashed',
  },
  sectionAddMaterialText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  sectionCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.primary + '0A',
  },
  sectionCardFooterLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  sectionCardFooterValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
  },
  materialsActionRow: {
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
  },
  materialsActionHalfRow: {
    flexDirection: 'row',
    gap: 8,
  },
  addMaterialButtonFull: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: 'dashed',
  },
  addMaterialButtonHalf: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: 'dashed',
  },
  addMaterialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: 'dashed',
  },
  addMaterialButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  sectionRenameInput: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 6,
    backgroundColor: colors.surface,
  },
  newSectionModal: {
    backgroundColor: colors.surface,
    margin: 20,
    padding: 20,
    borderRadius: 12,
  },
  // Template picker
  templatePickerModal: {
    backgroundColor: colors.surface,
    margin: 16,
    padding: 20,
    borderRadius: 12,
    maxHeight: '80%' as any,
  },
  templatePickerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
  },
  templatePickerDesc: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 12,
  },
  templatePickerCard: {
    padding: 14,
    borderRadius: 10,
    marginBottom: 8,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  templatePickerCardName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  templatePickerCardInfo: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  templatePreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  templatePreviewQty: {
    width: 60,
    fontSize: 13,
    color: colors.textMuted,
  },
  templatePreviewName: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
  },
  templatePreviewPrice: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
    marginLeft: 8,
  },
  templatePreviewLabor: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  templatePreviewLaborText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  templatePreviewLaborTotal: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  newSectionModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 16,
  },
  newSectionCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  newSectionCancelText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textMuted,
  },
  newSectionSaveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  newSectionSaveText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // Card-style instead of edge-to-edge bar — matches the surrounding
    // material cards so the row doesn't look cropped on wide screens.
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primary,
  },
  materialDescription: {
    fontSize: 13,
    color: colors.textMuted,
  },
  aiEstimateLabel: {
    fontSize: 10,
    color: colors.onSurface,
    fontStyle: 'italic',
    opacity: 0.4,
    marginTop: 2,
  },
  searchingLabel: {
    fontSize: 13,
    color: colors.primary,
    fontStyle: 'italic',
  },
  searchingPrice: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textMuted,
  },
  itemTotalSuccess: {
    color: colors.success,
  },
  expandedContent: {
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  detailsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'flex-start',
  },
  productImage: {
    width: Platform.OS === 'web' ? 100 : 80,
    height: Platform.OS === 'web' ? 100 : 80,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  detailsColumn: {
    flex: 1,
    minWidth: 200,
  },
  detailRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted,
    marginRight: 8,
    minWidth: 80,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.text,
    flex: 1,
  },
  // AI Analyzing State with Lottie
  aiAnalyzingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    paddingHorizontal: 20,
    margin: 'auto',
    minHeight: 300,
    minWidth: 300,
    maxWidth: 500,
  },
  lottieWrapper: {
    width: 250,
    height: 250,
    marginBottom: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lottieAnimation: {
    width: 250,
    height: 250,
  },
  aiAnalyzingTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  aiAnalyzingSubtitle: {
    fontSize: 14,
    color: colors.onSurface,
    textAlign: 'center',
    marginBottom: 24,
  },
  stepsWindow: {
    width: '100%',
    height: STEP_HEIGHT * VISIBLE_STEPS,
    overflow: 'hidden',
    marginBottom: 24,
    paddingHorizontal: 12,
  },
  stepsTrack: {
    width: '100%',
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: STEP_HEIGHT,
    gap: 10,
  },
  stepText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  stepTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  stepTextDone: {
    color: colors.success,
  },
  // Fetch Time Estimate Modal
  fetchEstimateModalContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  fetchEstimateCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    ...Platform.select({
      android: { elevation: 8 },
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      web: { boxShadow: '0 4px 20px rgba(0,0,0,0.15)' },
    }),
  },
  fetchEstimateIcon: {
    marginBottom: 8,
  },
  fetchEstimateTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 16,
  },
  fetchEstimateTime: {
    fontSize: 48,
    fontWeight: '700',
    color: colors.primary,
    fontVariant: ['tabular-nums'],
    marginBottom: 4,
  },
  fetchEstimateSubtext: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 4,
  },
  fetchCurrentItem: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: 4,
    textAlign: 'center',
  },
  fetchFunFact: {
    fontSize: 12,
    fontStyle: 'italic',
    color: colors.textMuted,
    marginBottom: 12,
    textAlign: 'center',
    opacity: 0.8,
  },
  progressBarContainer: {
    width: '100%',
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    marginBottom: 10,
    overflow: 'hidden' as const,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  progressBarIndeterminate: {
    width: '40%',
    opacity: 0.7,
  },
  fetchItemsWindow: {
    width: '100%',
    maxHeight: 100,
    marginBottom: 20,
    borderRadius: 10,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  fetchItemsScroll: {
    flex: 1,
  },
  fetchItemsContent: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  fetchItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 28,
  },
  fetchItemText: {
    fontSize: 13,
    flex: 1,
  },
  fetchItemDone: {
    color: colors.success,
  },
  fetchItemFailed: {
    color: colors.error,
  },
  fetchItemActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  fetchEstimateButtonRow: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
  },
  fetchEstimateCloseButton: {
    borderColor: colors.border,
  },
  fetchMinimizedPill: {
    position: 'absolute',
    bottom: 110,
    left: 16,
    right: 16,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 24,
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  fetchMinimizedText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  fetchMinimizedProgressBg: {
    flex: 1,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  fetchMinimizedProgressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
});
