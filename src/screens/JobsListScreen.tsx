/**
 * Jobs List Screen
 *
 * Top-level view of the user's jobs (Phase 10). Lists Jobs produced by
 * useJobStore, with filters (All / Active / Scheduled / Completed / Archived)
 * and search by customer or job name. Tap a card to open ViewJobScreen.
 * FAB opens the NewJobSheet, which creates a Job and drops into the quote
 * wizard.
 */

import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { View, StyleSheet, FlatList, Alert, RefreshControl, Pressable } from 'react-native';
import { Text, Searchbar, Chip, FAB } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useScrollToTop } from '@react-navigation/native';

import type { Job, JobStage } from '../../shared/job/types';
import { useJobStore } from '../store/useJobStore';
import { colors } from '../theme';
import { JobsCalendarScreen } from './JobsCalendarScreen';
import { WebContainer } from '../components/WebContainer';
import { JobCard } from '../components/JobCard';
import { JobStageSheet } from '../components/JobStageSheet';
import { NewJobSheet } from '../components/NewJobSheet';
import { AnimatedListItem } from '../components/AnimatedListItem';
import { SkeletonCardList } from '../components/SkeletonCard';
import { SkeletonCrossfade } from '../components/SkeletonCrossfade';
import { lightTap } from '../utils/haptics';

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
  const listRef = useRef<FlatList>(null);
  useScrollToTop(listRef);

  const navigation = useNavigation<any>();
  const { jobs, jobsLoaded, loadJobs, saveJob } = useJobStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterKind>('active');
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(jobsLoaded || jobs.length > 0);
  const [stageSheetJob, setStageSheetJob] = useState<Job | null>(null);
  const [newJobSheetVisible, setNewJobSheetVisible] = useState(false);

  useEffect(() => {
    if (!initialLoaded && jobs.length > 0) setInitialLoaded(true);
  }, [jobs.length, initialLoaded]);

  useEffect(() => {
    if (!initialLoaded) {
      loadJobs().then(() => setInitialLoaded(true));
    }
  }, []);

  const filtered = useMemo(() => {
    return jobs.filter((j) => {
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
    lightTap();
    setNewJobSheetVisible(true);
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
    // UI is flexible — the tradie can jump to any stage. The shared state
    // machine is enforced server-side for correctness (future phase),
    // not here.
    try {
      await saveJob({ ...job, stage: target });
    } catch {
      Alert.alert('Error', 'Failed to update stage. Please try again.');
    }
  };

  const renderCard = useCallback(
    ({ item, index }: { item: Job; index: number }) => (
      <AnimatedListItem index={index}>
        <JobCard job={item} onPress={handleView} onStagePress={handleStagePress} />
      </AnimatedListItem>
    ),
    [],
  );

  // Calendar view reuses JobsCalendarScreen as-is. The toggle lives at the
  // top of JobsListScreen so the tab header stays simple; when 'calendar'
  // is picked we swap bodies rather than route-switch (no extra stack
  // complexity, one tab, one mental model).
  if (viewMode === 'calendar') {
    return (
      <View style={styles.container}>
        <WebContainer>
          <ViewToggle mode={viewMode} onChange={setViewMode} />
        </WebContainer>
        <JobsCalendarScreen />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebContainer>
        <ViewToggle mode={viewMode} onChange={setViewMode} />
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
                style={styles.filterChip}
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
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            }
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <View style={styles.emptyIconCircle}>
                  <MaterialCommunityIcons
                    name={'briefcase-outline' as any}
                    size={36}
                    color={colors.primary}
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
        color={colors.white}
        accessibilityLabel="Create new job"
      />

      {stageSheetJob && (
        <JobStageSheet
          visible={!!stageSheetJob}
          onDismiss={() => setStageSheetJob(null)}
          job={stageSheetJob}
          onSelect={handleStageSelect}
        />
      )}

      <NewJobSheet
        visible={newJobSheetVisible}
        onDismiss={() => setNewJobSheetVisible(false)}
      />
    </View>
  );
}

function ViewToggle({
  mode,
  onChange,
}: {
  mode: 'list' | 'calendar';
  onChange: (mode: 'list' | 'calendar') => void;
}) {
  return (
    <View style={toggleStyles.row}>
      <ToggleButton
        icon="view-list"
        label="List"
        active={mode === 'list'}
        onPress={() => onChange('list')}
      />
      <ToggleButton
        icon="calendar-month-outline"
        label="Calendar"
        active={mode === 'calendar'}
        onPress={() => onChange('calendar')}
      />
    </View>
  );
}

function ToggleButton({
  icon,
  label,
  active,
  onPress,
}: {
  icon: string;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        lightTap();
        onPress();
      }}
      style={({ pressed }) => [
        toggleStyles.button,
        active && toggleStyles.buttonActive,
        pressed && { opacity: 0.8 },
      ]}
    >
      <MaterialCommunityIcons
        name={icon as any}
        size={16}
        color={active ? colors.white : colors.text}
      />
      <Text style={[toggleStyles.label, active && toggleStyles.labelActive]}>{label}</Text>
    </Pressable>
  );
}

const toggleStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: colors.surfaceGray3,
    borderRadius: 999,
    padding: 3,
    alignSelf: 'flex-start',
    gap: 2,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
  },
  buttonActive: {
    backgroundColor: colors.primary,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  labelActive: {
    color: colors.white,
  },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  searchBar: {
    margin: 16,
    elevation: 2,
    backgroundColor: colors.surface,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 8,
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: { backgroundColor: colors.surface },
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
    backgroundColor: colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
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
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 96,
    backgroundColor: colors.primary,
  },
});
