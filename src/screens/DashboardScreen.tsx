/**
 * Dashboard Screen
 * Home screen with quick stats and new quote button
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl, Pressable, Animated as RNAnimated } from 'react-native';
import {
  Text,
  Surface,
  Title,
  Button,
  Paragraph,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useScrollToTop, useIsFocused } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { formatDistanceToNow } from 'date-fns';

import { useStore } from '../store/useStore';
import { useJobStore } from '../store/useJobStore';
import { applyJobStageChange } from '../utils/applyJobStageChange';
import { pickPrimaryDoc } from '../components/StickyJobActionBar';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { Quote } from '../types';
import { WebContainer } from '../components/WebContainer';
import { JobCard } from '../components/JobCard';
import { JobStageSheet } from '../components/JobStageSheet';
import { ScheduleJobSheet } from '../components/ScheduleJobSheet';
import type { Job, JobStage } from '../../shared/job/types';
import { quoteToDocument } from '../types/documentAdapter';
import { AlertModal } from '../components/AlertModal';
import { updateActivityTimestamp } from '../services/emailService';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { AnimatedListItem } from '../components/AnimatedListItem';
import { SkeletonCardList } from '../components/SkeletonCard';
import { SkeletonCrossfade } from '../components/SkeletonCrossfade';
import { StageSheet } from '../components/StageSheet';
import { applyStageChange } from '../utils/applyStageChange';
import type { Document, DocumentStage } from '../types/document';
import { pickDashboardDraft, excludeDraftJob } from '../utils/dashboardDraft';
import { useJobActionsSheet } from '../hooks/useJobActionsSheet';
import { useIsAppActive } from '../hooks/useIsAppActive';
import { lightTap, successTap } from '../utils/haptics';
import { TrialBanner } from '../components/TrialBanner';
import { LeadsPromoCard } from '../components/LeadsPromoCard';
import { TRIAL_MS } from '../utils/trialConfig';
import { SyncErrorBanner } from '../components/SyncErrorBanner';
import { ShimmerOverlay } from '../components/ShimmerOverlay';
import { TapRipple } from '../components/TapRipple';
import { GrainOverlay } from '../components/GrainOverlay';

const GREETINGS = [
  "G'day",
  "Howdy",
  "Oi oi",
  "Well well well",
  "Crikey",
];

const SUBTITLES = [
  "Quoting at the pub? Classic.",
  "Gonna be a good day, ya legend.",
  "Time to send a quote and crack a cold one.",
  "Let's smash out some quotes, ay.",
  "Another day, another dollar... once they accept the quote.",
  "She'll be right, just send the quote.",
  "No wuckas, let's get quoting.",
  "Strap in legend, it's quoting time.",
  "Quotes don't write themselves... well, almost.",
  "Chuck a quote together, it'll only take a sec.",
  "If in doubt, quote it out.",
  "Too easy, let's get into it.",
  "The sooner you quote, the sooner you get paid. Probably.",
  "Bit quiet? Perfect time to fire off a quote.",
  "Your ute's loaded, your quotes should be too.",
  "Duck to the loo and smash out a quote while you're there.",
];

export function DashboardScreen() {
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);

  // Greeting changes only on mount/refresh, subtitle cycles with fade
  const [greetingIndex] = useState(() => Math.floor(Math.random() * GREETINGS.length));
  const subtitleFade = useRef(new RNAnimated.Value(1)).current;
  const [subtitleIndex, setSubtitleIndex] = useState(() => Math.floor(Math.random() * SUBTITLES.length));

  // Ambient animations — icons (bob + scale pulse)
  const iconFloat1 = useRef(new RNAnimated.Value(0)).current;
  const iconFloat2 = useRef(new RNAnimated.Value(0)).current;
  const iconFloat3 = useRef(new RNAnimated.Value(0)).current;
  const iconFloat4 = useRef(new RNAnimated.Value(0)).current;
  const iconScale1 = useRef(new RNAnimated.Value(1)).current;
  const iconScale2 = useRef(new RNAnimated.Value(1)).current;
  const iconScale3 = useRef(new RNAnimated.Value(1)).current;
  const iconScale4 = useRef(new RNAnimated.Value(1)).current;
  // Stat card breathing + tilt
  const cardBreath1 = useRef(new RNAnimated.Value(1)).current;
  const cardBreath2 = useRef(new RNAnimated.Value(1)).current;
  const cardBreath3 = useRef(new RNAnimated.Value(1)).current;
  const cardBreath4 = useRef(new RNAnimated.Value(1)).current;
  const cardTilt1 = useRef(new RNAnimated.Value(0)).current;
  const cardTilt2 = useRef(new RNAnimated.Value(0)).current;
  const cardTilt3 = useRef(new RNAnimated.Value(0)).current;
  const cardTilt4 = useRef(new RNAnimated.Value(0)).current;
  // New Quote button pulse
  const btnPulse = useRef(new RNAnimated.Value(1)).current;
  const btnTilt = useRef(new RNAnimated.Value(0)).current;
  const emptyFloat = useRef(new RNAnimated.Value(0)).current;
  const draftWiggle = useRef(new RNAnimated.Value(0)).current;

  const isFocused = useIsFocused();
  const isAppActive = useIsAppActive();

  // Hide the "TRY" badge on the Mate button once the tradie has tapped it
  // through to Mate at least once. Persisted so it stays hidden across app
  // launches. Read on focus so a tap on another device / earlier session is
  // reflected. Default true (show badge) until the stored flag says seen.
  const [mateTrySeen, setMateTrySeen] = useState(false);
  useEffect(() => {
    if (!isFocused) return;
    let cancelled = false;
    AsyncStorage.getItem('mate_try_seen')
      .then((v) => { if (!cancelled) setMateTrySeen(v === 'true'); })
      .catch(() => { /* keep showing the badge if the read fails */ });
    return () => { cancelled = true; };
  }, [isFocused]);
  const animsRef = useRef<RNAnimated.CompositeAnimation[]>([]);
  const animTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Start/stop ambient animations based on screen focus + app foreground.
  // Pausing on background prevents loops accumulating cost while the user
  // is away — they otherwise keep ticking until iOS suspends the process.
  useEffect(() => {
    // Stop previous animations
    animTimersRef.current.forEach(clearTimeout);
    animsRef.current.forEach((a) => a.stop());
    animsRef.current = [];
    animTimersRef.current = [];

    if (!isFocused || !isAppActive) return;

    const allAnims: RNAnimated.CompositeAnimation[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];

    // Stat icon floating — gentle bob + subtle scale pulse, staggered
    const floatIcons = [
      { anim: iconFloat1, scale: iconScale1, duration: 2800, delay: 0 },
      { anim: iconFloat2, scale: iconScale2, duration: 3200, delay: 400 },
      { anim: iconFloat3, scale: iconScale3, duration: 2600, delay: 800 },
      { anim: iconFloat4, scale: iconScale4, duration: 3000, delay: 1200 },
    ];
    floatIcons.forEach(({ anim, scale, duration, delay }) => {
      const a = RNAnimated.loop(
        RNAnimated.parallel([
          RNAnimated.sequence([
            RNAnimated.timing(anim, { toValue: -2, duration: duration / 2, useNativeDriver: true }),
            RNAnimated.timing(anim, { toValue: 0, duration: duration / 2, useNativeDriver: true }),
          ]),
          RNAnimated.sequence([
            RNAnimated.timing(scale, { toValue: 1.05, duration: duration / 2, useNativeDriver: true }),
            RNAnimated.timing(scale, { toValue: 1, duration: duration / 2, useNativeDriver: true }),
          ]),
        ])
      );
      allAnims.push(a);
      timers.push(setTimeout(() => a.start(), delay));
    });

    // Stat card breathing + tilt — each on its own rhythm
    const cardBreaths = [
      { anim: cardBreath1, tilt: cardTilt1, duration: 3400, tiltDuration: 4200, tiltDir: 1, delay: 200 },
      { anim: cardBreath2, tilt: cardTilt2, duration: 3800, tiltDuration: 4800, tiltDir: -1, delay: 700 },
      { anim: cardBreath3, tilt: cardTilt3, duration: 3100, tiltDuration: 3900, tiltDir: 1, delay: 1100 },
      { anim: cardBreath4, tilt: cardTilt4, duration: 3600, tiltDuration: 4500, tiltDir: -1, delay: 300 },
    ];
    cardBreaths.forEach(({ anim, tilt, duration, tiltDuration, tiltDir, delay }) => {
      const breathA = RNAnimated.loop(
        RNAnimated.sequence([
          RNAnimated.timing(anim, { toValue: 1.008, duration: duration / 2, useNativeDriver: true }),
          RNAnimated.timing(anim, { toValue: 1, duration: duration / 2, useNativeDriver: true }),
        ])
      );
      const tiltA = RNAnimated.loop(
        RNAnimated.sequence([
          RNAnimated.timing(tilt, { toValue: 0.8 * tiltDir, duration: tiltDuration / 2, useNativeDriver: true }),
          RNAnimated.timing(tilt, { toValue: -0.8 * tiltDir, duration: tiltDuration, useNativeDriver: true }),
          RNAnimated.timing(tilt, { toValue: 0, duration: tiltDuration / 2, useNativeDriver: true }),
        ])
      );
      allAnims.push(breathA, tiltA);
      timers.push(setTimeout(() => { breathA.start(); tiltA.start(); }, delay));
    });

    // New Quote button — gentle breathing pulse + slight tilt
    const btnPulseA = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(btnPulse, { toValue: 1.02, duration: 1800, useNativeDriver: true }),
        RNAnimated.timing(btnPulse, { toValue: 1, duration: 1800, useNativeDriver: true }),
      ])
    );
    const btnTiltA = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(btnTilt, { toValue: 0.3, duration: 2500, useNativeDriver: true }),
        RNAnimated.timing(btnTilt, { toValue: -0.3, duration: 5000, useNativeDriver: true }),
        RNAnimated.timing(btnTilt, { toValue: 0, duration: 2500, useNativeDriver: true }),
      ])
    );
    allAnims.push(btnPulseA, btnTiltA);
    btnPulseA.start();
    btnTiltA.start();

    // Empty state icon float
    const emptyA = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(emptyFloat, { toValue: -6, duration: 2000, useNativeDriver: true }),
        RNAnimated.timing(emptyFloat, { toValue: 0, duration: 2000, useNativeDriver: true }),
      ])
    );
    allAnims.push(emptyA);
    emptyA.start();

    // Draft pencil wiggle
    const wiggleA = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(draftWiggle, { toValue: 1, duration: 300, useNativeDriver: true }),
        RNAnimated.timing(draftWiggle, { toValue: 0, duration: 300, useNativeDriver: true }),
        RNAnimated.delay(4000),
      ])
    );
    allAnims.push(wiggleA);
    wiggleA.start();

    animsRef.current = allAnims;
    animTimersRef.current = timers;

    return () => {
      timers.forEach(clearTimeout);
      allAnims.forEach((a) => a.stop());
    };
  }, [isFocused, isAppActive]);

  useEffect(() => {
    if (!isFocused || !isAppActive) return;
    const CYCLE_MS = 12000;
    const interval = setInterval(() => {
      RNAnimated.timing(subtitleFade, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start(() => {
        setSubtitleIndex((prev) => {
          let next = Math.floor(Math.random() * SUBTITLES.length);
          while (next === prev && SUBTITLES.length > 1) next = Math.floor(Math.random() * SUBTITLES.length);
          return next;
        });
        RNAnimated.timing(subtitleFade, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }).start();
      });
    }, CYCLE_MS);
    return () => clearInterval(interval);
  }, [subtitleFade, isFocused, isAppActive]);

  // Track user activity for re-engagement emails (once per app session)
  const activityTracked = useRef(false);
  useEffect(() => {
    if (!activityTracked.current) {
      activityTracked.current = true;
      updateActivityTimestamp();
    }
  }, []);
  const navigation = useNavigation<any>();
  const jobActions = useJobActionsSheet(navigation);
  // Selector-form subscriptions — each field tracks independently so the
  // screen only re-renders when its actual reads change, not on any store
  // mutation. Replaces a single useStore() destructure that re-rendered on
  // every store write (the prime "janky return to home" suspect).
  const quotes = useStore((s) => s.quotes);
  const businessSettings = useStore((s) => s.businessSettings);
  const subscriptionStatus = useStore((s) => s.subscriptionStatus);
  // Action handles are stable Zustand fn refs — subscribing is a no-op
  // re-render-wise but keeps the call sites unchanged.
  const createNewQuote = useStore((s) => s.createNewQuote);
  const setCurrentQuote = useStore((s) => s.setCurrentQuote);
  const duplicateQuote = useStore((s) => s.duplicateQuote);
  const deleteQuote = useStore((s) => s.deleteQuote);
  const saveQuote = useStore((s) => s.saveQuote);
  const canCreateQuote = useStore((s) => s.canCreateQuote);
  const createInvoiceFromQuote = useStore((s) => s.createInvoiceFromQuote);
  const saveInvoice = useStore((s) => s.saveInvoice);
  const loadQuotes = useStore((s) => s.loadQuotes);
  const saveDraft = useStore((s) => s.saveDraft);

  const [stageSheetVisible, setStageSheetVisible] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(quotes.length > 0);
  useEffect(() => {
    if (!initialLoaded && quotes.length > 0) setInitialLoaded(true);
  }, [quotes.length, initialLoaded]);
  useEffect(() => {
    if (!initialLoaded) {
      loadQuotes().then(() => setInitialLoaded(true));
    }
  }, []);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [quoteToDelete, setQuoteToDelete] = useState<string | null>(null);
  const [duplicateSuccessVisible, setDuplicateSuccessVisible] = useState(false);
  const [deleteDraftModalVisible, setDeleteDraftModalVisible] = useState(false);

  const isTrialActive = !!(subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired);
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  // Calculate quick stats (memoized to avoid recalculation on every render)
  const { sentQuotes, acceptedQuotes, thisMonthRevenue, pipelineValue } = useMemo(() => {
    const now = new Date();
    let sent = 0;
    let accepted = 0;
    let monthRevenue = 0;
    let pipeline = 0;

    for (const q of quotes) {
      if (q.status === 'sent') {
        sent++;
        pipeline += q.total;
      }
      if (q.status === 'accepted' || q.status === 'completed') {
        accepted++;
        const d = new Date(q.updatedAt);
        if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
          monthRevenue += q.total;
        }
      }
    }

    return { sentQuotes: sent, acceptedQuotes: accepted, thisMonthRevenue: monthRevenue, pipelineValue: pipeline };
  }, [quotes]);

  // Newest in-progress draft, time-boxed — pickDashboardDraft hides
  // drafts older than the banner window so a zombie draft can't squat on
  // the home screen's top slot forever.
  const inProgressDraft = useMemo(() => pickDashboardDraft(quotes), [quotes]);

  // Translate the wizard step they left off on into a "what's needed
  // next" hint shown on the draft banner. Mirrors the screens in the
  // NewJob stack (see RootNavigator).
  const draftStepLabel = useMemo(() => {
    switch (inProgressDraft?.draftStep) {
      case 'Details':
        return 'Add job details';
      case 'CustomerDetails':
        return 'Add customer';
      case 'MaterialsList':
        return 'Add materials';
      case 'AddMaterial':
        return 'Add materials';
      case 'LaborMarkup':
        return 'Set labour & markup';
      case 'JobPreview':
        return 'Ready to send';
      default:
        return null;
    }
  }, [inProgressDraft?.draftStep]);

  // "edited 2 hours ago" — the cue that tells the tradie whether the
  // banner is today's job or old leftovers. Guarded: a malformed
  // updatedAt must not crash the dashboard.
  const draftEditedAgo = useMemo(() => {
    if (!inProgressDraft?.updatedAt) return null;
    try {
      return formatDistanceToNow(new Date(inProgressDraft.updatedAt), { addSuffix: true });
    } catch {
      return null;
    }
  }, [inProgressDraft?.updatedAt]);


  // Recent jobs (last 3) — Phase 12 replaces the "Recent Quotes" card on
  // the dashboard. Jobs are the new primary object.
  const jobs = useJobStore((s) => s.jobs);
  const saveJob = useJobStore((s) => s.saveJob);
  // While the draft banner is up, its auto-created Job would also sit at
  // the top of this list (freshest updatedAt) — same work shown twice on
  // one screen. The banner represents it; drop it from Recent Jobs.
  const recentJobs = useMemo(
    () =>
      excludeDraftJob(
        [...jobs].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
        inProgressDraft?.jobId,
      ).slice(0, 3),
    [jobs, inProgressDraft?.jobId],
  );

  const [stageSheetJob, setStageSheetJob] = useState<Job | null>(null);
  const [scheduleSheetJob, setScheduleSheetJob] = useState<Job | null>(null);
  // Stable identities — these go into memo'd JobCards; fresh closures every
  // render would make React.memo useless and re-render all cards on every
  // dashboard render.
  const handleJobStagePress = useCallback((job: Job) => setStageSheetJob(job), []);
  const handleJobPress = useCallback(
    (jobId: string) => navigation.navigate('ViewJob', { jobId }),
    [navigation],
  );
  const handleJobStageSelect = async (target: JobStage) => {
    if (!stageSheetJob) return;
    const job = stageSheetJob;
    setStageSheetJob(null);
    try {
      const documents = useStore.getState().documents;
      const attached = documents.filter((d) => d.jobId === job.id);
      const primaryDoc = job.primaryDocumentId
        ? documents.find((d) => d.id === job.primaryDocumentId) ?? pickPrimaryDoc(attached)
        : pickPrimaryDoc(attached);
      await applyJobStageChange({
        job,
        target,
        primaryDoc,
        saveJob,
        helpers: { saveQuote, saveInvoice, createInvoiceFromQuote, navigation },
      });
    } catch {
      Alert.alert('Error', 'Failed to update stage. Please try again.');
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadQuotes();
    } finally {
      setRefreshing(false);
    }
  };

  const handleContinueDraft = (draft: Quote) => {
    lightTap();
    setCurrentQuote(draft);
    navigation.navigate('NewJob' as never, { screen: draft.draftStep || 'Details' } as never);
  };

  const handleDeleteDraft = () => {
    setDeleteDraftModalVisible(true);
  };

  const confirmDeleteDraft = async () => {
    if (inProgressDraft) {
      try {
        await deleteQuote(inProgressDraft.id);
      } catch (error) {
        Alert.alert('Error', 'Failed to delete draft. Please try again.');
      }
    }
    setDeleteDraftModalVisible(false);
  };

  // The "New Job" button on the dashboard funnels straight into the quote
  // wizard. Customer + address + job title get captured on the wizard's
  // existing screens, and saveDraft's ensureJobForQuote auto-creates the
  // top-level Job once those fields have something in them — no extra
  // intermediate sheet.
  const handleNewJob = () => {
    if (!canCreateQuote()) {
      navigation.navigate('Paywall' as never);
      return;
    }
    lightTap();
    createNewQuote();
    navigation.navigate('NewJob' as never);
  };

  const handleViewQuote = (quoteId: string) => {
    // Post-UX-collapse: ViewQuote/ViewInvoice are gone. Look up the
    // job that this quote is attached to and navigate to ViewJob. The
    // quote↔job link lives on quote.jobId (Phase-8+), with a fallback
    // via jobs.find for legacy docs.
    const q = quotes.find((x) => x.id === quoteId);
    const jobId = (q as any)?.jobId;
    if (jobId) {
      navigation.navigate('ViewJob' as never, { jobId } as never);
      return;
    }
    // No linked job — open the scope editor instead so the user can
    // work with the quote directly. ensureJobForQuote will fire on
    // next save and stitch things together.
    if (q) {
      setCurrentQuote(q);
      navigation.navigate('NewJob' as never, {
        screen: 'MaterialsList',
        params: { editing: true },
      } as never);
    }
  };

  const handleEditQuote = (quote: Quote, section?: 'customer' | 'job' | 'materials' | 'labor') => {
    setCurrentQuote(quote);

    // Navigate to specific section if provided
    if (section) {
      const screenMap = {
        customer: 'CustomerDetails',
        job: 'Details',
        materials: 'MaterialsList',
        labor: 'LaborMarkup',
      };
      navigation.navigate('NewJob' as never, { screen: screenMap[section] } as never);
    } else {
      navigation.navigate('NewJob' as never);
    }
  };

  const handleDuplicateQuote = async (quote: Quote) => {
    // Check if user can create a new quote
    if (!canCreateQuote()) {
      navigation.navigate('Paywall' as never);
      return;
    }

    try {
      await duplicateQuote(quote);
      setDuplicateSuccessVisible(true);
    } catch (error) {
      Alert.alert('Error', 'Failed to duplicate quote. Please try again.');
    }
  };

  const handleDeleteQuote = async (quoteId: string) => {
    // QuoteCard already shows its own confirmation modal, so just delete directly
    try {
      await deleteQuote(quoteId);
    } catch (error) {
      Alert.alert('Error', 'Failed to delete quote. Please try again.');
    }
  };

  const confirmDeleteQuote = async () => {
    if (quoteToDelete) {
      try {
        await deleteQuote(quoteToDelete);
      } catch (error) {
        Alert.alert('Error', 'Failed to delete quote. Please try again.');
      }
    }
    setDeleteModalVisible(false);
    setQuoteToDelete(null);
  };

  const handleOpenStageSheet = (doc: Document) => {
    setSelectedDoc(doc);
    setStageSheetVisible(true);
  };

  const handleStageSelect = async (target: DocumentStage) => {
    if (!selectedDoc) return;
    setStageSheetVisible(false);
    if (target === 'invoice_sent' && selectedDoc.type === 'quote' && !isPro) {
      navigation.navigate('Paywall' as never);
      setSelectedDoc(null);
      return;
    }
    try {
      await applyStageChange(selectedDoc, target, {
        saveQuote,
        saveInvoice,
        createInvoiceFromQuote,
        navigation,
      });
    } catch {
      Alert.alert('Error', 'Failed to update stage. Please try again.');
    }
    setSelectedDoc(null);
  };

  return (
    <>
      {/* Duplicate Success */}
      <AlertModal
        visible={duplicateSuccessVisible}
        onDismiss={() => setDuplicateSuccessVisible(false)}
        type="success"
        title="Quote Duplicated"
        message="Quote duplicated successfully!"
      />

      {/* Delete Draft Confirmation */}
      <AlertModal
        visible={deleteDraftModalVisible}
        onDismiss={() => setDeleteDraftModalVisible(false)}
        type="error"
        icon="delete"
        title="Delete Draft"
        message="Are you sure you want to delete this draft?"
        primaryButtonText="Delete"
        primaryButtonAction={confirmDeleteDraft}
        secondaryButtonText="Cancel"
        secondaryButtonAction={() => setDeleteDraftModalVisible(false)}
        showConfetti={false}
      />

      {/* Delete Quote Confirmation */}
      <AlertModal
        visible={deleteModalVisible}
        onDismiss={() => { setDeleteModalVisible(false); setQuoteToDelete(null); }}
        type="error"
        icon="delete"
        title="Delete Quote"
        message="Are you sure you want to delete this quote?"
        primaryButtonText="Delete"
        primaryButtonAction={confirmDeleteQuote}
        secondaryButtonText="Cancel"
        secondaryButtonAction={() => { setDeleteModalVisible(false); setQuoteToDelete(null); }}
        showConfetti={false}
      />

    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 100 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      <WebContainer>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View style={styles.headerText}>
              <Title style={styles.greeting}>
                {GREETINGS[greetingIndex]}, {businessSettings?.businessName || 'Mate'}!
              </Title>
              <RNAnimated.View style={{ opacity: subtitleFade, minHeight: 40 }}>
                <Paragraph numberOfLines={2}>{SUBTITLES[subtitleIndex]}</Paragraph>
              </RNAnimated.View>
            </View>
            <View>
              <TouchableOpacity
                style={styles.referralButton}
                onPress={() => { lightTap(); navigation.navigate('Referral' as never); }}
                activeOpacity={0.7}
                accessibilityLabel="Refer a friend"
              >
                <MaterialCommunityIcons name="gift-outline" size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

      {/* Sync Error Banner — warns if the latest quote/invoice didn't sync to cloud */}
      <SyncErrorBanner />

      {/* Trial Status — shown only in the final 3 days of an active trial
          (days 1-3). Earlier in the trial, suppressing the countdown lets
          the tradie get hooked first; the hard gate fires at Send. The full
          banner is always available on the Subscription Settings screen. */}
      {(() => {
        if (!subscriptionStatus || subscriptionStatus.isPro || !subscriptionStatus.trialStartedAt) return null;
        const elapsed = Date.now() - new Date(subscriptionStatus.trialStartedAt).getTime();
        const daysRemaining = Math.max(0, Math.ceil((TRIAL_MS - elapsed) / (24 * 60 * 60 * 1000)));
        if (daysRemaining > 3 || daysRemaining === 0) return null;
        return (
          <TrialBanner
            trialStartedAt={subscriptionStatus.trialStartedAt}
            quoteCount={quotes.length}
          />
        );
      })()}

      {/* Continue Draft Banner */}
      {inProgressDraft && (
        <View>
          <TouchableOpacity
            onPress={() => handleContinueDraft(inProgressDraft)}
            activeOpacity={0.7}
            accessibilityLabel={`Continue draft for ${inProgressDraft.job.name || 'Untitled'}`}
          >
            <Surface style={styles.draftBanner}>
              <View style={styles.draftBannerContent}>
                <RNAnimated.View style={[styles.draftIconCircle, { backgroundColor: colors.warningBg, transform: [{ rotate: draftWiggle.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: ['0deg', '-6deg', '0deg', '6deg', '0deg'] }) }] }]}>
                  <MaterialCommunityIcons name="pencil-outline" size={20} color={colors.secondary} />
                </RNAnimated.View>
                <View style={styles.draftBannerText}>
                  <Text style={styles.draftBannerTitle} numberOfLines={1}>
                    {inProgressDraft.job.name || 'Untitled'}{inProgressDraft.customerName ? ` — ${inProgressDraft.customerName}` : ''}
                  </Text>
                  <Text style={styles.draftBannerSubtitle} numberOfLines={1}>
                    {[
                      draftStepLabel ? `Next: ${draftStepLabel}` : 'Continue draft',
                      draftEditedAgo ? `edited ${draftEditedAgo}` : null,
                    ].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={24} color={colors.primary} />
              </View>
            </Surface>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.draftDeleteButton}
            onPress={handleDeleteDraft}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Delete draft"
          >
            <MaterialCommunityIcons name="close-circle" size={22} color="#ef4444" />
          </TouchableOpacity>
        </View>
      )}

      {/* New Job + Mate buttons */}
      <View style={styles.actionRow}>
        <RNAnimated.View style={{ flex: 2, transform: [{ scale: btnPulse }, { rotate: btnTilt.interpolate({ inputRange: [-1, 1], outputRange: ['-1deg', '1deg'] }) }] }}>
          <View style={{
            borderRadius: 12,
            overflow: 'hidden',
          }}>
          <View style={{
            borderRadius: 12,
            shadowColor: colors.primary,
            shadowOffset: { width: 0, height: 0 },
            shadowRadius: 8,
            shadowOpacity: 0.5,
            elevation: 6,
          }}>
            <Button
              mode="contained"
              icon="plus-circle"
              onPress={handleNewJob}
              style={styles.newQuoteButton}
              contentStyle={styles.newQuoteButtonContent}
              accessibilityLabel="Start a new job"
            >
              New Job
            </Button>
          </View>
          </View>
        </RNAnimated.View>

        <View style={[styles.mateButtonWrapper, { flex: 1 }]}>
          <Pressable
            onPress={async () => {
              lightTap();
              if (!mateTrySeen) {
                setMateTrySeen(true);
                await AsyncStorage.setItem('mate_try_seen', 'true');
              }
              navigation.navigate('Mate' as never);
            }}
            accessibilityRole="button"
            accessibilityLabel="Talk to Mate"
            style={({ pressed }) => [styles.mateButtonGlow, pressed && styles.mateButtonPressed]}
          >
            <LinearGradient
              colors={['#243247', colors.surface]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.mateButton}
            >
              <MaterialCommunityIcons name="chat-processing" size={20} color="#E6B872" />
              <Text style={styles.mateButtonLabel}>Mate</Text>
              <ShimmerOverlay tint="#E6B872" intensity={0.1} duration={5000} />
            </LinearGradient>
          </Pressable>
          {!mateTrySeen && (
            <View style={styles.tryBadge} pointerEvents="none">
              <Text style={styles.tryBadgeText}>TRY</Text>
            </View>
          )}
        </View>
      </View>

      {/* Quick Stats */}
      <View style={styles.statsContainer}>
        <AnimatedListItem index={0} style={styles.statCardWrapper}>
          <TapRipple onPress={() => { lightTap(); navigation.navigate('Insights' as never); }} accessibilityRole="button" accessibilityLabel={`Earned this month: ${formatCurrency(thisMonthRevenue)}`} rippleColor="rgba(0,152,104,0.25)">
            <RNAnimated.View style={{ transform: [{ scale: cardBreath1 }, { rotate: cardTilt1.interpolate({ inputRange: [-1, 1], outputRange: ['-1deg', '1deg'] }) }] }}>
            <Surface style={styles.statCard}>
              <RNAnimated.View style={[styles.statIconCircle, { backgroundColor: colors.primaryBg, transform: [{ translateY: iconFloat1 }, { scale: iconScale1 }] }]}>
                <MaterialCommunityIcons name="chart-areaspline" size={22} color={colors.primary} />
              </RNAnimated.View>
              <AnimatedNumber value={thisMonthRevenue} format={formatCurrency} style={styles.statNumber} delay={0} />
              <Text style={styles.statLabel}>Earned this month</Text>
              <GrainOverlay density={60} />
              <ShimmerOverlay tint={colors.primary} intensity={0.06} />
            </Surface>
            </RNAnimated.View>
          </TapRipple>
        </AnimatedListItem>

        <AnimatedListItem index={1} style={styles.statCardWrapper}>
          <TapRipple onPress={() => { lightTap(); navigation.navigate('Insights' as never); }} accessibilityRole="button" accessibilityLabel={`Awaiting response: ${formatCurrency(pipelineValue)}`} rippleColor="rgba(90,185,234,0.25)">
            <RNAnimated.View style={{ transform: [{ scale: cardBreath2 }, { rotate: cardTilt2.interpolate({ inputRange: [-1, 1], outputRange: ['-1deg', '1deg'] }) }] }}>
            <Surface style={styles.statCard}>
              <RNAnimated.View style={[styles.statIconCircle, { backgroundColor: colors.infoBg, transform: [{ translateY: iconFloat2 }, { scale: iconScale2 }] }]}>
                <MaterialCommunityIcons name="timer-sand" size={22} color={colors.info} />
              </RNAnimated.View>
              <AnimatedNumber value={pipelineValue} format={formatCurrency} style={styles.statNumber} delay={100} />
              <Text style={styles.statLabel}>Awaiting response</Text>
              <GrainOverlay density={60} />
              <ShimmerOverlay tint={colors.info} intensity={0.06} />
            </Surface>
            </RNAnimated.View>
          </TapRipple>
        </AnimatedListItem>

        <AnimatedListItem index={2} style={styles.statCardWrapper}>
          <TapRipple onPress={() => { lightTap(); navigation.navigate('Jobs'); }} accessibilityRole="button" accessibilityLabel={`${sentQuotes} quotes sent`} rippleColor="rgba(207,161,83,0.25)">
            <RNAnimated.View style={{ transform: [{ scale: cardBreath3 }, { rotate: cardTilt3.interpolate({ inputRange: [-1, 1], outputRange: ['-1deg', '1deg'] }) }] }}>
            <Surface style={styles.statCard}>
              <RNAnimated.View style={[styles.statIconCircle, { backgroundColor: colors.warningBg, transform: [{ translateY: iconFloat3 }, { scale: iconScale3 }] }]}>
                <MaterialCommunityIcons name="send-check" size={22} color={colors.secondary} />
              </RNAnimated.View>
              <AnimatedNumber value={sentQuotes} style={styles.statNumber} delay={200} />
              <Text style={styles.statLabel}>Quotes sent</Text>
              <GrainOverlay density={60} />
              <ShimmerOverlay tint={colors.secondary} intensity={0.06} />
            </Surface>
            </RNAnimated.View>
          </TapRipple>
        </AnimatedListItem>

        <AnimatedListItem index={3} style={styles.statCardWrapper}>
          <TapRipple onPress={() => { lightTap(); navigation.navigate('Jobs'); }} accessibilityRole="button" accessibilityLabel={`${acceptedQuotes} jobs won`} rippleColor="rgba(0,200,151,0.25)">
            <RNAnimated.View style={{ transform: [{ scale: cardBreath4 }, { rotate: cardTilt4.interpolate({ inputRange: [-1, 1], outputRange: ['-1deg', '1deg'] }) }] }}>
            <Surface style={styles.statCard}>
              <RNAnimated.View style={[styles.statIconCircle, { backgroundColor: colors.successBg, transform: [{ translateY: iconFloat4 }, { scale: iconScale4 }] }]}>
                <MaterialCommunityIcons name="handshake" size={22} color={colors.success} />
              </RNAnimated.View>
              <AnimatedNumber value={acceptedQuotes} style={styles.statNumber} delay={300} />
              <Text style={styles.statLabel}>Jobs won</Text>
              <GrainOverlay density={60} />
              <ShimmerOverlay tint={colors.success} intensity={0.06} />
            </Surface>
            </RNAnimated.View>
          </TapRipple>
        </AnimatedListItem>
      </View>

      {/* Never-miss-a-call promo — dismissible, hides once dismissed or signed up */}
      <LeadsPromoCard />

      {/* Recent Jobs — Phase 12 replaces "Recent Quotes" */}
      <SkeletonCrossfade
        loaded={initialLoaded}
        skeleton={
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Jobs</Text>
            <SkeletonCardList count={3} />
          </View>
        }
      >
        {recentJobs.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Jobs</Text>

            {recentJobs.map((job, index) => (
              <AnimatedListItem key={job.id} index={index}>
                <View>
                  <JobCard
                    job={job}
                    onPress={handleJobPress}
                    onStagePress={handleJobStagePress}
                    onMenuPress={jobActions.open}
                  />
                </View>
              </AnimatedListItem>
            ))}

            <Button
              mode="text"
              onPress={() => navigation.navigate('Jobs')}
              style={styles.viewAllButton}
            >
              View All Jobs
            </Button>
          </View>
        ) : null}
      </SkeletonCrossfade>

      {/* Not shown while the draft banner is up — "bit quiet" under an
          active draft reads as contradictory (the only job may have been
          deduped out of Recent Jobs in favour of the banner). */}
      {recentJobs.length === 0 && !inProgressDraft && initialLoaded && (
        <View style={styles.emptyState}>
          <RNAnimated.View style={[styles.emptyIconCircle, { transform: [{ translateY: emptyFloat }] }]}>
            <MaterialCommunityIcons name="hard-hat" size={36} color={colors.primary} />
          </RNAnimated.View>
          <Text style={styles.emptyTitle}>Bit quiet around here</Text>
          <Text style={styles.emptyText}>
            Knock off early or get cracking
          </Text>
          <Text style={styles.emptySubtext}>
            Hit "New Job" and she'll be right
          </Text>
        </View>
      )}
      </WebContainer>
    </ScrollView>

    {/* Stage Sheet */}
    {selectedDoc && (
      <StageSheet
        visible={stageSheetVisible}
        onDismiss={() => {
          setStageSheetVisible(false);
          setSelectedDoc(null);
        }}
        doc={selectedDoc}
        onSelect={handleStageSelect}
      />
    )}

    {stageSheetJob && (
      <JobStageSheet
        visible={!!stageSheetJob}
        onDismiss={() => setStageSheetJob(null)}
        job={stageSheetJob}
        onSelect={handleJobStageSelect}
        onSchedule={() => {
          const job = stageSheetJob;
          setStageSheetJob(null);
          setScheduleSheetJob(job);
        }}
      />
    )}

    {scheduleSheetJob && (
      <ScheduleJobSheet
        visible={!!scheduleSheetJob}
        onDismiss={() => setScheduleSheetJob(null)}
        job={scheduleSheetJob}
      />
    )}

    {jobActions.element}

  </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    padding: 20,
    paddingTop: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerText: {
    flex: 1,
    marginRight: 12,
  },
  referralButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  greeting: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  draftBanner: {
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 18,
    borderRadius: 12,
    backgroundColor: colors.surface,
    elevation: 2,
    borderLeftWidth: 3,
    borderLeftColor: colors.secondary,
  },
  draftBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  draftIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  draftBannerText: {
    flex: 1,
  },
  draftBannerTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  draftBannerSubtitle: {
    fontSize: 12,
    color: colors.onSurface,
    marginTop: 2,
  },
  draftDeleteButton: {
    position: 'absolute',
    top: -6,
    right: 14,
    backgroundColor: colors.surface,
    borderRadius: 11,
    zIndex: 10,
    elevation: 10,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
    marginHorizontal: 20,
    marginBottom: 24,
  },
  newQuoteButton: {
    borderRadius: 12,
  },
  newQuoteButtonContent: {
    paddingVertical: 14,
  },
  mateButtonWrapper: {
    position: 'relative',
  },
  mateButtonGlow: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: colors.surface,
    shadowColor: colors.secondary,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 8,
    shadowOpacity: 0.3,
    elevation: 4,
  },
  mateButtonPressed: {
    transform: [{ scale: 0.97 }],
    shadowOpacity: 0.15,
  },
  mateButton: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(207, 161, 83, 0.55)',
  },
  mateButtonLabel: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
    color: '#E6B872',
  },
  tryBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: '#E6B872',
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 1,
    zIndex: 1,
  },
  tryBadgeText: {
    fontSize: 7,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: '#E6B872',
  },
  statsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    marginBottom: 24,
  },
  statCardWrapper: {
    width: '46%',
    margin: '2%',
  },
  statCard: {
    padding: 16,
    borderRadius: 14,
    alignItems: 'center',
    elevation: 2,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  statIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  statNumber: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 3,
  },
  statLabel: {
    fontSize: 11,
    color: colors.onSurface,
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  viewAllButton: {
    marginTop: 8,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    marginTop: 12,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 16,
    color: colors.onSurface,
    textAlign: 'center',
    lineHeight: 22,
  },
  emptySubtext: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
  },
});
