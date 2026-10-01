/**
 * Change anything about one time entry — who worked it, which job, the day,
 * the hours, the note, whether it's charged — and approve or delete it.
 * Opened from the Timesheets screen. Waiting entries (sent in by crew) get
 * an Approve button; saving never approves on its own.
 */

import React, { useEffect, useState } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Text, Button, TextInput, Switch } from 'react-native-paper';
import { Calendar, DateData } from 'react-native-calendars';
import { format } from 'date-fns';

import { CREW_WORKER_PREFIX, type TimeEntry } from '../../shared/time/types';
import { crewIdOf, dateKeyDaysAgo, formatHours, isCounted, parseHoursInput } from '../../shared/time/hours';
import { StaleEntryError, timeEntryService } from '../services/timeEntryService';
import { useStore } from '../store/useStore';
import { useJobStore } from '../store/useJobStore';
import { activeCrew } from '../utils/crew';
import { makeStyles, useThemeColors } from '../theme';
import { BottomSheet } from './BottomSheet';
import { JobPicker } from './JobPicker';
import { useAlertModal } from '../hooks/useAlertModal';

interface TimeEntryEditSheetProps {
  entry: TimeEntry | null;
  onDismiss: () => void;
  onSaved: (entry: TimeEntry) => void;
  onDeleted: (id: string) => void;
  /** Crew changed or deleted it on their link since it loaded — reload. */
  onStale?: () => void;
}

