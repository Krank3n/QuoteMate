/**
 * Timesheets — everyone's hours across every job, a week at a time.
 *
 * The per-job Log time sheet answers "how long did this job take"; this
 * answers "what did everyone work this week". Every entry opens the editor
 * (who, job, day, hours, note, charged), and crew send-ins can be approved
 * one at a time or all at once. Opened from the job screen's time sheet,
 * Settings and Crew.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, TouchableOpacity, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { format } from 'date-fns';

import type { TimeEntry } from '../../shared/time/types';
import { addDaysKey, dateKeyDaysAgo, formatHours, isCounted, weekStartKey } from '../../shared/time/hours';
import { StaleEntryError, timeEntryService } from '../services/timeEntryService';
import { useStore } from '../store/useStore';
import { useJobStore } from '../store/useJobStore';
import { activeCrew } from '../utils/crew';
import { buildTimesheetWeek, personKeyOf } from '../utils/timesheetWeek';
import { onCostPercentOf } from '../../shared/time/labourCost';
import { formatCurrency } from '../utils/documentCalculator';
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
  // Super/on-cost settings, for stamping costs on approval and the week's cost.
  const costing = useStore((s) => s.businessSettings) ?? undefined;
  const jobs = useJobStore((s) => s.jobs);

  const thisWeek = weekStartKey(dateKeyDaysAgo(0));
  const [start, setStart] = useState(thisWeek);
  const [filter, setFilter] = useState('all');
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [approving, setApproving] = useState(false);

  // The week on screen, for answers that land after the owner has moved on.
  const startRef = useRef(start);
  startRef.current = start;
  // Waiting entries from every week, so last Friday's aren't missed on Monday.
  const [allWaiting, setAllWaiting] = useState<TimeEntry[]>([]);

  const load = useCallback(() => {
    const want = start;
    timeEntryService.listRange(want, addDaysKey(want, 6)).then((list) => {
      if (startRef.current !== want) return;
      if (list) {
        setEntries(list);
        setFailed(false);
      } else {
        setFailed(true);
      }
    });
    timeEntryService.listWaiting().then((list) => {
      if (list) setAllWaiting(list);
    });
  }, [start]);
  useFocusEffect(load);
  // A new week starts blank, never showing the last week under its heading.
  useEffect(() => {
    setEntries(null);
    setFailed(false);
  }, [start]);

  const week = useMemo(() => buildTimesheetWeek(entries ?? [], crew, filter, costing), [entries, crew, filter, costing]);
  const jobName = (id: string) => {
    const j = jobs.find((x) => x.id === id);
    return j ? [j.customerName, j.name].filter(Boolean).join(' — ') || 'Untitled job' : 'Job no longer on file';
  };
  const people = activeCrew(crew);
  // Named as the week groups them — someone taken off the crew keeps the name they worked as.
  const personName = (key: string) => week.people.find((p) => p.key === key)?.name || (key === 'me' ? 'You' : 'Crew');

  const end = addDaysKey(start, 6);
  const otherWeeksWaiting = allWaiting.filter(
    (e) => (e.date < start || e.date > end) && (filter === 'all' || personKeyOf(e) === filter),
  );
  const latestOtherWeek = otherWeeksWaiting.length ? weekStartKey(otherWeeksWaiting[0].date) : null;

  const upsert = (e: TimeEntry) => {
    const from = startRef.current;
    setEntries((prev) => {
      const rest = (prev ?? []).filter((x) => x.id !== e.id);
      // Moved out of this week? Then it's not on this page any more.
      return e.date >= from && e.date <= addDaysKey(from, 6) ? [e, ...rest] : rest;
    });
    setAllWaiting((prev) => prev.filter((x) => x.id !== e.id || e.status === 'pending'));
  };
  const remove = (id: string) => {
    setEntries((prev) => (prev ?? []).filter((x) => x.id !== id));
    setAllWaiting((prev) => prev.filter((x) => x.id !== id));
  };

  const approveOne = async (e: TimeEntry) => {
    try {
      upsert(await timeEntryService.approveEntry(e, costing));
    } catch (err: any) {
      if (err instanceof StaleEntryError) load();
      showAlert({
        type: err instanceof StaleEntryError ? 'info' : 'error',
        title: err instanceof StaleEntryError ? 'Those hours just changed' : "Couldn't approve that",
        message: err?.message || 'Try again in a moment.',
      });
    }
  };

  const approveAll = async () => {
    const list = week.waiting;
    setApproving(true);
    let done = 0;
    let changed = 0;
    let failedOne: string | null = null;
    for (const e of list) {
      try {
        upsert(await timeEntryService.approveEntry(e, costing));
        done += 1;
      } catch (err: any) {
        // Changed on their link since this loaded: leave it for another look.
        if (err instanceof StaleEntryError) changed += 1;
        else {
          failedOne = err?.message || 'Try again in a moment.';
          break;
        }
      }
    }
    setApproving(false);
    if (changed || failedOne) {
      load();
      const left = list.length - done;
      showAlert({
        type: failedOne ? 'error' : 'info',
        title: `Approved ${done} of ${list.length}`,
        message: [
          changed ? `${changed} changed on their link just now — have another look.` : null,
          failedOne ? `${left - changed} still waiting: ${failedOne}` : null,
        ].filter(Boolean).join(' '),
      });
    }
  };
  const confirmApproveAll = () => {
    const hours = week.waiting.reduce((t, e) => t + e.hours, 0);
    const names = [...new Set(week.waiting.map((e) => personName(personKeyOf(e))))];
    const n = week.waiting.length;
    showAlert({
      type: 'info',
      title: `Approve ${n === 1 ? '1 entry' : `${n} entries`}?`,
      message: `${formatHours(hours)} from ${names.join(', ')}. Approved hours count on the job and can go on an invoice, and they're locked on the crew's side.`,
      primaryButtonText: 'Approve',
      // Not awaited: the confirm closes now, and a partial-result alert from
      // approveAll must not be dismissed along with it.
      primaryButtonAction: () => {
        void approveAll();
      },
      secondaryButtonText: 'Not yet',
      secondaryButtonAction: () => {},
    });
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
                  {`${shortDate(start)} – ${shortDate(end)} · ${entries ? formatHours(week.total) : '—'}`}
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
                <Button mode="contained" compact buttonColor={themeColors.accent} textColor={themeColors.onAccent} onPress={confirmApproveAll} loading={approving} disabled={approving}>
                  {filter === 'all' ? 'Approve all' : filter === 'me' ? 'Approve yours' : `Approve ${personName(filter).split(' ')[0]}'s`}
                </Button>
              </View>
            ) : null}

            {latestOtherWeek ? (
              <TouchableOpacity
                style={styles.otherWeeks}
                onPress={() => setStart(latestOtherWeek)}
                accessibilityRole="button"
              >
                <MaterialCommunityIcons name="clock-alert-outline" size={18} color={themeColors.warning} />
                <Text style={styles.otherWeeksText}>
                  {otherWeeksWaiting.length === 1 ? '1 more waiting' : `${otherWeeksWaiting.length} more waiting`} in other weeks
                </Text>
                <Text style={styles.otherWeeksGo}>{`Week of ${shortDate(latestOtherWeek)}`}</Text>
              </TouchableOpacity>
            ) : null}

            {!entries && !failed ? <ActivityIndicator style={styles.loading} color={themeColors.accentText} /> : null}

            {failed ? (
              <TouchableOpacity style={styles.empty} onPress={load}>
                <Text style={styles.emptyText}>Couldn't load this week. Tap to try again.</Text>
              </TouchableOpacity>
            ) : entries && week.people.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No hours logged this week.</Text>
                <Text style={styles.emptySub}>Log time from a job, or send your crew their link from Settings → Crew.</Text>
              </View>
            ) : null}

            {(failed ? [] : week.people).map((p) => (
              <View key={p.key} style={styles.person}>
                <View style={styles.personHead}>
                  <Text style={styles.personName}>{p.name}</Text>
                  <Text style={styles.personTotal}>
                    {formatHours(p.total)}
                    {p.waitingHours ? <Text style={styles.personWaiting}>{` · ${formatHours(p.waitingHours)} waiting`}</Text> : null}
                  </Text>
                </View>
                {p.cost ? (
                  <Text style={styles.personCost}>
                    {p.cost.superAndOnCosts > 0
                      ? `Costs about ${formatCurrency(p.cost.total)} · ${formatCurrency(p.cost.wages)} + ${formatCurrency(p.cost.superAndOnCosts)} ${onCostPercentOf(costing) > 0 ? 'super & on-costs' : 'super'}`
                      : `Costs ${formatCurrency(p.cost.total)}`}
                    {p.cost.uncostedCrewHours ? ` · ${formatHours(p.cost.uncostedCrewHours)} not costed` : ''}
                  </Text>
                ) : null}
                {p.entries.map((e) => {
                  const waiting = !isCounted(e);
                  const sub = [e.billable === false ? 'Not charged' : null, e.note || null].filter(Boolean).join(' · ');
                  const row = (
                    <TouchableOpacity
                      style={[styles.row, waiting ? styles.rowInCard : null]}
                      onPress={() => setEditing(e)}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${formatHours(e.hours)} on ${dayName(e.date)}, ${jobName(e.jobId)}`}
                    >
                      <Text style={styles.rowDay}>{dayName(e.date)}</Text>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.rowJob} numberOfLines={1}>{jobName(e.jobId)}</Text>
                        {sub ? (
                          <Text style={styles.rowSub} numberOfLines={1}>
                            {sub}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={styles.rowHours}>{formatHours(e.hours)}</Text>
                      <MaterialCommunityIcons name="pencil-outline" size={18} color={themeColors.textMuted} />
                    </TouchableOpacity>
                  );
                  if (!waiting) return <React.Fragment key={e.id}>{row}</React.Fragment>;
                  // Waiting: Approve gets its own line, so the job name keeps
                  // the row's width on a small phone.
                  return (
                    <View key={e.id} style={styles.waitingCard}>
                      {row}
                      <View style={styles.waitingFoot}>
                        <Text style={styles.waitingLabel}>Waiting for you</Text>
                        <Button
                          mode="contained-tonal"
                          compact
                          onPress={() => approveOne(e)}
                          accessibilityLabel={`Approve ${formatHours(e.hours)} from ${p.name}`}
                        >
                          Approve
                        </Button>
                      </View>
                    </View>
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
        onDeleted={remove}
        onStale={load}
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
  personCost: { fontSize: 12, color: t.colors.textMuted, paddingHorizontal: 4, marginTop: -2 },
  personWaiting: { fontSize: 13, fontWeight: '600', color: t.colors.warning },
  loading: { marginTop: 24 },
  otherWeeks: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: t.colors.warning,
  },
  otherWeeksText: { flex: 1, fontSize: 13, color: t.colors.text },
  otherWeeksGo: { fontSize: 13, fontWeight: '700', color: t.colors.accentText },
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
  waitingCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: t.colors.warning,
    backgroundColor: t.colors.surfaceRaised,
  },
  rowInCard: { borderWidth: 0, backgroundColor: 'transparent' },
  waitingFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8 },
  waitingLabel: { fontSize: 12, fontWeight: '600', color: t.colors.warning },
  rowDay: { width: 52, fontSize: 13, fontWeight: '700', color: t.colors.textMuted },
  rowJob: { fontSize: 14, fontWeight: '600', color: t.colors.text },
  rowSub: { fontSize: 12, color: t.colors.textMuted, marginTop: 2 },
  rowHours: { fontSize: 15, fontWeight: '700', color: t.colors.text },
}));
