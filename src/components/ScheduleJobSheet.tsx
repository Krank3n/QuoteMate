/**
 * Schedule Job Sheet
 * Bottom sheet with a calendar for picking / clearing a Job's
 * scheduledStartDate. Phase 13 deliberately stays to tap-to-edit — no
 * drag-to-reschedule — so the UX is obvious and predictable.
 *
 * Setting a date doesn't change job.stage on its own. The tradie can move
 * the job to 'scheduled' via the stage sheet separately if they like.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { Calendar, DateData } from 'react-native-calendars';
import { format } from 'date-fns';

import type { Job } from '../../shared/job/types';
import { colors } from '../theme';
import { BottomSheet } from './BottomSheet';
import { useJobStore } from '../store/useJobStore';

interface ScheduleJobSheetProps {
  visible: boolean;
  onDismiss: () => void;
  job: Job;
}

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
};

function toIsoDay(ms?: number): string | undefined {
  if (!ms) return undefined;
  try {
    return format(new Date(ms), 'yyyy-MM-dd');
  } catch {
    return undefined;
  }
}

function fromIsoDay(iso: string): number {
  // Interpret the ISO date as local midnight — the user picked "this day",
  // not "this UTC instant". new Date(iso) without a time parses as local
  // midnight on web and native, which is what we want.
  const d = new Date(`${iso}T00:00:00`);
  return d.getTime();
}

export function ScheduleJobSheet({ visible, onDismiss, job }: ScheduleJobSheetProps) {
  const saveJob = useJobStore((s) => s.saveJob);
  const selected = toIsoDay(job.scheduledStartDate);

  const markedDates = selected
    ? {
        [selected]: {
          selected: true,
          selectedColor: colors.primary,
          selectedTextColor: colors.white,
        },
      }
    : {};

  const handleDayPress = async (day: DateData) => {
    await saveJob({ ...job, scheduledStartDate: fromIsoDay(day.dateString) });
    onDismiss();
  };

  const handleClear = async () => {
    await saveJob({ ...job, scheduledStartDate: undefined });
    onDismiss();
  };

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      title="Schedule job"
      subtitle={
        selected
          ? `Currently ${format(new Date(job.scheduledStartDate || 0), 'EEE d MMM yyyy')}`
          : 'Pick a start date'
      }
    >
      <View style={styles.content}>
        <Calendar
          theme={CALENDAR_THEME}
          markedDates={markedDates}
          onDayPress={handleDayPress}
          firstDay={1}
          current={selected}
          style={styles.calendar}
        />

        <View style={styles.actionRow}>
          {selected ? (
            <Button
              mode="outlined"
              onPress={handleClear}
              icon={'calendar-remove-outline' as any}
              style={styles.actionButton}
              textColor={colors.error}
            >
              Clear date
            </Button>
          ) : (
            <Text style={styles.helper}>Tap a day to schedule.</Text>
          )}
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingVertical: 8,
    gap: 16,
  },
  calendar: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  actionButton: {
    borderRadius: 12,
  },
  helper: {
    fontSize: 13,
    color: colors.textMuted,
  },
});