export function TimeEntryEditSheet({ entry, onDismiss, onSaved, onDeleted, onStale }: TimeEntryEditSheetProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const { showAlert, dismissAlert, alertNode } = useAlertModal();
  const allCrew = useStore((s) => s.businessSettings?.crew);
  const businessName = useStore((s) => s.businessSettings?.businessName);
  const jobs = useJobStore((s) => s.jobs);

  const [crewId, setCrewId] = useState<string | null>(null);
  const [jobId, setJobId] = useState('');
  const [date, setDate] = useState(dateKeyDaysAgo(0));
  const [hoursText, setHoursText] = useState('');
  const [note, setNote] = useState('');
  const [billable, setBillable] = useState(true);
  const [pickingDay, setPickingDay] = useState(false);
  const [busy, setBusy] = useState<'save' | 'approve' | null>(null);

  useEffect(() => {
    if (!entry) return;
    setCrewId(crewIdOf(entry));
    setJobId(entry.jobId);
    setDate(entry.date);
    setHoursText(String(entry.hours));
    setNote(entry.note ?? '');
    setBillable(entry.billable !== false);
    setPickingDay(false);
  }, [entry?.id]);

  if (!entry) return null;
  const hours = parseHoursInput(hoursText);
  const waiting = !isCounted(entry);
  // Someone taken off the crew stays pickable on their own entries.
  const people = activeCrew(allCrew);
  const currentCrew = crewId && !people.some((c) => c.id === crewId)
    ? [{ id: crewId, name: allCrew?.find((c) => c.id === crewId)?.name || entry.workerName || 'Crew', createdAt: 0 }]
    : [];
  const crewName = (id: string) => allCrew?.find((c) => c.id === id)?.name || entry.workerName || 'Crew';

  const build = (approve: boolean): TimeEntry => {
    const job = jobs.find((j) => j.id === jobId);
    return {
      ...entry,
      jobId,
      documentId: job?.primaryDocumentId ?? (jobId === entry.jobId ? entry.documentId : undefined),
      date,
      hours: hours ?? entry.hours,
      note,
      billable,
      workerId: crewId ? `${CREW_WORKER_PREFIX}${crewId}` : entry.userId,
      workerName: crewId ? crewName(crewId) : businessName || undefined,
      ...(approve ? { status: 'approved' as const } : {}),
    };
  };

  const save = async (approve: boolean) => {
    if (hours === null || !jobId) return;
    setBusy(approve ? 'approve' : 'save');
    try {
      onSaved(await timeEntryService.updateEntry(build(approve), entry));
      onDismiss();
    } catch (err: any) {
      if (err instanceof StaleEntryError) {
        // Writing this copy would undo what they just changed on their link.
        onStale?.();
        showAlert({
          type: 'info',
          title: 'Those hours just changed',
          message: err.message,
          primaryButtonText: 'OK',
          primaryButtonAction: onDismiss,
        });
        return;
      }
      showAlert({ type: 'error', title: "Couldn't save that", message: err?.message || 'Try again in a moment.' });
    } finally {
      setBusy(null);
    }
  };

  const remove = () => {
    showAlert({
      type: 'warning',
      title: `Delete ${formatHours(entry.hours)}?`,
      message: 'It comes off the job, and off anything you bill from it later.',
      primaryButtonText: 'Delete',
      primaryKeepsOpen: true,
      primaryButtonAction: async () => {
        try {
          await timeEntryService.deleteEntry(entry.id);
        } catch (err: any) {
          showAlert({ type: 'error', title: "Couldn't delete that", message: err?.message || 'Try again in a moment.' });
          return;
        }
        dismissAlert();
        onDeleted(entry.id);
        onDismiss();
      },
      secondaryButtonText: 'Keep it',
      secondaryButtonAction: () => {},
    });
  };

  const dayLabel = (() => {
    if (date === dateKeyDaysAgo(0)) return 'Today';
    if (date === dateKeyDaysAgo(1)) return 'Yesterday';
    try {
      return format(new Date(`${date}T00:00:00`), 'EEE d MMM');
    } catch {
      return date;
    }
  })();

  return (
    <BottomSheet visible={!!entry} onDismiss={onDismiss} title={waiting ? 'Sent in — waiting for you' : 'Edit time'} scrollable>
      <View style={styles.content}>
        <Text style={styles.label}>Who worked it</Text>
        <View style={styles.chips}>
          <Chip label="You" active={crewId === null} onPress={() => setCrewId(null)} />
          {[...people, ...currentCrew].map((c) => (
            <Chip key={c.id} label={c.name} active={crewId === c.id} onPress={() => setCrewId(c.id)} />
          ))}
        </View>

        <Text style={styles.label}>Job</Text>
        <JobPicker jobs={jobs} value={jobId} onChange={setJobId} />

        <Text style={styles.label}>Day</Text>
        <Chip label={dayLabel} icon active onPress={() => setPickingDay((v) => !v)} a11yLabel="Day" />
        {pickingDay ? (
          <View style={styles.calendar}>
            <Calendar
              firstDay={1}
              current={date}
              maxDate={dateKeyDaysAgo(0)}
              markedDates={{ [date]: { selected: true, selectedColor: themeColors.accent } }}
              onDayPress={(d: DateData) => {
                setDate(d.dateString);
                setPickingDay(false);
              }}
              theme={{
                backgroundColor: 'transparent',
                calendarBackground: 'transparent',
                dayTextColor: themeColors.text,
                monthTextColor: themeColors.text,
                textSectionTitleColor: themeColors.textMuted,
                todayTextColor: themeColors.accent,
                arrowColor: themeColors.accent,
                textDisabledColor: themeColors.textDisabled,
                selectedDayTextColor: themeColors.alwaysLight,
              }}
              enableSwipeMonths
            />
          </View>
        ) : null}

        <Text style={styles.label}>Hours</Text>
        <TextInput
          value={hoursText}
          onChangeText={setHoursText}
          mode="outlined"
          dense
          keyboardType="decimal-pad"
          accessibilityLabel="Hours worked"
          error={hoursText.trim() !== '' && hours === null}
          style={styles.hours}
        />
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Note (optional)"
          mode="outlined"
          dense
          accessibilityLabel="Note"
          style={styles.note}
        />
        <View style={styles.switchRow}>
          <Text style={styles.switchTitle}>Charge for this time</Text>
          <Switch value={billable} onValueChange={setBillable} color={themeColors.accentText} accessibilityLabel="Charge for this time" />
        </View>

        {waiting ? (
          <Button
            mode="contained"
            buttonColor={themeColors.accent}
            textColor={themeColors.onAccent}
            onPress={() => save(true)}
            loading={busy === 'approve'}
            disabled={!!busy || hours === null || !jobId}
            style={styles.primary}
          >
            Approve
          </Button>
        ) : null}
        <Button
          mode={waiting ? 'outlined' : 'contained'}
          buttonColor={waiting ? undefined : themeColors.accent}
          textColor={waiting ? undefined : themeColors.onAccent}
          onPress={() => save(false)}
          loading={busy === 'save'}
          disabled={!!busy || hours === null || !jobId}
          style={styles.primary}
        >
          {waiting ? 'Save, keep waiting' : 'Save'}
        </Button>
        <Button mode="text" textColor={themeColors.error} onPress={remove} disabled={!!busy}>
          Delete
        </Button>
      </View>
      {alertNode}
    </BottomSheet>
  );
}

function Chip({ label, active, onPress, icon, a11yLabel }: { label: string; active: boolean; onPress: () => void; icon?: boolean; a11yLabel?: string }) {
  const styles = useStyles();
  return (
    <TouchableOpacity onPress={onPress} style={[styles.chip, active && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={a11yLabel ? `${a11yLabel}: ${label}` : undefined}>
      <Text style={[styles.chipText, active && styles.chipTextOn]}>
        {icon ? '📅  ' : ''}
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((t) => ({
  content: { gap: 8, paddingVertical: 4 },
  label: {
    fontSize: 12,
    color: t.colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
    marginLeft: 4,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surface,
  },
  chipOn: { backgroundColor: t.colors.accent, borderColor: t.colors.accent },
  chipText: { fontSize: 14, fontWeight: '600', color: t.colors.text },
  chipTextOn: { color: t.colors.onAccent },
  calendar: { borderRadius: 16, overflow: 'hidden', backgroundColor: t.colors.surface, paddingVertical: 4 },
  hours: { width: 120 },
  note: { marginTop: 4 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: 4 },
  switchTitle: { fontSize: 14, fontWeight: '600', color: t.colors.text },
  primary: { borderRadius: 12, marginTop: 6 },
}));
