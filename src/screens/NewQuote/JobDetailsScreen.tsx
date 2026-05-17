/**
 * Job Details Screen
 * First step: Select template and enter job parameters
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  Animated,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Text,
  TextInput,
  Button,
  Surface,
  Title,
  Card,
  Chip,
  ActivityIndicator,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute } from '@react-navigation/native';
// Safe import — native module may not be available if dev client wasn't rebuilt
let ExpoSpeechRecognitionModule: any = null;
let useSpeechRecognitionEvent: any = (_event: string, _callback: Function) => {};
try {
  const speechModule = require('expo-speech-recognition');
  ExpoSpeechRecognitionModule = speechModule.ExpoSpeechRecognitionModule;
  useSpeechRecognitionEvent = speechModule.useSpeechRecognitionEvent;
} catch (e) {
  // silently ignore - speech features disabled
}

import { useStore } from '../../store/useStore';
import { useCurrentDocument, useDocumentMode } from '../../utils/documentMode';
import { JOB_TEMPLATES } from '../../data/jobTemplates';
import { NICHE_TEMPLATES, getTemplatesForNiche, getNicheTemplateById, NicheJobTemplate, getDescriptionPlaceholder, getVoicePromptHint } from '../../data/nicheTemplates';
import { getPillsForNiche } from '../../data/nichePills';
import { ListeningPills } from '../../components/ListeningPills';
import { usePillMatcher, PillState } from '../../hooks/usePillMatcher';
import { getTradeCategoryById, getTradeNicheById, PRICING_METHODS } from '../../constants/tradeCategories';
import { createJobFromTemplate } from '../../utils/materialsEstimator';
import { colors } from '../../theme';
import { JobTemplate, QuotePhoto } from '../../types';
import type { TemplateMatchInput } from '../../services/llmService';
import { loadTemplates } from '../../services/sectionTemplateService';
import { generateId } from '../../utils/generateId';
import { getRecentJobTypeIds, recordJobTypeUsed, sortByRecency } from '../../utils/recentJobTypes';
import { WebContainer } from '../../components/WebContainer';
import { FixedBottomButton } from '../../components/FixedBottomButton';
import { ProBadge } from '../../components/ProBadge';
import { AlertModal } from '../../components/AlertModal';
import { JobPhotos } from '../../components/JobPhotos';
import { PhotoAnnotator } from '../../components/PhotoAnnotator';
import { useTourRefs } from '../../components/tour/useTourRefs';
import { ScreenTour } from '../../components/tour/ScreenTour';
import { TOUR_STEPS, INTRO_TOUR_TOTAL_STEPS } from '../../components/tour/tourSteps';
import { notifyScreenComplete, notifySkipRequest } from '../../components/tour/UnifiedTourController';
import { getTourPhoto, getTourPhotoAnnotated } from '../../components/tour/tourDummyData';
import { PHASE_STEP_OFFSETS, UNIFIED_TOUR_TOTAL_STEPS } from '../../components/tour/tourFlow';

// Sentinel id for the Custom chip so it participates in MRU sorting alongside
// niche template ids. Recorded via recordJobTypeUsed(CUSTOM_CHIP_ID) on tap.
const CUSTOM_CHIP_ID = 'custom';

export function JobDetailsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const fromTour = route.params?.fromTour;
  const isEditFromPreview = route.params?.editing === true;
  const mode = useDocumentMode();
  const { document: currentDocument, update: updateDocument } = useCurrentDocument();
  const quotes = useStore((s) => s.quotes);
  const invoices = useStore((s) => s.invoices);
  const businessSettings = useStore((s) => s.businessSettings);
  const subscriptionStatus = useStore((s) => s.subscriptionStatus);
  const saveDraft = useStore((s) => s.saveDraft);
  const unifiedTourActive = useStore((s) => s.unifiedTourActive);
  const unifiedTourPhase = useStore((s) => s.unifiedTourPhase);
  const isTrialActive = !!(subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired);
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  // For compatibility, alias to currentQuote (used throughout this file)
  const currentQuote = currentDocument;
  const updateQuote = updateDocument;
  const insets = useSafeAreaInsets();

  const [selectedTemplate, setSelectedTemplate] = useState<JobTemplate | NicheJobTemplate | null>(null);
  const [customParams, setCustomParams] = useState<Record<string, number>>({});
  const [jobName, setJobName] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisErrorDialogVisible, setAnalysisErrorDialogVisible] = useState(false);
  const [analysisErrorMessage, setAnalysisErrorMessage] = useState('');
  const [useCustomMode, setUseCustomMode] = useState(true); // Default to custom (AI) mode
  const [jobPhotos, setJobPhotos] = useState<QuotePhoto[]>([]);
  const [includePhotosInAi, setIncludePhotosInAi] = useState(true);
  // Snapshot taken right before cleanup runs; while non-null the user can
  // undo the cleanup and restore the original description + title.
  const [preCleanupSnapshot, setPreCleanupSnapshot] = useState<{ description: string; title: string } | null>(null);
  // Most-recently-used job-type chip ids, loaded once on mount. Drives the
  // chip ordering so frequent picks float to the front. Captured at mount
  // time only — we don't reorder mid-screen, which would jump chips around
  // under the user's finger as they tap.
  const [recentJobTypeIds, setRecentJobTypeIds] = useState<string[]>([]);
  const [recentJobTypeIdsLoaded, setRecentJobTypeIdsLoaded] = useState(false);
  useEffect(() => {
    getRecentJobTypeIds().then(ids => {
      setRecentJobTypeIds(ids);
      setRecentJobTypeIdsLoaded(true);
    });
  }, []);

  // Tour refs
  const { registerRef } = useTourRefs();
  const descriptionRef = useRef<View>(null);
  const descriptionCleanedRef = useRef<View>(null);
  const descriptionInputRef = useRef<any>(null);
  const micButtonRef = useRef<View>(null);
  const jobPhotosRef = useRef<View>(null);
  const jobPhotoThumbnailRef = useRef<View>(null);
  const analyzeRef = useRef<View>(null);
  const descriptionCardRef = useRef<View>(null);
  // Y position of the description card inside the ScrollView's content,
  // captured via onLayout. measureLayout against the inner scroll node was
  // flaky (worked first tap then drifted), this is the reliable signal.
  const descriptionCardYRef = useRef(0);
  // Y of the description input wrapper relative to its parent Surface card.
  // Combined with descriptionCardYRef to compute an absolute scroll target —
  // measureLayout on Fabric requires a host-component ref (not a numeric
  // node handle from findNodeHandle), so we side-step it with onLayout.
  const descriptionYInCardRef = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const [tourActive, setTourActive] = useState(false);
  const [tourAnnotatorOpen, setTourAnnotatorOpen] = useState(false);
  const typewriterRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (descriptionRef.current) registerRef('jobDescription', descriptionRef.current);
    if (descriptionCleanedRef.current) registerRef('jobDescriptionCleaned', descriptionCleanedRef.current);
    if (micButtonRef.current) registerRef('micButton', micButtonRef.current);
    if (jobPhotosRef.current) registerRef('jobPhotos', jobPhotosRef.current);
    if (jobPhotoThumbnailRef.current) registerRef('jobPhotoThumbnail', jobPhotoThumbnailRef.current);
    // jobPhotoAnnotated uses the same ref as jobPhotoThumbnail (same element, different content)
    if (jobPhotoThumbnailRef.current) registerRef('jobPhotoAnnotated', jobPhotoThumbnailRef.current);
    if (analyzeRef.current) registerRef('analyzeButton', analyzeRef.current);
  });

  // Clean up typewriter on unmount
  useEffect(() => {
    return () => {
      if (typewriterRef.current) clearInterval(typewriterRef.current);
    };
  }, []);

  // Listening pills — passive checklist that ticks itself off as the user
  // dictates. Pills come from the selected template's niche; serverState is
  // set once the cleanup LLM round-trip returns its authoritative map.
  const nichePills = React.useMemo(() => {
    const t = selectedTemplate as NicheJobTemplate | null;
    return getPillsForNiche(t?.categoryId, t?.nicheId);
  }, [selectedTemplate]);
  const [pillServerState, setPillServerState] = useState<PillState | null>(null);
  const pillState = usePillMatcher({
    transcript: jobDescription,
    pills: nichePills,
    serverState: pillServerState,
  });

  // Voice recording states
  const [isRecording, setIsRecording] = useState(false);
  const isRecordingRef = useRef(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const startingDescriptionRef = useRef('');
  const lastTranscriptRef = useRef('');
  const pulseAnim = useState(new Animated.Value(1))[0];
  const glowAnim = useState(new Animated.Value(0))[0];
  const rippleAnim = useState(new Animated.Value(0))[0];
  const rotateAnim = useState(new Animated.Value(0))[0];
  const webRecognitionRef = useRef<any>(null);

  // Keep ref in sync with state
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  // Templates available to this user, derived from their selected trade
  // categories/niches. Drives the chip row at the top of the screen.
  // Per-category fallback: if a category has no matching niche selected,
  // surface every template for that category — otherwise picking two
  // categories but only niches from one would hide the other entirely.
  const availableTemplates = React.useMemo<NicheJobTemplate[]>(() => {
    if (!businessSettings) return [];
    const all: NicheJobTemplate[] = [];
    const userNiches = businessSettings.tradeNiches || [];
    if (businessSettings.tradeCategories && businessSettings.tradeCategories.length > 0) {
      businessSettings.tradeCategories.forEach(catId => {
        const cat = getTradeCategoryById(catId);
        if (!cat) return;
        const before = all.length;
        // Niche 'all' is a meta-niche meaning "everything in this category" —
        // filter it out so we hit the broaden-to-category fallback below.
        const categoryNicheIds = new Set(cat.niches.map(n => n.id));
        const nichesForThisCategory = userNiches.filter(n => categoryNicheIds.has(n) && n !== 'all');
        nichesForThisCategory.forEach(nicheId => {
          all.push(...getTemplatesForNiche(catId, nicheId));
        });
        // If user's selections produced no templates for this category
        // (no niches picked, picked 'all', or picked niches without templates),
        // surface every template for the category instead of hiding it.
        if (all.length === before) {
          cat.niches.forEach(n => all.push(...getTemplatesForNiche(catId, n.id)));
        }
      });
    } else if (businessSettings.tradeCategory) {
      const cat = getTradeCategoryById(businessSettings.tradeCategory);
      const before = all.length;
      if (businessSettings.tradeNiche && businessSettings.tradeNiche !== 'all') {
        all.push(...getTemplatesForNiche(businessSettings.tradeCategory, businessSettings.tradeNiche));
      }
      if (all.length === before && cat) {
        cat.niches.forEach(n => all.push(...getTemplatesForNiche(businessSettings.tradeCategory!, n.id)));
      }
    }
    const deduped = Array.from(new Map(all.map(t => [t.id, t])).values());
    return sortByRecency(deduped, recentJobTypeIds);
  }, [businessSettings, recentJobTypeIds]);

  // Unified chip row — niche templates plus a sentinel "Custom" entry that
  // participates in the same MRU ordering. Custom sits first by default
  // (cold-start fallback), but once the tradie picks a niche that niche
  // floats to the front; once they pick Custom, Custom floats back.
  type ChipItem = NicheJobTemplate | { id: typeof CUSTOM_CHIP_ID; kind: 'custom' };
  const chipItems = React.useMemo<ChipItem[]>(() => {
    const customSentinel: ChipItem = { id: CUSTOM_CHIP_ID, kind: 'custom' };
    return sortByRecency<ChipItem>([customSentinel, ...availableTemplates], recentJobTypeIds);
  }, [availableTemplates, recentJobTypeIds]);

  // Header title — "New <niche> job" when a single niche is selected, else
  // "New job". Keeps the entity word "job" since it persists through the
  // quote-to-completion lifecycle.
  const screenHeaderTitle = React.useMemo<string>(() => {
    if (!businessSettings) return 'New job';
    const niches = businessSettings.tradeNiches?.length
      ? businessSettings.tradeNiches
      : (businessSettings.tradeNiche ? [businessSettings.tradeNiche] : []);
    const cats = businessSettings.tradeCategories?.length
      ? businessSettings.tradeCategories
      : (businessSettings.tradeCategory ? [businessSettings.tradeCategory] : []);
    if (niches.length !== 1 || cats.length !== 1) return 'New job';
    const niche = getTradeNicheById(cats[0], niches[0]);
    if (!niche || niche.id === 'all') return 'New job';
    return `New ${niche.name.toLowerCase()} job`;
  }, [businessSettings]);


  // Check if editing an existing document (by checking if it exists in saved quotes/invoices)
  const isEditingExisting = !!(currentQuote && (
    mode === 'invoice'
      ? invoices.find(i => i.id === currentQuote.id)
      : quotes.find(q => q.id === currentQuote.id)
  ));

  // Speech recognition event handlers
  useSpeechRecognitionEvent('start', () => {
    setRecognizing(true);
  });

  useSpeechRecognitionEvent('end', () => {
    setRecognizing(false);
    const isStillRecording = isRecordingRef.current;

    // If user is still recording (didn't manually stop), save and restart
    if (isStillRecording && lastTranscriptRef.current) {
      // Save the last segment to accumulated
      const newAccumulated = startingDescriptionRef.current
        ? startingDescriptionRef.current + ' ' + lastTranscriptRef.current
        : lastTranscriptRef.current;

      startingDescriptionRef.current = newAccumulated;
      lastTranscriptRef.current = '';

      // Restart speech recognition
      setTimeout(async () => {
        if (isRecordingRef.current) {
          try {
            await ExpoSpeechRecognitionModule.start({
              lang: 'en-AU',
              interimResults: true,
              maxAlternatives: 1,
              continuous: true,
              requiresOnDeviceRecognition: false,
              contextualStrings: ['deck', 'handrail', 'timber', 'pine', 'meters', 'metres'],
            });
          } catch (error) {
            setIsRecording(false);
          }
        }
      }, 100);
    }
  });

  useSpeechRecognitionEvent('result', (event: any) => {
    if (!isRecordingRef.current) {
      return; // Ignore results if we're not recording
    }

    const allResults = event.results || [];

    // Get the latest result (the last one in the array)
    // Each result contains the full transcript for that segment, not incremental text
    const lastResult = allResults[allResults.length - 1];
    if (!lastResult?.transcript) {
      return;
    }

    const currentTranscript = lastResult.transcript.trim();
    if (!currentTranscript) {
      return;
    }

    // If results count is 1 and we have a previous transcript that's different,
    // it means recognition restarted - check if it's a refinement or new segment
    if (allResults.length === 1 && lastTranscriptRef.current && lastTranscriptRef.current !== currentTranscript) {
      const lastLower = lastTranscriptRef.current.toLowerCase();
      const currentLower = currentTranscript.toLowerCase();

      // Check if current starts with a similar beginning to last (refinement/correction)
      // Get first 3 words of each
      const lastWords = lastLower.split(/\s+/).slice(0, 3).join(' ');
      const currentWords = currentLower.split(/\s+/).slice(0, 3).join(' ');
      const isRefinement = lastWords === currentWords;

      // Check if this is truly a new segment (not just a refinement)
      if (!isRefinement && !currentLower.includes(lastLower) && !lastLower.includes(currentLower)) {
        const newAccumulated = startingDescriptionRef.current
          ? startingDescriptionRef.current + ' ' + lastTranscriptRef.current
          : lastTranscriptRef.current;

        startingDescriptionRef.current = newAccumulated;
        // Display ONLY accumulated text for this frame, next result will add current
        setJobDescription(startingDescriptionRef.current);
        lastTranscriptRef.current = currentTranscript;
        return; // Exit early to avoid double display
      } else if (isRefinement) {
        // This is a refinement of what was already said, just update the display
        const displayText = startingDescriptionRef.current
          ? startingDescriptionRef.current + ' ' + currentTranscript
          : currentTranscript;

        setJobDescription(displayText);
        lastTranscriptRef.current = currentTranscript;
        return;
      }
    }

    // Display accumulated + current transcript
    const displayText = startingDescriptionRef.current
      ? startingDescriptionRef.current + ' ' + currentTranscript
      : currentTranscript;

    setJobDescription(displayText);
    lastTranscriptRef.current = currentTranscript;

  });

  useSpeechRecognitionEvent('error', (event: any) => {
    setIsRecording(false);
    setRecognizing(false);
    Alert.alert('Voice Recognition Error', event.error || 'Could not recognize speech');
  });

  // Beautiful animations for recording button. The four loops were previously
  // started without being stored, so toggling isRecording or unmounting the
  // screen left them running forever — every Start/Stop press stacked another
  // 4 loops on top of the previous, eventually causing GPU compositing thrash.
  useEffect(() => {
    if (!isRecording) {
      // Reset all animations smoothly back to idle.
      Animated.parallel([
        Animated.timing(pulseAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(rippleAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(rotateAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
      return;
    }

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    );
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0, duration: 1500, useNativeDriver: true }),
      ])
    );
    const rippleLoop = Animated.loop(
      Animated.timing(rippleAnim, { toValue: 1, duration: 2000, useNativeDriver: true })
    );
    const rotateLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(rotateAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(rotateAnim, { toValue: 0, duration: 2000, useNativeDriver: true }),
      ])
    );

    pulseLoop.start();
    glowLoop.start();
    rippleLoop.start();
    rotateLoop.start();

    return () => {
      pulseLoop.stop();
      glowLoop.stop();
      rippleLoop.stop();
      rotateLoop.stop();
    };
  }, [isRecording]);

  useEffect(() => {
    if (currentQuote) {
      setJobName(currentQuote.job.name);
      setJobDescription(currentQuote.job.description || '');
      setJobPhotos((currentQuote as any).photos || []);

      // Load template if exists and it's not 'custom'
      const template = JOB_TEMPLATES.find((t) => t.id === currentQuote.job.template);
      if (template && template.id !== 'custom') {
        setSelectedTemplate(template);
        setCustomParams(currentQuote.job.customParams || {});
        setUseCustomMode(false); // Switch to template mode
      } else {
        // It's a custom job
        setSelectedTemplate(null);
        setUseCustomMode(true);
      }
    }
  }, [currentQuote]);

  // Cold-start default: pre-select the first chip in the unified list so the
  // description placeholder feels trade-specific from second one. The first
  // chip may be Custom (no MRU yet, or Custom is the most-recent pick) — in
  // that case selectedTemplate stays null, which is the Custom state.
  // Skips when editing an existing job or when the user already has a chip
  // selected. Waits for the MRU list to load so the default reflects the
  // user's most-recent pick rather than the alphabetical first template.
  useEffect(() => {
    if (isEditingExisting) return;
    if (selectedTemplate) return;
    if (!recentJobTypeIdsLoaded) return;
    const first = chipItems[0];
    if (!first) return;
    if (first.id === CUSTOM_CHIP_ID) return; // null is already the Custom state
    setSelectedTemplate(first as NicheJobTemplate);
  }, [chipItems, isEditingExisting, recentJobTypeIdsLoaded]);

  // Save changes when navigating back. updateQuote keeps currentQuote in sync,
  // saveDraft persists to AsyncStorage + Firestore. Both are needed — without
  // saveDraft, a gesture-back only updates memory and the edit can be lost.
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', () => {
      if (!currentQuote) return;

      if (jobName.trim() || jobDescription.trim()) {
        const updatedQuote = {
          ...currentQuote,
          job: {
            ...currentQuote.job,
            name: jobName.trim() || currentQuote.job.name,
            description: jobDescription.trim(),
          },
          photos: jobPhotos,
        };
        updateQuote(updatedQuote);
        saveDraft(updatedQuote);
      }
    });

    return unsubscribe;
  }, [navigation, currentQuote, jobName, jobDescription, jobPhotos, updateQuote, saveDraft]);

  const handleVoiceRecording = async () => {
    // Web: Use native Web Speech API directly
    if (Platform.OS === 'web') {
      if (isRecording) {
        // Stop recording
        if (webRecognitionRef.current) {
          webRecognitionRef.current.stop();
        }
        setIsRecording(false);
        // Auto-cleanup removed - user must press clean-up button manually
      } else {
        // Start recording
        // @ts-ignore - Web Speech API
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
          Alert.alert('Not Supported', 'Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.');
          return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-AU';

        let finalTranscript = jobDescription; // Start with existing text

        recognition.onresult = (event: any) => {
          let interimTranscript = '';

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalTranscript += (finalTranscript ? ' ' : '') + transcript;
            } else {
              interimTranscript += transcript;
            }
          }

          // Show final + interim
          const displayText = finalTranscript + (interimTranscript ? ' ' + interimTranscript : '');
          setJobDescription(displayText);
        };

        recognition.onerror = (event: any) => {
          setIsRecording(false);
          Alert.alert('Error', 'Speech recognition failed: ' + event.error);
        };

        recognition.onend = () => {
          if (isRecordingRef.current) {
            // Restart if still recording
            recognition.start();
          }
        };

        webRecognitionRef.current = recognition;
        recognition.start();
        setIsRecording(true);
      }
      return;
    }

    // Native: Use expo-speech-recognition
    if (!ExpoSpeechRecognitionModule) {
      Alert.alert('Not Available', 'Speech recognition is not available. Please rebuild the dev client.');
      return;
    }

    if (isRecording) {
      // Stop recording manually
      try {
        // Build final description from accumulated + last segment BEFORE stopping
        const finalDescription = startingDescriptionRef.current && lastTranscriptRef.current
          ? startingDescriptionRef.current + ' ' + lastTranscriptRef.current
          : startingDescriptionRef.current || lastTranscriptRef.current || jobDescription;

        // Set the description immediately to prevent any reset
        setJobDescription(finalDescription);

        // Set isRecording to false FIRST so the end event handler knows user stopped manually
        setIsRecording(false);

        // Then stop the speech recognition (this will trigger the end event)
        await ExpoSpeechRecognitionModule.stop();

        // Reset transcript refs after stopping
        setTranscript('');
        startingDescriptionRef.current = '';
        lastTranscriptRef.current = '';
        // Auto-cleanup removed - user must press clean-up button manually
      } catch (error) {
        setIsRecording(false);
        Alert.alert('Error', 'Failed to stop voice recording');
      }
    } else {
      // Start recording - append to existing description
      try {
        // First check if we already have permission
        const currentStatus = await ExpoSpeechRecognitionModule.getPermissionsAsync();
        let result = currentStatus;

        // Only request if not already granted
        if (!currentStatus.granted) {
          setIsRequestingPermission(true);

          // Add a timeout to prevent infinite loading
          const permissionPromise = ExpoSpeechRecognitionModule.requestPermissionsAsync();
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Permission request timed out')), 10000)
          );

          try {
            result = await Promise.race([permissionPromise, timeoutPromise]) as any;
          } catch (timeoutError) {
            setIsRequestingPermission(false);
            Alert.alert(
              'Permission Request Failed',
              Platform.OS === 'ios'
                ? 'The permission dialog did not appear. Please go to Settings > QuoteMate > Microphone and enable it, then try again.'
                : 'The permission dialog did not appear. Please check:\n\n1. Go to Settings > Apps > QuoteMate > Permissions\n2. Enable Microphone permission\n3. Try again'
            );
            return;
          }

          setIsRequestingPermission(false);

          if (!result.granted) {
            Alert.alert('Permission Required', 'Microphone permission is required for voice recording');
            return;
          }
        }

        // Check if speech recognition is available
        const available = await ExpoSpeechRecognitionModule.getStateAsync();

        // Save starting description and clear refs
        startingDescriptionRef.current = jobDescription;
        lastTranscriptRef.current = '';
        setTranscript('');

        await ExpoSpeechRecognitionModule.start({
          lang: 'en-AU', // Australian English
          interimResults: true,
          maxAlternatives: 1,
          continuous: true, // Keep recording until user manually stops
          requiresOnDeviceRecognition: false,
          contextualStrings: ['deck', 'handrail', 'timber', 'pine', 'meters', 'metres'],
        });
        setIsRecording(true);
      } catch (error: any) {
        // Ensure we always reset the loading state
        setIsRequestingPermission(false);
        setIsRecording(false);
        Alert.alert(
          'Error Starting Recording',
          `Failed to start voice recording: ${error?.message || 'Unknown error'}\n\nPlease check:\n1. Microphone permission is granted\n2. Speech recognition is available on your device\n3. Internet connection (for cloud recognition)`
        );
      }
    }
  };

  const handleClearDescription = () => {
    setJobDescription('');
    setJobName('');
    setTranscript('');
    startingDescriptionRef.current = '';
    lastTranscriptRef.current = '';
    setPreCleanupSnapshot(null);
    setPillServerState(null);
  };

  const handleUndoCleanup = () => {
    if (!preCleanupSnapshot) return;
    setJobDescription(preCleanupSnapshot.description);
    setJobName(preCleanupSnapshot.title);
    setPreCleanupSnapshot(null);
  };

  const handleCleanupDescription = async () => {
    if (!jobDescription.trim()) {
      Alert.alert('No Description', 'Please enter or record a job description first');
      return;
    }

    // Snapshot current values so the user can undo the cleanup.
    const snapshot = { description: jobDescription, title: jobName };

    setIsProcessingVoice(true);
    try {
      // Load saved templates to include in the cleanup call
      const savedTemplates = await loadTemplates();
      const templateInputs: TemplateMatchInput[] | undefined = savedTemplates.length > 0
        ? savedTemplates.map(t => ({
            id: t.id,
            name: t.name,
            description: t.description,
            materialCount: t.materials.length,
            laborSummary: `${t.laborHours} ${t.laborUnit === 'days' ? 'days' : 'hrs'}`,
          }))
        : undefined;

      const pillSpecInput = nichePills.length > 0
        ? nichePills.map(p => ({ id: p.id, label: p.label }))
        : undefined;
      const { cleanupTranscriptionAndGenerateTitle } = await import('../../services/llmService');
      const result = await cleanupTranscriptionAndGenerateTitle(jobDescription, templateInputs, pillSpecInput);
      setJobDescription(result.cleanedDescription);
      if (result.suggestedTitle && !jobName) {
        setJobName(result.suggestedTitle);
      }
      // Authoritative pill state from the LLM. Replaces any client-side
      // keyword guesses (handles negation like "no oven" correctly).
      if (result.pills) {
        setPillServerState(result.pills);
      }
      // Cleanup succeeded — record the pre-cleanup state so the user can revert.
      setPreCleanupSnapshot(snapshot);
      // Store template suggestions on the quote for the materials screen
      if (result.templateSuggestions && result.templateSuggestions.length > 0 && currentQuote) {
        updateQuote({
          ...currentQuote,
          job: { ...currentQuote.job, description: result.cleanedDescription, name: result.suggestedTitle || currentQuote.job.name },
          templateSuggestions: result.templateSuggestions.map(s => ({
            templateId: s.templateId,
            templateName: s.templateName,
            suggestedQuantity: s.suggestedQuantity,
            reasoning: s.reasoning,
          })),
        });
      }
    } catch (error) {
      Alert.alert('Cleanup Failed', 'Could not clean up the description. Please try again.');
    } finally {
      setIsProcessingVoice(false);
    }
  };

  const handleTemplateSelect = (template: JobTemplate) => {
    setSelectedTemplate(template);

    // Initialize default params
    const defaults: Record<string, number> = {};
    template.requiredParams.forEach((param) => {
      defaults[param.key] = param.defaultValue || 0;
    });
    setCustomParams(defaults);
  };

  // Chip-row handler: select template and pop the keyboard so the
  // template's question prompts (rendered as the placeholder) are visible
  // and the tradie can start typing immediately.
  const handleSelectTemplate = (template: JobTemplate | NicheJobTemplate | null) => {
    setSelectedTemplate(template);
    // Different niche → different pill checklist. Old server state belongs
    // to a different set of ids; clear so we start from a fresh slate.
    setPillServerState(null);
    // Fire-and-forget — affects ordering on the next visit, not this one.
    // Custom uses its own sentinel id so it floats in MRU like any niche.
    recordJobTypeUsed(template?.id || CUSTOM_CHIP_ID);
    // Scroll the description card to the top of the viewport so the user's
    // eye lands on the description input. We deliberately do NOT focus the
    // input — popping the keyboard on chip tap was disorienting; let the
    // user tap into the field themselves when they're ready to type.
    if (descriptionCardYRef.current > 0) {
      scrollRef.current?.scrollTo({
        y: Math.max(0, descriptionCardYRef.current - 8),
        animated: true,
      });
    }
  };

  // Scroll the pills row to the top of the viewport when the description
  // input is focused — gives the user a clean view of "what's left to
  // mention" the moment they start typing. The description wrapper's
  // onLayout y is relative to the Surface card, so we add the card's y
  // (also captured via onLayout) to get the absolute offset in the scroll
  // container.
  const handleDescriptionFocus = () => {
    // Small delay so any keyboard-driven auto-scroll resolves first; we
    // want the final scroll position to be ours, not the keyboard's.
    setTimeout(() => {
      const absoluteY = descriptionCardYRef.current + descriptionYInCardRef.current;
      if (absoluteY <= 0) return;
      scrollRef.current?.scrollTo({ y: Math.max(0, absoluteY - 8), animated: true });
    }, 80);
  };

  const handleParamChange = (key: string, value: string) => {
    setCustomParams((prev) => ({
      ...prev,
      [key]: parseFloat(value) || 0,
    }));
  };

  const handleSkipToManualEntry = () => {
    if (!currentQuote) return;

    // Create a job with empty materials list - user will add them manually
    const job = {
      id: generateId(),
      name: jobName || 'Custom Job',
      description: jobDescription,
      template: 'custom' as const,
      estimatedHours: 8, // Default hours
    };

    const updatedQuote = {
      ...currentQuote,
      job,
      materials: [], // Empty - user will add manually
      laborHours: 8,
      aiSkipped: true, // Flag that AI was intentionally skipped
      draftStep: 'CustomerDetails',
      photos: jobPhotos,
    };

    updateQuote(updatedQuote);
    saveDraft(updatedQuote);
    navigation.navigate('CustomerDetails');
  };

  const handleAnalyzeCustomJob = () => {
    if (!jobDescription.trim()) {
      Alert.alert('Missing Information', 'Please enter a job description');
      return;
    }

    if (!currentQuote) return;

    // Create a temporary job object and navigate immediately
    const job = {
      id: generateId(),
      name: jobName || 'Custom Job',
      description: jobDescription,
      template: 'custom' as const,
      estimatedHours: 8, // Default, will be updated after analysis
    };

    const updatedQuote = {
      ...currentQuote,
      job,
      materials: [], // Empty for now, will be populated in background
      laborHours: 8,
      aiSkipped: false, // Explicitly mark that AI is being used
      draftStep: 'CustomerDetails',
      photos: jobPhotos,
    };

    updateQuote(updatedQuote);
    saveDraft(updatedQuote);

    // Navigate immediately - AI will analyze in background on CustomerDetails or MaterialsList screen
    navigation.navigate('CustomerDetails');

    // Start AI analysis in background (non-blocking)
    setIsAnalyzing(true);

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

      // Selected job-type chip — sharper signal than the broader niche.
      // Surfaces the chosen template's name + suggested materials to the LLM.
      const nicheTemplate = selectedTemplate as NicheJobTemplate | null;
      if (nicheTemplate?.name) {
        nicheNames.unshift(nicheTemplate.name);
      }
      if (nicheTemplate?.suggestedMaterials?.length) {
        allSuggestedMaterials.unshift(...nicheTemplate.suggestedMaterials);
      }
      if (nicheTemplate?.pricingMethod && !pricingMethod) {
        pricingMethod = (PRICING_METHODS as any)[nicheTemplate.pricingMethod]?.label || nicheTemplate.pricingMethod;
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

    // Pass photo URIs for vision analysis if toggle is on and photos exist
    const photoUrlsForAi = (includePhotosInAi && isPro && jobPhotos.length > 0)
      ? jobPhotos.map(p => p.storageUrl).filter(Boolean)
      : undefined;

    import('../../services/llmService').then(({ analyzeJobDescription, convertLLMMaterialsToMaterials }) =>
      analyzeJobDescription(jobDescription, tradeContext, photoUrlsForAi)
      .then((analysis) => {
        // Convert LLM materials to app materials format
        const baseMaterials = convertLLMMaterialsToMaterials(analysis.materials);

        // Add IDs to materials and ensure all required fields are present
        const materials = baseMaterials.map((m) => ({
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

        // Update the job with analyzed data
        const analyzedJob = {
          ...job,
          name: jobName || analysis.jobSummary || 'Custom Job',
          estimatedHours: analysis.estimatedHours,
        };

        // Get the latest document state and update it
        const state = useStore.getState();
        const latestDocument = mode === 'invoice' ? state.currentInvoice : state.currentQuote;
        if (latestDocument) {
          const finalDocument = {
            ...latestDocument,
            job: analyzedJob,
            materials,
            laborHours: analysis.estimatedHours,
          };
          if (mode === 'invoice') {
            state.updateInvoice(finalDocument as any);
          } else {
            state.updateQuote(finalDocument as any);
          }
        }

      })
      .catch((error: any) => {
        // Silently fail - user can still add materials manually
      })
      .finally(() => {
        setIsAnalyzing(false);
      })
    );
  };

  const handleSaveAndReturn = () => {
    if (!currentQuote) return;
    const updatedQuote = {
      ...currentQuote,
      job: {
        ...currentQuote.job,
        name: jobName || currentQuote.job.name,
        description: jobDescription,
      },
      photos: jobPhotos,
    };
    updateQuote(updatedQuote);
    saveDraft(updatedQuote);
    navigation.goBack();
  };

  const handleNext = () => {
    if (!currentQuote) return;

    // CUSTOM MODE: Create job and navigate (AI generation happens on MaterialsList screen)
    if (useCustomMode) {
      if (!jobDescription.trim()) {
        Alert.alert('Missing Information', 'Please describe the job or select a template');
        return;
      }

      // If editing existing quote, just navigate without re-analyzing
      if (isEditingExisting) {
        const updatedQuote = {
          ...currentQuote,
          job: {
            ...currentQuote.job,
            name: jobName || currentQuote.job.name,
            description: jobDescription,
          },
          photos: jobPhotos,
          draftStep: 'CustomerDetails',
        };
        updateQuote(updatedQuote);
        saveDraft(updatedQuote);
        navigation.navigate('CustomerDetails');
        return;
      }

      // Create job without AI analysis - user will trigger it manually from MaterialsList screen
      const job = {
        id: generateId(),
        name: jobName || 'Custom Job',
        description: jobDescription,
        template: 'custom' as const,
        estimatedHours: 8, // Default hours
      };

      const updatedQuote = {
        ...currentQuote,
        job,
        materials: [], // Empty - user will generate or add manually from MaterialsList screen
        laborHours: 8,
        aiSkipped: false, // Not skipped, just deferred to MaterialsList screen
        draftStep: 'CustomerDetails',
        photos: jobPhotos,
      };

      updateQuote(updatedQuote);
      saveDraft(updatedQuote);
      navigation.navigate('CustomerDetails');
      return;
    }

    // TEMPLATE MODE: Use parameters from selected template
    if (!selectedTemplate) {
      Alert.alert('Missing Information', 'Please select a template or describe your job');
      return;
    }

    // Validate parameters are filled in
    const nicheTemplate = selectedTemplate as NicheJobTemplate;
    if (nicheTemplate.requiredParams && nicheTemplate.requiredParams.length > 0) {
      const missingParams = nicheTemplate.requiredParams.filter(
        param => !customParams[param.key] || customParams[param.key] === 0
      );
      if (missingParams.length > 0) {
        Alert.alert(
          'Missing Parameters',
          `Please fill in: ${missingParams.map(p => p.label).join(', ')}`
        );
        return;
      }
    }

    // Create job from template with parameters using the materialsEstimator utility
    const { job, materials, estimatedHours } = createJobFromTemplate(
      selectedTemplate,
      customParams,
      jobName || selectedTemplate.name
    );

    // Update quote with template-generated materials
    const updatedQuote = {
      ...currentQuote,
      job,
      materials,
      laborHours: estimatedHours,
      draftStep: 'CustomerDetails',
      photos: jobPhotos,
    };

    updateQuote(updatedQuote);
    saveDraft(updatedQuote);
    navigation.navigate('CustomerDetails');
  };

  return (
    <>
      <AlertModal
        visible={analysisErrorDialogVisible}
        onDismiss={() => setAnalysisErrorDialogVisible(false)}
        type="error"
        title="AI Analysis Failed"
        message={analysisErrorMessage}
        primaryButtonText="Try Again"
        primaryButtonAction={() => { setAnalysisErrorDialogVisible(false); handleAnalyzeCustomJob(); }}
        secondaryButtonText="Enter Manually"
        secondaryButtonAction={() => { setAnalysisErrorDialogVisible(false); handleSkipToManualEntry(); }}
        showConfetti={false}
      />
      <KeyboardAvoidingView
        style={[styles.container]}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'ios' ? -48 : 0}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={true}
          scrollEnabled={true}
        >
          <WebContainer>
      {/* Job-type chip row — drives the description placeholder + voice cue. */}
      {availableTemplates.length > 0 && !isEditingExisting && (
        <Surface style={[styles.paramsSection, styles.firstSection, styles.templateSection]}>
          <View style={styles.sectionTitleContainer}>
            <View style={[styles.sectionIconCircle, { backgroundColor: colors.warningBg }]}>
              <MaterialCommunityIcons name="briefcase-outline" size={20} color={colors.secondary} />
            </View>
            <Title style={styles.sectionTitle}>{screenHeaderTitle}</Title>
          </View>
          <Text style={styles.helperText}>What kind of job is this?</Text>
          <View style={styles.chipScrollWrapper}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
              keyboardShouldPersistTaps="handled"
            >
              {chipItems.map((item) => {
                const isCustom = item.id === CUSTOM_CHIP_ID;
                const isSelected = isCustom ? selectedTemplate === null : selectedTemplate?.id === item.id;
                const iconColor = isSelected ? colors.surface : colors.onSurface;
                const iconName = isCustom ? null : ((item as NicheJobTemplate).icon as any);
                const label = isCustom ? 'Custom' : (item as NicheJobTemplate).name;
                return (
                  <Chip
                    key={item.id}
                    selected={isSelected}
                    onPress={() => handleSelectTemplate(isCustom ? null : (item as NicheJobTemplate))}
                    icon={iconName ? () => (
                      <MaterialCommunityIcons name={iconName} size={18} color={iconColor} />
                    ) : undefined}
                    style={[styles.jobTypeChip, isSelected && styles.jobTypeChipSelected]}
                    textStyle={isSelected ? styles.jobTypeChipTextSelected : styles.jobTypeChipText}
                    showSelectedCheck={false}
                  >
                    {label}
                  </Chip>
                );
              })}
            </ScrollView>
            {/* Right-edge fade — depth cue that more chips scroll off-screen.
                Fades to the surface charcoal so chips dissolve into the card. */}
            <LinearGradient
              pointerEvents="none"
              colors={['rgba(30,41,59,0)', colors.surface]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.chipFadeRight}
            />
          </View>
        </Surface>
      )}

      {/* Job description — voice + text. The placeholder, voice cue, and
          AI context are all shaped by the selected template chip above. */}
      <Surface
        ref={descriptionCardRef}
        style={styles.paramsSection}
        onLayout={(e) => {
          descriptionCardYRef.current = e.nativeEvent.layout.y;
        }}
      >
        <View style={styles.sectionTitleContainer}>
          <View style={[styles.sectionIconCircle, { backgroundColor: colors.warningBg }]}>
            <MaterialCommunityIcons name="hammer-wrench" size={20} color={colors.secondary} />
          </View>
          <Title style={styles.sectionTitle}>Job Description</Title>
        </View>
        <Text style={styles.helperText}>
          {getVoicePromptHint(selectedTemplate)}
        </Text>

        {/* Beautiful Record Button */}
        {(
          <View ref={micButtonRef} style={styles.recordButtonContainer}>
            <View style={styles.recordButtonRow}>
              <TouchableOpacity
                onPress={() => {
                  handleVoiceRecording();
                }}
                disabled={isProcessingVoice || isRequestingPermission}
                style={styles.recordButtonTouchable}
                activeOpacity={0.8}
              >
                {/* Animated ripple rings when recording */}
                {isRecording && (
                  <>
                    <Animated.View
                      style={[
                        styles.rippleRing,
                        {
                          opacity: rippleAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.6, 0],
                          }),
                          transform: [
                            {
                              scale: rippleAnim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [1, 1.8],
                              }),
                            },
                          ],
                        },
                      ]}
                    />
                    <Animated.View
                      style={[
                        styles.rippleRing,
                        {
                          opacity: rippleAnim.interpolate({
                            inputRange: [0, 0.5, 1],
                            outputRange: [0, 0.4, 0],
                          }),
                          transform: [
                            {
                              scale: rippleAnim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [1, 1.5],
                              }),
                            },
                          ],
                        },
                      ]}
                    />
                  </>
                )}

                {/* Glow effect */}
                <Animated.View
                  style={[
                    styles.glowEffect,
                    {
                      opacity: isRecording
                        ? glowAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.3, 0.6],
                          })
                        : 0,
                    },
                  ]}
                />

                {/* Main button */}
                <Animated.View
                  style={[
                    styles.recordButton,
                    isRecording && styles.recordButtonActive,
                    { transform: [{ scale: pulseAnim }] },
                  ]}
                >
                  <Animated.View
                    style={{
                      transform: [
                        {
                          rotate: rotateAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0deg', '5deg'],
                          }),
                        },
                      ],
                    }}
                  >
                    <MaterialCommunityIcons
                      name={isRecording ? 'stop' : 'microphone'}
                      size={36}
                      color="#FFFFFF"
                    />
                  </Animated.View>
                </Animated.View>
              </TouchableOpacity>

              {/* Clear Button next to record button */}
              {(jobDescription || jobName) && !isRecording && (
                <TouchableOpacity
                  onPress={handleClearDescription}
                  disabled={isProcessingVoice}
                  style={styles.clearButton}
                >
                  <MaterialCommunityIcons
                    name="close-circle"
                    size={20}
                    color={colors.onSurface}
                  />
                  <Text style={styles.clearButtonText}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={[
              styles.recordButtonLabel,
              { color: isRecording ? colors.success : colors.onSurface }
            ]}>
              {isRequestingPermission
                ? 'Requesting microphone permission...'
                : isRecording
                ? 'Tap to Stop Recording'
                : 'Tap to Record Description'}
            </Text>

            {/* Loading Indicator - only show for permission requests */}
            {isRequestingPermission && (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.loadingText}>Requesting permission...</Text>
              </View>
            )}
          </View>
        )}


        {/* Job Description + Clean-up Button + Title (wrapped for tour highlights) */}
        <View ref={descriptionCleanedRef}>
        <View
          ref={descriptionRef}
          onLayout={(e) => {
            descriptionYInCardRef.current = e.nativeEvent.layout.y;
          }}
        >
        {nichePills.length > 0 && (
          <ListeningPills pills={nichePills} state={pillState} />
        )}
        <View style={styles.descriptionInputWrapper}>
          <TextInput
            ref={descriptionInputRef}
            key={selectedTemplate?.id || 'freeform'}
            label="Job Description *"
            value={jobDescription}
            onChangeText={setJobDescription}
            onFocus={handleDescriptionFocus}
            mode="outlined"
            style={styles.input}
            multiline
            numberOfLines={10}
            placeholder={getDescriptionPlaceholder(selectedTemplate)}
            disabled={isProcessingVoice}
          />
          {preCleanupSnapshot && !isProcessingVoice && !isRecording && (
            <TouchableOpacity
              onPress={handleUndoCleanup}
              style={styles.undoCleanupChip}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialCommunityIcons
                name="undo-variant"
                size={13}
                color={colors.onSurface}
              />
              <Text style={styles.undoCleanupChipText}>Undo</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Clean-up Button below Job Description */}
        {jobDescription.trim() && !isRecording && (
          <TouchableOpacity
            onPress={() => {
              if (!isPro) {
                navigation.navigate('Paywall' as never);
                return;
              }
              handleCleanupDescription();
            }}
            disabled={isProcessingVoice}
            style={[
              styles.cleanupButtonBelow,
              {
                opacity: isProcessingVoice ? 0.5 : 1
              }
            ]}
          >
            {isProcessingVoice ? (
              <>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.cleanupButtonBelowText}>Cleaning...</Text>
              </>
            ) : (
              <>
                <MaterialCommunityIcons
                  name="auto-fix"
                  size={18}
                  color={colors.primary}
                />
                <Text style={styles.cleanupButtonBelowText}>Clean-up & Generate Title</Text>
                {!isPro && <ProBadge size="small" />}
              </>
            )}
          </TouchableOpacity>
        )}
        </View>

        {/* Job Title (moved below description) */}
        <TextInput
          label="Job Title"
          value={jobName}
          onChangeText={setJobName}
          mode="outlined"
          style={styles.input}
          placeholder="e.g., Backyard Deck Renovation"
          multiline
          numberOfLines={2}
          disabled={isProcessingVoice}
          autoComplete="off"
          textContentType="none"
        />
        </View>

        {/* Job Photos */}
        {useCustomMode && (
          <>
            <View ref={jobPhotosRef}>
            <JobPhotos
              photos={jobPhotos}
              onPhotosChange={setJobPhotos}
              firstPhotoRef={jobPhotoThumbnailRef}
              interactionDisabled={tourActive}
            />
            </View>
            {jobPhotos.length > 0 && (
              <TouchableOpacity
                style={styles.aiPhotoToggle}
                onPress={() => setIncludePhotosInAi(!includePhotosInAi)}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name={includePhotosInAi ? 'checkbox-marked' : 'checkbox-blank-outline'}
                  size={20}
                  color={includePhotosInAi ? colors.primary : colors.textMuted}
                />
                <Text style={[styles.aiPhotoToggleText, includePhotosInAi && { color: colors.text }]}>
                  Include photos in AI analysis
                </Text>
                {!isPro && <ProBadge size="small" />}
              </TouchableOpacity>
            )}
          </>
        )}
      </Surface>

          </WebContainer>
        </ScrollView>

        <View ref={analyzeRef}>
        <FixedBottomButton
          label={isEditFromPreview ? 'Save' : 'Next: Customer Details'}
          onPress={isEditFromPreview ? handleSaveAndReturn : handleNext}
          disabled={
            (useCustomMode && !jobDescription.trim()) ||
            (!useCustomMode && !selectedTemplate)
          }
          disableKeyboardSticky
        />
        </View>
      </KeyboardAvoidingView>

      {/* Screen Tour */}
      {unifiedTourActive && unifiedTourPhase === 'jobDetails' && <ScreenTour
        tourId="jobDetails"
        delay={fromTour ? 200 : 600}
        stepOffset={PHASE_STEP_OFFSETS.jobDetails}
        globalTotalSteps={UNIFIED_TOUR_TOTAL_STEPS}
        scrollRef={scrollRef}
        scrollPositions={{ micButton: 0, jobDescription: 0, jobDescriptionCleaned: 200, jobPhotoThumbnail: 600, annotatorCanvas: 0, annotatorTools: 0, annotatorDone: 0, jobPhotoAnnotated: 600 }}
        onActiveChange={setTourActive}
        unifiedMode={true}
        onScreenComplete={() => notifyScreenComplete('jobDetails')}
        onSkipRequest={notifySkipRequest}
        onStepChange={(stepId) => {
          if (stepId === 'jobDescription' && !jobDescription.trim()) {
            const demoText =
              "yeah so the dunny door fell off again and the missus is losing it, " +
              "hinges are cooked reckon the frames a bit dodgy too from when bazza " +
              "reversed the mower into it last arvo. needs new hinges and maybe " +
              "replace the bottom bit of the frame cos its gone all soggy from the rain";
            // Typewriter effect — write word by word
            const words = demoText.split(' ');
            let i = 0;
            if (typewriterRef.current) clearInterval(typewriterRef.current);
            typewriterRef.current = setInterval(() => {
              i++;
              if (i >= words.length) {
                clearInterval(typewriterRef.current!);
                typewriterRef.current = null;
                setJobDescription(demoText);
              } else {
                setJobDescription(words.slice(0, i + 1).join(' '));
              }
            }, 80);
          } else if (stepId === 'jobDescriptionCleaned') {
            // Auto-trigger cleanup when arriving at this step
            if (typewriterRef.current) {
              clearInterval(typewriterRef.current);
              typewriterRef.current = null;
            }
            handleCleanupDescription();
          } else if (stepId === 'jobPhotoThumbnail' && jobPhotos.length === 0) {
            // Inject dummy photo when arriving at combined photo/annotate step
            if (typewriterRef.current) {
              clearInterval(typewriterRef.current);
              typewriterRef.current = null;
            }
            setJobPhotos([getTourPhoto()]);
          } else if (stepId === 'annotatorCanvas') {
            // Open the real annotator in tour mode
            setTourAnnotatorOpen(true);
          } else if (stepId === 'jobPhotoAnnotated') {
            // Close annotator and swap to pre-annotated version
            setTourAnnotatorOpen(false);
            setJobPhotos([getTourPhotoAnnotated()]);
          } else {
            // Clear typewriter if moving away from step
            if (typewriterRef.current) {
              clearInterval(typewriterRef.current);
              typewriterRef.current = null;
            }
          }
        }}
      />}

      {/* Tour-mode annotator — rendered as absolute overlay (not Modal) so tour spotlight works on top */}
      {tourAnnotatorOpen && jobPhotos.length > 0 && (
        <PhotoAnnotator
          visible={true}
          tourMode={true}
          imageUri={jobPhotos[0].storageUrl}
          onSave={() => {}}
          onCancel={() => {}}
        />
      )}
    </>
  );
}

