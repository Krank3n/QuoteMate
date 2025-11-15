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
  KeyboardAvoidingView,
  Platform,
  Animated,
} from 'react-native';
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
  Dialog,
  Portal,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

import { useStore } from '../../store/useStore';
import { JOB_TEMPLATES } from '../../data/jobTemplates';
import { NICHE_TEMPLATES, getTemplatesForNiche, getNicheTemplateById, NicheJobTemplate } from '../../data/nicheTemplates';
import { getTradeCategoryById, getTradeNicheById, PRICING_METHODS } from '../../constants/tradeCategories';
import { createJobFromTemplate } from '../../utils/materialsEstimator';
import { colors } from '../../theme';
import { JobTemplate } from '../../types';
import { analyzeJobDescription, convertLLMMaterialsToMaterials, cleanupTranscriptionAndGenerateTitle } from '../../services/llmService';
import { generateId } from '../../utils/generateId';
import { bunningsApi } from '../../services/bunningsApi';
import { WebContainer } from '../../components/WebContainer';
import { FixedBottomButton } from '../../components/FixedBottomButton';

export function JobDetailsScreen() {
  const navigation = useNavigation<any>();
  const { currentQuote, updateQuote, quotes, businessSettings } = useStore();
  const insets = useSafeAreaInsets();

  const [selectedTemplate, setSelectedTemplate] = useState<JobTemplate | NicheJobTemplate | null>(null);
  const [customParams, setCustomParams] = useState<Record<string, number>>({});
  const [jobName, setJobName] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisErrorDialogVisible, setAnalysisErrorDialogVisible] = useState(false);
  const [analysisErrorMessage, setAnalysisErrorMessage] = useState('');
  const [useCustomMode, setUseCustomMode] = useState(true); // Default to custom (AI) mode

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

  // Template carousel expand/collapse state
  const [isTemplateCarouselExpanded, setIsTemplateCarouselExpanded] = useState(false);
  const carouselHeightAnim = useRef(new Animated.Value(0)).current; // 0 = collapsed, 1 = expanded

  // Keep ref in sync with state
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  // Animate carousel expansion/collapse
  useEffect(() => {
    Animated.spring(carouselHeightAnim, {
      toValue: isTemplateCarouselExpanded ? 1 : 0,
      useNativeDriver: false,
      tension: 50,
      friction: 7,
    }).start();
  }, [isTemplateCarouselExpanded]);

  // Check if editing an existing quote (by checking if it exists in saved quotes)
  const isEditingExisting = !!(currentQuote && quotes.find(q => q.id === currentQuote.id));

  // Speech recognition event handlers
  useSpeechRecognitionEvent('start', () => {
    setRecognizing(true);
    console.log('Speech recognition started');
  });

  useSpeechRecognitionEvent('end', () => {
    setRecognizing(false);
    const isStillRecording = isRecordingRef.current;

    console.log('🔴 Speech recognition ended');
    console.log('  - lastTranscript:', lastTranscriptRef.current);
    console.log('  - accumulated:', startingDescriptionRef.current);
    console.log('  - isRecording (ref):', isStillRecording);

    // If user is still recording (didn't manually stop), save and restart
    if (isStillRecording && lastTranscriptRef.current) {
      // Save the last segment to accumulated
      const newAccumulated = startingDescriptionRef.current
        ? startingDescriptionRef.current + ' ' + lastTranscriptRef.current
        : lastTranscriptRef.current;

      startingDescriptionRef.current = newAccumulated;
      lastTranscriptRef.current = '';

      console.log('✅ Saved segment. Accumulated:', startingDescriptionRef.current);

      // Restart speech recognition
      console.log('🔄 Restarting...');
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
            console.log('✅ Restarted');
          } catch (error) {
            console.error('❌ Failed to restart:', error);
            setIsRecording(false);
          }
        }
      }, 100);
    } else if (!isStillRecording) {
      console.log('🛑 User stopped manually');
    }
  });

  useSpeechRecognitionEvent('result', (event) => {
    if (!isRecordingRef.current) {
      return; // Ignore results if we're not recording
    }

    const allResults = event.results || [];

    console.log('📊 Results count:', allResults.length);

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

    console.log('Current segment:', currentTranscript);
    console.log('Accumulated:', startingDescriptionRef.current);

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
        console.log('🔄 NEW SEGMENT DETECTED - saving previous:', lastTranscriptRef.current);
        const newAccumulated = startingDescriptionRef.current
          ? startingDescriptionRef.current + ' ' + lastTranscriptRef.current
          : lastTranscriptRef.current;

        startingDescriptionRef.current = newAccumulated;
        console.log('✅ Accumulated now:', startingDescriptionRef.current);

        // Display ONLY accumulated text for this frame, next result will add current
        setJobDescription(startingDescriptionRef.current);
        lastTranscriptRef.current = currentTranscript;
        console.log('Displayed (after segment save):', startingDescriptionRef.current);
        return; // Exit early to avoid double display
      } else if (isRefinement) {
        console.log('🔧 REFINEMENT DETECTED - replacing with better recognition');
        // This is a refinement of what was already said, just update the display
        const displayText = startingDescriptionRef.current
          ? startingDescriptionRef.current + ' ' + currentTranscript
          : currentTranscript;

        setJobDescription(displayText);
        lastTranscriptRef.current = currentTranscript;
        console.log('Displayed (refinement):', displayText);
        return;
      }
    }

    // Display accumulated + current transcript
    const displayText = startingDescriptionRef.current
      ? startingDescriptionRef.current + ' ' + currentTranscript
      : currentTranscript;

    setJobDescription(displayText);
    lastTranscriptRef.current = currentTranscript;

    console.log('Displayed:', displayText);
  });

  useSpeechRecognitionEvent('error', (event) => {
    console.error('Speech recognition error:', event.error);
    setIsRecording(false);
    setRecognizing(false);
    Alert.alert('Voice Recognition Error', event.error || 'Could not recognize speech');
  });

  // Beautiful animations for recording button
  useEffect(() => {
    if (isRecording) {
      // Pulse animation - smooth breathing effect
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      ).start();

      // Glow animation - pulsing glow effect
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, {
            toValue: 1,
            duration: 1500,
            useNativeDriver: true,
          }),
          Animated.timing(glowAnim, {
            toValue: 0,
            duration: 1500,
            useNativeDriver: true,
          }),
        ])
      ).start();

      // Ripple animation - expanding rings
      Animated.loop(
        Animated.timing(rippleAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        })
      ).start();

      // Subtle rotation for microphone icon
      Animated.loop(
        Animated.sequence([
          Animated.timing(rotateAnim, {
            toValue: 1,
            duration: 2000,
            useNativeDriver: true,
          }),
          Animated.timing(rotateAnim, {
            toValue: 0,
            duration: 2000,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      // Reset all animations smoothly
      Animated.parallel([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(rippleAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(rotateAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isRecording]);

  useEffect(() => {
    if (currentQuote) {
      setJobName(currentQuote.job.name);
      setJobDescription(currentQuote.job.description || '');

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

  const handleVoiceRecording = async () => {
    console.log('🎤 handleVoiceRecording called, Platform:', Platform.OS);

    // Web: Use native Web Speech API directly
    if (Platform.OS === 'web') {
      if (isRecording) {
        // Stop recording
        console.log('🛑 Stopping web speech recognition');
        if (webRecognitionRef.current) {
          webRecognitionRef.current.stop();
        }
        setIsRecording(false);
        // Auto-cleanup removed - user must press clean-up button manually
      } else {
        // Start recording
        console.log('🎤 Starting web speech recognition');

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
              console.log('✅ Final segment:', transcript);
            } else {
              interimTranscript += transcript;
            }
          }

          // Show final + interim
          const displayText = finalTranscript + (interimTranscript ? ' ' + interimTranscript : '');
          setJobDescription(displayText);
          console.log('Display:', displayText);
        };

        recognition.onerror = (event: any) => {
          console.error('Speech recognition error:', event.error);
          setIsRecording(false);
          Alert.alert('Error', 'Speech recognition failed: ' + event.error);
        };

        recognition.onend = () => {
          console.log('🔴 Recognition ended');
          if (isRecordingRef.current) {
            // Restart if still recording
            console.log('🔄 Restarting...');
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
    if (isRecording) {
      // Stop recording manually
      console.log('🛑 User manually stopped recording');

      try {
        // Build final description from accumulated + last segment BEFORE stopping
        const finalDescription = startingDescriptionRef.current && lastTranscriptRef.current
          ? startingDescriptionRef.current + ' ' + lastTranscriptRef.current
          : startingDescriptionRef.current || lastTranscriptRef.current || jobDescription;

        console.log('📝 Final description:', finalDescription);

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
        console.error('Failed to stop recording:', error);
        setIsRecording(false);
        Alert.alert('Error', 'Failed to stop voice recording');
      }
    } else {
      // Start recording - append to existing description
      console.log('🎤 Starting native recording...');

      try {
        console.log('📝 Step 1: Checking current permission status...');

        // First check if we already have permission
        const currentStatus = await ExpoSpeechRecognitionModule.getPermissionsAsync();
        console.log('📝 Current permission status:', currentStatus);

        let result = currentStatus;

        // Only request if not already granted
        if (!currentStatus.granted) {
          console.log('📝 Permission not granted, requesting...');
          setIsRequestingPermission(true);

          // Add a timeout to prevent infinite loading
          const permissionPromise = ExpoSpeechRecognitionModule.requestPermissionsAsync();
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Permission request timed out')), 10000)
          );

          try {
            result = await Promise.race([permissionPromise, timeoutPromise]) as any;
            console.log('📝 Permission result:', result);
          } catch (timeoutError) {
            console.error('⏱️ Permission request timed out');
            setIsRequestingPermission(false);
            Alert.alert(
              'Permission Request Failed',
              'The permission dialog did not appear. Please check:\n\n1. Go to Android Settings > Apps > QuoteMate > Permissions\n2. Enable Microphone permission\n3. Try again'
            );
            return;
          }

          setIsRequestingPermission(false);

          if (!result.granted) {
            console.log('❌ Permission denied');
            Alert.alert('Permission Required', 'Microphone permission is required for voice recording');
            return;
          }
        }

        console.log('✅ Permission granted');

        // Check if speech recognition is available
        console.log('📝 Step 2: Checking availability...');
        const available = await ExpoSpeechRecognitionModule.getStateAsync();
        console.log('Speech recognition state:', available);

        // Save starting description and clear refs
        console.log('📝 Step 3: Setting up refs...');
        startingDescriptionRef.current = jobDescription;
        lastTranscriptRef.current = '';
        setTranscript('');

        console.log('📝 Step 4: Starting speech recognition...');
        await ExpoSpeechRecognitionModule.start({
          lang: 'en-AU', // Australian English
          interimResults: true,
          maxAlternatives: 1,
          continuous: true, // Keep recording until user manually stops
          requiresOnDeviceRecognition: false,
          contextualStrings: ['deck', 'handrail', 'timber', 'pine', 'meters', 'metres'],
        });
        console.log('✅ Speech recognition started successfully');
        setIsRecording(true);
      } catch (error: any) {
        console.error('❌ Failed to start recording:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));
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
  };

  const handleCleanupDescription = async () => {
    if (!jobDescription.trim()) {
      Alert.alert('No Description', 'Please enter or record a job description first');
      return;
    }

    setIsProcessingVoice(true);
    try {
      const result = await cleanupTranscriptionAndGenerateTitle(jobDescription);
      setJobDescription(result.cleanedDescription);
      if (result.suggestedTitle && !jobName) {
        setJobName(result.suggestedTitle);
      }
    } catch (error) {
      console.error('Failed to clean up description:', error);
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
    };

    updateQuote(updatedQuote);
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
    };

    updateQuote(updatedQuote);

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

    analyzeJobDescription(jobDescription, tradeContext)
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
        }));

        // Update the job with analyzed data
        const analyzedJob = {
          ...job,
          name: jobName || analysis.jobSummary || 'Custom Job',
          estimatedHours: analysis.estimatedHours,
        };

        // Get the latest quote state and update it
        const latestQuote = useStore.getState().currentQuote;
        if (latestQuote) {
          const finalQuote = {
            ...latestQuote,
            job: analyzedJob,
            materials,
            laborHours: analysis.estimatedHours,
          };
          useStore.getState().updateQuote(finalQuote);
        }

        console.log('✅ AI analysis complete:', materials.length, 'materials generated');
      })
      .catch((error: any) => {
        console.error('❌ Background analysis error:', error);
        // Silently fail - user can still add materials manually
      })
      .finally(() => {
        setIsAnalyzing(false);
      });
  };

  const handleNext = () => {
    if (!currentQuote) return;

    // CUSTOM MODE: Use AI to analyze description
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
        };
        updateQuote(updatedQuote);
        navigation.navigate('CustomerDetails');
        return;
      }

      // Analyze custom job with AI
      handleAnalyzeCustomJob();
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
    };

    updateQuote(updatedQuote);
    navigation.navigate('CustomerDetails');
  };

  return (
    <>
      <Portal>
        <Dialog visible={analysisErrorDialogVisible} onDismiss={() => setAnalysisErrorDialogVisible(false)}>
          <Dialog.Title>AI Analysis Failed</Dialog.Title>
          <Dialog.Content>
            <Text>{analysisErrorMessage}</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setAnalysisErrorDialogVisible(false)}>Cancel</Button>
            <Button onPress={() => { setAnalysisErrorDialogVisible(false); handleSkipToManualEntry(); }}>Enter Manually</Button>
            <Button onPress={() => { setAnalysisErrorDialogVisible(false); handleAnalyzeCustomJob(); }}>Try Again</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      <KeyboardAvoidingView
        style={[styles.container]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={-48}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={true}
        >
          <WebContainer>
      {/* Niche-Specific Quick Templates */}
      {businessSettings && !isEditingExisting && (() => {
        // Get all templates from user's selected categories and niches
        const allTemplates: NicheJobTemplate[] = [];

        // First, try to get templates from new multi-select fields
        if (businessSettings.tradeCategories && businessSettings.tradeCategories.length > 0) {
          businessSettings.tradeCategories.forEach(categoryId => {
            if (businessSettings.tradeNiches && businessSettings.tradeNiches.length > 0) {
              // Get templates for each selected niche
              businessSettings.tradeNiches.forEach(nicheId => {
                const templates = getTemplatesForNiche(categoryId, nicheId);
                allTemplates.push(...templates);
              });
            } else {
              // No niches selected, get all templates for this category
              const category = getTradeCategoryById(categoryId);
              if (category) {
                category.niches.forEach(niche => {
                  const templates = getTemplatesForNiche(categoryId, niche.id);
                  allTemplates.push(...templates);
                });
              }
            }
          });
        } else if (businessSettings.tradeCategory && businessSettings.tradeNiche) {
          // Fallback: Use legacy single-select fields
          allTemplates.push(...getTemplatesForNiche(businessSettings.tradeCategory, businessSettings.tradeNiche));
        }

        // Remove duplicates by ID
        const uniqueTemplates = Array.from(new Map(allTemplates.map(t => [t.id, t])).values());

        if (uniqueTemplates.length === 0) return null;

        return (
          <Surface style={[styles.paramsSection, styles.firstSection, styles.templateSection]}>
            <TouchableOpacity
              style={styles.sectionTitleContainer}
              onPress={() => setIsTemplateCarouselExpanded(!isTemplateCarouselExpanded)}
              activeOpacity={0.7}
            >
              <View style={styles.sectionTitleRow}>
                <MaterialCommunityIcons name="briefcase-outline" size={24} color={colors.primary} style={styles.sectionIcon} />
                <Title style={styles.sectionTitle}>
                  {isTemplateCarouselExpanded
                    ? 'Select Job Type'
                    : `${uniqueTemplates.length + 1} Job Types Available`
                  }
                </Title>
                <MaterialCommunityIcons
                  name={isTemplateCarouselExpanded ? "chevron-up" : "chevron-down"}
                  size={24}
                  color={colors.primary}
                  style={styles.expandIcon}
                />
              </View>
            </TouchableOpacity>

            <Animated.View style={{
              height: carouselHeightAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [Platform.OS === 'web' ? 160 : 80, 160], // Collapsed shows just one row, expanded shows more
              }),
              overflow: 'hidden',
            }}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.templateScroll}
                onScrollBeginDrag={() => {
                  if (!isTemplateCarouselExpanded) {
                    setIsTemplateCarouselExpanded(true);
                  }
                }}
              >
              {/* Custom Job Card (first option) */}
              <TouchableOpacity
                style={[
                  styles.quickTemplateCard,
                  useCustomMode && styles.quickTemplateCardSelected,
                ]}
                onPress={() => {
                  setUseCustomMode(true);
                  setSelectedTemplate(null);
                  setCustomParams({});
                  // Clear jobName and jobDescription when switching back to custom
                  setJobName('');
                  setJobDescription('');
                  // Auto-collapse after selection
                  setTimeout(() => setIsTemplateCarouselExpanded(false), 300);
                }}
              >
                <View style={styles.quickTemplateHeader}>
                  <MaterialCommunityIcons
                    name="pencil-outline"
                    size={28}
                    color={useCustomMode ? colors.primary : colors.textMuted}
                  />
                  <Text style={[
                    styles.quickTemplateName,
                    useCustomMode && styles.quickTemplateNameSelected,
                  ]}>Custom Job</Text>
                </View>
                <Text style={styles.quickTemplateDesc}>Describe your own job</Text>
                <View style={styles.quickTemplateBadge}>
                  <MaterialCommunityIcons name="brain" size={12} color={colors.secondary} />
                  <Text style={styles.quickTemplateBadgeText}>AI Powered</Text>
                </View>
              </TouchableOpacity>

              {/* Template Cards */}
              {uniqueTemplates.map((template) => (
              <TouchableOpacity
                key={template.id}
                style={[
                  styles.quickTemplateCard,
                  selectedTemplate?.id === template.id && styles.quickTemplateCardSelected,
                ]}
                onPress={() => {
                  // Switch to template mode
                  setUseCustomMode(false);
                  setSelectedTemplate(template);
                  setJobName(template.name);
                  setJobDescription(template.description);

                  // Initialize params with default values
                  if (template.requiredParams && template.requiredParams.length > 0) {
                    const params: Record<string, number> = {};
                    template.requiredParams.forEach(param => {
                      params[param.key] = param.defaultValue || 0;
                    });
                    setCustomParams(params);
                  }

                  // Auto-collapse after selection
                  setTimeout(() => setIsTemplateCarouselExpanded(false), 300);
                }}
              >
                <View style={styles.quickTemplateHeader}>
                  <MaterialCommunityIcons
                    name={template.icon as any}
                    size={28}
                    color={selectedTemplate?.id === template.id ? colors.primary : colors.textMuted}
                  />
                  <Text style={[
                    styles.quickTemplateName,
                    selectedTemplate?.id === template.id && styles.quickTemplateNameSelected,
                  ]}>{template.name}</Text>
                </View>
                <Text style={styles.quickTemplateDesc}>{template.description}</Text>
                <View style={styles.quickTemplateBadge}>
                  <MaterialCommunityIcons name="lightning-bolt" size={12} color={colors.secondary} />
                  <Text style={styles.quickTemplateBadgeText}>{(PRICING_METHODS as any)[template.pricingMethod]?.label || template.pricingMethod}</Text>
                </View>
              </TouchableOpacity>
              ))}
              </ScrollView>
            </Animated.View>
          </Surface>
        );
      })()}

      {/* Template Parameters OR Custom Job Description */}
      {!useCustomMode && selectedTemplate && (selectedTemplate as NicheJobTemplate).requiredParams && (selectedTemplate as NicheJobTemplate).requiredParams.length > 0 ? (
        // TEMPLATE MODE: Show parameter inputs
        <Surface style={styles.paramsSection}>
          <View style={styles.sectionTitleContainer}>
            <MaterialCommunityIcons name="format-list-numbered" size={24} color={colors.primary} style={styles.sectionIcon} />
            <Title style={styles.sectionTitle}>Job Details</Title>
          </View>
          <Text style={styles.helperText}>
            Enter the measurements for this {selectedTemplate.name.toLowerCase()} job.
          </Text>

          {(selectedTemplate as NicheJobTemplate).requiredParams.map((param) => (
            <View key={param.key} style={styles.paramInputContainer}>
              <TextInput
                label={param.label}
                value={customParams[param.key]?.toString() || ''}
                onChangeText={(text) => {
                  const value = parseFloat(text) || 0;
                  setCustomParams({ ...customParams, [param.key]: value });
                }}
                mode="outlined"
                keyboardType="decimal-pad"
                style={styles.paramInput}
                right={param.unit ? <TextInput.Affix text={param.unit} /> : undefined}
              />
            </View>
          ))}
        </Surface>
      ) : (
        // CUSTOM MODE: Show voice/text input (merged into one Surface)
        <Surface style={styles.paramsSection}>
          <View style={styles.sectionTitleContainer}>
            <MaterialCommunityIcons name="hammer-wrench" size={24} color={colors.primary} style={styles.sectionIcon} />
            <Title style={styles.sectionTitle}>Custom Job Description</Title>
          </View>
          <Text style={styles.helperText}>
            Tap the microphone to describe the job with your voice, or type it manually below.
          </Text>

        {/* Beautiful Record Button */}
        {(
          <View style={styles.recordButtonContainer}>
            <View style={styles.recordButtonRow}>
              <TouchableOpacity
                onPress={() => {
                  console.log('🔘 Record button pressed!');
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
                      size={48}
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
                  style={[styles.actionButton, { backgroundColor: colors.surface, marginLeft: 20 }]}
                >
                  <MaterialCommunityIcons
                    name="delete-outline"
                    size={24}
                    color={colors.error}
                  />
                  <Text style={[styles.actionButtonText, { color: colors.error }]}>Clear</Text>
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


        {/* Job Description Text Input */}
        <TextInput
          label="Job Description *"
          value={jobDescription}
          onChangeText={setJobDescription}
          mode="outlined"
          style={styles.input}
          multiline
          numberOfLines={6}
          placeholder="e.g., Build a 5x4 meter outdoor deck with 10 steps leading down to the garden. Need to replace old timber and add handrails."
          disabled={isProcessingVoice}
        />

        {/* Clean-up Button below Job Description */}
        {jobDescription.trim() && !isRecording && (
          <TouchableOpacity
            onPress={handleCleanupDescription}
            disabled={isProcessingVoice}
            style={[
              styles.cleanupButtonBelow,
              {
                backgroundColor: isProcessingVoice ? colors.surfaceGray : colors.primary,
                opacity: isProcessingVoice ? 0.7 : 1
              }
            ]}
          >
            {isProcessingVoice ? (
              <>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={styles.cleanupButtonBelowText}>Cleaning...</Text>
              </>
            ) : (
              <>
                <MaterialCommunityIcons
                  name="auto-fix"
                  size={20}
                  color="#FFFFFF"
                />
                <Text style={styles.cleanupButtonBelowText}>Clean-up & Generate Title</Text>
              </>
            )}
          </TouchableOpacity>
        )}

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
        </Surface>
      )}

          </WebContainer>
        </ScrollView>

        <FixedBottomButton
          label="Next: Customer Details"
          onPress={handleNext}
          disabled={
            (useCustomMode && !jobDescription.trim()) ||
            (!useCustomMode && !selectedTemplate)
          }
          secondaryLabel={!isEditingExisting && useCustomMode ? "Skip AI" : undefined}
          secondaryOnPress={!isEditingExisting && useCustomMode ? handleSkipToManualEntry : undefined}
        />
      </KeyboardAvoidingView>
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
      maxWidth: 800,
      margin: 'auto' as any,
      width: '100%',
      height: '0px' as any,
    }),
  },
  section: {
    padding: 16,
  },
  sectionTitleContainer: {
    marginBottom: 16,
    // marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionIcon: {
    marginRight: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
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
    marginVertical: 24,
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
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: colors.primary, // Beautiful eucalyptus green
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 12,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    // Subtle gradient effect (simulated with overlays in the component)
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
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 3,
    borderColor: colors.primary,
    backgroundColor: 'transparent',
  },
  glowEffect: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
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
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginTop: -12,
    marginBottom: 16,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
  },
  cleanupButtonBelowText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    marginLeft: 8,
  },
  recordButtonLabel: {
    fontSize: 16,
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
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 16,
    paddingTop: 16,
    borderRadius: 8,
    elevation: 2,
    backgroundColor: colors.surface,
  },
  firstSection: {
    marginTop: 20,
  },
  templateSection: {
    marginBottom: 16, // Consistent spacing with next section
  },
  helperText: {
    fontSize: 13,
    color: colors.onSurface,
    marginBottom: 12,
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
});
