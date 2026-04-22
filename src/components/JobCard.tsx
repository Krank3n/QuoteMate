/**
 * JobCard — compact card shown in the Jobs list.
 *
 * Simpler than DocumentCard. Shows the customer, address, stage chip,
 * money summary (quoted / invoiced / paid / balance), attached-document
 * count, and last-updated timestamp. Tap → ViewJobScreen.
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, Card } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { formatDistanceToNow } from 'date-fns';

import type { Job } from '../../shared/job/types';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { formatScheduledDateTime, formatScheduledDuration } from '../utils/formatSchedule';
import { JOB_STAGE_META } from './JobStageSheet';
import { selectionTap } from '../utils/haptics';

interface JobCardProps {
  job: Job;
  onPress: (jobId: string) => void;
  onStagePress?: (job: Job) => void;
}

// Top-line money depends on where the job is. Before an invoice is raised we
// lead with the quoted total; after, we lead with the outstanding balance.
function pickHeadlineAmount(job: Job): { label: string; value: string } {
  if (job.totalInvoiced > 0) {
    if (job.balanceDue > 0) return { label: 'Balance', value: formatCurrency(job.balanceDue) };
    return { label: 'Paid', value: formatCurrency(job.totalPaid) };
  }
  if (job.totalQuoted > 0) return { label: 'Quoted', value: formatCurrency(job.totalQuoted) };
  return { label: '', value: '' };
}

function formatUpdatedAt(ms: number): string {
  if (!ms) return '';
  try {
    return formatDistanceToNow(new Date(ms), { addSuffix: true });
  } catch {
    return '';
  }
}

export const JobCard = React.memo(function JobCard({ job, onPress, onStagePress }: JobCardProps) {
  const meta = JOB_STAGE_META[job.stage];
  const headline = pickHeadlineAmount(job);
  const scheduled = formatScheduledDateTime(job.scheduledStartDate);
  const duration = formatScheduledDuration(
    job.scheduledDurationDays,
    job.scheduledHoursPerDay,
  );
  const scheduledLine = scheduled
    ? duration
      ? `${scheduled} · ${duration}`
      : scheduled
    : null;
  const docCount = job.documentIds?.length ?? 0;

  return (
    <Card style={styles.card} onPress={() => { selectionTap(); onPress(job.id); }}>
      <View style={styles.cardContent}>
        <View style={styles.topRow}>
          <View style={styles.titleBlock}>
            <Text style={styles.jobName} numberOfLines={1}>
              {job.name || 'Untitled job'}
            </Text>
            <Text style={styles.customer} numberOfLines={1}>
              {job.customerName || 'Unknown customer'}
            </Text>
          </View>

          {onStagePress ? (
            <Pressable
              onPress={() => { selectionTap(); onStagePress(job); }}
              hitSlop={8}
              style={({ pressed }) => [
                styles.stageChip,
                { backgroundColor: meta.bgColor, borderColor: meta.color + '44' },
                pressed && styles.stageChipPressed,
              ]}
            >
              <MaterialCommunityIcons name={meta.icon as any} size={14} color={meta.color} />
              <Text style={[styles.stageLabel, { color: meta.color }]}>
                {meta.label.replace(/^Mark as /, '')}
              </Text>
            </Pressable>
          ) : (
            <View
              style={[
                styles.stageChip,
                { backgroundColor: meta.bgColor, borderColor: meta.color + '44' },
              ]}
            >
              <MaterialCommunityIcons name={meta.icon as any} size={14} color={meta.color} />
              <Text style={[styles.stageLabel, { color: meta.color }]}>
                {meta.label.replace(/^Mark as /, '')}
              </Text>
            </View>
          )}
        </View>

        {job.jobAddress ? (
          <View style={styles.inlineRow}>
            <MaterialCommunityIcons name="map-marker-outline" size={14} color={colors.textMuted} />
            <Text style={styles.inlineText} numberOfLines={1}>{job.jobAddress}</Text>
          </View>
        ) : null}

        {scheduledLine ? (
          <View style={styles.inlineRow}>
            <MaterialCommunityIcons name="calendar-clock-outline" size={14} color={colors.textMuted} />
            <Text style={styles.inlineText} numberOfLines={1}>{scheduledLine}</Text>
          </View>
        ) : null}

        <View style={styles.bottomRow}>
          <View style={styles.metaRow}>
            <MaterialCommunityIcons
              name="file-document-multiple-outline"
              size={14}
              color={colors.textMuted}
            />
            <Text style={styles.metaText}>
              {docCount} {docCount === 1 ? 'doc' : 'docs'}
            </Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>{formatUpdatedAt(job.updatedAt)}</Text>
          </View>

          {headline.value ? (
            <View style={styles.amountBlock}>
              <Text style={styles.amountLabel}>{headline.label}</Text>
              <Text style={styles.amountValue}>{headline.value}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Card>
  );
});

const styles = StyleSheet.create({
  card: {
    marginBottom: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
  },
  cardContent: {
    padding: 14,
    gap: 8,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  titleBlock: {
    flex: 1,
  },
  jobName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  customer: {
    fontSize: 13,
    color: colors.onSurface,
  },
  stageChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    gap: 4,
  },
  stageChipPressed: {
    opacity: 0.7,
  },
  stageLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inlineText: {
    fontSize: 13,
    color: colors.textMuted,
    flexShrink: 1,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  metaText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  metaDot: {
    fontSize: 12,
    color: colors.textMuted,
    marginHorizontal: 2,
  },
  amountBlock: {
    alignItems: 'flex-end',
  },
  amountLabel: {
    fontSize: 10,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  amountValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
});
