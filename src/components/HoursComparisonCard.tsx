/**
 * Insights card: quoted vs logged hours, job by job. The payoff for logging
 * time — it shows whether the tradie's labour estimates hold up. Pro, like
 * the rest of the reporting on this page; a free account that has logged
 * time sees what the card is for and a way in.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { TouchableOpacity, View } from 'react-native';
import { Button, Surface, Text } from 'react-native-paper';

import type { TimeEntry } from '../../shared/time/types';
import type { Document } from '../types/document';
import { formatHours } from '../../shared/time/hours';
import { timeEntryService } from '../services/timeEntryService';
import { useJobStore } from '../store/useJobStore';
import { buildHoursComparison } from '../utils/hoursComparison';
import { makeStyles, useThemeColors } from '../theme';
import { ProBadge } from './ProBadge';

const MAX_ROWS = 8;

interface HoursComparisonCardProps {
  documents: Document[];
  isPro: boolean;
  onLockedPress: () => void;
  onOpenJob: (jobId: string) => void;
}

export function HoursComparisonCard({ documents, isPro, onLockedPress, onOpenJob }: HoursComparisonCardProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const jobs = useJobStore((s) => s.jobs);
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);

  // Read for free accounts too: the locked card only shows to someone who
  // has actually logged time, so it's an offer about their own jobs rather
  // than one more upsell for a feature they don't use.
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

  const comparison = useMemo(
    () => (entries ? buildHoursComparison(entries, jobs, documents) : null),
    [entries, jobs, documents],
  );

  if (!isPro) {
    if (!entries?.length) return null;
    return (
      <Surface style={styles.card}>
        <View style={styles.headingRow}>
          <Text style={styles.title}>Quoted vs actual hours</Text>
          <ProBadge size="small" />
        </View>
        <Text style={styles.body}>
          You're logging time. See which finished jobs ran over your quote, and by how much.
        </Text>
        <Button mode="outlined" onPress={onLockedPress} style={styles.lockedButton}>
          See it with Pro
        </Button>
      </Surface>
    );
  }

  // Nothing to compare yet (still loading, or no job has both sides): stay out
  // of the way instead of adding an empty card to the charts.
  if (!comparison || comparison.rows.length === 0) return null;

  const overall = comparison.overallOverPercent ?? 0;
  return (
    <Surface style={styles.card}>
      <Text style={styles.title}>Quoted vs actual hours</Text>
      <Text style={styles.body}>
        {`${formatHours(comparison.totalLogged)} logged against ${formatHours(comparison.totalQuoted)} quoted · `}
        <Text style={{ color: overall > 0 ? themeColors.warning : themeColors.money, fontWeight: '700' }}>
          {overall === 0 ? 'spot on' : overall > 0 ? `${overall}% over` : `${-overall}% under`}
        </Text>
        {comparison.jobsOver > 0
          ? ` · ${comparison.jobsOver} of ${comparison.rows.length} ${comparison.rows.length === 1 ? 'job' : 'jobs'} over`
          : ''}
      </Text>
      {comparison.rows.slice(0, MAX_ROWS).map((row) => (
        <TouchableOpacity
          key={row.jobId}
          style={styles.row}
          onPress={() => onOpenJob(row.jobId)}
          accessibilityRole="button"
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {row.jobName}
            </Text>
            <Text style={styles.rowSub} numberOfLines={1}>
              {[row.customerName, `${formatHours(row.loggedHours)} of ${formatHours(row.quotedHours)}`]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          <Text
            style={[
              styles.rowDelta,
              { color: row.overPercent > 0 ? themeColors.warning : themeColors.money },
            ]}
          >
            {row.overPercent === 0 ? 'spot on' : row.overPercent > 0 ? `+${row.overPercent}%` : `${row.overPercent}%`}
          </Text>
        </TouchableOpacity>
      ))}
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
  body: {
    fontSize: 13,
    color: t.colors.textSecondary,
    marginTop: 6,
    marginBottom: 8,
    lineHeight: 18,
  },
  lockedButton: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.text,
  },
  rowSub: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 2,
  },
  rowDelta: {
    fontSize: 14,
    fontWeight: '700',
  },
}));
