/**
 * LogTimeSheet
 *
 * Log the hours actually worked on a Job, and see (edit / delete) what's
 * already logged. The summary pill sets logged time against the quote's
 * labour so an overrun is obvious before the invoice goes out.
 *
 * Deliberately small: a day, a number of hours, an optional note, and a
 * "charge for this" switch. No timer, no start/finish — tradies think in
 * "about 6 hours on Tuesday", and every extra field is one more reason not
 * to log it at all.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, TouchableOpacity, ScrollView } from 'react-native';
import { Text, Button, TextInput, Switch } from 'react-native-paper';
import { Calendar, DateData } from 'react-native-calendars';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { format } from 'date-fns';

import type { Job } from '../../shared/job/types';
import { CREW_WORKER_PREFIX, type TimeEntry } from '../../shared/time/types';
import type { Document } from '../types/document';
import {
  crewIdOf,
  dateKeyDaysAgo,
  formatHours,
  isCounted,
  parseHoursInput,
  sumBillableHours,
  sumHours,
} from '../../shared/time/hours';
import { StaleEntryError, timeEntryService } from '../services/timeEntryService';
import { hourlyRateOf, quotedHoursOf } from '../utils/loggedHours';
import { makeStyles, useThemeColors } from '../theme';
import { BottomSheet } from './BottomSheet';
import { useAlertModal } from '../hooks/useAlertModal';
import { useStore } from '../store/useStore';
import { activeCrew } from '../utils/crew';
import { useJobStore } from '../store/useJobStore';
import { JobPicker } from './JobPicker';

interface LogTimeSheetProps {
  visible: boolean;
  onDismiss: () => void;
  job: Job;
  primaryDoc: Document | null;
  entries: TimeEntry[];
  /** An entry was logged or edited — the job screen folds it into its list. */
  onSaved: (entry: TimeEntry) => void;
  /** An entry was deleted. */
  onDeleted: (id: string) => void;
  /** Everyone's hours, every job — the Timesheets screen. */
  onOpenTimesheets?: () => void;
  /** Crew changed or deleted hours on their link since this list loaded — reload it. */
  onStale?: () => void;
  workerName?: string;
}

const QUICK_HOURS = [1, 2, 4, 8];

function dayLabel(dateKey: string): string {
  if (dateKey === dateKeyDaysAgo(0)) return 'Today';
  if (dateKey === dateKeyDaysAgo(1)) return 'Yesterday';
  try {
    return format(new Date(`${dateKey}T00:00:00`), 'EEE d MMM');
  } catch {
    return dateKey;
  }
}

/** "from yesterday", "on Tue 23 Sep" — for sentences, not headings. */
function dayPhrase(dateKey: string): string {
  const label = dayLabel(dateKey);
  return label === 'Today' || label === 'Yesterday' ? `from ${label.toLowerCase()}` : `on ${label}`;
}

