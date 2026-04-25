/**
 * JobTimeline
 *
 * Collapsable activity timeline for a Job. Shows the newest two events
 * by default with a subtle gradient fade; tap "Show timeline · N" to
 * expand and see the full history. The expanded list is still inside a
 * ScrollView on short screens, but on most it fits flat.
 *
 * Visual style:
 *  - Vertical connector line runs down the left edge, stitched through
 *    dot markers per event.
 *  - Dot color keyed to event kind (money → success, rejection → error,
 *    upcoming → muted outline).
 *  - Upcoming (future) events render with a dashed outline dot + italic
 *    muted text so they read as "what's next" not history.
 *  - Animated expand/collapse via LayoutAnimation + a small chevron
 *    rotation for the toggle.
 */

import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Animated,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { formatDistanceToNow, format } from 'date-fns';

import type { Job } from '../../shared/job/types';
import type { Document } from '../types/document';
import { colors } from '../theme';
import {
  deriveTimelineEvents,
  formatEventAmount,
  type TimelineEvent,
  type TimelineEventKind,
} from '../utils/jobTimeline';
import { selectionTap } from '../utils/haptics';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface JobTimelineProps {
  job: Job;
  documents: Document[];
  /** How many events to show while collapsed. Default 2. */
  collapsedCount?: number;
}

interface EventMeta {
  icon: string;
  color: string;
  bgColor: string;
}

const META: Record<TimelineEventKind, EventMeta> = {
  job_created:            { icon: 'briefcase-plus-outline',    color: colors.info,    bgColor: colors.infoBg },
  quote_drafted:          { icon: 'file-document-edit-outline', color: colors.info,    bgColor: colors.infoBg },
  quote_sent:             { icon: 'send-outline',               color: colors.warning, bgColor: colors.warningBg },
  quote_accepted:         { icon: 'check-circle-outline',       color: colors.success, bgColor: colors.successBg },
  quote_rejected:         { icon: 'close-circle-outline',       color: colors.error,   bgColor: colors.errorBg },
  invoice_created:        { icon: 'file-swap-outline',          color: colors.primary, bgColor: colors.primaryBg },
  invoice_sent:           { icon: 'send',                       color: colors.warning, bgColor: colors.warningBg },
  payment_deposit:        { icon: 'cash-plus',                  color: colors.success, bgColor: colors.successBg },
  payment_balance:        { icon: 'cash-check',                 color: colors.success, bgColor: colors.successBg },
  payment_manual:         { icon: 'cash-multiple',              color: colors.success, bgColor: colors.successBg },
  job_scheduled:          { icon: 'calendar-clock-outline',     color: colors.info,    bgColor: colors.infoBg },
  job_in_progress:        { icon: 'hammer-wrench',              color: colors.warning, bgColor: colors.warningBg },
  job_completed:          { icon: 'flag-checkered',             color: colors.success, bgColor: colors.successBg },
  job_paid:               { icon: 'cash-check',                 color: colors.success, bgColor: colors.successBg },
  job_closed:             { icon: 'archive-outline',            color: colors.inactive,bgColor: colors.surfaceGray3 },
  job_cancelled:          { icon: 'close-octagon-outline',      color: colors.error,   bgColor: colors.errorBg },
  job_scheduled_upcoming: { icon: 'timer-sand',                 color: colors.textMuted, bgColor: colors.surfaceGray3 },
};

function relativeLabel(ms: number): string {
  if (!ms) return '';
  try {
    const d = new Date(ms);
    const days = (Date.now() - ms) / (24 * 60 * 60 * 1000);
    // If older than 14 days, show the absolute date (less noisy than "3 weeks ago").
    if (Math.abs(days) > 14) return format(d, 'd MMM yyyy');
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return '';
  }
}

function absoluteLabel(ms: number): string {
  if (!ms) return '';
  try {
    return format(new Date(ms), "d MMM yyyy · h:mm a").toLowerCase();
  } catch {
    return '';
  }
}

