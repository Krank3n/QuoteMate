/**
 * JobDetailHeader — slim header card on ViewJobScreen.
 *
 * Replaces the bulky earlier header (large Call/Text/Email/Map tiles +
 * underlined-link address + status pill in the corner) with the JobCard
 * visual language: title, customer, compact circular contact icons,
 * subtle icon-prefixed contact rows, low-profile totals strip, and a
 * horizontal stage stepper at the bottom.
 *
 * Tapping the active pill in the stepper opens the JobStageSheet so the
 * tradie can override the auto-derived stage. The activity log expand /
 * collapse moved to a small chevron in the bottom-right corner so the
 * pill tap is reserved for stage editing.
 */

import React, { useMemo, useState } from 'react';
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
import * as Clipboard from 'expo-clipboard';
import { useNavigation } from '@react-navigation/native';

import type { Job, JobDocument } from '../../shared/job/types';
import type { Document } from '../types/document';
import { computeJobAggregates, quotedRange } from '../../shared/job/aggregate';
import { makeStyles, useThemeColors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { selectionTap, lightTap } from '../utils/haptics';
import { JobTimeline } from './JobTimeline';
import {
  getJobSubStatus,
  isSlotReached,
  type JobSubStatusSlot,
} from '../utils/jobTimeline';
import { openJobPreview } from '../utils/openJobPreview';
import { useStore } from '../store/useStore';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const TIMELINE_SLOTS: Array<{ slot: JobSubStatusSlot }> = [
  { slot: 'quote' },
  { slot: 'accepted' },
  { slot: 'scheduled' },
  { slot: 'in_progress' },
  { slot: 'completed' },
];

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
  /** Tap on the active timeline pill — opens the JobStageSheet. */
  onStagePress?: () => void;
  /** Tap on the job title or description — navigates to the full
   *  Edit Job screen (wizard's JobDetails step). */
  onJobEdit?: () => void;
}