function getTemplateIcon(templateId: string): keyof typeof MaterialCommunityIcons.glyphMap {
  switch (templateId) {
    case 'outdoor-stairs':
      return 'stairs';
    case 'timber-deck':
      return 'home-floor-2';
    case 'timber-fence':
      return 'fence';
    case 'pergola':
      return 'home-roof';
    default:
      return 'hammer-wrench';
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    ...(Platform.OS === 'web' && {
      display: 'flex' as any,
      flexDirection: 'column' as any,
      height: '100vh' as any,
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
    paddingBottom: 200,
    flexGrow: 1,
    ...(Platform.OS === 'web' && {
      height: '0px' as any,
    }),
  },
  section: {
    padding: 16,
  },
  sectionTitleContainer: {
    marginBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 10,
  },
  sectionIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 0,
    flex: 1,
  },
  expandIcon: {
    marginLeft: 'auto',
  },
  input: {
    marginBottom: 20,
  },
  recordButtonContainer: {
    alignItems: 'center',
    marginVertical: 16,
  },
  recordButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordButtonTouchable: {
    marginBottom: 12,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordButton: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  recordButtonActive: {
    backgroundColor: '#00C897', // Brighter green when recording
    shadowColor: '#00C897',
    shadowOpacity: 0.6,
    elevation: 16,
  },
  rippleRing: {
    position: 'absolute',
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 3,
    borderColor: colors.primary,
    backgroundColor: 'transparent',
  },
  glowEffect: {
    position: 'absolute',
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
    elevation: 20,
  },
  actionButtonsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginLeft: 20,
  },
  actionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 70,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  cleanupButtonBelow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: -8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: 'transparent',
  },
  cleanupButtonBelowText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
    marginLeft: 6,
  },
  descriptionInputWrapper: {
    position: 'relative',
  },
  undoCleanupChip: {
    position: 'absolute',
    top: -2,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 1,
    paddingHorizontal: 6,
    backgroundColor: colors.background,
    zIndex: 2,
  },
  undoCleanupChipText: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.onSurface,
    marginLeft: 3,
  },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 16,
    padding: 8,
  },
  clearButtonText: {
    fontSize: 13,
    color: colors.onSurface,
    marginLeft: 4,
  },
  recordButtonLabel: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 8,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  loadingText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
    marginLeft: 8,
  },
  transcriptPreview: {
    marginTop: 16,
    padding: 12,
    borderRadius: 8,
    backgroundColor: colors.surface,
    maxWidth: '100%',
    elevation: 2,
  },
  transcriptText: {
    fontSize: 14,
    color: colors.onSurface,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  templatesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6,
  },
  templateCardWrapper: {
    width: '50%',
    padding: 6,
  },
  templateCard: {
    minHeight: 140,
    backgroundColor: colors.surface,
  },
  selectedCard: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  disabledCard: {
    opacity: 0.5,
  },
  templateName: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 4,
  },
  templateDesc: {
    fontSize: 11,
    color: colors.onSurface,
  },
  paramsSection: {
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 16,
    padding: 16,
    paddingTop: 16,
    borderRadius: 14,
    elevation: 2,
    backgroundColor: colors.surface,
  },
  firstSection: {
    marginTop: 20,
  },
  templateSection: {
    marginBottom: 0,
  },
  selectedTemplateSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  selectedTemplateName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: colors.onSurface,
    marginLeft: 10,
  },
  changeIconButton: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: colors.primary + '15',
  },
  helperText: {
    fontSize: 13,
    color: colors.onSurface,
    marginBottom: 12,
  },
  chipScrollWrapper: {
    position: 'relative',
  },
  chipFadeRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 40,
  },
  chipRow: {
    paddingVertical: 4,
    paddingRight: 8,
    gap: 8,
  },
  jobTypeChip: {
    marginRight: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary + '33',
  },
  jobTypeChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  jobTypeChipText: {
    color: colors.onSurface,
  },
  jobTypeChipTextSelected: {
    color: colors.surface,
    fontWeight: '600',
  },
  analyzingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    padding: 12,
    backgroundColor: colors.surface,
    borderRadius: 8,
  },
  analyzingText: {
    marginLeft: 12,
    fontSize: 14,
    color: colors.primary,
  },
  debugInfo: {
    padding: 10,
    marginHorizontal: 20,
    marginBottom: 20,
    backgroundColor: colors.surfaceGray3,
  },
  webSpeechHelper: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#E3F2FD',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  webSpeechHelperText: {
    flex: 1,
    marginLeft: 8,
    fontSize: 13,
    color: '#1565C0',
    lineHeight: 18,
  },
  // Niche template styles
  templateScroll: {
    marginBottom: 0,
  },
  quickTemplateCard: {
    width: 160,
    backgroundColor: colors.surfaceLight,
    borderRadius: 12,
    padding: 16,
    marginRight: 12,
    borderWidth: 1,
    borderColor: colors.outline,
  },
  quickTemplateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  quickTemplateName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  quickTemplateDesc: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 8,
    lineHeight: 16,
  },
  quickTemplateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.secondary + '20',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  quickTemplateBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.secondary,
    marginLeft: 4,
  },
  pricingMethodInfo: {
    marginTop: 8,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.outline,
  },
  pricingMethodLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  pricingMethodChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pricingMethodChip: {
    height: 28,
    backgroundColor: colors.primary + '15',
    marginRight: 0,
  },
  pricingMethodChipText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
  },
  quickTemplateCardSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.primary + '10',
  },
  quickTemplateNameSelected: {
    color: colors.primary,
  },
  quickTemplateCheck: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  paramInputContainer: {
    marginBottom: 12,
  },
  paramInput: {
    backgroundColor: colors.surface,
  },
  switchModeButton: {
    marginTop: 16,
  },
  aiPhotoToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingVertical: 6,
  },
  aiPhotoToggleText: {
    fontSize: 13,
    color: colors.textMuted,
    flex: 1,
  },
});
