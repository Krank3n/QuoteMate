/**
 * Jobs Calendar Screen
 *
 * Month view of jobs plotted by their scheduledStartDate. Tap a day to see
 * jobs starting that day. Tap a job to open ViewJob. The FAB and
 * NewJobSheet mirror JobsListScreen so the create-new flow works from
 * either view.
 *
 * Phase 13 is intentionally narrow: no drag-to-reschedule, no multi-day
 * spans. Scheduling still happens via ScheduleJobSheet (tap-to-edit).
 */

import React, { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, FAB } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Calendar, DateData } from 'react-native-calendars';
import { useNavigation } from '@react-navigation/native';
import { format } from 'date-fns';

import type { Job } from '../../shared/job/types';
import { useJobStore } from '../store/useJobStore';
import { colors } from '../theme';
import { WebContainer } from '../components/WebContainer';
import { JobCard } from '../components/JobCard';
import { JobStageSheet, JOB_STAGE_META } from '../components/JobStageSheet';
import { NewJobSheet } from '../components/NewJobSheet';
import { lightTap } from '../utils/haptics';

const CALENDAR_THEME = {
  backgroundColor: colors.surface,
  calendarBackground: colors.surface,
  textSectionTitleColor: colors.textMuted,
  dayTextColor: colors.text,
  todayTextColor: colors.primary,
  selectedDayTextColor: colors.white,
  selectedDayBackgroundColor: colors.primary,
  monthTextColor: colors.text,
  arrowColor: colors.primary,
  textDisabledColor: colors.inactive,
  textMonthFontWeight: '700' as const,
  textDayFontWeight: '500' as const,
  textDayHeaderFontWeight: '600' as const,
  textMonthFontSize: 15,
  textDayFontSize: 14,
  textDayHeaderFontSize: 12,
  dotColor: colors.primary,
};

function toIsoDay(ms?: number): string | undefined {
  if (!ms) return undefined;
  try {
    return format(new Date(ms), 'yyyy-MM-dd');
  } catch {
    return undefined;
  }
}

export function JobsCalendarScreen() {
  const navigation = useNavigation<any>();
  const jobs = useJobStore((s) => s.jobs);

  const [selected, setSelected] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [stageSheetJob, setStageSheetJob] = useState<Job | null>(null);
  const [newJobSheetVisible, setNewJobSheetVisible] = useState(false);

  // Bucket scheduled jobs by ISO day so the marker map is cheap to compute
  // and the day-detail list is a lookup rather than a filter.
  const { marked, byDay } = useMemo(() => {
    const m: Record<string, { marked: boolean; dotColor: string }> = {};
    const by: Record<string, Job[]> = {};
    for (const job of jobs) {
      const iso = toIsoDay(job.scheduledStartDate);
      if (!iso) continue;
      m[iso] = { marked: true, dotColor: JOB_STAGE_META[job.stage]?.color || colors.primary };
      by[iso] = by[iso] ? [...by[iso], job] : [job];
    }
    return { marked: m, byDay: by };
  }, [jobs]);

  const markedWithSelection = useMemo(() => {
    const existing = marked[selected] || {};
    return {
      ...marked,
      [selected]: {
        ...existing,
        selected: true,
        selectedColor: colors.primary,
        selectedTextColor: colors.white,
      },
    };
  }, [marked, selected]);

  const jobsForSelected = byDay[selected] || [];
  const label = format(new Date(`${selected}T00:00:00`), 'EEEE d MMMM');

  const handleSaveJobStage = async (targetStage: Job['stage']) => {
    if (!stageSheetJob) return;
    const job = stageSheetJob;
    setStageSheetJob(null);
    await useJobStore.getState().saveJob({ ...job, stage: targetStage });
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <WebContainer>
          <Calendar
            theme={CALENDAR_THEME}
            firstDay={1}
            current={selected}
            markedDates={markedWithSelection}
            onDayPress={(day: DateData) => {
              lightTap();
              setSelected(day.dateString);
            }}
            style={styles.calendar}
          />
        </WebContainer>

        <WebContainer style={styles.daySection}>
          <Text style={styles.dayTitle}>{label}</Text>

          {jobsForSelected.length === 0 ? (
            <View style={styles.empty}>
              <MaterialCommunityIcons
                name={'calendar-blank-outline' as any}
                size={28}
                color={colors.textMuted}
              />
              <Text style={styles.emptyText}>No jobs scheduled for this day.</Text>
            </View>
          ) : (
            jobsForSelected.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onPress={(jobId) => navigation.navigate('ViewJob', { jobId })}
                onStagePress={setStageSheetJob}
              />
            ))
          )}
        </WebContainer>
      </ScrollView>

      <FAB
        icon="plus"
        style={styles.fab}
        onPress={() => {
          lightTap();
          setNewJobSheetVisible(true);
        }}
        color={colors.white}
        accessibilityLabel="Create new job"
      />

      {stageSheetJob ? (
        <JobStageSheet
          visible={true}
          onDismiss={() => setStageSheetJob(null)}
          job={stageSheetJob}
          onSelect={handleSaveJobStage}
        />
      ) : null}

      <NewJobSheet
        visible={newJobSheetVisible}
        onDismiss={() => setNewJobSheetVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { paddingBottom: 100 },
  calendar: {
    margin: 16,
    borderRadius: 16,
    overflow: 'hidden',
  },
  daySection: {
    paddingHorizontal: 16,
  },
  dayTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 96,
    backgroundColor: colors.primary,
  },
});
