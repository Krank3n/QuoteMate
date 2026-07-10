/**
 * JobCard — compact card shown in the Jobs list.
 *
 * Shows the customer, address, stage chip,
 * a single right-aligned headline price (matches ViewJob's header), and
 * a status line with the most recent stage event (e.g. "Quote sent 2h
 * ago"). Tap → ViewJobScreen.
 */

import React, { useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Linking,
  Platform,
  Alert,
  Animated,
} from 'react-native';
import { Text, Card } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { formatDistanceToNow } from 'date-fns';

import type { Job, JobStage } from '../../shared/job/types';
import { colors } from '../theme';
import { useStore } from '../store/useStore';
import { formatCurrency } from '../utils/quoteCalculator';
import { formatScheduledDateTime, formatScheduledDuration } from '../utils/formatSchedule';
import { deriveDuration } from '../utils/deriveDuration';
import { useNavigation } from '@react-navigation/native';
import { useIsAppActive } from '../hooks/useIsAppActive';

import { stageMetaFor } from './JobStageSheet';
import { ShimmerOverlay } from './ShimmerOverlay';
import { selectionTap } from '../utils/haptics';
import { openJobPreview } from '../utils/openJobPreview';
import {
  getJobSubStatus,
  isSlotReached,
  type JobSubStatusSlot,
} from '../utils/jobTimeline';
import type { Document } from '../types/document';

