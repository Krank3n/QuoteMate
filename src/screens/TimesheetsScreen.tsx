/**
 * Timesheets — everyone's hours across every job, a week at a time.
 *
 * The per-job Log time sheet answers "how long did this job take"; this
 * answers "what did everyone work this week". Every entry opens the editor
 * (who, job, day, hours, note, charged), and crew send-ins can be approved
 * one at a time or all at once. Opened from the job screen's time sheet,
 * Settings and Crew.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, TouchableOpacity, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { format } from 'date-fns';

import type { TimeEntry } from '../../shared/time/types';
import { addDaysKey, dateKeyDaysAgo, formatHours, isCounted, weekStartKey } from '../../shared/time/hours';
import { timeEntryService } from '../services/timeEntryService';
import { useStore } from '../store/useStore';
import { useJobStore } from '../store/useJobStore';
import { activeCrew } from '../utils/crew';
import { buildTimesheetWeek } from '../utils/timesheetWeek';
import { makeStyles, useThemeColors } from '../theme';
import { WebContainer } from '../components/WebContainer';
import { GridBackground } from '../components/GridBackground';
import { TimeEntryEditSheet } from '../components/TimeEntryEditSheet';
import { useAlertModal } from '../hooks/useAlertModal';

const dayName = (key: string) => {
  try {
    return format(new Date(`${key}T00:00:00`), 'EEE d');
  } catch {
    return key;
  }
};
const shortDate = (key: string) => format(new Date(`${key}T00:00:00`), 'd MMM');

export function TimesheetsScreen() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const navigation = useNavigation<any>();
  const { showAlert, alertNode } = useAlertModal();
  const crew = useStore((s) => s.businessSettings?.crew);
  const jobs = useJobStore((s) => s.jobs);

  const thisWeek = weekStartKey(dateKeyDaysAgo(0));
  const [start, setStart] = useState(thisWeek);
  const [filter, setFilter] = useState('all');
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [approving, setApproving] = useState(false);

  const load = useCallback(() => {
    timeEntryService.listRange(start, addDaysKey(start, 6)).then((list) => {
      if (list) {
        setEntries(list);
        setFailed(false);
      } else {
        setFailed(true);
      }
    });
  }, [start]);
  useFocusEffect(load);

  const week = useMemo(() => buildTimesheetWeek(entries ?? [], crew, filter), [entries, crew, filter]);
  const jobName = (id: string) => {
    const j = jobs.find((x) => x.id === id);
    return j ? [j.customerName, j.name].filter(Boolean).join(' — ') || 'Untitled job' : 'Job no longer on file';
  };
  const people = activeCrew(crew);

  const upsert = (e: TimeEntry) =>
    setEntries((prev) => {
      const rest = (prev ?? []).filter((x) => x.id !== e.id);
      // Moved out of this week? Then it's not on this page any more.
      return e.date >= start && e.date <= addDaysKey(start, 6) ? [e, ...rest] : rest;
    });

  const approveAll = async () => {
    setApproving(true);
    try {
      for (const e of week.waiting) upsert(await timeEntryService.approveEntry(e));
    } catch (err: any) {
      showAlert({ type: 'error', title: "Couldn't approve them all", message: err?.message || 'Try again in a moment.' });
    } finally {
      setApproving(false);
    }
  };

  return (
    <View style={styles.host}>
      <GridBackground />
      <ScrollView style={styles.scroller}>
        <WebContainer>
          <View style={styles.content}>
            <View style={styles.weekbar}>
              <TouchableOpacity style={styles.arrow} onPress={() => setStart(addDaysKey(start, -7))} accessibilityLabel="Previous week">
                <MaterialCommunityIcons name="chevron-left" size={26} color={themeColors.text} />
              </TouchableOpacity>
              <View style={{ alignItems: 'center' }}>
                <Text style={styles.weekTitle}>{start === thisWeek ? 'This week' : `Week of ${shortDate(start)}`}</Text>
                <Text style={styles.weekSub}>
                  {`${shortDate(start)} – ${shortDate(addDaysKey(start, 6))} · ${formatHours(week.total)}`}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.arrow, start >= thisWeek && styles.arrowOff]}
                disabled={start >= thisWeek}
                onPress={() => setStart(addDaysKey(start, 7))}
                accessibilityLabel="Next week"
              >
                <MaterialCommunityIcons name="chevron-right" size={26} color={themeColors.text} />
              </TouchableOpacity>
            </View>

            {people.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
                {[{ id: 'all', name: 'Everyone' }, { id: 'me', name: 'You' }, ...people].map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.filter, filter === p.id && styles.filterOn]}
                    onPress={() => setFilter(p.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: filter === p.id }}
                  >
                    <Text style={[styles.filterText, filter === p.id && styles.filterTextOn]}>{p.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : null}

            {week.waiting.length > 0 ? (
              <View style={styles.waitingBar}>
                <MaterialCommunityIcons name="clock-alert-outline" size={20} color={themeColors.warning} />
                <Text style={styles.waitingText}>
                  {week.waiting.length === 1 ? '1 sent in, waiting for you' : `${week.waiting.length} sent in, waiting for you`}
                </Text>
                <Button mode="contained" compact buttonColor={themeColors.accent} textColor={themeColors.onAccent} onPress={approveAll} loading={approving} disabled={approving}>
                  Approve all
                </Button>
              </View>
            ) : null}

            {failed && !entries ? (
              <TouchableOpacity style={styles.empty} onPress={load}>
                <Text style={styles.emptyText}>Couldn't load this week. Tap to try again.</Text>
              </TouchableOpacity>
            ) : entries && week.people.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No hours logged this week.</Text>
                <Text style={styles.emptySub}>Log time from a job, or send your crew their link from Settings → Crew.</Text>
              </View>
            ) : null}

            {week.people.map((p) => (
              <View key={p.key} style={styles.person}>
                <View style={styles.personHead}>
                  <Text style={styles.personName}>{p.name}</Text>
                  <Text style={styles.personTotal}>{formatHours(p.total)}</Text>
                </View>
                {p.entries.map((e) => {
                  const waiting = !isCounted(e);
                  return (
                    <TouchableOpacity
                      key={e.id}
                      style={[styles.row, waiting && styles.rowWaiting]}
                      onPress={() => setEditing(e)}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${formatHours(e.hours)} on ${dayName(e.date)}, ${jobName(e.jobId)}`}
                    >
                      <Text style={styles.rowDay}>{dayName(e.date)}</Text>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.rowJob} numberOfLines={1}>{jobName(e.jobId)}</Text>
                        {e.note || waiting || e.billable === false ? (
                          <Text style={[styles.rowSub, waiting && { color: themeColors.warning }]} numberOfLines={1}>
                            {[waiting ? 'Waiting for you' : null, e.billable === false ? 'Not charged' : null, e.note || null].filter(Boolean).join(' · ')}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={styles.rowHours}>{formatHours(e.hours)}</Text>
                      <MaterialCommunityIcons name="pencil-outline" size={18} color={themeColors.textMuted} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        </WebContainer>
      </ScrollView>

      <TimeEntryEditSheet
        entry={editing}
        onDismiss={() => setEditing(null)}
        onSaved={upsert}
        onDeleted={(id) => setEntries((prev) => (prev ?? []).filter((x) => x.id !== id))}
      />
      {alertNode}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  host: { flex: 1, backgroundColor: t.colors.bg },
  scroller: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 16, paddingBottom: 48, gap: 12 },
  weekbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceRaised,
  },
  arrowOff: { opacity: 0.35 },
  weekTitle: { fontSize: 17, fontWeight: '700', color: t.colors.text },
  weekSub: { fontSize: 13, color: t.colors.textMuted, marginTop: 2 },
  filters: { gap: 8, paddingVertical: 2 },
  filter: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceRaised,
  },
  filterOn: { backgroundColor: t.colors.accent, borderColor: t.colors.accent },
  filterText: { fontSize: 14, fontWeight: '600', color: t.colors.text },
  filterTextOn: { color: t.colors.onAccent },
  waitingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.colors.warning,
    backgroundColor: t.colors.surfaceRaised,
  },
  waitingText: { flex: 1, fontSize: 14, fontWeight: '600', color: t.colors.text },
  empty: { padding: 24, borderRadius: 16, backgroundColor: t.colors.surfaceRaised, alignItems: 'center', gap: 6 },
  emptyText: { fontSize: 15, fontWeight: '600', color: t.colors.text, textAlign: 'center' },
  emptySub: { fontSize: 13, color: t.colors.textMuted, textAlign: 'center' },
  person: { gap: 6 },
  personHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 4, marginTop: 6 },
  personName: { fontSize: 16, fontWeight: '700', color: t.colors.text },
  personTotal: { fontSize: 15, fontWeight: '700', color: t.colors.text },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: t.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  rowWaiting: { borderStyle: 'dashed', borderColor: t.colors.warning },
  rowDay: { width: 52, fontSize: 13, fontWeight: '700', color: t.colors.textMuted },
  rowJob: { fontSize: 14, fontWeight: '600', color: t.colors.text },
  rowSub: { fontSize: 12, color: t.colors.textMuted, marginTop: 2 },
  rowHours: { fontSize: 15, fontWeight: '700', color: t.colors.text },
}));
