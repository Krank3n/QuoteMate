/**
 * JobDetailHeader — slim header card on ViewJobScreen.
 *
 * Replaces the bulky earlier header (large Call/Text/Email/Map tiles +
 * underlined-link address + status pill in the corner) with the JobCard
 * visual language: title, customer, compact circular contact icons,
 * subtle icon-prefixed contact rows, low-profile totals strip, and a
 * horizontal stage stepper at the bottom.
 *
 * Tapping the stepper expands the activity log inline (the same
 * JobTimeline component used elsewhere on this screen), so the
 * historical activity is one tap away from where the user already
 * looks for "where is this job at".
 *
 * Stage-change interaction lives on the kebab (JobActionsSheet) — the
 * top-right pill that used to open the stage sheet has been retired in
 * favour of the active step in the bottom timeline.
 */

import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Linking,
  Platform,
  Alert,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import { Text, Card } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import type { Job, JobStage } from '../../shared/job/types';
import type { Document } from '../types/document';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { selectionTap } from '../utils/haptics';
import { JobTimeline } from './JobTimeline';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const TIMELINE_STEPS: Array<{ stage: JobStage; icon: string; label: string }> = [
  { stage: 'quoted', icon: 'send-outline', label: 'Quote' },
  { stage: 'accepted', icon: 'handshake-outline', label: 'Accepted' },
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

const STAGE_STAMP: Record<JobStage, keyof Job | null> = {
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

function isStageReached(job: Job, step: JobStage): boolean {
  const key = STAGE_STAMP[step];
  if (key && job[key]) return true;
  return STAGE_ORDER[job.stage] >= STAGE_ORDER[step];
}

function openMapsFor(address: string) {
  const url =
    Platform.OS === 'ios'
      ? `http://maps.apple.com/?q=${encodeURIComponent(address)}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  Linking.openURL(url).catch(() => {
    Alert.alert("Couldn't open Maps", 'Try copying the address instead.');
  });
}

interface JobDetailHeaderProps {
  job: Job;
  documents: Document[];
  customerIsUnknown: boolean;
  completedAt: string | null;
  onCustomerEdit: () => void;
  onMenu: () => void;
}

export function JobDetailHeader({
  job,
  documents,
  customerIsUnknown,
  completedAt,
  onCustomerEdit,
  onMenu,
}: JobDetailHeaderProps) {
  const [activityOpen, setActivityOpen] = useState(false);
  const isTerminal = job.stage === 'cancelled' || job.stage === 'closed';
  // Headline figure that goes next to the customer name on line one —
  // mirrors JobCard.pickHeadlineAmount: balance once invoiced, paid
  // once cleared, otherwise quoted.
  const headlineAmount =
    job.totalInvoiced > 0
      ? job.balanceDue > 0
        ? job.balanceDue
        : job.totalPaid
      : job.totalQuoted;

  const toggleActivity = () => {
    selectionTap();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActivityOpen((v) => !v);
  };

  return (
    <Card style={styles.card}>
      <View style={styles.cardContent}>
        {/* Title block + compact contact icons + kebab. The status chip
            that used to live in this corner is now the active pill in
            the bottom stepper. */}
        <View style={styles.topRow}>
          <View style={styles.titleBlock}>
            <View style={styles.titleHeadRow}>
              {customerIsUnknown ? (
                <Pressable
                  onPress={onCustomerEdit}
                  hitSlop={6}
                  style={({ pressed }) => [
                    styles.assignCustomer,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <MaterialCommunityIcons
                    name={'account-plus-outline' as any}
                    size={14}
                    color={colors.primary}
                  />
                  <Text style={styles.assignCustomerLabel}>
                    Add customer details
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={onCustomerEdit}
                  hitSlop={4}
                  style={({ pressed }) => [
                    styles.customerPress,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text style={styles.customer} numberOfLines={1}>
                    {job.customerName}
                  </Text>
                </Pressable>
              )}
              {headlineAmount > 0 ? (
                <Text style={styles.headlinePrice} numberOfLines={1}>
                  {formatCurrency(headlineAmount)}
                </Text>
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

          <Pressable
            onPress={() => {
              selectionTap();
              onMenu();
            }}
            hitSlop={10}
            style={({ pressed }) => [
              styles.menuButton,
              pressed && styles.menuButtonPressed,
            ]}
            accessibilityLabel="Actions"
          >
            <MaterialCommunityIcons
              name={'dots-vertical' as any}
              size={26}
              color={colors.textMuted}
            />
          </Pressable>
        </View>

        {/* Subtle icon-prefixed contact rows — replaces the underlined
            green hyperlink and stacked text lines. */}
        {job.jobAddress ? (
          <Pressable
            onPress={() => {
              selectionTap();
              openMapsFor(job.jobAddress!);
            }}
            style={({ pressed }) => [
              styles.inlineRow,
              pressed && { opacity: 0.6 },
            ]}
          >
            <MaterialCommunityIcons
              name="map-marker-outline"
              size={14}
              color={colors.textMuted}
            />
            <Text style={styles.inlineText} numberOfLines={2}>
              {job.jobAddress}
            </Text>
          </Pressable>
        ) : null}

        {job.customerPhone ? (
          <View style={styles.inlineRow}>
            <MaterialCommunityIcons
              name={'phone-outline' as any}
              size={13}
              color={colors.textMuted}
            />
            <Text style={styles.inlineText} numberOfLines={1}>
              {job.customerPhone}
            </Text>
          </View>
        ) : null}

        {job.customerEmail ? (
          <View style={styles.inlineRow}>
            <MaterialCommunityIcons
              name={'email-outline' as any}
              size={13}
              color={colors.textMuted}
            />
            <Text style={styles.inlineText} numberOfLines={1}>
              {job.customerEmail}
            </Text>
          </View>
        ) : null}

        {/* Low-profile totals strip — four cells with hairline dividers. */}
        <View style={styles.totalsRow}>
          <Totals label="Quoted" value={job.totalQuoted} />
          <View style={styles.totalsDivider} />
          <Totals label="Invoiced" value={job.totalInvoiced} />
          <View style={styles.totalsDivider} />
          <Totals label="Paid" value={job.totalPaid} />
          <View style={styles.totalsDivider} />
          <Totals
            label="Balance"
            value={job.balanceDue}
            accent={job.balanceDue > 0}
          />
        </View>

        {completedAt ? (
          <View style={styles.completedRow}>
            <MaterialCommunityIcons
              name="flag-checkered"
              size={12}
              color={colors.success}
            />
            <Text style={styles.completedText}>Completed {completedAt}</Text>
          </View>
        ) : null}

        {/* Horizontal stepper. Whole row tappable; toggles the inline
            activity log below. The active step is rendered as a pill
            (matches the JobCard summary card). */}
        {!isTerminal ? (
          <Pressable
            onPress={toggleActivity}
            hitSlop={4}
            accessibilityLabel={
              activityOpen ? 'Hide activity log' : 'Show activity log'
            }
            style={({ pressed }) => [pressed && { opacity: 0.85 }]}
          >
            <JobStageTimeline job={job} expanded={activityOpen} />
          </Pressable>
        ) : null}

        {activityOpen ? (
          <View style={styles.activityWrap}>
            <JobTimeline job={job} documents={documents} />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

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

  const tap = (fn: () => void) => () => {
    selectionTap();
    fn();
  };
  const call = () => {
    if (!phone) return;
    Linking.openURL(`tel:${phone.replace(/\s+/g, '')}`).catch(() =>
      Alert.alert("Couldn't call", 'Copy the number instead.'),
    );
  };
  const sms = () => {
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
    openMapsFor(address);
  };

  return (
    <View style={styles.inlineActions}>
      {hasPhone ? (
        <InlineIcon icon="phone" color={colors.success} onPress={tap(call)} />
      ) : null}
      {hasPhone ? (
        <InlineIcon
          icon="message-text"
          color={colors.info}
          onPress={tap(sms)}
        />
      ) : null}
      {hasEmail ? (
        <InlineIcon icon="email" color={colors.warning} onPress={tap(mail)} />
      ) : null}
      {hasAddress ? (
        <InlineIcon
          icon="map-marker"
          color={colors.primary}
          onPress={tap(map)}
        />
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
  onPress: () => void;
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
  expanded,
}: {
  job: Job;
  expanded: boolean;
}) {
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
            {isCurrent ? (
              <View style={styles.timelineActivePill}>
                <MaterialCommunityIcons
                  name={step.icon as any}
                  size={14}
                  color={colors.success}
                />
                <Text style={styles.timelineActiveLabel} numberOfLines={1}>
                  {step.label}
                </Text>
                <MaterialCommunityIcons
                  name={(expanded ? 'chevron-up' : 'chevron-down') as any}
                  size={12}
                  color={colors.success}
                />
              </View>
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

function Totals({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <View style={styles.totalsCell}>
      <Text style={styles.totalsLabel}>{label}</Text>
      <Text
        style={[
          styles.totalsValue,
          accent ? { color: colors.warning } : undefined,
        ]}
        numberOfLines={1}
      >
        {formatCurrency(value)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    margin: 16,
    backgroundColor: colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
  },
  cardContent: {
    padding: 14,
    gap: 8,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  jobName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: colors.onSurface,
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
    marginTop: 4,
  },
  customerPress: {
    flexShrink: 1,
    minWidth: 0,
  },
  customer: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  headlinePrice: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.success,
  },
  assignCustomer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  assignCustomerLabel: {
    fontSize: 15,
    color: colors.primary,
    fontWeight: '700',
  },
  inlineActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 'auto',
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
  menuButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    marginRight: -6,
  },
  menuButtonPressed: {
    backgroundColor: colors.surfaceGray3,
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
  totalsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 4,
    backgroundColor: colors.surfaceDark,
    borderRadius: 10,
  },
  totalsCell: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 4,
    minWidth: 0,
  },
  totalsLabel: {
    fontSize: 9,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontWeight: '600',
  },
  totalsValue: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    marginTop: 2,
  },
  totalsDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: 2,
  },
  completedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: -2,
  },
  completedText: {
    fontSize: 11,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  // Timeline styles mirror JobCard so the visual language matches
  // exactly between the list view and the detail view.
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 2,
    marginHorizontal: -14,
    paddingHorizontal: 12,
  },
  timelineActivePill: {
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
    width: 16,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineMicroDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.inactive,
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
    backgroundColor: colors.success + '88',
  },
  activityWrap: {
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