// Small circular icon buttons for the contact quick-taps (call / text /
// email / map). Keep these close at hand so cleaners on the list can
// reach a customer in one tap without opening the job.
function openMaps(address: string) {
  const url =
    Platform.OS === 'ios'
      ? `http://maps.apple.com/?q=${encodeURIComponent(address)}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  Linking.openURL(url).catch(() => {
    Alert.alert("Couldn't open Maps", 'Try copying the address instead.');
  });
}

// Happy-path lifecycle shown as a 5-slot mini progress tracker on the card.
// Each slot can render multiple sub-statuses (Draft/Quote/Quote Sent in the
// quote slot; Completed/Paid in the final slot) — getJobSubStatus picks the
// label + icon for whichever slot is currently active. Terminal states
// (cancelled/closed) suppress the tracker entirely.
const TIMELINE_SLOTS: Array<{ slot: JobSubStatusSlot }> = [
  { slot: 'quote' },
  { slot: 'accepted' },
  { slot: 'scheduled' },
  { slot: 'in_progress' },
  { slot: 'paid' },
];

interface JobCardProps {
  job: Job;
  onPress: (jobId: string) => void;
  onStagePress?: (job: Job) => void;
  /** Opens the 3-dot action sheet (Duplicate / Archive / Delete / ...). */
  onMenuPress?: (job: Job) => void;
}


function formatUpdatedAt(ms: number): string {
  if (!ms) return '';
  try {
    return formatDistanceToNow(new Date(ms), { addSuffix: true });
  } catch {
    return '';
  }
}

const STAGE_STATUS_LABELS: Record<JobStage, string> = {
  inquiry: 'Created',
  quoted: 'Quote sent',
  accepted: 'Accepted',
  scheduled: 'Scheduled',
  in_progress: 'Started',
  completed: 'Completed',
  paid: 'Paid',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

const STAGE_TIMESTAMP_KEY: Record<JobStage, keyof Job | null> = {
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

function pickStageStatus(job: Job): { label: string; ms: number } {
  const key = STAGE_TIMESTAMP_KEY[job.stage];
  const stamped = key ? (job[key] as number | undefined) : undefined;
  const ms = stamped || job.updatedAt || job.createdAt;
  return { label: STAGE_STATUS_LABELS[job.stage] ?? STAGE_STATUS_LABELS.inquiry, ms };
}

export const JobCard = React.memo(function JobCard({ job, onPress, onStagePress, onMenuPress }: JobCardProps) {
  const meta = stageMetaFor(job.stage);
  // Live-derive the headline price from attached docs so a draft quote
  // shows its running total here without waiting on the server-side
  // syncJobAggregates trigger. Mirrors the precedence used on
  // JobDetailHeader: outstanding balance once invoiced, paid once
  // cleared, otherwise the quoted total. Selector returns a primitive
  // so the memo'd card only re-renders when the number itself moves.
  const headlineValue = useStore((s) => {
    const docs = s.documents.filter(
      (d) => d.jobId === job.id && d.stage !== 'cancelled',
    );
    const totalQuoted = docs
      .filter((d) => d.type === 'quote')
      .reduce((sum, d) => sum + (Number(d.total) || 0), 0);
    const totalInvoiced = docs
      .filter((d) => d.type === 'invoice')
      .reduce((sum, d) => sum + (Number(d.total) || 0), 0);
    const totalPaid = docs.reduce((sum, d) => sum + (Number(d.paidTotal) || 0), 0);
    const balanceDue = docs.reduce((sum, d) => sum + (Number(d.balanceDue) || 0), 0);
    if (totalInvoiced > 0) {
      return balanceDue > 0 ? balanceDue : totalPaid;
    }
    return totalQuoted;
  });

  // Aggregate Xero sync state across the job's docs so the card can
  // show a small status pip on the meta row. 'error' wins over 'synced'
  // — a failed push is more important to surface than a successful one.
  const xeroSyncStatus = useStore((s) => {
    const docs = s.documents.filter(
      (d) => d.jobId === job.id && d.stage !== 'cancelled',
    );
    if (docs.some((d) => d.xeroSyncStatus === 'error')) return 'error' as const;
    if (docs.some((d) => d.xeroSyncStatus === 'synced')) return 'synced' as const;
    return undefined;
  });

  // Idle bob + tilt so the list feels alive rather than static. Each
  // card picks its own duration and direction so the stack doesn't
  // breathe in lockstep.
  const idleAnim = useRef(new Animated.Value(0)).current;
  const idleTilt = useRef(new Animated.Value(0)).current;
  const bobDurationRef = useRef(2400 + Math.random() * 1200);
  const tiltDurationRef = useRef(3200 + Math.random() * 1600);
  const tiltDirRef = useRef(Math.random() > 0.5 ? 1 : -1);
  const delayRef = useRef(Math.random() * 1500);

  const isAppActive = useIsAppActive();
  useEffect(() => {
    if (!isAppActive) return;
    const bobD = bobDurationRef.current;
    const tiltD = tiltDurationRef.current;
    const tiltDir = tiltDirRef.current;

    const bobAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(idleAnim, { toValue: -2, duration: bobD / 2, useNativeDriver: true }),
        Animated.timing(idleAnim, { toValue: 0, duration: bobD / 2, useNativeDriver: true }),
      ]),
    );
    const tiltAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(idleTilt, { toValue: 0.4 * tiltDir, duration: tiltD / 2, useNativeDriver: true }),
        Animated.timing(idleTilt, { toValue: -0.4 * tiltDir, duration: tiltD, useNativeDriver: true }),
        Animated.timing(idleTilt, { toValue: 0, duration: tiltD / 2, useNativeDriver: true }),
      ]),
    );
    const timer = setTimeout(() => {
      bobAnim.start();
      tiltAnim.start();
    }, delayRef.current);
    return () => {
      clearTimeout(timer);
      bobAnim.stop();
      tiltAnim.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAppActive]);

  // Pull the primary attached doc so duration on the card matches the
  // labour quoted on the linked Document — single source of truth.
  const primaryDoc = useStore((s) =>
    job.primaryDocumentId
      ? s.documents.find((d) => d.id === job.primaryDocumentId)
      : s.documents.find((d) => d.jobId === job.id),
  );
  const setCurrentQuote = useStore((s) => s.setCurrentQuote);
  const setCurrentInvoice = useStore((s) => s.setCurrentInvoice);
  const navigation = useNavigation<any>();
  const handlePricePress = (e: any) => {
    e.stopPropagation();
    if (!primaryDoc) return;
    selectionTap();
    openJobPreview(primaryDoc, { navigation, setCurrentQuote, setCurrentInvoice });
  };
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
  const status = pickStageStatus(job);
  const terminal = job.stage === 'cancelled' || job.stage === 'closed';
  // The timeline's active pill now covers every non-terminal stage
  // (including inquiry → "Draft" and completed → "Completed"), so the
  // stage chip is only needed for the terminal stages we don't render.
  const showStageChip = terminal;

  return (
    <Animated.View
      style={{
        transform: [
          { translateY: idleAnim },
          {
            rotate: idleTilt.interpolate({
              inputRange: [-1, 1],
              outputRange: ['-1deg', '1deg'],
            }),
          },
        ],
      }}
    >
      <Card
        style={styles.card}
        onPress={() => {
          selectionTap();
          onPress(job.id);
        }}
      >
        <ShimmerOverlay tint={meta.color} intensity={0.12} />
        <View style={styles.cardContent}>
        <View style={styles.topRow}>
          <View style={styles.titleBlock}>
            <View style={styles.titleHeadRow}>
              <Text style={styles.customer} numberOfLines={1}>
                {job.customerName || 'Unknown customer'}
              </Text>
              {headlineValue > 0 ? (
                <Pressable
                  onPress={handlePricePress}
                  hitSlop={6}
                  style={({ pressed }) => [
                    styles.headlinePricePress,
                    pressed && { opacity: 0.7 },
                  ]}
                  accessibilityLabel="View job preview"
                >
                  <Text style={styles.headlinePrice} numberOfLines={1}>
                    {formatCurrency(headlineValue)}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.titleSubRow}>
              <Text style={styles.jobName}>
                {job.name || 'Untitled job'}
              </Text>
              <InlineContactActions
                phone={job.customerPhone}
                email={job.customerEmail}
                address={job.jobAddress}
              />
            </View>
          </View>

          {showStageChip && onStagePress ? (
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
          ) : showStageChip ? (
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
          ) : null}

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
                size={24}
                color={colors.textMuted}
              />
            </Pressable>
          ) : null}
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

        <View style={styles.metaRow}>
          <MaterialCommunityIcons
            name="clock-outline"
            size={14}
            color={colors.textMuted}
          />
          <Text style={styles.metaText} numberOfLines={1}>
            {status.label} {formatUpdatedAt(status.ms)}
          </Text>
          {xeroSyncStatus === 'synced' ? (
            <MaterialCommunityIcons
              name="cloud-check"
              size={14}
              color={colors.success}
              accessibilityLabel="Synced to Xero"
            />
          ) : xeroSyncStatus === 'error' ? (
            <MaterialCommunityIcons
              name="cloud-alert"
              size={14}
              color={colors.error}
              accessibilityLabel="Xero sync failed"
            />
          ) : null}
        </View>

        {!terminal ? (
          <JobStageTimeline
            job={job}
            primaryDoc={primaryDoc}
            onActivePress={onStagePress}
          />
        ) : null}
        </View>
      </Card>
    </Animated.View>
  );
});

function InlineContactActions({
  phone,
  email,
  address,
}: {
  phone?: string;
  email?: string;
  address?: string;
}) {
  const hasPhone = !!(phone && phone.trim());
  const hasEmail = !!(email && email.trim());
  const hasAddress = !!(address && address.trim());
  if (!hasPhone && !hasEmail && !hasAddress) return null;

  const stop = (fn: () => void) => (e: any) => {
    e?.stopPropagation?.();
    selectionTap();
    fn();
  };
  const call = () => {
    if (!phone) return;
    Linking.openURL(`tel:${phone.replace(/\s+/g, '')}`).catch(() =>
      Alert.alert("Couldn't call", 'Copy the number instead.'),
    );
  };
  const text = () => {
    if (!phone) return;
    Linking.openURL(`sms:${phone.replace(/\s+/g, '')}`).catch(() =>
      Alert.alert("Couldn't open SMS", 'Copy the number instead.'),
    );
  };
  const mail = () => {
    if (!email) return;
    Linking.openURL(`mailto:${email}`).catch(() =>
      Alert.alert("Couldn't open mail", 'Copy the address instead.'),
    );
  };
  const map = () => {
    if (!address) return;
    openMaps(address);
  };

  return (
    <View style={styles.inlineActions}>
      {hasPhone ? (
        <InlineIcon icon="phone" color={colors.success} onPress={stop(call)} />
      ) : null}
      {hasPhone ? (
        <InlineIcon icon="message-text" color={colors.info} onPress={stop(text)} />
      ) : null}
      {hasEmail ? (
        <InlineIcon icon="email" color={colors.warning} onPress={stop(mail)} />
      ) : null}
      {hasAddress ? (
        <InlineIcon icon="map-marker" color={colors.primary} onPress={stop(map)} />
      ) : null}
    </View>
  );
}

function InlineIcon({
  icon,
  color,
  onPress,
}: {
  icon: string;
  color: string;
  bg?: string;
  onPress: (e: any) => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.inlineIconBtn,
        pressed && { opacity: 0.7 },
      ]}
    >
      <MaterialCommunityIcons name={icon as any} size={14} color={color} />
    </Pressable>
  );
}

function JobStageTimeline({
  job,
  primaryDoc,
  onActivePress,
}: {
  job: Job;
  primaryDoc?: Document | null;
  onActivePress?: (job: Job) => void;
}) {
  const subStatus = getJobSubStatus(job, primaryDoc);
  return (
    <View style={styles.timelineRow}>
      {TIMELINE_SLOTS.map((step, i) => {
        const reached = isSlotReached(job, step.slot);
        const isCurrent = subStatus.slot === step.slot;
        const nextReached =
          i < TIMELINE_SLOTS.length - 1 &&
          isSlotReached(job, TIMELINE_SLOTS[i + 1].slot);
        return (
          <React.Fragment key={step.slot}>
            {isCurrent ? (
              onActivePress ? (
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    selectionTap();
                    onActivePress(job);
                  }}
                  hitSlop={6}
                  style={({ pressed }) => [
                    styles.timelineActivePill,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <MaterialCommunityIcons
                    name={subStatus.icon as any}
                    size={14}
                    color={colors.success}
                  />
                  <Text style={styles.timelineActiveLabel} numberOfLines={1}>
                    {subStatus.label}
                  </Text>
                </Pressable>
              ) : (
                <View style={styles.timelineActivePill}>
                  <MaterialCommunityIcons
                    name={subStatus.icon as any}
                    size={14}
                    color={colors.success}
                  />
                  <Text style={styles.timelineActiveLabel} numberOfLines={1}>
                    {subStatus.label}
                  </Text>
                </View>
              )
            ) : (
              <View style={styles.timelineMicroSlot}>
                <View
                  style={[
                    styles.timelineMicroDot,
                    reached && styles.timelineMicroDotReached,
                  ]}
                />
              </View>
            )}
            {i < TIMELINE_SLOTS.length - 1 ? (
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
    // Required so the ShimmerOverlay's sweep stays clipped inside the
    // card's rounded corners.
    overflow: 'hidden',
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
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: colors.onSurface,
  },
  customer: {
    flex: 1,
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
  },
  titleHeadRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  titleSubRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 2,
  },
  headlinePricePress: {
    marginLeft: 'auto',
  },
  headlinePrice: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.success,
    textAlign: 'right',
  },
  inlineActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 'auto',
    // Mirror JobDetailHeader: breathing room from the green headlinePrice
    // sitting directly above on the title head row.
    marginTop: 6,
  },
  inlineIconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.white + '33',
    backgroundColor: 'transparent',
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
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    marginRight: -6, // pull back so the touch target doesn't push the chip
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
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  metaText: {
    fontSize: 12,
    color: colors.textMuted,
    flexShrink: 1,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 2,
    // Break out of the card's 14px content padding so the timeline
    // track reaches the rounded card edges.
    marginHorizontal: -14,
    paddingHorizontal: 12,
  },
  timelineActivePill: {
    // Flatter pill — matches the footer nav's liquid-pill indicator
    // so the active step reads as "the thing you can tap" in the same
    // visual vocabulary as the bottom tabs.
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.success,
    backgroundColor: 'transparent',
    flexShrink: 0,
  },
  timelineActiveLabel: {
    fontSize: 11,
    color: colors.success,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  timelineMicroSlot: {
    // Same height as the active dot so the row stays vertically
    // anchored — the micro dot sits centred inside this slot,
    // matching the active dot's centreline.
    width: 16,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineMicroDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    // Lifted off the dark slate background so future steps are still
    // legible in glaring sunlight — colors.border was nearly invisible.
    backgroundColor: colors.inactive,
    borderWidth: 0,
  },
  timelineMicroDotReached: {
    backgroundColor: colors.success,
  },
  timelineConnector: {
    flex: 1,
    height: 2,
    backgroundColor: colors.inactive,
    marginHorizontal: 2,
    borderRadius: 1,
  },
  timelineConnectorReached: {
    // Subtler than the solid colors.success — matches the muted
    // reached pip style so the connecting line doesn't outshout
    // the dots it's joining.
    backgroundColor: colors.success + '88',
  },
});