export function LogTimeSheet({
  visible,
  onDismiss,
  job,
  primaryDoc,
  entries,
  onSaved,
  onDeleted,
  onOpenTimesheets,
  onStale,
  workerName,
}: LogTimeSheetProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const { showAlert, dismissAlert, alertNode } = useAlertModal();
  const scrollRef = useRef<ScrollView>(null);

  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [date, setDate] = useState(() => dateKeyDaysAgo(0));
  const [hoursText, setHoursText] = useState('');
  const [note, setNote] = useState('');
  const [billable, setBillable] = useState(true);
  // null = the owner; otherwise the crew member it was worked by.
  const [crewId, setCrewId] = useState<string | null>(null);
  // Which job an entry being edited belongs to — moving it fixes hours
  // logged on the wrong job.
  const [editJobId, setEditJobId] = useState(job.id);
  const jobs = useJobStore((st) => st.jobs);
  const allCrew = useStore((st) => st.businessSettings?.crew);
  const crew = activeCrew(allCrew);
  const crewName = (id: string | null) => (id ? allCrew?.find((c) => c.id === id)?.name : undefined);
  const [pickingDay, setPickingDay] = useState(false);
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setEditing(null);
    setDate(dateKeyDaysAgo(0));
    setHoursText('');
    setNote('');
    setBillable(true);
    setCrewId(null);
    setEditJobId(job.id);
    setPickingDay(false);
  };

  useEffect(() => {
    if (visible) resetForm();
  }, [visible, job.id]);

  const hours = parseHoursInput(hoursText);
  const pending = entries.filter((e) => !isCounted(e));
  const counted = entries.filter(isCounted);
  // Name each row's worker once there's anyone besides the owner.
  const showWho = crew.length > 0 || entries.some((e) => crewIdOf(e));
  const whoLabel = (e: TimeEntry) => crewName(crewIdOf(e)) || (crewIdOf(e) ? e.workerName || 'Crew' : 'You');

  // Crew changed or deleted these hours on their link since the list loaded:
  // say so, drop the edit and fetch what's there now instead of writing
  // the old copy over it.
  const handleStale = (err: unknown) => {
    if (!(err instanceof StaleEntryError)) return false;
    resetForm();
    onStale?.();
    showAlert({ type: 'info', title: 'Those hours just changed', message: err.message });
    return true;
  };

  const handleApprove = async (entry: TimeEntry) => {
    try {
      onSaved(await timeEntryService.approveEntry(entry));
    } catch (err: any) {
      if (handleStale(err)) return;
      showAlert({ type: 'error', title: "Couldn't approve that", message: err?.message || 'Try again in a moment.' });
    }
  };
  const logged = sumHours(entries);
  const billableLogged = sumBillableHours(entries);
  // Only an hourly quote has hours to compare against — a lump-sum price
  // has none, and "0 h quoted" would read as a mistake.
  const quoted = primaryDoc && hourlyRateOf(primaryDoc) > 0 ? quotedHoursOf(primaryDoc) : null;

  const summary = useMemo(() => {
    const parts = [`${formatHours(logged)} logged`];
    if (quoted !== null && quoted > 0) parts.push(`${formatHours(quoted)} quoted`);
    if (billableLogged !== logged) parts.push(`${formatHours(logged - billableLogged)} not charged`);
    if (pending.length) parts.push(`${pending.length} waiting for you`);
    return parts.join(' · ');
  }, [logged, billableLogged, quoted, pending.length]);

  const over = quoted !== null && quoted > 0 && billableLogged > quoted;

  const startEdit = (entry: TimeEntry) => {
    setEditing(entry);
    setDate(entry.date);
    setHoursText(String(entry.hours));
    setNote(entry.note ?? '');
    setBillable(entry.billable !== false);
    setCrewId(crewIdOf(entry));
    setEditJobId(entry.jobId);
    setPickingDay(false);
    // The form is at the top and the tradie tapped a row further down —
    // without this the only sign anything happened is a thin border.
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const handleSave = async () => {
    if (hours === null) return;
    setSaving(true);
    try {
      if (editing) {
        onSaved(
          await timeEntryService.updateEntry({
            ...editing,
            jobId: editJobId,
            documentId:
              editJobId === editing.jobId
                ? editing.documentId
                : jobs.find((j) => j.id === editJobId)?.primaryDocumentId,
            date,
            hours,
            note,
            billable,
            workerId: crewId ? `${CREW_WORKER_PREFIX}${crewId}` : editing.userId,
            workerName: crewId ? crewName(crewId) : workerName,
          }),
        );
        resetForm();
      } else {
        const created = await timeEntryService.createEntry({
          jobId: job.id,
          documentId: primaryDoc?.id,
          date,
          hours,
          note,
          billable,
          workerName: crewId ? crewName(crewId) : workerName,
          crewMemberId: crewId ?? undefined,
          source: 'manual',
        });
        onSaved(created);
        // One entry is the usual visit — close, and the job's time row
        // shows the new total. Editing keeps the sheet open.
        onDismiss();
      }
    } catch (err: any) {
      if (handleStale(err)) return;
      showAlert({
        type: 'error',
        title: "Couldn't save that",
        message: err?.message || 'Try again in a moment.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (entry: TimeEntry) => {
    showAlert({
      type: 'warning',
      title: `Delete ${formatHours(entry.hours)} ${dayPhrase(entry.date)}?`,
      message: 'It comes off this job, and off anything you bill from it later.',
      primaryButtonText: 'Delete',
      // Kept open so a failure can replace this prompt with an error the
      // tradie actually sees, instead of the modal closing on nothing.
      primaryKeepsOpen: true,
      primaryButtonAction: async () => {
        try {
          await timeEntryService.deleteEntry(entry.id);
        } catch (err: any) {
          showAlert({
            type: 'error',
            title: "Couldn't delete that",
            message: err?.message || 'Try again in a moment.',
          });
          return;
        }
        dismissAlert();
        if (editing?.id === entry.id) resetForm();
        onDeleted(entry.id);
      },
      secondaryButtonText: 'Keep it',
      secondaryButtonAction: () => {},
    });
  };

  const yesterday = dateKeyDaysAgo(1);
  const today = dateKeyDaysAgo(0);
  const pickedOtherDay = date !== today && date !== yesterday;

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      title={editing ? 'Edit time' : 'Log time'}
      subtitle={job.name || undefined}
      scrollable
      scrollRef={scrollRef}
    >
      <View style={styles.content}>
        <View style={styles.summaryPill}>
          <MaterialCommunityIcons
            name={'clock-outline' as any}
            size={16}
            color={over ? themeColors.warning : themeColors.accent}
          />
          <Text style={styles.summaryText}>{summary}</Text>
        </View>
        {onOpenTimesheets ? (
          <TouchableOpacity onPress={onOpenTimesheets} style={styles.allLink} accessibilityRole="button">
            <MaterialCommunityIcons name="calendar-clock" size={16} color={themeColors.accentText} />
            <Text style={styles.allLinkText}>See all timesheets — every job, by week</Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color={themeColors.accentText} />
          </TouchableOpacity>
        ) : null}

        {/* Crew send-ins first: the push lands here to approve them. */}
        {pending.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Sent in — waiting for you</Text>
            {pending.map((entry) => (
              <TouchableOpacity
                key={entry.id}
                style={[styles.entryRow, styles.pendingRow, editing?.id === entry.id && styles.entryRowActive]}
                onPress={() => startEdit(entry)}
                accessibilityLabel={`Edit ${formatHours(entry.hours)} from ${whoLabel(entry)} on ${dayLabel(entry.date)}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.entryTitle}>
                    {whoLabel(entry)} · {dayLabel(entry.date)} · {formatHours(entry.hours)}
                  </Text>
                  {entry.note ? (
                    <Text style={styles.entryNote} numberOfLines={2}>
                      {entry.note}
                    </Text>
                  ) : null}
                </View>
                <Button
                  mode="contained-tonal"
                  compact
                  onPress={() => handleApprove(entry)}
                  accessibilityLabel={`Approve ${formatHours(entry.hours)} from ${whoLabel(entry)}`}
                >
                  Approve
                </Button>
                <TouchableOpacity
                  onPress={() => handleDelete(entry)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityLabel="Delete entry"
                >
                  <MaterialCommunityIcons name="trash-can-outline" size={20} color={themeColors.textMuted} />
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {editing ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Job</Text>
            <JobPicker jobs={jobs} value={editJobId} onChange={setEditJobId} />
          </View>
        ) : null}

        {crew.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Who worked it</Text>
            <View style={styles.chipRow}>
              <Chip label="You" active={crewId === null} onPress={() => setCrewId(null)} />
              {crew.map((c) => (
                <Chip key={c.id} label={c.name} active={crewId === c.id} onPress={() => setCrewId(c.id)} />
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Day</Text>
          <View style={styles.chipRow}>
            {[
              { key: today, label: 'Today' },
              { key: yesterday, label: 'Yesterday' },
            ].map((opt) => (
              <Chip
                key={opt.key}
                label={opt.label}
                active={date === opt.key && !pickingDay}
                onPress={() => {
                  setDate(opt.key);
                  setPickingDay(false);
                }}
              />
            ))}
            <Chip
              label={pickedOtherDay ? dayLabel(date) : 'Other day'}
              icon="calendar-outline"
              active={pickedOtherDay || pickingDay}
              onPress={() => setPickingDay((v) => !v)}
            />
          </View>
          {pickingDay ? (
            <View style={styles.calendarCard}>
              <Calendar
                firstDay={1}
                current={date}
                maxDate={today}
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
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Hours</Text>
          <View style={styles.hoursRow}>
            <TextInput
              value={hoursText}
              onChangeText={setHoursText}
              placeholder="e.g. 7.5"
              mode="outlined"
              dense
              keyboardType="decimal-pad"
              style={styles.hoursInput}
              accessibilityLabel="Hours worked"
              error={hoursText.trim() !== '' && hours === null}
            />
            {QUICK_HOURS.map((h) => (
              <Chip key={h} label={`${h}h`} active={hours === h} onPress={() => setHoursText(String(h))} />
            ))}
          </View>
          {hoursText.trim() !== '' && hours === null ? (
            <Text style={styles.errorText}>Enter hours up to 24, like 7.5.</Text>
          ) : null}
        </View>

        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Note (optional) — e.g. rough-in, second fix"
          mode="outlined"
          dense
          style={styles.noteInput}
          accessibilityLabel="Note"
        />

        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchTitle}>Charge for this time</Text>
            <Text style={styles.switchSub}>
              Turn off for a warranty callback or a quote visit — it's kept, never invoiced.
            </Text>
          </View>
          <Switch
            value={billable}
            onValueChange={setBillable}
            color={themeColors.accentText}
            accessibilityLabel="Charge for this time"
          />
        </View>

        <View style={styles.buttonStack}>
          <Button
            mode="contained"
            buttonColor={themeColors.accent}
            textColor={themeColors.onAccent}
            onPress={handleSave}
            disabled={hours === null || saving}
            loading={saving}
            style={styles.primaryButton}
            contentStyle={styles.primaryButtonContent}
          >
            {editing ? (isCounted(editing) ? 'Save changes' : 'Save, keep waiting') : hours !== null ? `Log ${formatHours(hours)}` : 'Log time'}
          </Button>
          {editing ? (
            <Button mode="text" onPress={resetForm} disabled={saving}>
              Cancel edit
            </Button>
          ) : null}
        </View>

        {counted.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Logged on this job</Text>
            {counted.map((entry) => (
              <TouchableOpacity
                key={entry.id}
                style={[styles.entryRow, editing?.id === entry.id && styles.entryRowActive]}
                onPress={() => startEdit(entry)}
                accessibilityLabel={`Edit ${formatHours(entry.hours)} on ${dayLabel(entry.date)}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.entryTitle}>
                    {showWho ? `${whoLabel(entry)} · ` : ''}
                    {dayLabel(entry.date)} · {formatHours(entry.hours)}
                    {entry.billable === false ? ' · not charged' : ''}
                  </Text>
                  {entry.note ? (
                    <Text style={styles.entryNote} numberOfLines={2}>
                      {entry.note}
                    </Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  onPress={() => handleDelete(entry)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityLabel="Delete entry"
                >
                  <MaterialCommunityIcons name="trash-can-outline" size={20} color={themeColors.textMuted} />
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </View>
      {alertNode}
    </BottomSheet>
  );
}

function Chip({
  label,
  active,
  onPress,
  icon,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon?: string;
}) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      {icon ? (
        <MaterialCommunityIcons
          name={icon as any}
          size={14}
          color={active ? themeColors.onAccent : themeColors.textMuted}
        />
      ) : null}
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((t) => ({
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
    backgroundColor: t.colors.surfacePressed,
  },
  summaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.text,
    flexShrink: 1,
  },
  section: {
    gap: 6,
  },
  sectionLabel: {
    fontSize: 12,
    color: t.colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginLeft: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  // 44pt minimum — these get tapped with work gloves on.
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 44,
    minWidth: 52,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surface,
  },
  chipActive: {
    backgroundColor: t.colors.accent,
    borderColor: t.colors.accent,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.text,
  },
  chipTextActive: {
    color: t.colors.onAccent,
  },
  calendarCard: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: t.colors.surface,
    paddingVertical: 4,
  },
  hoursRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  hoursInput: {
    width: 96,
  },
  errorText: {
    fontSize: 12,
    color: t.colors.error,
    marginLeft: 4,
  },
  noteInput: {},
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 4,
  },
  switchTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.text,
  },
  switchSub: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 2,
    lineHeight: 16,
  },
  buttonStack: {
    gap: 4,
  },
  primaryButton: {
    borderRadius: 12,
  },
  primaryButtonContent: {
    paddingVertical: 4,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: t.colors.surface,
  },
  allLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 4,
  },
  allLinkText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.accentText,
  },
  pendingRow: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: t.colors.warning,
  },
  entryRowActive: {
    borderWidth: 1,
    borderColor: t.colors.accent,
  },
  entryTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.text,
  },
  entryNote: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 2,
  },
}));