export function JobTimeline({
  job,
  documents,
  collapsedCount = 2,
}: JobTimelineProps) {
  const [expanded, setExpanded] = useState(false);
  const chevronSpin = useRef(new Animated.Value(0)).current;

  const events = useMemo(
    () => deriveTimelineEvents(job, documents),
    [job, documents],
  );

  if (events.length === 0) return null;

  const visible = expanded ? events : events.slice(0, collapsedCount);
  const hiddenCount = Math.max(0, events.length - collapsedCount);
  const canExpand = hiddenCount > 0;

  const toggle = () => {
    if (!canExpand) return;
    selectionTap();
    LayoutAnimation.configureNext({
      duration: 220,
      create: { type: 'easeInEaseOut', property: 'opacity' },
      update: { type: 'easeInEaseOut' },
      delete: { type: 'easeInEaseOut', property: 'opacity' },
    });
    Animated.timing(chevronSpin, {
      toValue: expanded ? 0 : 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
    setExpanded((e) => !e);
  };

  const chevronRotate = chevronSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  return (
    <View style={styles.container}>
      {canExpand ? (
        <View style={styles.headerRow}>
          <Pressable onPress={toggle} hitSlop={8} style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>
              {expanded ? 'Collapse' : `Show timeline · ${events.length}`}
            </Text>
            <Animated.View style={{ transform: [{ rotate: chevronRotate }] }}>
              <MaterialCommunityIcons
                name={'chevron-down' as any}
                size={18}
                color={colors.primary}
              />
            </Animated.View>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.list}>
        {visible.map((event, idx) => (
          <TimelineRow
            key={event.id}
            event={event}
            isFirst={idx === 0}
            isLast={idx === visible.length - 1 && (expanded || !canExpand)}
          />
        ))}

        {!expanded && canExpand ? (
          <Pressable onPress={toggle} style={styles.moreRow}>
            <View style={styles.moreDot} />
            <Text style={styles.moreLabel}>
              {hiddenCount} earlier {hiddenCount === 1 ? 'event' : 'events'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function TimelineRow({
  event,
  isFirst,
  isLast,
}: {
  event: TimelineEvent;
  isFirst: boolean;
  isLast: boolean;
}) {
  const meta = META[event.kind];
  const amountLabel = formatEventAmount(event.amount);
  const dateLabel = relativeLabel(event.at);
  const absLabel = absoluteLabel(event.at);

  return (
    <View style={styles.row}>
      {/* Rail — connector line + dot */}
      <View style={styles.rail}>
        {!isFirst ? <View style={styles.connectorTop} /> : <View style={styles.connectorSpacer} />}
        <View
          style={[
            styles.dot,
            { backgroundColor: event.upcoming ? 'transparent' : meta.bgColor, borderColor: meta.color },
            event.upcoming && styles.dotUpcoming,
          ]}
        >
          <MaterialCommunityIcons
            name={meta.icon as any}
            size={12}
            color={event.upcoming ? meta.color : meta.color}
          />
        </View>
        {!isLast ? <View style={styles.connectorBottom} /> : <View style={styles.connectorSpacer} />}
      </View>

      {/* Body */}
      <View style={[styles.body, event.upcoming && styles.bodyUpcoming]}>
        <View style={styles.titleRow}>
          <Text
            style={[styles.title, event.upcoming && styles.titleUpcoming]}
            numberOfLines={1}
          >
            {event.title}
          </Text>
          {amountLabel ? (
            <Text style={[styles.amount, event.upcoming && styles.titleUpcoming]}>
              {amountLabel}
            </Text>
          ) : null}
        </View>
        <View style={styles.metaRow}>
          {event.detail ? (
            <>
              <Text style={styles.detail} numberOfLines={1}>
                {event.detail}
              </Text>
              <Text style={styles.dotSep}>·</Text>
            </>
          ) : null}
          <Text
            style={styles.timestamp}
            numberOfLines={1}
            accessibilityLabel={absLabel}
          >
            {dateLabel}
          </Text>
        </View>
      </View>
    </View>
  );
}

const DOT_SIZE = 22;
const RAIL_WIDTH = 32;

const styles = StyleSheet.create({
  container: {
    // Embedded inside JobDetailHeader; no outer card chrome — the parent
    // already supplies the surface, padding, and border.
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginBottom: 4,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  toggleLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  list: {
    paddingTop: 2,
  },
  row: {
    flexDirection: 'row',
    minHeight: 44,
  },
  rail: {
    width: RAIL_WIDTH,
    alignItems: 'center',
  },
  connectorTop: {
    width: 2,
    height: 8,
    backgroundColor: colors.border,
  },
  connectorBottom: {
    flex: 1,
    width: 2,
    backgroundColor: colors.border,
  },
  connectorSpacer: {
    height: 8,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  dotUpcoming: {
    borderStyle: 'dashed',
  },
  body: {
    flex: 1,
    paddingVertical: 6,
    paddingLeft: 6,
  },
  bodyUpcoming: {
    opacity: 0.7,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  titleUpcoming: {
    fontStyle: 'italic',
    color: colors.textMuted,
    fontWeight: '500',
  },
  amount: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: 6,
    flexWrap: 'wrap',
  },
  detail: {
    fontSize: 12,
    color: colors.onSurface,
    flexShrink: 1,
  },
  dotSep: {
    fontSize: 12,
    color: colors.textMuted,
  },
  timestamp: {
    fontSize: 12,
    color: colors.textMuted,
  },
  moreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 6,
    marginTop: 4,
  },
  moreDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    marginLeft: (RAIL_WIDTH - 6) / 2,
    marginRight: 6,
  },
  moreLabel: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
  },
});
