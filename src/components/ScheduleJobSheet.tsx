/**
 * ScheduleJobSheet
 *
 * Day + start-time picker for a Job's scheduledStartDate, plus a
 * shortcut to open the event pre-filled in Google Calendar. Duration is
 * NOT collected here — it's derived from the linked Document's labor
 * (the tradie types it once on the quote). The "Open in Google
 * Calendar" link sizes the GCal event from that derived duration.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, Linking, Alert } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { Calendar, DateData } from 'react-native-calendars';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { format } from 'date-fns';

import type { Job } from '../../shared/job/types';
import { useStore } from '../store/useStore';
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
import { deriveDuration } from '../utils/deriveDuration';
import { useGoogleCalendarAuth } from '../services/googleCalendarAuth';

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
  // Look up the job's primary attached document so we can derive the GCal
  // event duration from quoted labor instead of asking the tradie again.
  const primaryDoc = useStore((s) =>
    job.primaryDocumentId
      ? s.documents.find((d) => d.id === job.primaryDocumentId)
      : s.documents.find((d) => d.jobId === job.id),
  );
  const derived = useMemo(() => deriveDuration(primaryDoc), [primaryDoc]);
  // When the user has connected Google Calendar via Settings, the
  // server-side trigger pushes the event automatically — we don't need
  // the deeplink button. When they haven't, the deeplink stays as the
  // zero-OAuth escape hatch.
  const { connection: gcalConnection } = useGoogleCalendarAuth();
  const gcalConnected = !!gcalConnection;

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
    const timePart = pendingMinutes == null ? 'All day' : formatMinutes(pendingMinutes);
    return `${dayLabel} · ${timePart}`;
  }, [pendingDay, pendingMinutes]);

  const durationLabel = useMemo(() => {
    const { durationDays, hoursPerDay } = derived;
    if (durationDays === 1 && hoursPerDay === 8 && !primaryDoc) return null;
    const days = `${durationDays} ${durationDays === 1 ? 'day' : 'days'}`;
    return `${days} · ${hoursPerDay}h/day (from quote)`;
  }, [derived, primaryDoc]);

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
      const updated: Job = { ...job, scheduledStartDate: next };
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
    // Persist any pending edits first so what the tradie sees in GCal
    // matches what's on the job.
    const target: Job = dirty && pendingDay ? ((await handleSave()) ?? job) : job;
    if (!target.scheduledStartDate) {
      Alert.alert('Pick a date first', 'Choose a day before opening Google Calendar.');
      return;
    }
    const url = buildGoogleCalendarUrl(target, primaryDoc);
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
      await saveJob({
        ...job,
        scheduledStartDate: undefined,
        scheduledEndDate: undefined,
      });
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

        {durationLabel ? (
          <View style={styles.derivedRow}>
            <MaterialCommunityIcons
              name={'timer-sand' as any}
              size={14}
              color={colors.textMuted}
            />
            <Text style={styles.derivedText}>{durationLabel}</Text>
          </View>
        ) : null}

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

          {gcalConnected ? (
            <View style={styles.gcalSyncedRow}>
              <MaterialCommunityIcons
                name={'calendar-check' as any}
                size={14}
                color={colors.success}
              />
              <Text style={styles.gcalSyncedLabel}>
                Auto-syncs to your Google Calendar
              </Text>
            </View>
          ) : (
            <Button
              mode="outlined"
              onPress={handleOpenInGoogleCalendar}
              disabled={!pendingDay || saving}
              icon={'google' as any}
              style={styles.gcalButton}
            >
              Open in Google Calendar
            </Button>
          )}

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
  derivedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  derivedText: {
    fontSize: 12,
    color: colors.textMuted,
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
  gcalSyncedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  gcalSyncedLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.success,
  },
});
