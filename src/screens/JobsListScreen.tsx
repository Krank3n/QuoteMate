/**
 * Jobs List Screen
 *
 * Top-level view of the user's jobs (Phase 10). Lists Jobs produced by
 * useJobStore, with filters (All / Active / Scheduled / Completed / Archived)
 * and search by customer or job name. Tap a card to open ViewJobScreen.
 * FAB drops straight into the quote wizard — saveDraft's
 * ensureJobForQuote auto-creates the Job once customer / address / job
 * title have been entered, so no interstitial sheet is needed.
 */

import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { View, StyleSheet, FlatList, Alert, RefreshControl } from 'react-native';
import { Text, Searchbar, Chip, FAB } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useScrollToTop } from '@react-navigation/native';

import type { Job, JobStage } from '../../shared/job/types';
import { useJobStore } from '../store/useJobStore';
import { useStore } from '../store/useStore';
import { makeStyles, useThemeColors } from '../theme';
import { WebContainer } from '../components/WebContainer';
import { GridBackground } from '../components/GridBackground';
import { JobCard } from '../components/JobCard';
import { JobStageSheet } from '../components/JobStageSheet';
import { ScheduleJobSheet } from '../components/ScheduleJobSheet';
import { AnimatedListItem } from '../components/AnimatedListItem';
import { SkeletonCardList } from '../components/SkeletonCard';
import { SkeletonCrossfade } from '../components/SkeletonCrossfade';
import { useJobActionsSheet } from '../hooks/useJobActionsSheet';
import { lightTap } from '../utils/haptics';
import { applyJobStageChange } from '../utils/applyJobStageChange';
import { sortJobsForList } from '../utils/jobTimeline';
import { pickPrimaryDoc } from '../components/StickyJobActionBar';
type FilterKind = 'all' | 'active' | 'scheduled' | 'completed' | 'archived';

const FILTERS: { key: FilterKind; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'completed', label: 'Completed' },
  { key: 'archived', label: 'Archived' },
];

// Terminal stages = jobs you've parked (closed/cancelled). Active = anything
// else that isn't finished-and-paid. "Active" intentionally includes inquiry,
// quoted, accepted, scheduled, in_progress — the day-to-day feed.
function matchesFilter(job: Job, filter: FilterKind): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'active':
      return ['inquiry', 'quoted', 'accepted', 'scheduled', 'in_progress'].includes(job.stage);
    case 'scheduled':
      return job.stage === 'scheduled' || !!job.scheduledStartDate;
    case 'completed':
      return ['completed', 'paid'].includes(job.stage);
    case 'archived':
      return job.stage === 'closed' || job.stage === 'cancelled' || !!job.archivedAt;
    default:
      return true;
  }
}

