/**
 * ScheduleJobSheet
 *
 * Day + time picker for a Job's scheduledStartDate, plus a shortcut to
 * open the event pre-filled in Google Calendar. The in-app picker stays
 * minimal — tradies pick a day + a half-hour slot, we store the
 * timestamp, and if they want reminders / customer invites / the full
 * calendar experience they open it in GCal.
 *
 * The sheet keeps picks local until the tradie taps Save — swapping a
 * day or a time chip no longer writes the job immediately, so "pick a
 * day, then set a time" works as a single motion.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, Linking, Alert } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { Calendar, DateData } from 'react-native-calendars';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { format } from 'date-fns';

import type { Job } from '../../shared/job/types';
import { colors } from '../theme';
import { BottomSheet } from './BottomSheet';
import { useJobStore } from '../store/useJobStore';
import {
  TimeSlotPicker,
  minutesFromTimestamp,
  combineDayAndMinutes,
  formatMinutes,
} from './TimeSlotPicker';
import { buildGoogleCalendarUrl } from '../utils/gcalUrl';

interface ScheduleJobSheetProps {
  visible: boolean;
  onDismiss: () => void;
  job: Job;
}

const CALENDAR_THEME = {
  backgroundColor: 'transparent',
  calendarBackground: 'transparent',
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
  textMonthFontSize: 16,
  textDayFontSize: 14,
  textDayHeaderFontSize: 11,
};

function toIsoDay(ms?: number): string | undefined {
  if (!ms) return undefined;
  try {
    return format(new Date(ms), 'yyyy-MM-dd');
  } catch {
    return undefined;
  }
}

export function ScheduleJobSheet({ visible, onDismiss, job }: ScheduleJobSheetProps) {
  const saveJob = useJobStore((s) => s.saveJob);

  const [pendingDay, setPendingDay] = useState<string | undefined>(() =>
    toIsoDay(job.scheduledStartDate),
  );
  const [pendingMinutes, setPendingMinutes] = useState<number | null>(() =>
    minutesFromTimestamp(job.scheduledStartDate),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setPendingDay(toIsoDay(job.scheduledStartDate));
      setPendingMinutes(minutesFromTimestamp(job.scheduledStartDate));
      setSaving(false);
    }
  }, [visible, job.id, job.scheduledStartDate]);

  const markedDates = useMemo(() => {
    if (!pendingDay) return {};
    return {
      [pendingDay]: {
        selected: true,
        selectedColor: colors.primary,
        selectedTextColor: colors.white,
      },
    };
  }, [pendingDay]);

  const pendingSummary = useMemo(() => {
    if (!pendingDay) return 'Pick a day';
    const dayLabel = format(new Date(`${pendingDay}T00:00:00`), 'EEE d MMM');
    return pendingMinutes == null
      ? `${dayLabel} · All day`
      : `${dayLabel} · ${formatMinutes(pendingMinutes)}`;
  }, [pendingDay, pendingMinutes]);

  const dirty =
    (pendingDay || undefined) !== toIsoDay(job.scheduledStartDate) ||
    pendingMinutes !== minutesFromTimestamp(job.scheduledStartDate);

  const handleDayPress = (day: DateData) => {
    setPendingDay(day.dateString);
  };

  const handleSave = async (): Promise<Job | null> => {
    if (!pendingDay) return null;
    setSaving(true);
    try {
      const next = combineDayAndMinutes(pendingDay, pendingMinutes);
      const updated = { ...job, scheduledStartDate: next };
      await saveJob(updated);
      return updated;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndClose = async () => {
    const updated = await handleSave();
    if (updated) onDismiss();
  };

  const handleOpenInGoogleCalendar = async () => {
    // If the tradie changed date / time in the sheet but hasn't hit Save,
    // persist first so what they see in GCal matches what's on the job.
    const target: Job = dirty && pendingDay ? ((await handleSave()) ?? job) : job;
    if (!target.scheduledStartDate) {
      Alert.alert('Pick a date first', 'Choose a day before opening Google Calendar.');
      return;
    }
    const url = buildGoogleCalendarUrl(target);
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      Alert.alert("Couldn't open Google Calendar", 'Copy the link from the URL bar instead.');
      return;
    }
    await Linking.openURL(url);
    onDismiss();
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await saveJob({ ...job, scheduledStartDate: undefined });
      onDismiss();
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} title="Schedule job">
      <View style={styles.content}>
        <View style={styles.summaryPill}>
          <MaterialCommunityIcons
            name={'calendar-clock' as any}
            size={16}
            color={pendingDay ? colors.primary : colors.textMuted}
          />
          <Text
            style={[
              styles.summaryText,
              pendingDay && { color: colors.text, fontWeight: '700' },
            ]}
          >
            {pendingSummary}
          </Text>
        </View>

        <View style={styles.calendarCard}>
          <Calendar
            theme={CALENDAR_THEME}
            firstDay={1}
            current={pendingDay}
            markedDates={markedDates}
            onDayPress={handleDayPress}
            enableSwipeMonths
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Start time</Text>
          <TimeSlotPicker value={pendingMinutes} onChange={setPendingMinutes} />
        </View>

        <View style={styles.buttonStack}>
          <Button
            mode="contained"
            onPress={handleSaveAndClose}
            disabled={!pendingDay || !dirty || saving}
            loading={saving}
            style={styles.primaryButton}
            contentStyle={styles.primaryButtonContent}
          >
            Save
          </Button>

          <Button
            mode="outlined"
            onPress={handleOpenInGoogleCalendar}
            disabled={!pendingDay || saving}
            icon={'google' as any}
            style={styles.gcalButton}
          >
            Open in Google Calendar
          </Button>

          {job.scheduledStartDate ? (
            <Button
              mode="text"
              onPress={handleClear}
              icon={'calendar-remove-outline' as any}
              textColor={colors.error}
              disabled={saving}
            >
              Clear date
            </Button>
          ) : null}
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingVertical: 4,
    gap: 12,
  },
  summaryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.surfaceGray3,
    alignSelf: 'stretch',
  },
  summaryText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  calendarCard: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.surfaceDark,
    paddingVertical: 4,
  },
  section: {
    gap: 4,
  },
  sectionLabel: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginLeft: 4,
  },
  buttonStack: {
    gap: 8,
    marginTop: 4,
  },
  primaryButton: {
    borderRadius: 12,
  },
  primaryButtonContent: {
    paddingVertical: 4,
  },
  gcalButton: {
    borderRadius: 12,
    borderColor: colors.border,
  },
});
