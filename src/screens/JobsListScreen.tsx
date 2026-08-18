/**
 * Jobs List Screen
 *
 * Top-level view of the user's jobs. Lists Jobs produced by useJobStore, piled
 * by what each one needs from you (see jobBuckets), searchable by any handle
 * the job carries (see jobSearch), and orderable by money or diary (see
 * jobSort). Tap a card to open ViewJobScreen.
 *
 * The chip and the sort persist per pile so tapping into a job and coming back
 * doesn't lose your place; the search box deliberately doesn't survive a
 * restart (see useJobListPrefsStore).
 *
 * FAB drops straight into the quote wizard — saveDraft's ensureJobForQuote
 * auto-creates the Job once customer / address / job title have been entered,
 * so no interstitial sheet is needed.
 */

import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { Text, Searchbar, FAB } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
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
import {
  JOB_FILTERS,
  bucketForJob,
  groupDocsByJob,
  type JobBucket,
  type JobFilterKey,
} from '../utils/jobBuckets';
import { buildJobSearchIndex, filterJobsBySearch } from '../utils/jobSearch';
import {
  buildJobSortMetrics,
  jobSortLabel,
  sortJobsBy,
  type JobSortKey,
} from '../utils/jobSort';
import { JobSortMenu } from '../components/JobSortMenu';
import { useJobListPrefsStore } from '../store/useJobListPrefsStore';
import {
  computeCustomerRollup,
  customerKeyByJobId,
  groupJobsByCustomer,
  jobCountByJobId,
} from '../utils/customerGroups';
import { formatCurrency } from '../utils/quoteCalculator';
import { pickPrimaryDoc } from '../components/StickyJobActionBar';
/**
 * Midnight today. Overdue is measured in days, so pinning the clock to the
 * start of the day keeps the sort order stable across a session's renders
 * instead of drifting with every millisecond.
 */
