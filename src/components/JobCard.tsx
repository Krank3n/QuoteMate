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

import type { Job, JobStage } from '../../shared/job/types';
import { colors } from '../theme';
import { useStore } from '../store/useStore';
import { formatCurrency } from '../utils/quoteCalculator';
import { formatScheduledDateTime, formatScheduledDuration } from '../utils/formatSchedule';
import { deriveDuration } from '../utils/deriveDuration';
import { JOB_STAGE_META } from './JobStageSheet';
import { selectionTap } from '../utils/haptics';

// Happy-path lifecycle shown as a 5-step mini progress tracker on the card.
// Skips "inquiry" (pre-quote) and "completed" (ambiguous vs paid) to keep the
// row short. Terminal states (cancelled/closed) suppress the tracker entirely.
const TIMELINE_STEPS: Array<{ stage: JobStage; icon: string; label: string }> = [
  { stage: 'quoted', icon: 'send-outline', label: 'Quote' },
  { stage: 'accepted', icon: 'cash-multiple', label: 'Deposit' },
  { stage: 'scheduled', icon: 'calendar-check-outline', label: 'Scheduled' },
  { stage: 'in_progress', icon: 'hammer-wrench', label: 'In Progress' },
  { stage: 'paid', icon: 'check-decagram-outline', label: 'Paid' },
];

const STAGE_ORDER: Record<JobStage, number> = {
  inquiry: 0,
  quoted: 1,
  accepted: 2,
  scheduled: 3,
  in_progress: 4,
  completed: 5,
  paid: 6,
  closed: 7,
  cancelled: -1,
};

function isStageReached(job: Job, step: JobStage): boolean {
  // Prefer explicit timestamps (write-once, stamped by the trigger) when
  // present, fall back to ordinal comparison against the current stage.
  const stampKey: Record<JobStage, keyof Job | null> = {
    inquiry: null,
    quoted: 'quotedAt',
    accepted: 'acceptedAt',
    scheduled: 'scheduledAt',
    in_progress: 'inProgressAt',
    completed: 'completedAt',
    paid: 'paidAt',
    closed: 'closedAt',
    cancelled: 'cancelledAt',
  };
  const key = stampKey[step];
  if (key && job[key]) return true;
  return STAGE_ORDER[job.stage] >= STAGE_ORDER[step];
}

interface JobCardProps {
  job: Job;
  onPress: (jobId: string) => void;
  onStagePress?: (job: Job) => void;
  /** Opens the 3-dot action sheet (Duplicate / Archive / Delete / ...). */
  onMenuPress?: (job: Job) => void;
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

export const JobCard = React.memo(function JobCard({ job, onPress, onStagePress, onMenuPress }: JobCardProps) {
  const meta = JOB_STAGE_META[job.stage];
  const headline = pickHeadlineAmount(job);
  // Pull the primary attached doc so duration on the card matches the
  // labour quoted on the linked Document — single source of truth.
  const primaryDoc = useStore((s) =>
    job.primaryDocumentId
      ? s.documents.find((d) => d.id === job.primaryDocumentId)
      : s.documents.find((d) => d.jobId === job.id),
  );
  const { durationDays, hoursPerDay } = deriveDuration(primaryDoc);
  const scheduled = formatScheduledDateTime(job.scheduledStartDate);
  const duration =
    scheduled && (durationDays > 1 || hoursPerDay !== 8)
      ? formatScheduledDuration(durationDays, hoursPerDay)
      : null;
  const scheduledLine = scheduled
    ? duration
      ? `${scheduled} · ${duration}`
      : scheduled
    : null;
  const docCount = job.documentIds?.length ?? 0;
  const terminal = job.stage === 'cancelled' || job.stage === 'closed';

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
              // stopPropagation so the chip tap opens the stage sheet
              // instead of bubbling to the Card.onPress (which would
              // navigate into ViewJob).
              onPress={(e) => {
                e.stopPropagation();
                selectionTap();
                onStagePress(job);
              }}
              hitSlop={8}
              style={({ pressed }) => [
                styles.stageChip,
                { backgroundColor: meta.bgColor, borderColor: meta.color + '44' },
                pressed && styles.stageChipPressed,
              ]}
            >
              <MaterialCommunityIcons name={meta.icon as any} size={14} color={meta.color} />
              <Text style={[styles.stageLabel, { color: meta.color }]}>
                {meta.chipLabel}
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
                {meta.chipLabel}
              </Text>
            </View>
          )}

          {onMenuPress ? (
            <Pressable
              onPress={(e) => {
                // stopPropagation so the kebab doesn't bubble to the card
                // and open ViewJob.
                e.stopPropagation();
                selectionTap();
                onMenuPress(job);
              }}
              hitSlop={10}
              style={({ pressed }) => [
                styles.menuButton,
                pressed && styles.menuButtonPressed,
              ]}
            >
              <MaterialCommunityIcons
                name={'dots-vertical' as any}
                size={20}
                color={colors.textMuted}
              />
            </Pressable>
          ) : null}
        </View>

        {!terminal ? <JobStageTimeline job={job} /> : null}

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

function JobStageTimeline({ job }: { job: Job }) {
  return (
    <View style={styles.timelineRow}>
      {TIMELINE_STEPS.map((step, i) => {
        const reached = isStageReached(job, step.stage);
        const isCurrent = job.stage === step.stage;
        const nextReached =
          i < TIMELINE_STEPS.length - 1 &&
          isStageReached(job, TIMELINE_STEPS[i + 1].stage);
        return (
          <React.Fragment key={step.stage}>
            <View style={styles.timelineStep}>
              <View
                style={[
                  styles.timelineDot,
                  reached && styles.timelineDotReached,
                  isCurrent && styles.timelineDotCurrent,
                ]}
              >
                <MaterialCommunityIcons
                  name={step.icon as any}
                  size={12}
                  color={
                    isCurrent
                      ? colors.white
                      : reached
                        ? colors.success
                        : colors.inactive
                  }
                />
              </View>
              <Text
                style={[
                  styles.timelineLabel,
                  reached && styles.timelineLabelReached,
                  isCurrent && styles.timelineLabelCurrent,
                ]}
                numberOfLines={1}
              >
                {step.label}
              </Text>
            </View>
            {i < TIMELINE_STEPS.length - 1 ? (
              <View
                style={[
                  styles.timelineConnector,
                  nextReached && styles.timelineConnectorReached,
                ]}
              />
            ) : null}
          </React.Fragment>
        );
      })}
    </View>
  );
}

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
  menuButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  menuButtonPressed: {
    backgroundColor: colors.surfaceGray3,
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
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 2,
    paddingHorizontal: 2,
  },
  timelineStep: {
    alignItems: 'center',
    gap: 3,
    flexShrink: 0,
    width: 44,
  },
  timelineDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceGray3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  timelineDotReached: {
    backgroundColor: colors.successBg,
    borderColor: colors.success + '55',
  },
  timelineDotCurrent: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  timelineLabel: {
    fontSize: 9,
    color: colors.inactive,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  timelineLabelReached: {
    color: colors.textMuted,
  },
  timelineLabelCurrent: {
    color: colors.text,
    fontWeight: '700',
  },
  timelineConnector: {
    flex: 1,
    height: 2,
    backgroundColor: colors.border,
    marginHorizontal: 2,
    marginBottom: 13, // align with the dot center (22px tall + 3 gap + label)
    borderRadius: 1,
  },
  timelineConnectorReached: {
    backgroundColor: colors.success + '88',
  },
});
