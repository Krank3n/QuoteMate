/**
 * Insights → Reports: the timesheet for the period picked above it. Shares
 * the statement's period chips rather than carrying its own — one period
 * control on the page, two documents off it. Pro, like the statement.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { View } from 'react-native';
import { Button, Surface, Text } from 'react-native-paper';

import type { TimeEntry } from '../../shared/time/types';
import { buildTimesheet, timesheetSummaryLine } from '../../shared/time/buildTimesheet';
import { formatHours, localDateKey } from '../../shared/time/hours';
import { timeEntryService } from '../services/timeEntryService';
import { useJobStore } from '../store/useJobStore';
import { useStore } from '../store/useStore';
import type { StatementPeriod } from '../utils/statementPeriods';
import { exportTimesheetPDF, reservePrintWindow, shareTimesheetCSV } from '../utils/pdfGenerator';
import { makeStyles, useThemeColors } from '../theme';
import { ProBadge } from './ProBadge';

const MAX_JOB_ROWS = 5;

interface TimesheetCardProps {
  period: StatementPeriod;
  isPro: boolean;
  /** Returns true when the tradie may go ahead (opens the paywall otherwise). */
  requirePro: () => boolean;
  onError: (title: string, message: string) => void;
}

export function TimesheetCard({ period, isPro, requirePro, onError }: TimesheetCardProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const jobs = useJobStore((s) => s.jobs);
  const businessSettings = useStore((s) => s.businessSettings);
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [busy, setBusy] = useState<'pdf' | 'csv' | null>(null);

  // Re-read on focus: Insights sits in the stack while time gets logged.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      timeEntryService.listAll().then((all) => {
        if (!cancelled) setEntries(all);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const data = useMemo(() => {
    if (!entries) return null;
    // The period runs local midnight to local midnight, and entries carry
    // the local day they were logged for — compare in the phone's own days.
    return buildTimesheet(entries, jobs, {
      fromKey: localDateKey(new Date(period.fromMs)),
      toKey: localDateKey(new Date(period.toMs - 1)),
    }, businessSettings?.crew ?? []);
  }, [entries, jobs, period.fromMs, period.toMs, businessSettings?.crew]);

  // Someone who has never logged time has no use for a timesheet card.
  if (!entries || entries.length === 0 || !data) return null;

  const handlePdf = async () => {
    if (!requirePro()) return;
    const printWindow = reservePrintWindow();
    setBusy('pdf');
    try {
      await exportTimesheetPDF(data, businessSettings, { isPro, printWindow, periodLabel: period.label });
    } catch (error: any) {
      onError('Could not share the timesheet', error?.message || 'Something went wrong making the PDF. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const handleCsv = async () => {
    if (!requirePro()) return;
    setBusy('csv');
    try {
      await shareTimesheetCSV(data, businessSettings);
    } catch (error: any) {
      onError('Could not share the timesheet', error?.message || 'Something went wrong making the file. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const empty = data.rows.length === 0;
  return (
    <Surface style={styles.card}>
      <View style={styles.headingRow}>
        <Text style={styles.title}>Timesheet</Text>
        {!isPro && <ProBadge size="small" />}
      </View>
      <Text style={styles.summary}>{timesheetSummaryLine(data)}</Text>
      {data.byJob.slice(0, MAX_JOB_ROWS).map((job) => (
        <View key={job.jobId} style={styles.row}>
          <Text style={styles.rowLabel} numberOfLines={1}>
            {job.customerName ? `${job.jobName} · ${job.customerName}` : job.jobName}
          </Text>
          <Text style={styles.rowValue}>{formatHours(job.hours)}</Text>
        </View>
      ))}
      {data.byJob.length > MAX_JOB_ROWS ? (
        <Text style={styles.more}>
          {`+ ${data.byJob.length - MAX_JOB_ROWS} more ${data.byJob.length - MAX_JOB_ROWS === 1 ? 'job' : 'jobs'} in the PDF`}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          mode="contained"
          buttonColor={themeColors.accent}
          textColor={themeColors.onAccent}
          icon="file-pdf-box"
          onPress={handlePdf}
          loading={busy === 'pdf'}
          disabled={!!busy || empty}
          style={styles.primaryAction}
        >
          Share PDF
        </Button>
        <Button
          mode="outlined"
          icon="file-delimited-outline"
          onPress={handleCsv}
          loading={busy === 'csv'}
          disabled={!!busy || empty}
        >
          Spreadsheet (CSV)
        </Button>
      </View>
      {!isPro && <Text style={styles.proLine}>Sharing the timesheet is part of Pro.</Text>}
    </Surface>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    padding: 20,
    borderRadius: 16,
    backgroundColor: t.colors.surfaceRaised,
    elevation: 2,
    marginBottom: 12,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: t.colors.text,
  },
  summary: {
    fontSize: 13,
    color: t.colors.textSecondary,
    marginTop: 6,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 6,
  },
  rowLabel: {
    flex: 1,
    fontSize: 13,
    color: t.colors.textSecondary,
  },
  rowValue: {
    fontSize: 14,
    fontWeight: '700',
    color: t.colors.text,
  },
  more: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  primaryAction: {
    borderRadius: 24,
  },
  proLine: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 8,
  },
}));