export function JobDetailHeader({
  job,
  documents,
  customerIsUnknown,
  completedAt,
  onCustomerEdit,
  onMenu,
  onStagePress,
  onJobEdit,
}: JobDetailHeaderProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const [activityOpen, setActivityOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const isTerminal = job.stage === 'cancelled' || job.stage === 'closed';
  const primaryDoc = documents.find((d) => d.id === job.primaryDocumentId)
    ?? documents.find((d) => d.jobId === job.id)
    ?? null;

  // Headline figure (single green number, top-right) — live-derived so a
  // draft quote shows its running total immediately, no waiting on the
  // server-side aggregate trigger. Same precedence as the old totals
  // strip: balance owed once invoiced, paid once cleared, otherwise the
  // quoted total.
  const totals = useMemo(
    () => computeJobAggregates(
      { id: job.id },
      documents as unknown as JobDocument[],
    ),
    [job.id, documents],
  );
  // Two undecided options have no single value, and picking one silently is
  // worse than it sounds: the pick is "most recently touched", so the job's
  // headline CHANGES when the tradie opens the other card. Show the spread
  // until the customer decides. See shared/job/aggregate.ts.
  const range = useMemo(
    () => quotedRange(documents.filter((d) => d.jobId === job.id && d.type === 'quote') as any),
    [documents, job.id],
  );
  const headlineAmount =
    totals.totalInvoiced > 0
      ? totals.balanceDue > 0
        ? totals.balanceDue
        : totals.totalPaid
      : totals.totalQuoted;

  // Tap the green headline price → wizard's JobPreviewScreen in
  // viewing mode. Single tap to land on the customer-facing summary.
  const setCurrentQuote = useStore((s) => s.setCurrentQuote);
  const setCurrentInvoice = useStore((s) => s.setCurrentInvoice);
  const navigation = useNavigation<any>();
  const handlePricePress = () => {
    if (!primaryDoc) return;
    selectionTap();
    openJobPreview(primaryDoc, { navigation, setCurrentQuote, setCurrentInvoice });
  };

  // Description was previously buried inside JobScopeCard. Surface it
  // up here as a read-first summary; the "Show more" toggle below
  // expands it AND reveals the raw phone/email strings.
  const description = (
    primaryDoc?.job?.description ??
    job.description ??
    ''
  ).trim();

  const descriptionLong = description.length > 90;
  const hasContacts = !!(job.customerPhone || job.customerEmail);
  const canExpandDetails = descriptionLong || hasContacts;

  const toggleActivity = () => {
    selectionTap();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActivityOpen((v) => !v);
  };

  const toggleDetails = () => {
    selectionTap();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setDetailsOpen((v) => !v);
  };

  const handleEditJob = () => {
    if (!onJobEdit) return;
    selectionTap();
    onJobEdit();
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
                    color={themeColors.accentText}
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
                    {range
                      ? `${formatCurrency(range.min)} – ${formatCurrency(range.max)}`
                      : formatCurrency(headlineAmount)}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.titleSubRow}>
              <Pressable
                onPress={handleEditJob}
                hitSlop={4}
                style={({ pressed }) => [
                  styles.jobNamePress,
                  pressed && { opacity: 0.7 },
                ]}
                accessibilityLabel="Edit job"
              >
                <Text style={styles.jobName}>
                  {job.name || 'Untitled job'}
                </Text>
              </Pressable>
              <InlineContactActions
                phone={job.customerPhone}
                email={job.customerEmail}
                address={job.jobAddress}
              />
            </View>
            {description ? (
              <Pressable
                onPress={handleEditJob}
                hitSlop={4}
                accessibilityLabel="Edit job description"
              >
                <Text
                  style={styles.description}
                  numberOfLines={detailsOpen ? undefined : 2}
                >
                  {description}
                </Text>
              </Pressable>
            ) : null}
            {detailsOpen && hasContacts ? (
              <View style={styles.contactStringsBlock}>
                {job.customerPhone ? (
                  <View style={styles.contactStringRow}>
                    <MaterialCommunityIcons
                      name={'phone-outline' as any}
                      size={13}
                      color={themeColors.textMuted}
                    />
                    <Text style={styles.contactStringText} selectable>
                      {job.customerPhone}
                    </Text>
                  </View>
                ) : null}
                {job.customerEmail ? (
                  <View style={styles.contactStringRow}>
                    <MaterialCommunityIcons
                      name={'email-outline' as any}
                      size={13}
                      color={themeColors.textMuted}
                    />
                    <Text
                      style={styles.contactStringText}
                      selectable
                      numberOfLines={1}
                    >
                      {job.customerEmail}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            {canExpandDetails ? (
              <Pressable
                onPress={toggleDetails}
                hitSlop={6}
                accessibilityLabel={
                  detailsOpen ? 'Show less' : 'Show more details'
                }
                style={({ pressed }) => [
                  styles.detailsToggle,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={styles.detailsToggleLabel}>
                  {detailsOpen ? 'Show less' : 'Show more'}
                </Text>
                <MaterialCommunityIcons
                  name={(detailsOpen ? 'chevron-up' : 'chevron-down') as any}
                  size={16}
                  color={themeColors.accentText}
                />
              </Pressable>
            ) : null}
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
              color={themeColors.textMuted}
            />
          </Pressable>
        </View>

        {/* Address stays as a row — it doubles as the "where am I going"
            context that an icon alone can't convey. Phone + email rows
            were removed; the action icons in the title row already cover
            tap-to-call / sms / email, with long-press to copy. */}
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
              color={themeColors.textMuted}
            />
            <Text style={styles.inlineText} numberOfLines={2}>
              {job.jobAddress}
            </Text>
          </Pressable>
        ) : null}

        {completedAt ? (
          <View style={styles.completedRow}>
            <MaterialCommunityIcons
              name="flag-checkered"
              size={12}
              color={themeColors.money}
            />
            <Text style={styles.completedText}>Completed {completedAt}</Text>
          </View>
        ) : null}

        {/* Horizontal stepper. Tap on the active pill opens the
            JobStageSheet so the tradie can override the auto-derived
            stage. The activity-log expand/collapse moved to the small
            chevron in the bottom-right corner. */}
        {!isTerminal ? (
          <JobStageTimeline
            job={job}
            primaryDoc={primaryDoc}
            onActivePress={onStagePress}
          />
        ) : null}

        {activityOpen ? (
          <View style={styles.activityWrap}>
            <JobTimeline
              job={job}
              documents={documents}
              collapsedCount={Number.MAX_SAFE_INTEGER}
            />
          </View>
        ) : null}

        {/* Activity log toggle — sits in the bottom-right corner so the
            timeline pill above is reserved for tap-to-edit-stage. */}
        <View style={styles.activityToggleRow}>
          <Pressable
            onPress={toggleActivity}
            hitSlop={8}
            accessibilityLabel={
              activityOpen ? 'Hide activity log' : 'Show activity log'
            }
            style={({ pressed }) => [
              styles.activityToggleBtn,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={styles.activityToggleLabel}>
              {activityOpen ? 'Hide activity' : 'Activity'}
            </Text>
            <MaterialCommunityIcons
              name={(activityOpen ? 'chevron-up' : 'chevron-down') as any}
              size={16}
              color={themeColors.textMuted}
            />
          </Pressable>
        </View>
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
  const styles = useStyles();
  const themeColors = useThemeColors();
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

  // Long-press a contact icon → copy the underlying string. The on-screen
  // text rows are gone now (icons-only), so this is the recovery path
  // when the tradie wants to paste the number/email somewhere else.
  const copyToClipboard = async (value: string, label: string) => {
    try {
      await Clipboard.setStringAsync(value);
      lightTap();
      Alert.alert('', `${label} copied`);
    } catch {
      Alert.alert("Couldn't copy", value);
    }
  };

  return (
    <View style={styles.inlineActions}>
      {hasPhone ? (
        <InlineIcon
          icon="phone"
          color={themeColors.money}
          onPress={tap(call)}
          onLongPress={() => copyToClipboard(phone!, 'Phone')}
        />
      ) : null}
      {hasPhone ? (
        <InlineIcon
          icon="message-text"
          color={themeColors.info}
          onPress={tap(sms)}
          onLongPress={() => copyToClipboard(phone!, 'Phone')}
        />
      ) : null}
      {hasEmail ? (
        <InlineIcon
          icon="email"
          color={themeColors.warning}
          onPress={tap(mail)}
          onLongPress={() => copyToClipboard(email!, 'Email')}
        />
      ) : null}
      {hasAddress ? (
        <InlineIcon
          icon="map-marker"
          color={themeColors.accentText}
          onPress={tap(map)}
          onLongPress={() => copyToClipboard(address!, 'Address')}
        />
      ) : null}
    </View>
  );
}

function InlineIcon({
  icon,
  color,
  onPress,
  onLongPress,
}: {
  icon: string;
  color: string;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
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
  onActivePress?: () => void;
}) {
  const styles = useStyles();
  const themeColors = useThemeColors();
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
                  onPress={() => {
                    selectionTap();
                    onActivePress();
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
                    color={themeColors.money}
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
                    color={themeColors.money}
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

const useStyles = makeStyles((t) => ({
  card: {
    margin: 16,
    backgroundColor: t.colors.surfaceRaised,
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
  jobNamePress: {
    flex: 1,
    minWidth: 0,
  },
  jobName: {
    fontSize: 15,
    fontWeight: '500',
    color: t.colors.textSecondary,
  },
  description: {
    fontSize: 13,
    lineHeight: 18,
    color: t.colors.textMuted,
    marginTop: 4,
  },
  detailsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 2,
    marginTop: 4,
    paddingVertical: 2,
  },
  detailsToggleLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: t.colors.accentText,
  },
  contactStringsBlock: {
    marginTop: 6,
    gap: 4,
  },
  contactStringRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  contactStringText: {
    fontSize: 13,
    color: t.colors.text,
    flexShrink: 1,
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
    color: t.colors.text,
  },
  headlinePricePress: {
    marginLeft: 'auto',
  },
  headlinePrice: {
    fontSize: 20,
    fontWeight: '800',
    color: t.colors.money,
    textAlign: 'right',
  },
  assignCustomer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  assignCustomerLabel: {
    fontSize: 15,
    color: t.colors.accentText,
    fontWeight: '700',
  },
  inlineActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 'auto',
    // Breathing room from the green headlinePrice that sits directly
    // above on the title head row.
    marginTop: 6,
  },
  inlineIconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.colors.overlayPressed,
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
    backgroundColor: t.colors.surfacePressed,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inlineText: {
    fontSize: 13,
    color: t.colors.textMuted,
    flexShrink: 1,
  },
  completedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: -2,
  },
  completedText: {
    fontSize: 11,
    color: t.colors.textMuted,
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
    borderColor: t.colors.money,
    backgroundColor: 'transparent',
    flexShrink: 0,
  },
  timelineActiveLabel: {
    fontSize: 11,
    color: t.colors.money,
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
    backgroundColor: t.colors.textDisabled,
  },
  timelineMicroDotReached: {
    backgroundColor: t.colors.money,
  },
  timelineConnector: {
    flex: 1,
    height: 2,
    backgroundColor: t.colors.textDisabled,
    marginHorizontal: 2,
    borderRadius: 1,
  },
  timelineConnectorReached: {
    backgroundColor: t.colors.moneySubtle,
  },
  activityWrap: {
    marginTop: 4,
  },
  activityToggleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 4,
    marginBottom: -4,
    marginRight: -4,
  },
  activityToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  activityToggleLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: t.colors.textMuted,
  },
}));