export function JobsListScreen() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const listRef = useRef<FlatList>(null);
  useScrollToTop(listRef);

  const navigation = useNavigation<any>();
  const { jobs, jobsLoaded, loadJobs, saveJob } = useJobStore();
  const canCreateQuote = useStore((s) => s.canCreateQuote);
  const createNewQuote = useStore((s) => s.createNewQuote);
  const documents = useStore((s) => s.documents);
  const saveQuote = useStore((s) => s.saveQuote);
  const saveInvoice = useStore((s) => s.saveInvoice);
  const createInvoiceFromQuote = useStore((s) => s.createInvoiceFromQuote);

  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterKind>('active');
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(jobsLoaded || jobs.length > 0);
  const [stageSheetJob, setStageSheetJob] = useState<Job | null>(null);
  const [scheduleSheetJob, setScheduleSheetJob] = useState<Job | null>(null);

  // Shared Actions sheet host (see useJobActionsSheet for the whole
  // menu → dispatcher wiring including linked dialogs/sheets).
  const actionsSheet = useJobActionsSheet(navigation);

  useEffect(() => {
    if (!initialLoaded && jobs.length > 0) setInitialLoaded(true);
  }, [jobs.length, initialLoaded]);

  useEffect(() => {
    if (!initialLoaded) {
      loadJobs().then(() => setInitialLoaded(true));
    }
  }, []);

  const filtered = useMemo(() => {
    const matches = jobs.filter((j) => {
      if (!matchesFilter(j, filter)) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          j.customerName.toLowerCase().includes(q) ||
          j.name.toLowerCase().includes(q) ||
          (j.jobAddress || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
    // Sort here rather than leaning on the query's updatedAt ordering —
    // the cards are dated by their stage stamp, and the two disagreed.
    return sortJobsForList(matches);
  }, [jobs, filter, searchQuery]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadJobs();
    } finally {
      setRefreshing(false);
    }
  };

  const handleNew = () => {
    if (!canCreateQuote()) {
      navigation.navigate('Paywall' as never, { source: 'jobs_list' } as never);
      return;
    }
    lightTap();
    // Funnel into the existing quote wizard. The wizard captures customer
    // + address + job title on its own screens; saveDraft auto-creates
    // the Job once those fields are populated. No interstitial sheet.
    createNewQuote();
    navigation.navigate('NewJob' as never);
  };

  const handleView = (jobId: string) => {
    navigation.navigate('ViewJob', { jobId });
  };

  const handleStagePress = (job: Job) => {
    setStageSheetJob(job);
  };

  const handleStageSelect = async (target: JobStage) => {
    if (!stageSheetJob) return;
    const job = stageSheetJob;
    setStageSheetJob(null);
    // UI is flexible — the tradie can jump to any stage. The shared helper
    // also propagates the stage to the underlying primary quote-doc so
    // downstream features (Push to Xero, Continue Draft banner) stay
    // consistent.
    try {
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


  const renderCard = useCallback(
    ({ item, index }: { item: Job; index: number }) => (
      <AnimatedListItem index={index}>
        <JobCard
          job={item}
          onPress={handleView}
          onStagePress={handleStagePress}
          onMenuPress={actionsSheet.open}
        />
      </AnimatedListItem>
    ),
    [],
  );

  return (
    <View style={styles.container}>
      <GridBackground />
      <WebContainer>
        <Searchbar
          placeholder="Search jobs..."
          onChangeText={setSearchQuery}
          value={searchQuery}
          style={styles.searchBar}
        />

        <View style={styles.filterRow}>
          {FILTERS.map(({ key, label }) => {
            const count =
              key === 'all' ? jobs.length : jobs.filter((j) => matchesFilter(j, key)).length;
            return (
              <Chip
                key={key}
                selected={filter === key}
                onPress={() => {
                  lightTap();
                  setFilter(key);
                }}
                style={[styles.filterChip, filter === key && styles.filterChipActive]}
                textStyle={filter === key ? styles.filterChipTextActive : styles.filterChipText}
                showSelectedCheck={false}
              >
                {label}
                {count > 0 ? ` (${count})` : ''}
              </Chip>
            );
          })}
        </View>
      </WebContainer>

      <WebContainer style={styles.listContainer}>
        <SkeletonCrossfade
          loaded={initialLoaded}
          fill
          skeleton={
            <View style={{ padding: 16 }}>
              <SkeletonCardList count={4} />
            </View>
          }
        >
          <FlatList
            ref={listRef}
            data={filtered}
            renderItem={renderCard}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            style={styles.flatList}
            removeClippedSubviews
            initialNumToRender={8}
            maxToRenderPerBatch={5}
            windowSize={7}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={themeColors.accent}
                colors={[themeColors.accent]}
              />
            }
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <View style={styles.emptyIconCircle}>
                  <MaterialCommunityIcons
                    name={'briefcase-outline' as any}
                    size={36}
                    color={themeColors.accentText}
                  />
                </View>
                <Text style={styles.emptyTitle}>
                  {filter === 'all' && 'No jobs yet'}
                  {filter === 'active' && 'Nothing on the go'}
                  {filter === 'scheduled' && 'Nothing on the calendar'}
                  {filter === 'completed' && 'Nothing in the rear-view'}
                  {filter === 'archived' && 'Archive is empty'}
                </Text>
                <Text style={styles.emptyText}>
                  {filter === 'all' && 'Start your first job and it’ll show up here'}
                  {filter === 'active' &&
                    'Jobs you’re quoting or working on live here'}
                  {filter === 'scheduled' && 'Schedule a start date to see a job here'}
                  {filter === 'completed' && 'Wrapped-up jobs show up here'}
                  {filter === 'archived' &&
                    'Closed and cancelled jobs rest here'}
                </Text>
                <Text style={styles.emptySubtext}>
                  {filter === 'all'
                    ? 'Tap + to start a new job'
                    : 'Try another filter or tap + to start one'}
                </Text>
              </View>
            }
          />
        </SkeletonCrossfade>
      </WebContainer>

      <FAB
        icon="plus"
        style={styles.fab}
        onPress={handleNew}
        color={themeColors.onAccent}
        accessibilityLabel="Create new job"
      />

      {stageSheetJob && (
        <JobStageSheet
          visible={!!stageSheetJob}
          onDismiss={() => setStageSheetJob(null)}
          job={stageSheetJob}
          onSelect={handleStageSelect}
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

      {actionsSheet.element}

    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: { flex: 1, backgroundColor: t.colors.bg },
  searchBar: {
    margin: 16,
    elevation: 2,
    backgroundColor: t.colors.surfaceRaised,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 8,
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    backgroundColor: t.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  filterChipActive: {
    backgroundColor: t.colors.accent,
    borderColor: t.colors.accentBorder,
  },
  filterChipText: { color: t.colors.textMuted, fontFamily: 'Archivo-SemiBold' },
  filterChipTextActive: { color: t.colors.onAccent, fontFamily: 'Archivo-Bold' },
  listContainer: { flex: 1 },
  flatList: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 100 },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: t.colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: t.colors.text,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 16,
    color: t.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  emptySubtext: {
    fontSize: 14,
    color: t.colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 96,
    backgroundColor: t.colors.accent,
  },
}));