function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const EMPTY_COPY: Record<JobFilterKey, { title: string; body: string }> = {
  all: { title: 'No jobs yet', body: 'Start your first job and it’ll show up here' },
  to_send: { title: 'Nothing waiting on you', body: 'Drafts to send and finished work to invoice land here' },
  waiting: { title: 'Nobody to chase', body: 'Quotes you’ve sent sit here until the customer answers' },
  owed: { title: 'Nothing outstanding', body: 'Invoices with money still owing land here' },
  to_book: { title: 'Nothing waiting on a date', body: 'Work you’ve won but haven’t put in the diary lands here' },
  scheduled: { title: 'Nothing on the calendar', body: 'Schedule a start date to see a job here' },
  done: { title: 'Nothing in the rear-view', body: 'Finished work that’s been paid for rests here, with anything closed or archived' },
};

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

  // Filter, sort and query live in a store, not in useState — this screen is a
  // tab and tapping into a job unmounts it, so component state would drop the
  // pile you were working through. Filter and sort persist to disk; the query
  // survives the round trip but not a restart. See useJobListPrefsStore.
  const filter = useJobListPrefsStore((s) => s.prefs.filter);
  const setFilter = useJobListPrefsStore((s) => s.setFilter);
  const setSort = useJobListPrefsStore((s) => s.setSort);
  const searchQuery = useJobListPrefsStore((s) => s.searchQuery);
  const setSearchQuery = useJobListPrefsStore((s) => s.setSearchQuery);
  const hydratePrefs = useJobListPrefsStore((s) => s.hydrate);
  const sortKey = useJobListPrefsStore((s) => s.sortFor(s.prefs.filter));

  // The chip row scrolls horizontally now, so the selected chip can start off
  // screen — on a restored "Done" filter you'd see a filtered list with nothing
  // visible explaining why. These keep it in view.
  const chipScrollRef = useRef<ScrollView>(null);
  const chipOffsets = useRef<Record<string, number>>({});
  /** Which filter we've already auto-scrolled to, so we only do it once. */
  const chipScrolledFor = useRef<string | null>(null);

  // Which edges are hiding chips. Both fades are conditional: a fade at an edge
  // with nothing past it makes the first chip look clipped when it isn't.
  const chipViewport = useRef(0);
  const chipContent = useRef(0);
  const chipScrollX = useRef(0);
  const [chipFades, setChipFades] = useState({ left: false, right: false });

  const syncChipFades = useCallback(() => {
    const viewport = chipViewport.current;
    const content = chipContent.current;
    if (!viewport || !content) return;
    const scrollable = content > viewport + 1;
    const x = chipScrollX.current;
    const left = scrollable && x > 1;
    const right = scrollable && x + viewport < content - 1;
    // Return prev when nothing flipped so a scroll gesture doesn't re-render
    // the whole list on every frame.
    setChipFades((prev) =>
      prev.left === left && prev.right === right ? prev : { left, right },
    );
  }, []);

  const [refreshing, setRefreshing] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(jobsLoaded || jobs.length > 0);
  const [stageSheetJob, setStageSheetJob] = useState<Job | null>(null);
  const [scheduleSheetJob, setScheduleSheetJob] = useState<Job | null>(null);

  // Shared Actions sheet host (see useJobActionsSheet for the whole
  // menu → dispatcher wiring including linked dialogs/sheets).
  // onSchedule lets the kebab's "Change status" submenu route into the same
  // date picker the stage sheet uses, rather than flipping a job to
  // Scheduled with no date on it.
  const actionsSheet = useJobActionsSheet(navigation, {
    onSchedule: (job) => setScheduleSheetJob(job),
  });

  useEffect(() => {
    if (!initialLoaded && jobs.length > 0) setInitialLoaded(true);
  }, [jobs.length, initialLoaded]);

  useEffect(() => {
    if (!initialLoaded) {
      loadJobs().then(() => setInitialLoaded(true));
    }
    void hydratePrefs();
  }, []);

  // The pipeline below is split so a KEYSTROKE only re-runs its cheap tail.
  // Everything derived from the data — buckets, the search index, the sort
  // metrics — is keyed on [jobs, documents] and never rebuilt while typing.

  // Walk `documents` once. Three consumers need this same map.
  const docsByJob = useMemo(() => groupDocsByJob(documents), [documents]);

  // Bucket every job once per data change, rather than re-deriving it inside
  // each chip's count — that was jobs × filters × a document scan on every
  // keystroke in the search box.
  const bucketByJob = useMemo(() => {
    const map = new Map<string, JobBucket>();
    // One clock for the whole pass, so two jobs booked for the same day can't
    // land in different buckets because midnight fell between them.
    const today = startOfToday();
    for (const j of jobs) map.set(j.id, bucketForJob(j, docsByJob.get(j.id) ?? [], today));
    return map;
  }, [jobs, docsByJob]);

  const searchIndex = useMemo(() => buildJobSearchIndex(jobs, docsByJob), [jobs, docsByJob]);

  // `now` is frozen for the session on purpose. Overdue is a day-granularity
  // idea, so re-ticking it per render would only make the comparators
  // non-deterministic — and it's rounded to the start of the day so two
  // renders an hour apart produce the same order.
  const sortMetrics = useMemo(
    () => buildJobSortMetrics(jobs, docsByJob, startOfToday()),
    [jobs, docsByJob],
  );

  // Chip counts stay SEARCH-INDEPENDENT, deliberately: they count the whole
  // population so they sum to the total (the property jobBuckets guarantees).
  // Recomputing them from the searched set makes every chip read "(1)", which
  // reads as the counts being broken.
  const counts = useMemo(() => {
    const tally = new Map<JobFilterKey, number>([['all', jobs.length]]);
    for (const bucket of bucketByJob.values()) {
      tally.set(bucket, (tally.get(bucket) ?? 0) + 1);
    }
    return tally;
  }, [bucketByJob, jobs.length]);

  const bucketed = useMemo(
    () => (filter === 'all' ? jobs : jobs.filter((j) => bucketByJob.get(j.id) === filter)),
    [jobs, bucketByJob, filter],
  );

  // The only memo a keystroke invalidates.
  const matched = useMemo(
    () => filterJobsBySearch(bucketed, searchIndex, searchQuery),
    [bucketed, searchIndex, searchQuery],
  );

  const filtered = useMemo(
    () => sortJobsBy(matched, sortKey, sortMetrics),
    [matched, sortKey, sortMetrics],
  );

  // Bring the selected chip into view. A little lead-in so it doesn't sit flush
  // against the edge and look clipped.
  const scrollChipIntoView = useCallback((key: JobFilterKey) => {
    const x = chipOffsets.current[key];
    if (x === undefined) return;
    chipScrolledFor.current = key;
    chipScrollRef.current?.scrollTo({ x: Math.max(0, x - 16), animated: true });
  }, []);

  useEffect(() => {
    // Allow one auto-scroll for the new filter, then leave the row alone so we
    // never fight the tradie's own scrolling.
    chipScrolledFor.current = null;
    scrollChipIntoView(filter);
  }, [filter, scrollChipIntoView]);

  const searching = searchQuery.trim().length > 0;

  // Customer grouping: drives the repeat marker on cards, and the customer rows
  // the search puts above the job results. Both are entry points into the
  // Customer screen, and neither costs a new control on this screen.
  const customerGroups = useMemo(() => groupJobsByCustomer(jobs, docsByJob), [jobs, docsByJob]);
  const jobCounts = useMemo(() => jobCountByJobId(customerGroups), [customerGroups]);
  const customerKeys = useMemo(() => customerKeyByJobId(customerGroups), [customerGroups]);
  const jobsById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);

  /**
   * Customers whose own details match the query — shown above the job cards so
   * "smith" offers Jane Smith's whole history, not just her individual jobs.
   * Capped at 3: this is a shortcut, not a second list.
   */
  const matchedCustomers = useMemo(() => {
    if (searchQuery.trim().length < 2) return [];
    const matchedKeys = new Set(
      matched.map((j) => customerKeys.get(j.id)).filter(Boolean) as string[],
    );
    return customerGroups
      .filter((g) => g.isRepeat && matchedKeys.has(g.key))
      .slice(0, 3)
      .map((g) => ({ group: g, rollup: computeCustomerRollup(g, jobsById, docsByJob) }));
  }, [searchQuery, matched, customerKeys, customerGroups, jobsById, docsByJob]);

  const openCustomer = useCallback(
    (job: Job) => {
      const key = customerKeys.get(job.id);
      if (!key) return;
      navigation.navigate('Customer', { customerKey: key, name: job.customerName });
    },
    [customerKeys, navigation],
  );

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
        attachedDocs: attached,
        saveJob,
        helpers: { saveQuote, saveInvoice, createInvoiceFromQuote, navigation },
      });
    } catch {
      Alert.alert('Error', 'Failed to update stage. Please try again.');
    }
  };


  // sortKey and sortMetrics MUST be in the dep array. Without them the cards
  // keep whatever sort label they first rendered with — React.memo on JobCard
  // hides the staleness, so the list silently orders by one thing while every
  // card claims another.
  const renderCard = useCallback(
    ({ item, index }: { item: Job; index: number }) => {
      const metrics = sortMetrics.get(item.id);
      return (
        <AnimatedListItem index={index}>
          <JobCard
            job={item}
            onPress={handleView}
            onStagePress={handleStagePress}
            onMenuPress={actionsSheet.open}
            sortLabel={metrics ? jobSortLabel(sortKey, metrics) : null}
            customerJobCount={jobCounts.get(item.id)}
            onCustomerPress={openCustomer}
          />
        </AnimatedListItem>
      );
    },
    [sortKey, sortMetrics, jobCounts, openCustomer],
  );

  return (
    <View style={styles.container}>
      <GridBackground />
      <WebContainer>
        <Searchbar
          placeholder="Name, address, phone, invoice #"
          onChangeText={setSearchQuery}
          value={searchQuery}
          style={styles.searchBar}
        />

        {/* One line, not two. Six chips plus the sort button wrapped onto a
            second row on any normal phone width, which put three bands of
            chrome above the list. The chips scroll horizontally instead; the
            sort button sits outside the scroller so it stays reachable. */}
        <View style={styles.controlsRow}>
          <View style={styles.filterScrollWrap}>
            <ScrollView
              ref={chipScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
              scrollEventThrottle={32}
              onScroll={(e) => {
                chipScrollX.current = e.nativeEvent.contentOffset.x;
                syncChipFades();
              }}
              onLayout={(e) => {
                chipViewport.current = e.nativeEvent.layout.width;
                syncChipFades();
              }}
              onContentSizeChange={(w) => {
                chipContent.current = w;
                syncChipFades();
              }}
            >
            {JOB_FILTERS.map(({ key, label }) => {
              const count = counts.get(key) ?? 0;
              return (
                <View
                  key={key}
                  // Remember where each chip sits so the selected one can be
                  // scrolled into view — see scrollChipIntoView.
                  //
                  // Scrolling from HERE as well as from the effect is what makes
                  // it reliable. On a restored filter the effect runs before any
                  // chip has measured itself, so offsets are empty and it gives
                  // up — leaving the selected pile off screen with no chip
                  // highlighted, i.e. a filtered list with nothing on screen
                  // saying why. Whichever happens last wins, and the guard keeps
                  // it to one auto-scroll per filter.
                  onLayout={(e) => {
                    chipOffsets.current[key] = e.nativeEvent.layout.x;
                    if (key === filter && chipScrolledFor.current !== filter) {
                      scrollChipIntoView(filter);
                    }
                  }}
                >
                  <Pressable
                    onPress={() => {
                      lightTap();
                      setFilter(key);
                    }}
                    // The chip is deliberately shorter than a comfortable tap
                    // target, so extend the touch area past the visual bounds
                    // rather than making the row taller again.
                    hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: filter === key }}
                    style={({ pressed }) => [
                      styles.filterChip,
                      filter === key && styles.filterChipActive,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Text
                      style={
                        filter === key ? styles.filterChipTextActive : styles.filterChipText
                      }
                      numberOfLines={1}
                    >
                      {label}
                      {count > 0 ? ` (${count})` : ''}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
            </ScrollView>
            {/* Chips fade out at whichever edge is hiding them, instead of
                being sliced mid-word — a flat-cut chip reads as a rendering
                fault, which is exactly how the left edge looked before this.
                Both gradients end on the page background at zero alpha rather
                than 'transparent': interpolating towards transparent-black
                smudges the gradient grey on iOS. pointerEvents none so they
                never eat a chip tap. */}
            {chipFades.left ? (
              <LinearGradient
                pointerEvents="none"
                colors={[themeColors.bg, themeColors.bg + '00']}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={[styles.filterFade, styles.filterFadeLeft]}
              />
            ) : null}
            {chipFades.right ? (
              <LinearGradient
                pointerEvents="none"
                colors={[themeColors.bg + '00', themeColors.bg]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={[styles.filterFade, styles.filterFadeRight]}
              />
            ) : null}
          </View>
          <JobSortMenu value={sortKey} onChange={(key) => setSort(filter, key)} />
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
            // Only shown while searching, so it costs nothing when idle — and
            // it makes a narrowed list obvious rather than looking like jobs
            // have gone missing.
            ListHeaderComponent={
              searching ? (
                <View>
                  {matchedCustomers.map(({ group, rollup }) => (
                    <Pressable
                      key={group.key}
                      onPress={() => {
                        lightTap();
                        navigation.navigate('Customer', {
                          customerKey: group.key,
                          name: group.name,
                        });
                      }}
                      style={({ pressed }) => [
                        styles.customerRow,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={'account-outline' as any}
                        size={18}
                        color={themeColors.accentText}
                      />
                      <Text style={styles.customerRowName} numberOfLines={1}>
                        {group.name}
                      </Text>
                      <Text style={styles.customerRowMeta} numberOfLines={1}>
                        {group.jobCount} jobs
                        {rollup.owed > 0 ? ` · ${formatCurrency(rollup.owed)} owed` : ''}
                      </Text>
                      <MaterialCommunityIcons
                        name={'chevron-right' as any}
                        size={18}
                        color={themeColors.textMuted}
                      />
                    </Pressable>
                  ))}
                  <Text style={styles.resultCount}>
                    Showing {filtered.length} of {bucketed.length}
                  </Text>
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <View style={styles.emptyIconCircle}>
                  <MaterialCommunityIcons
                    name={(searching ? 'magnify' : 'briefcase-outline') as any}
                    size={36}
                    color={themeColors.accentText}
                  />
                </View>
                {/* Under an active search the stock copy ("No jobs yet") is a
                    false statement about the tradie's data — the exact shape
                    of a "my jobs are gone" support ticket. Say what actually
                    happened, and offer the way out. */}
                {searching ? (
                  <>
                    <Text style={styles.emptyTitle}>No jobs match</Text>
                    <Text style={styles.emptyText}>
                      Nothing here for “{searchQuery.trim()}”
                    </Text>
                    <Pressable
                      onPress={() => {
                        lightTap();
                        setSearchQuery('');
                      }}
                      style={({ pressed }) => [styles.clearSearch, pressed && { opacity: 0.7 }]}
                    >
                      <Text style={styles.clearSearchLabel}>Clear search</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text style={styles.emptyTitle}>{EMPTY_COPY[filter].title}</Text>
                    <Text style={styles.emptyText}>{EMPTY_COPY[filter].body}</Text>
                    <Text style={styles.emptySubtext}>
                      {filter === 'all'
                        ? 'Tap + to start a new job'
                        : 'Try another filter or tap + to start one'}
                    </Text>
                  </>
                )}
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
          primaryDoc={pickPrimaryDoc(documents.filter((d) => d.jobId === stageSheetJob.id))}
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
    // Was margin:16 all round. Trimmed vertically — the chip row directly
    // below supplies its own spacing, so 16 top and bottom was double.
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 10,
    elevation: 2,
    backgroundColor: t.colors.surfaceRaised,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 16,
    marginBottom: 8,
    gap: 8,
  },
  // flexShrink lets the scroller give way to the sort button rather than
  // pushing it off the edge. minWidth:0 is what actually makes that work on
  // web — without it a flex child refuses to shrink below its content's
  // intrinsic width, so six chips would shove the sort button off screen.
  //
  // The wrapper exists to anchor the fade: it has to overlay the scroller, and
  // an absolute child of the ScrollView itself would scroll away with the chips.
  filterScrollWrap: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    position: 'relative',
  },
  filterFade: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 24,
  },
  filterFadeLeft: { left: 0 },
  filterFadeRight: { right: 0 },
  // No flexWrap: the row is a single scrolling line. Trailing padding so the
  // last chip can clear the sort button when scrolled fully right.
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 8,
  },
  // Hand-rolled rather than Paper's Chip, which can't be made shorter without
  // fighting its internals: its MD3 label carries marginVertical:8 on a 20px
  // line-height, so ~36px is its floor. This matches the Pressable idiom
  // PillToggle and JobSortMenu already use, and lines the chips up with the
  // sort button beside them — at 36 vs 30 they didn't agree before.
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: t.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  filterChipActive: {
    backgroundColor: t.colors.accent,
    borderColor: t.colors.accentBorder,
  },
  filterChipText: { fontSize: 12, color: t.colors.textMuted, fontFamily: 'Archivo-SemiBold' },
  filterChipTextActive: { fontSize: 12, color: t.colors.onAccent, fontFamily: 'Archivo-Bold' },
  listContainer: { flex: 1 },
  flatList: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 100 },
  resultCount: {
    fontSize: 12,
    color: t.colors.textMuted,
    fontFamily: 'Archivo-SemiBold',
    marginBottom: 8,
  },
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceRaised,
  },
  customerRowName: {
    fontSize: 15,
    fontFamily: 'Archivo-Bold',
    color: t.colors.text,
    flexShrink: 1,
  },
  customerRowMeta: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginLeft: 'auto',
    flexShrink: 0,
  },
  clearSearch: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceRaised,
  },
  clearSearchLabel: {
    fontSize: 14,
    fontFamily: 'Archivo-SemiBold',
    color: t.colors.text,
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
