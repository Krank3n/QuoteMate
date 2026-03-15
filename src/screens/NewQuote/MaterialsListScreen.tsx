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
  Image,
  Animated,
  TextInput as RNTextInput,
} from 'react-native';
import {
  Text,
  Button,
  List,
  IconButton,
  Portal,
  Modal,
  TextInput,
  SegmentedButtons,
  ActivityIndicator,
} from 'react-native-paper';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import LottieView from 'lottie-react-native';
import { generateId } from '../../utils/generateId';

import { useStore } from '../../store/useStore';
import { useCurrentDocument, useDocumentMode } from '../../utils/documentMode';
import { Material, BunningsItem } from '../../types';
import { colors } from '../../theme';
import { formatCurrency, updateMaterialTotalPrice } from '../../utils/quoteCalculator';
import { bunningsApi } from '../../services/bunningsApi';
import { searchMaterialPrice } from '../../services/webSearchPricing';
import { searchReeceMaterialPrice } from '../../services/reeceApi';
import { analyzeJobDescription, convertLLMMaterialsToMaterials } from '../../services/llmService';
import { getTradeCategoryById, getTradeNicheById, TRADE_CATEGORIES } from '../../constants/tradeCategories';
import { AnimatedListItem } from '../../components/AnimatedListItem';
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
  PricingResult,
  getBestMatch,
} from '../../services/webScrapingPricing';
import {
  getFavoriteProduct,
  saveFavoriteProduct,
} from '../../services/materialFavorites';
import MaterialMatchSelector from '../../components/MaterialMatchSelector';
import {
  findBestMatchForMaterial,
} from '../../services/bunningsScraperClient';
import { FixedBottomButton } from '../../components/FixedBottomButton';
import { WebContainer } from '../../components/WebContainer';
import { AlertModal } from '../../components/AlertModal';
import { ProBadge } from '../../components/ProBadge';
import { BUNNINGS_SCRAPER_URL } from '@env';

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
  const cancelFetchRef = useRef(false);
  const cancelFetchResolverRef = useRef<(() => void) | null>(null);
  const [recentlyPricedIds, setRecentlyPricedIds] = useState<Set<string>>(new Set());
  const priceFlashAnims = useRef<Map<string, Animated.Value>>(new Map());
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [initialMaterialCount, setInitialMaterialCount] = useState(0);
  const [cancelGeneration, setCancelGeneration] = useState(false);

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

  // Optimistic quantity overrides — shown instantly before store re-render
  const [localQuantities, setLocalQuantities] = useState<Record<string, number>>({});



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

      const analysis = await analyzeJobDescription(jobDescription, tradeContext, 3, photoUrlsForAi);

      // Check if user canceled during AI analysis
      if (cancelGeneration) {
        console.log('Generation canceled by user');
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
      }));

      // Update the quote with analyzed data
      const updatedJob = {
        ...currentQuote.job,
        estimatedHours: analysis.estimatedHours,
      };

      const updatedQuote = {
        ...currentQuote,
        job: updatedJob,
        materials: generatedMaterials,
        laborHours: analysis.estimatedHours,
      };

      updateQuote(updatedQuote);

      console.log('✅ AI analysis complete:', generatedMaterials.length, 'materials generated');
      setSuccessTitle('Materials Generated!');
      setSuccessMessage(`Generated ${generatedMaterials.length} material${generatedMaterials.length !== 1 ? 's' : ''} from your job description.`);
      setShowSuccessModal(true);
    } catch (error: any) {
      console.error('❌ AI analysis error:', error);
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
    if (materials.length === 0) {
      setSuccessType('info');
      setSuccessTitle('Nothing to Price');
      setSuccessMessage('Chuck some materials in first, legend.');
      setShowSuccessModal(true);
      return;
    }

    // Calculate estimated time and show modal
    const materialsNeedingPrices = materials.filter(m => !(m.price > 0 && !m.manualPriceOverride));
    const estimatedSeconds = Math.max(materialsNeedingPrices.length * 35, 35);
    setFetchedItemNames([]);
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
    const useScraperApi = BUNNINGS_SCRAPER_URL ? true : false;

    // Get selected store (single store only now)
    const selectedStore = businessSettings?.selectedStore || 'bunnings';
    const storeUrl = selectedStore === 'bunnings' ? 'bunnings.com.au' :
                     selectedStore === 'mitre10' ? 'mitre10.com.au' :
                     selectedStore === 'reece' ? 'reece.com.au' : 'bunnings.com.au';

    const hardwareStores = [storeUrl]; // Single store array for backwards compatibility

    console.log('💡 Pricing method settings:', {
      selectedStore,
      storeUrl,
      useScraperApi,
      useBunningsApi,
      scraperUrl: BUNNINGS_SCRAPER_URL,
    });

    let methodName = 'AI estimation';
    if (useScraperApi && selectedStore === 'bunnings') {
      methodName = 'Bunnings';
    } else if (useBunningsApi) {
      methodName = 'Bunnings API';
    }

    console.log(`📊 Using pricing method: ${methodName}`);

    const updatedMaterials = [...materials];

    try {

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
          try {
            console.log(`🔍 Scraper: Searching for "${searchTerm}"...`);
            const product = await withCancel(findBestMatchForMaterial(searchTerm));

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
              console.log(`✅ Scraper: ${product.productName} - $${product.price}`);
            } else {
              console.log('⚠️ Scraper: No product found with price, trying next method...');
              throw new Error('No product found with price');
            }
          } catch (error: any) {
            // Re-throw cancellation so the outer catch handles it instantly
            if (error?.message === '__FETCH_CANCELLED__') throw error;
            console.log('❌ Scraper failed, falling back to next pricing method:', error);

            // Fallback to next method: try Bunnings API first, then AI estimation
            if (useBunningsApi) {
              console.log('🔄 Trying Bunnings API fallback...');
              const result = await withCancel(bunningsApi.findAndPriceMaterial(searchTerm));
              if (result) {
                material.bunningsItemNumber = result.item.itemNumber;
                material.price = result.price.priceIncGst;
                material.totalPrice = material.price * material.quantity;
                material.manualPriceOverride = false;
                material.pricingSource = 'api';
                fetchedCount++;
              triggerPriceFlash(material.id);
                console.log(`✅ Bunnings API fallback succeeded: $${result.price.priceIncGst}`);
              } else {
                // Bunnings API also failed, try AI estimation as final fallback
                console.log('🔄 Bunnings API failed, trying AI estimation fallback...');
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
                  console.log(`✅ AI estimation fallback succeeded: $${aiResult.price}`);
                } else {
                  failedCount++;
                  console.log('❌ All fallback methods failed');
                }
              }
            } else {
              // No Bunnings API, fall back directly to AI estimation
              console.log('🔄 Trying AI estimation fallback...');
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
                console.log(`✅ AI estimation fallback succeeded: $${aiResult.price}`);
              } else {
                failedCount++;
                console.log('❌ AI estimation fallback failed');
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
            console.log(`Using favorite for "${searchTerm}":`, favorite.productName);
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
            console.log(`Web scraping failed for "${searchTerm}", trying AI estimation...`);
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
              console.log(`AI estimation succeeded for "${searchTerm}": $${aiResult.price}`);
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

        // Small delay to avoid overwhelming the API
        await withCancel(new Promise(resolve => setTimeout(resolve, 1000)));
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
        console.error('Error fetching prices:', error);
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

  const handleOpenInStore = (material: Material) => {
    // If we have a direct product URL (from scraper or API), use it!
    if (material.productUrl) {
      console.log(`🔗 Opening product URL: ${material.productUrl}`);
      if (Platform.OS === 'web') {
        window.open(material.productUrl, '_blank');
      } else {
        Linking.openURL(material.productUrl).catch((err) => {
          setSuccessType('error');
          setSuccessTitle('Error');
          setSuccessMessage('Could not open product link.');
          setShowSuccessModal(true);
          console.error('Failed to open URL:', err);
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

    console.log(`🔍 Opening search URL: ${storeUrl}`);

    // Open URL
    if (Platform.OS === 'web') {
      window.open(storeUrl, '_blank');
    } else {
      Linking.openURL(storeUrl).catch((err) => {
        setSuccessType('error');
        setSuccessTitle('Error');
        setSuccessMessage('Could not open store link.');
        setShowSuccessModal(true);
        console.error('Failed to open URL:', err);
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
        return updateMaterialTotalPrice({ ...m, quantity: newQty });
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
        return updateMaterialTotalPrice({ ...m, quantity: newQty });
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
      <ScrollView
          ref={materialsScrollRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={!tourActive}
      >
        <WebContainer>
        {isAiAnalyzing ? (
            <AiAnalyzingState />
        ) : materials.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="package-variant-closed" size={64} color={colors.textMuted} />
            <Text style={styles.emptyText}>{emptyMessage.title}</Text>
            <Text style={styles.emptySubtext}>
              {emptyMessage.subtitle}
            </Text>

            {/* AI Generate Card */}
            <TouchableOpacity ref={aiGenerateRef} style={styles.emptyActionCard} onPress={() => {
              if (!isPro) {
                navigation.navigate('Paywall' as never);
                return;
              }
              handleGenerateMaterialsList();
            }} activeOpacity={0.7}>
              <View style={styles.emptyActionIconWrap}>
                <MaterialCommunityIcons name="auto-fix" size={28} color={colors.primary} />
              </View>
              <View style={styles.emptyActionContent}>
                <View style={styles.emptyActionTitleRow}>
                  <Text style={styles.emptyActionTitle}>Generate with AI</Text>
                  {!isPro && <ProBadge size="small" />}
                </View>
                <Text style={styles.emptyActionDesc}>
                  Automatically create a full materials list from your job description
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={24} color={colors.textMuted} />
            </TouchableOpacity>

            {/* Add Manually Card */}
            <TouchableOpacity ref={addManualRef} style={styles.emptyActionCard} onPress={handleAddMaterial} activeOpacity={0.7}>
              <View style={[styles.emptyActionIconWrap, { backgroundColor: colors.surfaceLight }]}>
                <MaterialCommunityIcons name="plus" size={28} color={colors.onSurface} />
              </View>
              <View style={styles.emptyActionContent}>
                <Text style={styles.emptyActionTitle}>Add manually</Text>
                <Text style={styles.emptyActionDesc}>
                  Search for products or enter materials by hand
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={24} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        ) : (
          <List.Section style={styles.listView}>
            {(() => {
              const groupedMaterials = groupMaterialsByCategory(materials);
              const hasMultipleGroups = groupedMaterials.size > 1 || (groupedMaterials.size === 1 && !groupedMaterials.has(''));

              let runningIndex = 0;
              return Array.from(groupedMaterials.entries()).map(([groupKey, group]) => {
                return (
                  <View key={groupKey || 'uncategorized'}>
                    {/* Section Header - only show if there are multiple groups */}
                    {hasMultipleGroups && (
                      <View style={styles.categoryHeader}>
                        <View style={styles.sectionLine} />
                        <Text style={styles.categoryTitle}>
                          {group.info.name}
                        </Text>
                        <Text style={styles.categoryCount}>
                          ({group.materials.length})
                        </Text>
                        <View style={styles.sectionLine} />
                      </View>
                    )}

                    {/* Materials in this section */}
                    {group.materials.map((material) => {
                      const animIndex = runningIndex++;
                      const isExpanded = expandedMaterials.has(material.id);

                      // Check if brand is meaningful (not just "Bunnings" or the store name)
                      const hasMeaningfulBrand = material.brand &&
                        material.brand.toLowerCase() !== 'bunnings' &&
                        material.brand.toLowerCase() !== 'bunnings.com.au' &&
                        material.brand.toLowerCase() !== 'reece' &&
                        material.brand.toLowerCase() !== 'mitre 10';

                      const hasDetails = material.imageUrl || material.description || hasMeaningfulBrand || material.stockCheckedAt || material.bunningsItemNumber;
                      const showLink = material.pricingSource === 'scraper' || material.pricingSource === 'api';
                      const isAiEstimate = material.pricingSource === 'ai';
                      const isCurrentlyFetching = fetchingMaterialId === material.id;
                      const isRecentlyPriced = recentlyPricedIds.has(material.id);
                      const flashAnim = priceFlashAnims.current.get(material.id);

                      return (
                        <AnimatedListItem key={material.id} index={animIndex} staggerDelay={100}>
                        <Animated.View
                          ref={animIndex === 0 ? firstMaterialItemRef as any : undefined}
                          style={[
                            styles.listItem,
                            isCurrentlyFetching && styles.listItemFetching,
                            isRecentlyPriced && flashAnim && {
                              backgroundColor: flashAnim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [colors.surface, '#0a3d2a'],
                              }),
                              borderLeftWidth: 3,
                              borderLeftColor: flashAnim.interpolate({
                                inputRange: [0, 1],
                                outputRange: ['transparent', colors.success],
                              }),
                            },
                          ]}
                        >
                          <TouchableOpacity
                            onPress={() => hasDetails && toggleMaterialExpanded(material.id)}
                            disabled={!hasDetails}
                            activeOpacity={0.7}
                          >
                            {/* Top row: icon + name + total price */}
                            <View style={styles.itemTopRow}>
                              <View style={styles.itemStatusIcon}>
                                {isCurrentlyFetching ? (
                                  <ActivityIndicator
                                    size={20}
                                    color={colors.primary}
                                  />
                                ) : isRecentlyPriced ? (
                                  <MaterialCommunityIcons
                                    name="check-circle"
                                    size={20}
                                    color={colors.success}
                                  />
                                ) : (
                                  <MaterialCommunityIcons
                                    name="package-variant"
                                    size={20}
                                    color={colors.textMuted}
                                  />
                                )}
                              </View>
                              <View style={styles.itemNameWrap}>
                                <Text style={styles.itemName} numberOfLines={2}>{material.name}</Text>
                                {isCurrentlyFetching ? (
                                  <Text style={styles.searchingLabel}>Searching...</Text>
                                ) : (
                                  <Text style={styles.itemUnitPrice}>
                                    {formatCurrency(material.price)} ea.
                                    {isAiEstimate ? (
                                      <Text style={{
                                        color: material.priceConfidence === 'high' ? colors.success
                                          : material.priceConfidence === 'low' ? '#ef4444'
                                          : '#f59e0b',
                                        fontWeight: '600',
                                      }}>
                                        {'  ·  AI est. '}
                                        ({material.priceConfidence || 'medium'})
                                      </Text>
                                    ) : ''}
                                  </Text>
                                )}
                              </View>
                              <View style={styles.itemPriceWrap}>
                                {isCurrentlyFetching ? (
                                  <Text style={styles.searchingPrice}>...</Text>
                                ) : (
                                  <Text style={[styles.itemTotal, isRecentlyPriced && styles.itemTotalSuccess]}>
                                    {formatCurrency(material.totalPrice)}
                                  </Text>
                                )}
                              </View>
                            </View>

                            {/* Bottom row: qty stepper + actions */}
                            <View style={styles.itemBottomRow}>
                              <View style={styles.qtyRow}>
                                <View style={styles.qtyStepper}>
                                  <Pressable
                                    style={({ pressed }) => [styles.qtyBtn, pressed && styles.qtyBtnPressed]}
                                    onPress={() => handleQuickQuantityUpdate(material.id, -1)}
                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                  >
                                    <MaterialCommunityIcons name="minus" size={16} color={colors.text} />
                                  </Pressable>
                                  <RNTextInput
                                    style={styles.qtyInput}
                                    key={`${material.id}-${localQuantities[material.id] ?? material.quantity}`}
                                    defaultValue={String(localQuantities[material.id] ?? material.quantity)}
                                    onEndEditing={(e) => handleQuantityBlur(material.id, e.nativeEvent.text)}
                                    keyboardType="number-pad"
                                    selectTextOnFocus
                                    returnKeyType="done"
                                  />
                                  <Pressable
                                    style={({ pressed }) => [styles.qtyBtn, pressed && styles.qtyBtnPressed]}
                                    onPress={() => handleQuickQuantityUpdate(material.id, 1)}
                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                  >
                                    <MaterialCommunityIcons name="plus" size={16} color={colors.text} />
                                  </Pressable>
                                </View>
                                <Text style={styles.qtyUnit}>{material.unit}</Text>
                              </View>
                              <View style={styles.itemActions}>
                                {showLink && (
                                  <TouchableOpacity
                                    style={styles.actionBtn}
                                    onPress={() => handleOpenInStore(material)}
                                  >
                                    <MaterialCommunityIcons name="open-in-new" size={18} color={colors.primary} />
                                  </TouchableOpacity>
                                )}
                                <TouchableOpacity
                                  style={styles.actionBtn}
                                  onPress={() => handleEditMaterial(material)}
                                >
                                  <MaterialCommunityIcons name="pencil" size={18} color={colors.textMuted} />
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={styles.actionBtn}
                                  onPress={() => handleDeleteMaterial(material.id)}
                                >
                                  <MaterialCommunityIcons name="delete-outline" size={18} color={colors.textMuted} />
                                </TouchableOpacity>
                              </View>
                            </View>
                          </TouchableOpacity>
                          {hasDetails && (
                            <CollapsibleSection expanded={isExpanded}>
                              <View style={styles.expandedContent}>
                                <View style={styles.detailsContainer}>
                                  {material.imageUrl && (
                                    <Image
                                      source={{ uri: material.imageUrl }}
                                      style={styles.productImage}
                                      resizeMode="contain"
                                    />
                                  )}
                                  <View style={styles.detailsColumn}>
                                    {material.description && (
                                      <View style={styles.detailRow}>
                                        <Text style={styles.detailLabel}>Description:</Text>
                                        <Text style={styles.detailValue}>{material.description}</Text>
                                      </View>
                                    )}
                                    {hasMeaningfulBrand && (
                                      <View style={styles.detailRow}>
                                        <Text style={styles.detailLabel}>Brand:</Text>
                                        <Text style={styles.detailValue}>{material.brand}</Text>
                                      </View>
                                    )}
                                    {material.stockCheckedAt && (
                                      <View style={styles.detailRow}>
                                        <Text style={styles.detailLabel}>Last checked:</Text>
                                        <Text style={styles.detailValue}>{formatTimeAgo(material.stockCheckedAt)}</Text>
                                      </View>
                                    )}
                                    {material.bunningsItemNumber && (
                                      <View style={styles.detailRow}>
                                        <Text style={styles.detailLabel}>Item #:</Text>
                                        <Text style={styles.detailValue}>{material.bunningsItemNumber}</Text>
                                      </View>
                                    )}
                                  </View>
                                </View>
                              </View>
                            </CollapsibleSection>
                          )}
                        </Animated.View>
                        </AnimatedListItem>
                      );
                    })}
                  </View>
                );
              });
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

        {/* Add Material button - inline so it doesn't overlay content */}
        {materials.length > 0 && !isAiAnalyzing && (
          <TouchableOpacity ref={addMaterialButtonRef as any} style={styles.addMaterialButton} onPress={handleAddMaterial}>
            <MaterialCommunityIcons name="plus" size={20} color={colors.primary} />
            <Text style={styles.addMaterialButtonText}>Add Material</Text>
          </TouchableOpacity>
        )}

        {/* Spacer for fixed bottom button */}
        <View style={{ height: 120 }} />
        </WebContainer>
       </ScrollView>

      <FixedBottomButton
        label={isAiAnalyzing ? "Cancel" : "Next: Labor & Markup"}
        onPress={isAiAnalyzing ? handleCancelGeneration : handleNext}
        mode={isAiAnalyzing ? "outlined" : "contained"}
        buttonStyle={isAiAnalyzing ? { borderColor: colors.error, borderWidth: 2 } : undefined}
        labelStyle={isAiAnalyzing ? { color: colors.error } : undefined}
        secondaryLabel={materials.length > 0 && !isAiAnalyzing ? "Fetch Prices" : undefined}
        secondaryOnPress={materials.length > 0 && !isAiAnalyzing ? handleFetchPrices : undefined}
        secondaryLoading={isFetchingPrices}
        secondaryDisabled={isFetchingPrices}
        secondaryLoadingText={isFetchingPrices && fetchProgress.total > 0 ? `${chasingTitle.split(' ')[0]} ${fetchProgress.current} of ${fetchProgress.total}...` : undefined}
        secondaryLoadingOnPress={isFetchingPrices ? handleCancelFetchPrices : undefined}
        secondaryRef={fetchPricesButtonRef}
      />

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

            {/* Progress bar */}
            {fetchProgress.total > 0 && (
              <View style={styles.progressBarContainer}>
                <View style={[styles.progressBarFill, { width: `${(fetchProgress.current / fetchProgress.total) * 100}%` }]} />
              </View>
            )}

            <Text style={styles.fetchEstimateSubtext}>
              {fetchProgress.total > 0 && currentFetchingName
                ? `${chasingSubtitle} ${fetchProgress.current} of ${fetchProgress.total}`
                : 'Warming up the ute...'}
            </Text>
            {/* Item list - show last 2 completed + current = max 3 */}
            <View style={styles.fetchItemsWindow}>
              <View style={styles.fetchItemsContent}>
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
              </View>
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
            {fetchProgress.total > 0
              ? `${fetchProgress.current}/${fetchProgress.total}`
              : 'Fetching...'}
          </Text>
          <View style={styles.fetchMinimizedProgressBg}>
            <View style={[styles.fetchMinimizedProgressFill, { width: fetchProgress.total > 0 ? `${(fetchProgress.current / fetchProgress.total) * 100}%` : '0%' }]} />
          </View>
          {notifyWhenDone && <MaterialCommunityIcons name="bell-ring-outline" size={14} color={colors.primary} />}
          <MaterialCommunityIcons name="chevron-up" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      )}

      {/* Success Modal */}
      <AlertModal
        visible={showSuccessModal}
        onDismiss={() => { setShowSuccessModal(false); setSuccessType('success'); }}
        type={successType}
        title={successTitle}
        message={successMessage}
      />
      {!showSuccessModal && (
        <>
          <ScreenTour
            tourId="materialsList"
            onActiveChange={setTourActive}
            unifiedMode={unifiedTourActive && unifiedTourPhase === 'materialsList'}
            onScreenComplete={() => notifyScreenComplete('materialsList')}
            onSkipRequest={notifySkipRequest}
            stepOffset={unifiedTourActive ? PHASE_STEP_OFFSETS.materialsList : 0}
            globalTotalSteps={unifiedTourActive ? UNIFIED_TOUR_TOTAL_STEPS : undefined}
          />
          {materials.length > 0 && !isAiAnalyzing && (
            <ScreenTour
              tourId="materialsListItems"
              delay={unifiedTourActive ? 800 : 600}
              onActiveChange={setTourActive}
              scrollRef={materialsScrollRef}
              scrollPositions={{ fetchPricesButton: 99999, firstMaterialItem: 0, addMaterialButton: 99999 }}
              unifiedMode={unifiedTourActive && unifiedTourPhase === 'materialsListItems'}
              onScreenComplete={() => notifyScreenComplete('materialsListItems')}
              onSkipRequest={notifySkipRequest}
              stepOffset={unifiedTourActive ? PHASE_STEP_OFFSETS.materialsListItems : 0}
              globalTotalSteps={unifiedTourActive ? UNIFIED_TOUR_TOTAL_STEPS : undefined}
              onStepChange={(stepId) => {
                if (!unifiedTourActive) return;
                const quote = currentQuote;
                if (!quote) return;
                if (stepId === 'fetchPricesButton') {
                  // Simulate price fetch when advancing past the "Strewth" step
                  const pricedMaterials = getTourMaterialsPriced();
                  storeUpdateQuote({ ...quote, materials: pricedMaterials });
                } else if (stepId === 'firstMaterialItem') {
                  // Second time we hit firstMaterialItem — after prices. Expand first item.
                  if (materials.some(m => m.price > 0) && materials.length > 0) {
                    setExpandedMaterials(new Set([materials[0].id]));
                  }
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
  addMaterialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: 'dashed',
  },
  addMaterialButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.primary,
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
