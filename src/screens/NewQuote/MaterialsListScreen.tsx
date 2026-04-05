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
} from 'react-native-paper';
import { useNavigation, useIsFocused, useRoute } from '@react-navigation/native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import LottieView from 'lottie-react-native';
import { generateId } from '../../utils/generateId';

import { useStore } from '../../store/useStore';
import { useCurrentDocument, useDocumentMode } from '../../utils/documentMode';
import { Material, QuoteSection, LaborUnit, SectionTemplate } from '../../types';
import { loadTemplates, saveTemplate, matchTemplatesByKeywords, extractQuantityForKeyword, suggestKeywordsFromName } from '../../services/sectionTemplateService';
import { colors } from '../../theme';
import { formatCurrency, updateMaterialTotalPrice } from '../../utils/quoteCalculator';
import { bunningsApi } from '../../services/bunningsApi';
import { searchMaterialPrice } from '../../services/webSearchPricing';
import { searchReeceMaterialPrice } from '../../services/reeceApi';
import { analyzeJobDescription, convertLLMMaterialsToMaterials } from '../../services/llmService';
import { getTradeCategoryById, getTradeNicheById, TRADE_CATEGORIES } from '../../constants/tradeCategories';
import { MaterialItemCard } from '../../components/MaterialItemCard';
import { NestableScrollContainer, NestableDraggableFlatList, RenderItemParams } from 'react-native-draggable-flatlist';
import { CollapsibleSection } from '../../components/CollapsibleSection';
import { useTourRefs } from '../../components/tour/useTourRefs';
import { ScreenTour } from '../../components/tour/ScreenTour';
import { notifyScreenComplete, notifySkipRequest } from '../../components/tour/UnifiedTourController';
import { PHASE_STEP_OFFSETS, UNIFIED_TOUR_TOTAL_STEPS } from '../../components/tour/tourFlow';
import { getTourMaterialsPriced } from '../../components/tour/tourDummyData';
import { notificationService } from '../../services/notificationService';

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
} from '../../services/materialFavorites';
import MaterialMatchSelector from '../../components/MaterialMatchSelector';
import {
  findBestMatchForMaterial,
  ScraperProduct,
  batchFindBestMatchesProgressive,
} from '../../services/bunningsScraperClient';
import { FixedBottomButton } from '../../components/FixedBottomButton';
import { WebContainer } from '../../components/WebContainer';
import { AlertModal } from '../../components/AlertModal';
import { ProBadge } from '../../components/ProBadge';

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
  const { businessSettings, subscriptionStatus, saveDraft, unifiedTourActive, unifiedTourPhase, updateQuote: storeUpdateQuote } = useStore();
  const isTrialActive = !!(subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired);
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  // Tour refs
  const { registerRef } = useTourRefs();
  const aiGenerateRef = useRef<View>(null);
  const addManualRef = useRef<View>(null);
  const firstMaterialItemRef = useRef<View>(null);
  const addMaterialButtonRef = useRef<View>(null);
  const fetchPricesButtonRef = useRef<View>(null);
  const materialsScrollRef = useRef<ScrollView>(null);
  const [tourActive, setTourActive] = useState(false);
  const tourPastFetchRef = useRef(false);

  useEffect(() => {
    if (aiGenerateRef.current) registerRef('aiGenerateCard', aiGenerateRef.current);
    if (addManualRef.current) registerRef('addManualCard', addManualRef.current);
    if (firstMaterialItemRef.current) registerRef('firstMaterialItem', firstMaterialItemRef.current);
    if (addMaterialButtonRef.current) registerRef('addMaterialButton', addMaterialButtonRef.current);
    if (fetchPricesButtonRef.current) registerRef('fetchPricesButton', fetchPricesButtonRef.current);
  });

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
  const cancelFetchRef = useRef(false);
  const cancelFetchResolverRef = useRef<(() => void) | null>(null);
  const [recentlyPricedIds, setRecentlyPricedIds] = useState<Set<string>>(new Set());
  const batchProgressAnim = useRef(new Animated.Value(0)).current;
  const priceFlashAnims = useRef<Map<string, Animated.Value>>(new Map());
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [initialMaterialCount, setInitialMaterialCount] = useState(0);
  const [cancelGeneration, setCancelGeneration] = useState(false);

  // Animate indeterminate progress bar during batch fetch phase
  useEffect(() => {
    if (fetchPhase === 'batch') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(batchProgressAnim, { toValue: 1, duration: 1200, useNativeDriver: false }),
          Animated.timing(batchProgressAnim, { toValue: 0, duration: 1200, useNativeDriver: false }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      batchProgressAnim.setValue(0);
    }
  }, [fetchPhase]);

  // Unified tour: show brief fake AI loading when transitioning materialsList → materialsListItems
  useEffect(() => {
    if (unifiedTourActive && unifiedTourPhase === 'materialsListItems' && materials.length > 0 && !isAiAnalyzing) {
      // Materials were just injected — show fake loading for 2s
      setIsAiAnalyzing(true);
      const timer = setTimeout(() => {
        setIsAiAnalyzing(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [unifiedTourPhase]);

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
  const [renamingSectionKey, setRenamingSectionKey] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  // Web drag-and-drop ref (must be at top level to avoid conditional hook call)
  const webDragRef = React.useRef<{ materialId: string } | null>(null);

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
      const jobDescription = currentQuote.job.description;

      // Prepare trade context from business settings (supports multi-select)
      const tradeContext = businessSettings ? (() => {
        let categoryNames: string[] = [];
        let nicheNames: string[] = [];
        let allSuggestedMaterials: string[] = [];
        let pricingMethod: string | undefined;

        // Try new multi-select fields first
        if (businessSettings.tradeCategories && businessSettings.tradeCategories.length > 0) {
          categoryNames = businessSettings.tradeCategories
            .map(id => getTradeCategoryById(id)?.name)
            .filter((n): n is string => !!n);

          if (businessSettings.tradeNiches && businessSettings.tradeNiches.length > 0) {
            businessSettings.tradeCategories.forEach(catId => {
              businessSettings.tradeNiches?.forEach(nicheId => {
                const niche = getTradeNicheById(catId, nicheId);
                if (niche) {
                  nicheNames.push(niche.name);
                  allSuggestedMaterials.push(...(niche.commonServices || []));
                  if (!pricingMethod && niche.pricingMethods && niche.pricingMethods.length > 0) {
                    pricingMethod = niche.pricingMethods[0].label;
                  }
                }
              });
            });
          }
        } else if (businessSettings.tradeCategory) {
          // Fallback to legacy single-select
          const category = getTradeCategoryById(businessSettings.tradeCategory);
          if (category) categoryNames.push(category.name);

          if (businessSettings.tradeNiche) {
            const niche = getTradeNicheById(businessSettings.tradeCategory, businessSettings.tradeNiche);
            if (niche) {
              nicheNames.push(niche.name);
              allSuggestedMaterials.push(...(niche.commonServices || []));
              if (niche.pricingMethods && niche.pricingMethods.length > 0) {
                pricingMethod = niche.pricingMethods[0].label;
              }
            }
          }
        }

        // Remove duplicates from suggested materials
        const uniqueMaterials = Array.from(new Set(allSuggestedMaterials));

        return {
          categoryName: categoryNames.join(', '),
          nicheName: nicheNames.join(', '),
          suggestedMaterials: uniqueMaterials.length > 0 ? uniqueMaterials : undefined,
          pricingMethod,
          selectedStore: businessSettings.selectedStore || 'bunnings',
        };
      })() : undefined;

      // Pass photo URLs for vision analysis if available (Pro feature)
      const quotePhotos = (currentQuote as any).photos;
      const photoUrlsForAi = (isPro && quotePhotos?.length)
        ? quotePhotos.map((p: any) => p.storageUrl).filter(Boolean)
        : undefined;

      // Pass existing materials so AI doesn't duplicate them (gap-fill mode)
      const existingMatsForAi = currentQuote.materials.length > 0
        ? currentQuote.materials.map(m => ({ name: m.name, quantity: m.quantity, unit: m.unit, section: m.section }))
        : undefined;

      // Pass saved templates so AI can reuse their section names and materials
      const templateDataForAi = allTemplates.length > 0
        ? allTemplates.map(t => ({
            name: t.name,
            materials: t.materials.map(m => ({ name: m.name, quantity: m.quantity, unit: m.unit })),
            laborHours: t.laborHours,
          }))
        : undefined;

      const analysis = await analyzeJobDescription(jobDescription, tradeContext, 3, photoUrlsForAi, existingMatsForAi, templateDataForAi);

      // Check if user canceled during AI analysis
      if (cancelGeneration) {
        return;
      }

      // Convert LLM materials to app materials format
      const baseMaterials = convertLLMMaterialsToMaterials(analysis.materials);

      // Add IDs to materials and ensure all required fields are present
      const generatedMaterials = baseMaterials.map((m) => ({
        id: generateId(),
        name: m.name || 'Unknown Material',
        quantity: m.quantity || 1,
        unit: m.unit || 'each',
        searchTerm: m.searchTerm,
        price: 0,
        totalPrice: 0,
        manualPriceOverride: false,
        ...(m.section && { section: m.section }),
        ...(m.templateBaseQuantity && { templateBaseQuantity: m.templateBaseQuantity }),
      }));

      // Create QuoteSection objects from unique AI-generated sections with multipliers + labor
      const sectionMultipliers = new Map<string, number>();
      const sectionLaborHours = new Map<string, number>();
      baseMaterials.forEach(m => {
        if (m.section && m.sectionMultiplier && m.sectionMultiplier > 1) {
          sectionMultipliers.set(m.section, m.sectionMultiplier);
        }
        if (m.section && (m as any).sectionLaborHours > 0) {
          sectionLaborHours.set(m.section, (m as any).sectionLaborHours);
        }
      });
      const existingSections = currentQuote.sections || [];
      const existingSectionNames = new Set(existingSections.map(s => s.name));
      const defaultRate = businessSettings?.defaultLaborRate || 85;
      const newSections: QuoteSection[] = [];
      sectionMultipliers.forEach((multiplier, sectionName) => {
        if (!existingSectionNames.has(sectionName)) {
          const perUnitHours = sectionLaborHours.get(sectionName) || 0;
          const useDays = perUnitHours >= 5;
          const laborRate = useDays ? defaultRate * 8 : defaultRate;
          const laborHoursValue = useDays ? perUnitHours / 8 : perUnitHours;
          newSections.push({
            id: `section-${Date.now()}-${sectionName.replace(/\s/g, '')}`,
            name: sectionName,
            multiplier,
            laborHours: laborHoursValue,
            laborRate,
            laborUnit: useDays ? 'days' : 'hours',
            laborTotal: laborHoursValue * laborRate * multiplier,
            sortOrder: existingSections.length + newSections.length,
          });
        }
      });

      // Update the quote with analyzed data
      const updatedJob = {
        ...currentQuote.job,
        estimatedHours: analysis.estimatedHours,
      };

      // If materials already exist (gap-fill mode), append instead of replace
      const hasExistingMaterials = currentQuote.materials.length > 0;
      const updatedQuote = {
        ...currentQuote,
        job: updatedJob,
        sections: [...existingSections, ...newSections],
        materials: hasExistingMaterials
          ? [...currentQuote.materials, ...generatedMaterials]
          : generatedMaterials,
        laborHours: hasExistingMaterials
          ? currentQuote.laborHours + (analysis.estimatedHours || 0)
          : analysis.estimatedHours,
      };

      updateQuote(updatedQuote);

      setSuccessTitle('Materials Generated!');
      setSuccessMessage(`Generated ${generatedMaterials.length} material${generatedMaterials.length !== 1 ? 's' : ''} from your job description.`);
      setShowSuccessModal(true);
    } catch (error: any) {
      setSuccessType('error');
      setSuccessTitle('Generation Failed');
      setSuccessMessage('Could not generate materials list. Please add materials manually or try again.');
      setShowSuccessModal(true);
    } finally {
      setIsAiAnalyzing(false);
      setCancelGeneration(false);
    }
  };

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

    // Calculate estimated time and show modal
    const materialsNeedingPrices = materials.filter(m => !(m.price > 0 && !m.manualPriceOverride));
    const useScraperApiBatch = true; // Always available via Firebase proxy
    // Batch mode processes 3 at a time (~35s per batch of 3) vs 35s per item individually
    const estimatedSeconds = useScraperApiBatch
      ? Math.max(Math.ceil(materialsNeedingPrices.length / 3) * 35, 35)
      : Math.max(materialsNeedingPrices.length * 35, 35);
    setFetchedItemNames([]);
    setFetchPhase('idle');
    setCurrentFetchingName('');
    startFetchCountdown(estimatedSeconds);

    // Set up cancel promise so in-flight requests can be interrupted instantly
    let cancelPromiseReject: (() => void) | null = null;
    const cancelPromise = new Promise<never>((_, reject) => {
      cancelPromiseReject = () => reject(new Error('__FETCH_CANCELLED__'));
    });
    cancelFetchResolverRef.current = cancelPromiseReject;

    // Helper to race any async call against the cancel promise
    const withCancel = <T,>(promise: Promise<T>): Promise<T> =>
      Promise.race([promise, cancelPromise]);

    setIsFetchingPrices(true);
    setNotifyWhenDone(false);
    cancelFetchRef.current = false;

    let fetchedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    // Count materials that need pricing
    const materialsToFetch = materials.filter(m => !(m.price > 0 && !m.manualPriceOverride));
    setFetchProgress({ current: 0, total: materialsToFetch.length });

    // Determine which pricing method to use
    const useBunningsApi = businessSettings?.useBunningsApi === true;
    const useReeceApi = false; // Disabled - API coming soon
    const useScraperApi = true; // Always available via Firebase proxy

    // Get selected store (single store only now)
    const selectedStore = businessSettings?.selectedStore || 'bunnings';
    const storeUrl = selectedStore === 'bunnings' ? 'bunnings.com.au' :
                     selectedStore === 'mitre10' ? 'mitre10.com.au' :
                     selectedStore === 'reece' ? 'reece.com.au' : 'bunnings.com.au';

    const hardwareStores = [storeUrl]; // Single store array for backwards compatibility

    let methodName = 'AI estimation';
    if (useScraperApi && selectedStore === 'bunnings') {
      methodName = 'Bunnings';
    } else if (useBunningsApi) {
      methodName = 'Bunnings API';
    }

    const updatedMaterials = [...materials];

    try {

      // --- BATCH FETCH: Progressive chunking (3 items at a time) ---
      let batchResults: Map<string, ScraperProduct | null> | null = null;
      const batchSucceededTerms = new Set<string>();
      if (useScraperApi && materialsToFetch.length > 0) {
        try {
          const searchTermsToFetch = materialsToFetch.map(m => m.searchTerm || m.name);
          const chunkSize = 3;
          const totalChunks = Math.ceil(searchTermsToFetch.length / chunkSize);
          setFetchPhase('batch');
          setBatchChunkProgress({ current: 0, total: totalChunks });

          // Initialize per-item statuses: first chunk "searching", rest "pending"
          const initialStatuses = new Map<string, 'pending' | 'searching' | 'done' | 'failed'>();
          searchTermsToFetch.forEach((term, idx) => {
            initialStatuses.set(term, idx < chunkSize ? 'searching' : 'pending');
          });
          setBatchItemStatuses(new Map(initialStatuses));
          setCurrentFetchingName(`Searching batch 1 of ${totalChunks}...`);

          // Helper to apply a scraper product to a material
          const applyProduct = (material: any, product: any) => {
            material.price = product.price;
            material.totalPrice = product.price * material.quantity;
            material.manualPriceOverride = false;
            material.pricingSource = 'scraper';
            if (product.itemNumber) material.bunningsItemNumber = product.itemNumber;
            if (product.productUrl) material.productUrl = product.productUrl;
            if (product.imageUrl) material.imageUrl = product.imageUrl;
            if (product.description) material.description = product.description;
            if (product.brand &&
                product.brand.toLowerCase() !== 'bunnings' &&
                product.brand.toLowerCase() !== 'bunnings.com.au') {
              material.brand = product.brand;
            }
            if (product.stockCheckedAt) material.stockCheckedAt = product.stockCheckedAt;
          };

          batchResults = await withCancel(batchFindBestMatchesProgressive(
            searchTermsToFetch,
            5,
            chunkSize,
            (chunkResults: Map<string, ScraperProduct | null>, chunkTerms: string[], chunkIndex: number, totalChunks: number) => {
              // Apply prices from this chunk immediately
              for (const [searchTerm, product] of chunkResults) {
                const matIndex = updatedMaterials.findIndex(
                  m => (m.searchTerm || m.name) === searchTerm
                );
                if (matIndex === -1) continue;
                const material = updatedMaterials[matIndex];

                if (product && product.price > 0) {
                  applyProduct(material, product);
                  fetchedCount++;
                  batchSucceededTerms.add(searchTerm);
                  triggerPriceFlash(material.id);
                }
              }

              // Update statuses: mark this chunk done/failed, next chunk searching
              setBatchItemStatuses(prev => {
                const next = new Map(prev);
                for (const [term, product] of chunkResults) {
                  next.set(term, product && product.price > 0 ? 'done' : 'failed');
                }
                // Mark next chunk as searching
                const nextChunkStart = (chunkIndex + 1) * chunkSize;
                for (let j = nextChunkStart; j < Math.min(nextChunkStart + chunkSize, searchTermsToFetch.length); j++) {
                  next.set(searchTermsToFetch[j], 'searching');
                }
                return next;
              });

              const completedCount = (chunkIndex + 1) * chunkSize;
              const doneCount = Math.min(completedCount, searchTermsToFetch.length);
              setBatchChunkProgress({ current: chunkIndex + 1, total: totalChunks });
              setFetchProgress({ current: doneCount, total: materialsToFetch.length });
              setCurrentFetchingName(`Searching batch ${Math.min(chunkIndex + 2, totalChunks)} of ${totalChunks}...`);

              // Add completed items to the fetched list
              for (const [term, product] of chunkResults) {
                setFetchedItemNames(prev => [...prev, {
                  name: term,
                  success: !!(product && product.price > 0),
                }]);
              }

              // Persist partial results to store
              if (currentQuote) {
                updateQuote({
                  ...currentQuote,
                  materials: [...updatedMaterials],
                } as any);
              }

              // Recalculate time estimate
              if (fetchCountdownRef.current) {
                const chunksRemaining = totalChunks - (chunkIndex + 1);
                if (chunksRemaining <= 0) {
                  fetchEstimateSecondsRef.current = 0;
                  setFetchEstimateSeconds(0);
                } else {
                  const elapsedMs = Date.now() - fetchStartTimeRef.current;
                  const avgMsPerChunk = elapsedMs / (chunkIndex + 1);
                  const newEstimate = Math.ceil((avgMsPerChunk * chunksRemaining) / 1000);
                  fetchEstimateSecondsRef.current = newEstimate;
                  setFetchEstimateSeconds(newEstimate);
                }
              }
            },
            () => cancelFetchRef.current,
          ));

          setBatchItemStatuses(new Map());
          setFetchPhase('individual');
        } catch (error: any) {
          if (error?.message === '__FETCH_CANCELLED__') throw error;
          batchResults = null;
          setBatchItemStatuses(new Map());
          setFetchPhase('individual');
        }
      }

      let fetchIndex = 0;
      for (let i = 0; i < updatedMaterials.length; i++) {
        // Check for cancellation
        if (cancelFetchRef.current) {
          break;
        }

        const material = updatedMaterials[i];

        // Skip if price already set and not overridden
        if (material.price > 0 && !material.manualPriceOverride) {
          skippedCount++;
          continue;
        }

        fetchIndex++;
        setFetchProgress({ current: fetchIndex, total: materialsToFetch.length });
        setFetchingMaterialId(material.id);
        setCurrentFetchingName(material.name);

        const searchTerm = material.searchTerm || material.name;

        if (useScraperApi) {
          // Use Bunnings Scraper API (Priority #1 - Real Prices)
          // Try batch result first (instant), fall back to individual search
          try {
            let product = batchResults?.get(searchTerm) ?? null;

            if (!product) {
              // Batch missed this one — try individual search
              product = await withCancel(findBestMatchForMaterial(searchTerm));
            }

            if (product && product.price > 0) {
              material.price = product.price;
              material.totalPrice = product.price * material.quantity;
              material.manualPriceOverride = false;
              material.pricingSource = 'scraper';

              if (product.itemNumber) {
                material.bunningsItemNumber = product.itemNumber;
              }

              if (product.productUrl) {
                material.productUrl = product.productUrl;
              }

              if (product.imageUrl) {
                material.imageUrl = product.imageUrl;
              }

              if (product.description) {
                material.description = product.description;
              }

              // Only save brand if it's not just the store name
              if (product.brand &&
                  product.brand.toLowerCase() !== 'bunnings' &&
                  product.brand.toLowerCase() !== 'bunnings.com.au') {
                material.brand = product.brand;
              }

              if (product.stockCheckedAt) {
                material.stockCheckedAt = product.stockCheckedAt;
              }

              fetchedCount++;
              triggerPriceFlash(material.id);
            } else {
              throw new Error('No product found with price');
            }
          } catch (error: any) {
            // Re-throw cancellation so the outer catch handles it instantly
            if (error?.message === '__FETCH_CANCELLED__') throw error;
            // Fallback to next method: try Bunnings API first, then AI estimation
            if (useBunningsApi) {
              const result = await withCancel(bunningsApi.findAndPriceMaterial(searchTerm));
              if (result) {
                material.bunningsItemNumber = result.item.itemNumber;
                material.price = result.price.priceIncGst;
                material.totalPrice = material.price * material.quantity;
                material.manualPriceOverride = false;
                material.pricingSource = 'api';
                fetchedCount++;
              triggerPriceFlash(material.id);
              } else {
                const aiResult = await withCancel(searchMaterialPrice(searchTerm, hardwareStores));

                if (aiResult.price) {
                  material.price = aiResult.price;
                  material.totalPrice = material.price * material.quantity;
                  material.manualPriceOverride = false;
                  material.pricingSource = 'ai';
                  material.priceConfidence = aiResult.confidence || 'medium';

                  if (aiResult.productName) {
                    material.name = aiResult.productName;
                  }
                  if (aiResult.store) {
                    material.description = `AI reckons about this much`;
                  }

                  fetchedCount++;
              triggerPriceFlash(material.id);
                } else {
                  failedCount++;
                }
              }
            } else {
              // No Bunnings API, fall back directly to AI estimation
              const aiResult = await withCancel(searchMaterialPrice(searchTerm, hardwareStores));

              if (aiResult.price) {
                material.price = aiResult.price;
                material.totalPrice = material.price * material.quantity;
                material.manualPriceOverride = false;
                material.pricingSource = 'ai';
                material.priceConfidence = aiResult.confidence || 'medium';

                if (aiResult.productName) {
                  material.name = aiResult.productName;
                }
                if (aiResult.store) {
                  material.description = `AI reckons about this much`;
                }

                fetchedCount++;
              triggerPriceFlash(material.id);
              } else {
                failedCount++;
              }
            }
          }
        } else if (useBunningsApi) {
          // Use Bunnings API
          const result = await withCancel(bunningsApi.findAndPriceMaterial(searchTerm));

          if (result) {
            material.bunningsItemNumber = result.item.itemNumber;
            material.price = result.price.priceIncGst;
            material.totalPrice = material.price * material.quantity;
            material.manualPriceOverride = false;
            material.pricingSource = 'api';

            // Store additional info from Bunnings API
            if (result.item.productName) {
              material.name = result.item.productName;
            }
            // Only save brand if it's not just the store name
            if (result.item.brand &&
                result.item.brand.toLowerCase() !== 'bunnings' &&
                result.item.brand.toLowerCase() !== 'bunnings.com.au') {
              material.brand = result.item.brand;
            }
            if (result.item.description) {
              material.description = result.item.description;
            }

            fetchedCount++;
            triggerPriceFlash(material.id);
          } else {
            failedCount++;
          }
        } else if (useReeceApi) {
          // Use Reece API for plumbing supplies
          const result = await withCancel(searchReeceMaterialPrice(searchTerm));

          if (result.price) {
            material.price = result.price;
            material.totalPrice = material.price * material.quantity;
            material.manualPriceOverride = false;
            material.pricingSource = 'api';

            // Store additional info if available
            if (result.productName) {
              material.name = result.productName;
            }
            if (result.store) {
              material.description = `Available at ${result.store}`;
            }

            fetchedCount++;
            triggerPriceFlash(material.id);
          } else {
            failedCount++;
          }
        } else {
          // Use Web Scraping with Favorites (NEW METHOD)

          // 1. Check for saved favorite first
          const favorite = await withCancel(getFavoriteProduct(material.name, material.searchTerm));

          if (favorite) {
            // Use favorite product's last known price (user can manually update if needed)
            material.favoriteProduct = favorite;
            // Note: Favorite stores the product info but not price (prices change)
            // So we still need to search, but we'll auto-select the favorite
          }

          // 2. Search hardware stores with web scraping
          const results = await withCancel(searchMaterialWithWebScraping(
            material.name,
            searchTerm,
            material.quantity,
            material.unit,
            hardwareStores
          ));

          if (results.length > 0 && results[0].matches.length > 0) {
            const allMatches = results.flatMap(r => r.matches);
            const quantityAdj = results[0].quantityAdjustment;

            // 3. Check if we have a favorite match in results
            let selectedMatch: ProductMatch | null = null;

            if (favorite) {
              // Try to find the favorite product in matches
              selectedMatch = allMatches.find(
                m =>
                  m.productName === favorite.productName ||
                  m.itemNumber === favorite.itemNumber
              ) || null;
            }

            // 4. If no favorite or favorite not found, get best match
            if (!selectedMatch) {
              selectedMatch = getBestMatch(results);
            }

            // 5. If multiple high-confidence matches and no favorite, prompt user
            const highConfidenceMatches = allMatches.filter(m => m.confidence === 'high');
            if (!favorite && highConfidenceMatches.length > 1 && !selectedMatch) {
              // Pause and ask user to select
              setPendingMatches(highConfidenceMatches);
              setPendingMaterialIndex(i);
              setPendingMaterialName(material.name);
              setMatchSelectorVisible(true);

              // Wait for user selection before continuing
              // (This will be handled by the modal callback)
              stopFetchCountdown();
              setCurrentFetchingName('');
              setIsFetchingPrices(false);
              setFetchPhase('idle');
              return; // Exit early, user will resume after selection
            }

            // 6. Apply selected product to material
            if (selectedMatch) {
              material.price = selectedMatch.price;
              material.totalPrice = selectedMatch.price * material.quantity;
              material.manualPriceOverride = false;
              material.pricingSource = 'scraper';

              // Apply quantity adjustment if needed
              if (quantityAdj && quantityAdj.adjustedQuantity !== material.quantity) {
                material.quantity = quantityAdj.adjustedQuantity;
                material.totalPrice = selectedMatch.price * material.quantity;
              }

              // Store product details
              if (selectedMatch.itemNumber) {
                material.bunningsItemNumber = selectedMatch.itemNumber;
              }
              if (selectedMatch.productUrl) {
                material.productUrl = selectedMatch.productUrl;
              }
              if (selectedMatch.description) {
                material.description = selectedMatch.description;
              }
              // Only save brand if it's not just the store name
              if (selectedMatch.brand &&
                  selectedMatch.brand.toLowerCase() !== 'bunnings' &&
                  selectedMatch.brand.toLowerCase() !== 'bunnings.com.au' &&
                  selectedMatch.brand.toLowerCase() !== 'reece' &&
                  selectedMatch.brand.toLowerCase() !== 'mitre 10') {
                material.brand = selectedMatch.brand;
              }
              if (selectedMatch.stockCheckedAt) {
                material.stockCheckedAt = selectedMatch.stockCheckedAt;
              }

              fetchedCount++;
              triggerPriceFlash(material.id);
            } else {
              failedCount++;
            }
          } else {
            // Web scraping failed, fall back to AI estimation
            const aiResult = await withCancel(searchMaterialPrice(searchTerm, hardwareStores));

            if (aiResult.price) {
              material.price = aiResult.price;
              material.totalPrice = material.price * material.quantity;
              material.manualPriceOverride = false;
              material.pricingSource = 'ai';
              material.priceConfidence = aiResult.confidence || 'medium';

              if (aiResult.productName) {
                material.name = aiResult.productName;
              }
              if (aiResult.store) {
                material.description = `AI reckons about this much`;
              }

              fetchedCount++;
              triggerPriceFlash(material.id);
            } else {
              failedCount++;
            }
          }
        }

        // Track completed item for the estimate modal
        setFetchedItemNames(prev => [...prev, {
          name: material.name,
          success: material.price > 0,
        }]);

        // Recalculate remaining time based on actual pace
        const itemsCompleted = fetchIndex;
        const itemsRemaining = materialsToFetch.length - itemsCompleted;
        if (itemsCompleted > 0 && fetchCountdownRef.current) {
          if (itemsRemaining <= 0) {
            fetchEstimateSecondsRef.current = 0;
            setFetchEstimateSeconds(0);
          } else {
            const elapsedMs = Date.now() - fetchStartTimeRef.current;
            const avgMsPerItem = elapsedMs / itemsCompleted;
            const newEstimate = Math.ceil((avgMsPerItem * itemsRemaining) / 1000);
            fetchEstimateSecondsRef.current = newEstimate;
            setFetchEstimateSeconds(newEstimate);
          }
        }

        // Update UI progressively (skip if dialogs are open to avoid flickering)
        if (!matchSelectorVisible && currentQuote) {
          updateQuote({
            ...currentQuote,
            materials: [...updatedMaterials],
          } as any);
        }

        // Small delay to avoid overwhelming the API (skip if just applying batch results)
        if (!batchResults) {
          await withCancel(new Promise(resolve => setTimeout(resolve, 1000)));
        } else {
          // Brief delay so UI can render each item update
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Final update to ensure all changes are saved
      if (currentQuote) {
        updateQuote({
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
        setSuccessMessage(`Couldn't track down prices for ${failedCount} item${failedCount > 1 ? 's' : ''}.\n\nGive these a crack:\n• Tweak material names to match what's on the shelf\n• Punch in prices manually\n• ${useBunningsApi ? 'Bunnings API might be having a smoko' : 'Try a different hardware store in Settings'}\n• Have another go later`);
        setShowSuccessModal(true);
      } else if (fetchedCount > 0 && failedCount === 0) {
        setSuccessTitle('Beauty!');
        setSuccessMessage(`Scored ${fetchedCount} price${fetchedCount > 1 ? 's' : ''}. Too easy!`);
        setShowSuccessModal(true);
      } else if (fetchedCount > 0 && failedCount > 0) {
        setSuccessTitle('Nearly There');
        setSuccessMessage(`Got ${fetchedCount} price${fetchedCount > 1 ? 's' : ''}, but ${failedCount} item${failedCount > 1 ? 's' : ''} gave us the slip. ${useBunningsApi ? 'Bunnings API might be having a rough one.' : 'Try tweaking material names or switching stores in Settings.'}`);
        setShowSuccessModal(true);
      } else {
        setSuccessTitle('All Done');
        setSuccessMessage('Prices are sorted. Time for a cuppa!');
        setShowSuccessModal(true);
      }
    } catch (error: any) {
      if (error?.message === '__FETCH_CANCELLED__') {
        // Cancelled via the cancel promise — save any progress made so far
        if (currentQuote) {
          updateQuote({
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
        setSuccessMessage(`Something went wrong fetching prices. ${useBunningsApi ? 'Bunnings API might be on smoko,' : 'The price service might be taking a sickie,'} or your internet\'s gone walkabout. Give it another crack later.`);
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
        const favoriteMapping = {
          productName: match.productName,
          store: match.store,
          productUrl: match.productUrl,
          itemNumber: match.itemNumber,
          dimensions: match.dimensions,
          unit: match.unit,
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

  const handleAddMaterial = () => {
    // Navigate to the new AddMaterial screen
    navigation.navigate('AddMaterial');
  };

  const handleCreateSection = () => {
    if (!newSectionName.trim() || !currentQuote) return;
    // Create a QuoteSection entry and add to quote
    const defaultRate = currentQuote.laborRate || businessSettings?.defaultLaborRate || 85;
    const existingSections = currentQuote.sections || [];
    const section: QuoteSection = {
      id: `section-${Date.now()}`,
      name: newSectionName.trim(),
      multiplier: 1,
      laborHours: 0,
      laborRate: defaultRate,
      laborUnit: 'hours' as LaborUnit,
      laborTotal: 0,
      sortOrder: existingSections.length,
    };
    updateQuote({
      ...currentQuote,
      sections: [...existingSections, section],
    });
    setNewSectionName('');
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
    const updatedMaterials = currentQuote.materials.map(m =>
      m.section === deleteSectionName ? { ...m, section: undefined } : m
    );
    const updatedSections = (currentQuote.sections || []).filter(s => s.name !== deleteSectionName);
    updateQuote({ ...currentQuote, materials: updatedMaterials, sections: updatedSections });
    setDeleteSectionModalVisible(false);
  };

  const handleMoveToSection = (materialId: string) => {
    if (!currentQuote) return;
    const material = currentQuote.materials.find(m => m.id === materialId);
    const currentSection = material?.section || '';

    const sectionNames = new Set<string>();
    if (currentQuote.sections) currentQuote.sections.forEach(s => sectionNames.add(s.name));
    currentQuote.materials.forEach(m => { if (m.section) sectionNames.add(m.section); });

    // Build options: all sections except current, plus "Unsectioned"
    const buttons: { text: string; onPress: () => void }[] = [];
    Array.from(sectionNames).sort().forEach(name => {
      if (name === currentSection) return; // Skip current section
      buttons.push({
        text: name,
        onPress: () => {
          const updatedMaterials = currentQuote.materials.map(m =>
            m.id === materialId ? { ...m, section: name, templateBaseQuantity: undefined } : m
          );
          updateQuote({ ...currentQuote, materials: updatedMaterials });
        },
      });
    });
    if (currentSection) {
      buttons.push({
        text: 'Unsectioned',
        onPress: () => {
          const updatedMaterials = currentQuote.materials.map(m =>
            m.id === materialId ? { ...m, section: undefined, templateBaseQuantity: undefined } : m
          );
          updateQuote({ ...currentQuote, materials: updatedMaterials });
        },
      });
    }
    if (buttons.length === 0) {
      Alert.alert('No Other Sections', 'Create another section first.');
      return;
    }
    buttons.push({ text: 'Cancel', onPress: () => {} });
    Alert.alert('Move to Section', 'Choose a section:', buttons as any);
  };


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

    // Determine search term
    const searchTerm = material.searchTerm || material.name;
    const encodedSearch = encodeURIComponent(searchTerm);

    // Generate store URL based on the store domain
    let storeUrl = '';

    if (firstStore.includes('bunnings.com.au')) {
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
    // Navigate to AddMaterial screen in edit mode
    navigation.navigate('AddMaterial', { materialId: material.id });
  };


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
    navigation.goBack();
  }, [currentQuote, updateQuote, saveDraft, navigation]);

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
      navigation.navigate('LaborMarkup');
    }
  }, [hasUnpricedMaterials, navigation, currentQuote, updateQuote, saveDraft]);

  const proceedWithUnpricedMaterials = () => {
    setUnpricedDialogVisible(false);
    if (currentQuote) {
      const draftQuote = { ...currentQuote, draftStep: 'LaborMarkup' };
      updateQuote(draftQuote);
      saveDraft(draftQuote);
    }
    navigation.navigate('LaborMarkup');
  };

  // Handle null currentQuote case
  if (!currentQuote) {
    return null;
  }

  return (
    <View style={styles.container}>
      <NestableScrollContainer
          ref={materialsScrollRef as any}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={!tourActive}
      >
        <WebContainer>
        {isAiAnalyzing ? (
            <AiAnalyzingState />
        ) : materials.length === 0 && !templatesLoaded ? (
          <View style={styles.emptyState}>
            <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 40 }} />
          </View>
        ) : materials.length === 0 ? (
          <View style={styles.emptyState}>
            {allTemplates.length > 0 && suggestedTemplateIds.size > 0 ? (
              <>
                {/* Templates matched — compact layout */}
                <Text style={styles.suggestionsTitle}>Ready to load</Text>

                {allTemplates
                  .sort((a, b) => {
                    const aMatch = suggestedTemplateIds.has(a.id) ? 0 : 1;
                    const bMatch = suggestedTemplateIds.has(b.id) ? 0 : 1;
                    return aMatch - bMatch;
                  })
                  .map(template => {
                    const isChecked = checkedTemplateIds.has(template.id);
                    const isSuggested = suggestedTemplateIds.has(template.id);
                    const qty = templateQuantities[template.id] || 1;
                    const materialsCost = template.materials.reduce((sum, m) => sum + (m.quantity * m.price), 0);
                    const laborCost = template.laborHours * template.laborRate;
                    const unitCost = materialsCost + laborCost;

                    return (
                      <Surface key={template.id} style={[styles.suggestionCard, isChecked && styles.suggestionCardChecked]}>
                        <TouchableOpacity
                          style={styles.suggestionCardInner}
                          onPress={() => setCheckedTemplateIds(prev => {
                            const next = new Set(prev);
                            next.has(template.id) ? next.delete(template.id) : next.add(template.id);
                            return next;
                          })}
                          activeOpacity={0.7}
                        >
                          <MaterialCommunityIcons
                            name={isChecked ? 'checkbox-marked' : 'checkbox-blank-outline'}
                            size={22}
                            color={isChecked ? colors.primary : colors.textMuted}
                          />
                          <View style={styles.suggestionInfo}>
                            <View style={styles.suggestionCompactRow}>
                              <Text style={styles.suggestionName} numberOfLines={1}>{template.name}</Text>
                              <Text style={styles.suggestionQtyBadge}>×{qty}</Text>
                              <Text style={styles.suggestionUnitCost}>{formatCurrency(unitCost)}/unit</Text>
                            </View>
                            {isSuggested && (
                              <Text style={styles.suggestionMatchHint}>
                                {template.materials.length} material{template.materials.length !== 1 ? 's' : ''}
                                {laborCost > 0 ? ` · ${template.laborHours}${template.laborUnit === 'days' ? 'd' : 'h'} labour` : ''}
                              </Text>
                            )}
                          </View>
                        </TouchableOpacity>
                        {isChecked && (
                          <View style={styles.suggestionQtyRow}>
                            <Text style={styles.suggestionQtyLabel}>Qty:</Text>
                            <View style={styles.suggestionStepper}>
                              <Pressable
                                style={({ pressed }) => [styles.suggestionStepperBtn, pressed && { opacity: 0.6 }]}
                                onPress={() => setTemplateQuantities(prev => ({ ...prev, [template.id]: Math.max(1, qty - 1) }))}
                              >
                                <MaterialCommunityIcons name="minus" size={16} color={colors.text} />
                              </Pressable>
                              <Text style={styles.suggestionStepperValue}>{qty}</Text>
                              <Pressable
                                style={({ pressed }) => [styles.suggestionStepperBtn, pressed && { opacity: 0.6 }]}
                                onPress={() => setTemplateQuantities(prev => ({ ...prev, [template.id]: qty + 1 }))}
                              >
                                <MaterialCommunityIcons name="plus" size={16} color={colors.text} />
                              </Pressable>
                            </View>
                            <Text style={styles.suggestionQtyTotal}>
                              {formatCurrency(unitCost * qty)}
                            </Text>
                          </View>
                        )}
                      </Surface>
                    );
                  })}

                {/* Single load button */}
                {checkedTemplateIds.size > 0 && (
                  <View style={styles.suggestionActions}>
                    <TouchableOpacity
                      style={styles.loadAndFillBtn}
                      onPress={() => {
                        loadSelectedTemplatesIntoQuote();
                        if (isLoadingWithGaps && isPro) {
                          setTimeout(() => handleGenerateMaterialsList(), 300);
                        }
                      }}
                      activeOpacity={0.7}
                    >
                      <MaterialCommunityIcons name="download" size={20} color="#FFFFFF" />
                      <Text style={styles.loadAndFillBtnText}>Load Materials</Text>
                    </TouchableOpacity>

                    {/* Fill gaps toggle (Pro) */}
                    {isPro && (
                      <TouchableOpacity
                        style={styles.fillGapsToggle}
                        onPress={() => setIsLoadingWithGaps(prev => !prev)}
                        activeOpacity={0.7}
                      >
                        <MaterialCommunityIcons
                          name={isLoadingWithGaps ? 'checkbox-marked' : 'checkbox-blank-outline'}
                          size={20}
                          color={isLoadingWithGaps ? colors.primary : colors.textMuted}
                        />
                        <Text style={styles.fillGapsToggleText}>Fill remaining gaps</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                {/* Secondary options */}
                <View style={styles.orDivider}>
                  <View style={styles.orDividerLine} />
                  <Text style={styles.orDividerText}>or start differently</Text>
                  <View style={styles.orDividerLine} />
                </View>
                <View style={styles.secondaryActionsRow}>
                  <TouchableOpacity ref={aiGenerateRef} onPress={() => {
                    if (!isPro) { navigation.navigate('Paywall' as never); return; }
                    handleGenerateMaterialsList();
                  }} style={styles.secondaryActionLink}>
                    <Text style={styles.secondaryActionText}>Build from description</Text>
                    {!isPro && <ProBadge size="small" />}
                  </TouchableOpacity>
                  <TouchableOpacity ref={addManualRef} onPress={handleAddMaterial} style={styles.secondaryActionLink}>
                    <Text style={styles.secondaryActionText}>Start empty</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : allTemplates.length > 0 ? (
              <>
                {/* Templates exist but none matched */}
                <Text style={styles.suggestionsTitle}>Your Job Templates</Text>

                {allTemplates.map(template => {
                  const isChecked = checkedTemplateIds.has(template.id);
                  const qty = templateQuantities[template.id] || 1;
                  const materialsCost = template.materials.reduce((sum, m) => sum + (m.quantity * m.price), 0);
                  const laborCost = template.laborHours * template.laborRate;
                  const unitCost = materialsCost + laborCost;

                  return (
                    <Surface key={template.id} style={[styles.suggestionCard, isChecked && styles.suggestionCardChecked]}>
                      <TouchableOpacity
                        style={styles.suggestionCardInner}
                        onPress={() => setCheckedTemplateIds(prev => {
                          const next = new Set(prev);
                          next.has(template.id) ? next.delete(template.id) : next.add(template.id);
                          return next;
                        })}
                        activeOpacity={0.7}
                      >
                        <MaterialCommunityIcons
                          name={isChecked ? 'checkbox-marked' : 'checkbox-blank-outline'}
                          size={22}
                          color={isChecked ? colors.primary : colors.textMuted}
                        />
                        <View style={styles.suggestionInfo}>
                          <View style={styles.suggestionCompactRow}>
                            <Text style={styles.suggestionName} numberOfLines={1}>{template.name}</Text>
                            {isChecked && <Text style={styles.suggestionQtyBadge}>×{qty}</Text>}
                            <Text style={styles.suggestionUnitCost}>{formatCurrency(unitCost)}/unit</Text>
                          </View>
                          <Text style={styles.suggestionMatchHint}>
                            {template.materials.length} material{template.materials.length !== 1 ? 's' : ''}
                            {laborCost > 0 ? ` · ${template.laborHours}${template.laborUnit === 'days' ? 'd' : 'h'} labour` : ''}
                          </Text>
                        </View>
                      </TouchableOpacity>
                      {isChecked && (
                        <View style={styles.suggestionQtyRow}>
                          <Text style={styles.suggestionQtyLabel}>Qty:</Text>
                          <View style={styles.suggestionStepper}>
                            <Pressable
                              style={({ pressed }) => [styles.suggestionStepperBtn, pressed && { opacity: 0.6 }]}
                              onPress={() => setTemplateQuantities(prev => ({ ...prev, [template.id]: Math.max(1, qty - 1) }))}
                            >
                              <MaterialCommunityIcons name="minus" size={16} color={colors.text} />
                            </Pressable>
                            <Text style={styles.suggestionStepperValue}>{qty}</Text>
                            <Pressable
                              style={({ pressed }) => [styles.suggestionStepperBtn, pressed && { opacity: 0.6 }]}
                              onPress={() => setTemplateQuantities(prev => ({ ...prev, [template.id]: qty + 1 }))}
                            >
                              <MaterialCommunityIcons name="plus" size={16} color={colors.text} />
                            </Pressable>
                          </View>
                          <Text style={styles.suggestionQtyTotal}>{formatCurrency(unitCost * qty)}</Text>
                        </View>
                      )}
                    </Surface>
                  );
                })}

                {checkedTemplateIds.size > 0 && (
                  <View style={styles.suggestionActions}>
                    <TouchableOpacity
                      style={styles.loadAndFillBtn}
                      onPress={() => loadSelectedTemplatesIntoQuote()}
                      activeOpacity={0.7}
                    >
                      <MaterialCommunityIcons name="download" size={20} color="#FFFFFF" />
                      <Text style={styles.loadAndFillBtnText}>Load Materials</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <View style={styles.orDivider}>
                  <View style={styles.orDividerLine} />
                  <Text style={styles.orDividerText}>or start differently</Text>
                  <View style={styles.orDividerLine} />
                </View>
                <View style={styles.secondaryActionsRow}>
                  <TouchableOpacity ref={aiGenerateRef} onPress={() => {
                    if (!isPro) { navigation.navigate('Paywall' as never); return; }
                    handleGenerateMaterialsList();
                  }} style={styles.secondaryActionLink}>
                    <Text style={styles.secondaryActionText}>Build from description</Text>
                    {!isPro && <ProBadge size="small" />}
                  </TouchableOpacity>
                  <TouchableOpacity ref={addManualRef} onPress={handleAddMaterial} style={styles.secondaryActionLink}>
                    <Text style={styles.secondaryActionText}>Start empty</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                {/* No templates at all */}
                <View style={{ alignItems: 'center', marginBottom: 20 }}>
                  <MaterialCommunityIcons name="puzzle-outline" size={40} color={colors.textMuted} style={{ marginBottom: 8 }} />
                  <Text style={{ color: colors.textMuted, fontSize: 14, textAlign: 'center' }}>
                    No saved templates yet
                  </Text>
                </View>

                <TouchableOpacity ref={aiGenerateRef} style={styles.emptyActionCard} onPress={() => {
                  if (!isPro) { navigation.navigate('Paywall' as never); return; }
                  handleGenerateMaterialsList();
                }} activeOpacity={0.7}>
                  <View style={styles.emptyActionIconWrap}>
                    <MaterialCommunityIcons name="auto-fix" size={28} color={colors.primary} />
                  </View>
                  <View style={styles.emptyActionContent}>
                    <View style={styles.emptyActionTitleRow}>
                      <Text style={styles.emptyActionTitle}>Build from description</Text>
                      {!isPro && <ProBadge size="small" />}
                    </View>
                    <Text style={styles.emptyActionDesc}>
                      Create a full materials list from your job description
                    </Text>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={24} color={colors.textMuted} />
                </TouchableOpacity>

                <TouchableOpacity ref={addManualRef} style={styles.emptyActionCard} onPress={handleAddMaterial} activeOpacity={0.7}>
                  <View style={[styles.emptyActionIconWrap, { backgroundColor: colors.surfaceLight }]}>
                    <MaterialCommunityIcons name="plus" size={28} color={colors.onSurface} />
                  </View>
                  <View style={styles.emptyActionContent}>
                    <Text style={styles.emptyActionTitle}>Start empty</Text>
                    <Text style={styles.emptyActionDesc}>
                      Search for products or enter materials by hand
                    </Text>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={24} color={colors.textMuted} />
                </TouchableOpacity>

                <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: 16 }}>
                  Save sections as templates for faster quoting next time.
                </Text>
              </>
            )}
          </View>
        ) : (
          <List.Section style={styles.listView}>
            {(() => {
              const groupedMaterials = groupMaterialsByCategory(materials);

              // Build flat list: section-header, materials, section-footer interleaved
              type FlatItem =
                | { type: 'header'; key: string; sectionName: string }
                | { type: 'material'; key: string; material: Material }
                | { type: 'footer'; key: string; sectionName: string; subtotal: number }

              const sectionedGroups = Array.from(groupedMaterials.entries()).filter(([key]) => key !== '');
              const unsectionedGroup = groupedMaterials.get('');
              const existingSectionNames = new Set(sectionedGroups.map(([key]) => key));
              if (currentQuote?.sections) {
                currentQuote.sections.forEach(s => {
                  if (!existingSectionNames.has(s.name)) {
                    sectionedGroups.push([s.name, { info: { name: s.name, color: colors.primary }, materials: [] }]);
                  }
                });
              }

              const toggleSectionCollapsed = (sectionName: string) => {
                setCollapsedSections(prev => {
                  const next = new Set(prev);
                  if (next.has(sectionName)) next.delete(sectionName);
                  else next.add(sectionName);
                  return next;
                });
              };

              const flatData: FlatItem[] = [];
              sectionedGroups.forEach(([groupKey, group]) => {
                const subtotal = group.materials.reduce((sum, m) => sum + m.totalPrice, 0);
                flatData.push({ type: 'header', key: `h-${groupKey}`, sectionName: groupKey });
                if (!collapsedSections.has(groupKey)) {
                  group.materials.forEach(m => flatData.push({ type: 'material', key: m.id, material: m }));
                }
                flatData.push({ type: 'footer', key: `f-${groupKey}`, sectionName: groupKey, subtotal });
              });
              if (unsectionedGroup) {
                unsectionedGroup.materials.forEach(m => flatData.push({ type: 'material', key: m.id, material: m }));
              }

              const renderFlatItem = ({ item, drag, isActive }: RenderItemParams<FlatItem>) => {
                if (item.type === 'header') {
                  const sd = currentQuote?.sections?.find(s => s.name === item.sectionName);
                  const sectionMats = materials.filter(m => m.section === item.sectionName);
                  const hasMultiplier = sd && sd.multiplier > 0 && sectionMats.some(m => m.templateBaseQuantity);
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
                        {hasMultiplier && (
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
                          <TouchableOpacity style={styles.sectionAddMaterialBtn} onPress={() => navigation.navigate('AddMaterial', { section: item.sectionName })}>
                            <MaterialCommunityIcons name="plus" size={16} color={colors.primary} />
                            <Text style={styles.sectionAddMaterialText}>Add Material</Text>
                          </TouchableOpacity>
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

                // Material — draggable
                return (
                  <View collapsable={false}>
                    <MaterialItemCard
                      material={item.material}
                      isExpanded={expandedMaterials.has(item.material.id)}
                      isFetching={fetchingMaterialId === item.material.id}
                      isRecentlyPriced={recentlyPricedIds.has(item.material.id)}
                      localQuantity={localQuantities[item.material.id]}
                      isActive={isActive}
                      drag={drag}
                      onToggleExpand={() => toggleMaterialExpanded(item.material.id)}
                      onQuantityUpdate={(delta) => handleQuickQuantityUpdate(item.material.id, delta)}
                      onQuantityBlur={(value) => handleQuantityBlur(item.material.id, value)}
                      onMoveToSection={() => handleMoveToSection(item.material.id)}
                      onOpenInStore={() => handleOpenInStore(item.material)}
                      onEdit={() => handleEditMaterial(item.material)}
                      onDelete={() => handleDeleteMaterial(item.material.id)}
                    />
                  </View>
                );
              };

              // After drag: walk the reordered flat list, assign sections based on which header each material is under.
              // Materials dropped before the first header get assigned to the first section.
              const handleFlatDragEnd = ({ data }: { data: FlatItem[] }) => {
                if (!currentQuote) return;

                // Find the first section name so orphan materials get assigned there
                const firstSectionName = data.find(d => d.type === 'header')?.sectionName;

                let currentSection: string | undefined = firstSectionName;
                const newMaterials: Material[] = [];
                data.forEach(item => {
                  if (item.type === 'header') currentSection = item.sectionName;
                  else if (item.type === 'material') {
                    const assignedSection = currentSection || firstSectionName;
                    newMaterials.push({
                      ...item.material,
                      section: assignedSection,
                      templateBaseQuantity: item.material.section !== assignedSection ? undefined : item.material.templateBaseQuantity,
                    });
                  }
                });
                // Only update if something actually changed
                let changed = false;
                for (let i = 0; i < newMaterials.length; i++) {
                  const orig = currentQuote.materials[i];
                  if (!orig || newMaterials[i].id !== orig.id || newMaterials[i].section !== orig.section) {
                    changed = true;
                    break;
                  }
                }
                if (changed) {
                  updateQuote({ ...currentQuote, materials: newMaterials });
                }
              };

              const WebDropZone = ({ children, onDropMaterial, style, keyProp }: {
                children: React.ReactNode;
                onDropMaterial?: (matId: string) => void;
                style?: any;
                keyProp: string;
              }) => {
                const ref = React.useRef<any>(null);
                React.useEffect(() => {
                  const el = ref.current;
                  if (!el) return;
                  const handleDragOver = (e: DragEvent) => { e.preventDefault(); };
                  const handleDrop = (e: DragEvent) => {
                    e.preventDefault();
                    if (webDragRef.current && onDropMaterial) {
                      onDropMaterial(webDragRef.current.materialId);
                      webDragRef.current = null;
                    }
                  };
                  el.addEventListener('dragover', handleDragOver);
                  el.addEventListener('drop', handleDrop);
                  return () => { el.removeEventListener('dragover', handleDragOver); el.removeEventListener('drop', handleDrop); };
                });
                return <View ref={ref} key={keyProp} style={style}>{children}</View>;
              };

              const WebDraggableItem = ({ children, materialId, onDropOnto, keyProp }: {
                children: React.ReactNode;
                materialId: string;
                onDropOnto: (draggedId: string) => void;
                keyProp: string;
              }) => {
                const ref = React.useRef<any>(null);
                React.useEffect(() => {
                  const el = ref.current;
                  if (!el) return;
                  el.draggable = true;
                  el.style.cursor = 'grab';
                  const handleDragStart = () => { webDragRef.current = { materialId }; };
                  const handleDragOver = (e: DragEvent) => { e.preventDefault(); };
                  const handleDrop = (e: DragEvent) => {
                    e.preventDefault();
                    if (webDragRef.current) {
                      onDropOnto(webDragRef.current.materialId);
                      webDragRef.current = null;
                    }
                  };
                  el.addEventListener('dragstart', handleDragStart);
                  el.addEventListener('dragover', handleDragOver);
                  el.addEventListener('drop', handleDrop);
                  return () => { el.removeEventListener('dragstart', handleDragStart); el.removeEventListener('dragover', handleDragOver); el.removeEventListener('drop', handleDrop); };
                });
                return <View ref={ref} key={keyProp}>{children}</View>;
              };

              const renderWebFlatItem = (item: FlatItem) => {
                if (item.type === 'header') {
                  const sd = currentQuote?.sections?.find(s => s.name === item.sectionName);
                  const sectionMats = materials.filter(m => m.section === item.sectionName);
                  const hasMultiplier = sd && sd.multiplier > 0 && sectionMats.some(m => m.templateBaseQuantity);
                  const isCollapsed = collapsedSections.has(item.sectionName);
                  return (
                    <WebDropZone
                      keyProp={item.key}
                      onDropMaterial={(matId) => {
                        if (!currentQuote) return;
                        const mat = currentQuote.materials.find(m => m.id === matId);
                        if (!mat || mat.section === item.sectionName) return;
                        const updated = currentQuote.materials.map(m =>
                          m.id === matId ? { ...m, section: item.sectionName, templateBaseQuantity: undefined } : m
                        );
                        updateQuote({ ...currentQuote, materials: updated });
                      }}
                    >
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
                        {hasMultiplier && (
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
                    </WebDropZone>
                  );
                }

                if (item.type === 'footer') {
                  const isCollapsed = collapsedSections.has(item.sectionName);
                  return (
                    <WebDropZone
                      keyProp={item.key}
                      onDropMaterial={(matId) => {
                        if (!currentQuote) return;
                        const mat = currentQuote.materials.find(m => m.id === matId);
                        if (!mat || mat.section === item.sectionName) return;
                        const updated = currentQuote.materials.map(m =>
                          m.id === matId ? { ...m, section: item.sectionName, templateBaseQuantity: undefined } : m
                        );
                        updateQuote({ ...currentQuote, materials: updated });
                      }}
                    >
                      <View style={[
                        styles.sectionCardFooterStandalone,
                        isCollapsed && styles.sectionCardFooterCollapsed,
                      ]}>
                        {!isCollapsed && (
                          <TouchableOpacity style={styles.sectionAddMaterialBtn} onPress={() => navigation.navigate('AddMaterial', { section: item.sectionName })}>
                            <MaterialCommunityIcons name="plus" size={16} color={colors.primary} />
                            <Text style={styles.sectionAddMaterialText}>Add Material</Text>
                          </TouchableOpacity>
                        )}
                        <View style={styles.sectionCardFooter}>
                          <Text style={styles.sectionCardFooterLabel}>
                            {isCollapsed ? `${materials.filter(m => m.section === item.sectionName).length} items` : 'Section Total'}
                          </Text>
                          <Text style={styles.sectionCardFooterValue}>{formatCurrency(item.subtotal)}</Text>
                        </View>
                      </View>
                    </WebDropZone>
                  );
                }

                // Material — web draggable
                return (
                  <WebDraggableItem
                    keyProp={item.key}
                    materialId={item.material.id}
                    onDropOnto={(draggedId) => {
                      if (!currentQuote || draggedId === item.material.id) return;
                      const targetSection = item.material.section;
                      const mats = [...currentQuote.materials];
                      const fromIdx = mats.findIndex(m => m.id === draggedId);
                      const toIdx = mats.findIndex(m => m.id === item.material.id);
                      if (fromIdx === -1 || toIdx === -1) return;
                      const [moved] = mats.splice(fromIdx, 1);
                      const insertIdx = mats.findIndex(m => m.id === item.material.id);
                      mats.splice(insertIdx, 0, {
                        ...moved,
                        section: targetSection,
                        templateBaseQuantity: moved.section !== targetSection ? undefined : moved.templateBaseQuantity,
                      });
                      updateQuote({ ...currentQuote, materials: mats });
                    }}
                  >
                    <MaterialItemCard
                      material={item.material}
                      isExpanded={expandedMaterials.has(item.material.id)}
                      isFetching={fetchingMaterialId === item.material.id}
                      isRecentlyPriced={recentlyPricedIds.has(item.material.id)}
                      localQuantity={localQuantities[item.material.id]}
                      isActive={false}
                      onToggleExpand={() => toggleMaterialExpanded(item.material.id)}
                      onQuantityUpdate={(delta) => handleQuickQuantityUpdate(item.material.id, delta)}
                      onQuantityBlur={(value) => handleQuantityBlur(item.material.id, value)}
                      onMoveToSection={() => handleMoveToSection(item.material.id)}
                      onOpenInStore={() => handleOpenInStore(item.material)}
                      onEdit={() => handleEditMaterial(item.material)}
                      onDelete={() => handleDeleteMaterial(item.material.id)}
                    />
                  </WebDraggableItem>
                );
              };

              return Platform.OS !== 'web' ? (
                <NestableDraggableFlatList
                  data={flatData}
                  keyExtractor={(item) => item.key}
                  renderItem={renderFlatItem}
                  onDragEnd={handleFlatDragEnd}
                />
              ) : (
                flatData.map(item => renderWebFlatItem(item))
              );
            })()}
          </List.Section>
        )}

        {materials.length > 0 && !isAiAnalyzing && (
          <View style={styles.summary}>
            <Text style={styles.summaryLabel}>Materials Subtotal:</Text>
            <Text style={styles.summaryValue}>
              {formatCurrency(materialsSubtotal)}
            </Text>
          </View>
        )}

        {/* Action buttons */}
        {materials.length > 0 && !isAiAnalyzing && (
          <View style={styles.materialsActionRow}>
            <TouchableOpacity ref={addMaterialButtonRef as any} style={styles.addMaterialButtonFull} onPress={handleAddMaterial}>
              <MaterialCommunityIcons name="plus" size={20} color={colors.primary} />
              <Text style={styles.addMaterialButtonText}>Add Material</Text>
            </TouchableOpacity>
            <View style={styles.materialsActionHalfRow}>
              <TouchableOpacity style={styles.addMaterialButtonHalf} onPress={handleLoadTemplate}>
                <MaterialCommunityIcons name="puzzle-outline" size={18} color={colors.primary} />
                <Text style={styles.addMaterialButtonText}>Load Template</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.addMaterialButtonHalf} onPress={() => { setNewSectionName(''); setShowNewSectionModal(true); }}>
                <MaterialCommunityIcons name="folder-plus-outline" size={18} color={colors.primary} />
                <Text style={styles.addMaterialButtonText}>New Section</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Spacer for fixed bottom button */}
        <View style={{ height: 120 }} />
        </WebContainer>
       </NestableScrollContainer>

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
        secondaryRef={fetchPricesButtonRef}
      />

      {/* New Section Modal */}
      <Portal>
        <Modal
          visible={showNewSectionModal}
          onDismiss={() => setShowNewSectionModal(false)}
          contentContainerStyle={styles.newSectionModal}
        >
          <Text style={styles.newSectionModalTitle}>New Section</Text>
          <TextInput
            label="Section Name"
            value={newSectionName}
            onChangeText={setNewSectionName}
            mode="outlined"
            style={{ marginBottom: 16 }}
            placeholder="e.g. Fence Bay, Gate, Footings"
            autoFocus
          />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
            <TouchableOpacity
              style={styles.newSectionCancelBtn}
              onPress={() => setShowNewSectionModal(false)}
            >
              <Text style={styles.newSectionCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.newSectionSaveBtn}
              onPress={handleCreateSection}
            >
              <Text style={styles.newSectionSaveText}>Create</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      </Portal>

      {/* Template Picker Modal */}
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

      {/* Fetch Time Estimate Modal */}
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

      {/* Delete Section Confirmation Modal */}
      <AlertModal
        visible={deleteSectionModalVisible}
        onDismiss={() => setDeleteSectionModalVisible(false)}
        type="warning"
        title="Ditch This Section?"
        message={`Gonna chuck "${deleteSectionName}" and move its materials to unsectioned. She'll be right, nothing gets deleted.`}
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
        onDismiss={() => { setShowSuccessModal(false); setSuccessType('success'); }}
        type={successType}
        title={successTitle}
        message={successMessage}
      />
      {!showSuccessModal && unifiedTourActive && (
        <>
          {unifiedTourPhase === 'materialsList' && (
            <ScreenTour
              tourId="materialsList"
              onActiveChange={setTourActive}
              unifiedMode={true}
              onScreenComplete={() => notifyScreenComplete('materialsList')}
              onSkipRequest={notifySkipRequest}
              stepOffset={PHASE_STEP_OFFSETS.materialsList}
              globalTotalSteps={UNIFIED_TOUR_TOTAL_STEPS}
            />
          )}
          {materials.length > 0 && !isAiAnalyzing && unifiedTourPhase === 'materialsListItems' && (
            <ScreenTour
              tourId="materialsListItems"
              delay={800}
              onActiveChange={setTourActive}
              scrollRef={materialsScrollRef}
              scrollPositions={{ fetchPricesButton: 99999, firstMaterialItem: 0, addMaterialButton: 99999 }}
              unifiedMode={true}
              onScreenComplete={() => notifyScreenComplete('materialsListItems')}
              onSkipRequest={notifySkipRequest}
              stepOffset={PHASE_STEP_OFFSETS.materialsListItems}
              globalTotalSteps={UNIFIED_TOUR_TOTAL_STEPS}
              onStepChange={(stepId) => {
                const quote = currentQuote;
                if (!quote) return;
                if (stepId === 'addMaterialButton' && materials.length > 0) {
                  setExpandedMaterials(new Set([materials[0].id]));
                } else if (stepId === 'firstMaterialItem' && tourPastFetchRef.current) {
                  const pricedMaterials = getTourMaterialsPriced();
                  storeUpdateQuote({ ...quote, materials: pricedMaterials });
                  if (pricedMaterials.length > 0) {
                    setExpandedMaterials(new Set([pricedMaterials[0].id]));
                  }
                } else if (stepId === 'fetchPricesButton') {
                  tourPastFetchRef.current = true;
                }
              }}
            />
          )}
          {materials.length > 0 && unifiedTourActive && unifiedTourPhase === 'materialsListAdded' && (
            <ScreenTour
              tourId="materialsListAdded"
              delay={800}
              onActiveChange={setTourActive}
              scrollRef={materialsScrollRef}
              scrollPositions={{ firstMaterialItem: 0 }}
              unifiedMode={true}
              onScreenComplete={() => notifyScreenComplete('materialsListAdded')}
              onSkipRequest={notifySkipRequest}
              stepOffset={PHASE_STEP_OFFSETS.materialsListAdded}
              globalTotalSteps={UNIFIED_TOUR_TOTAL_STEPS}
            />
          )}
        </>
      )}
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
    paddingBottom: 140,
    flexGrow: 1,
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
    paddingVertical: 48,
    paddingHorizontal: 24,
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
    marginBottom: 8,
    backgroundColor: colors.surfaceDark,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sectionCardHeaderCollapsed: {
    borderBottomWidth: 0,
    marginBottom: 0,
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
    justifyContent: 'space-between',
    padding: 20,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderBottomWidth: 1,
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
