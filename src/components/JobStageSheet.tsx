/**
 * JobStageSheet
 * Bottom sheet for changing a Job's stage. Mirrors StageSheet one-for-one —
 * filters legal transitions via canTransition (from the shared Job state
 * machine), renders each target as a tappable row with icon + label.
 */

import React from 'react';
import { View, StyleSheet, Pressable, Animated } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import type { Job, JobStage } from '../../shared/job/types';
import { canTransition } from '../../shared/job/stage';
import type { Tokens } from '../theme';
import { makeStyles, useThemeColors } from '../theme';
import { selectionTap } from '../utils/haptics';
import { BottomSheet, useStaggeredEntrance } from './BottomSheet';

interface JobStageSheetProps {
  visible: boolean;
  onDismiss: () => void;
  job: Job;
  /** True if the job's primary doc has money against its deposit. Used
   *  by the shared state machine to gate `accepted → quoted`. */
  depositPaid?: boolean;
  onSelect: (targetStage: JobStage) => void;
  /**
   * Schedule action — when supplied, a dedicated "Schedule…" row sits
   * above the regular stage list and the implicit `scheduled` target is
   * dropped from the legal-transition list (so it doesn't appear twice).
   * Schedule isn't a plain stage flip — the picker writes the date and
   * lets the save path bump the stage — so it lives outside the
   * canTransition graph.
   */
  onSchedule?: () => void;
  title?: string;
}

interface StageMeta {
  /** Static state name shown in chips ("Cancelled", "In Progress"). */
  chipLabel: string;
  /** Verb-y label shown as a row in the action sheet ("Cancel Job",
   *  "Mark as Paid"). */
  actionLabel: string;
  icon: string;
  color: string;
  bgColor: string;
}

/**
 * Stage meta with a safe fallback. A server aggregate write racing a client
 * job delete has produced stage-less "ghost" job docs in production (see
 * syncJobAggregates), and JobCard renders whatever the listener delivers —
 * one malformed doc must never hard-crash every screen that shows jobs.
 */
export function stageMetaFor(stage: JobStage | undefined, themeColors: Tokens): StageMeta {
  const meta = jobStageMetaFor(themeColors);
  return meta[stage as JobStage] ?? meta.inquiry;
}

export const jobStageMetaFor = (themeColors: Tokens): Record<JobStage, StageMeta> => ({
  inquiry: {
    chipLabel: 'Inquiry',
    actionLabel: 'Mark as Inquiry',
    icon: 'help-circle-outline',
    // Neutral for the same reason 'draft' is: nothing has happened on this job
    // yet. Giving it a real colour makes an untouched job look as active as a
    // sent one in the list.
    color: themeColors.neutral,
    bgColor: themeColors.neutralSubtle,
  },
  quoted: {
    chipLabel: 'Quoted',
    actionLabel: 'Mark as Quoted',
    icon: 'send-outline',
    color: themeColors.warning,
    bgColor: themeColors.warningSubtle,
  },
  accepted: {
    chipLabel: 'Accepted',
    actionLabel: 'Mark as Accepted',
    icon: 'check-circle-outline',
    color: themeColors.money,
    bgColor: themeColors.moneySubtle,
  },
  scheduled: {
    chipLabel: 'Scheduled',
    actionLabel: 'Schedule…',
    icon: 'calendar-clock-outline',
    color: themeColors.info,
    bgColor: themeColors.infoSubtle,
  },
  in_progress: {
    chipLabel: 'In Progress',
    actionLabel: 'Mark as In Progress',
    icon: 'hammer-wrench',
    color: themeColors.warning,
    bgColor: themeColors.warningSubtle,
  },
  completed: {
    chipLabel: 'Completed',
    actionLabel: 'Mark as Completed',
    icon: 'flag-checkered',
    color: themeColors.money,
    bgColor: themeColors.moneySubtle,
  },
  paid: {
    chipLabel: 'Paid',
    actionLabel: 'Mark as Paid',
    icon: 'cash-check',
    color: themeColors.money,
    bgColor: themeColors.moneySubtle,
  },
  closed: {
    chipLabel: 'Closed',
    actionLabel: 'Archive',
    icon: 'archive-outline',
    color: themeColors.textDisabled,
    bgColor: themeColors.surfacePressed,
  },
  cancelled: {
    chipLabel: 'Cancelled',
    actionLabel: 'Cancel Job',
    icon: 'close-octagon-outline',
    color: themeColors.error,
    bgColor: themeColors.errorSubtle,
  },
});

const ALL_STAGES: JobStage[] = [
  'inquiry',
  'quoted',
  'accepted',
  'scheduled',
  'in_progress',
  'completed',
  'paid',
  'closed',
  'cancelled',
];

// Stages where penciling in a date doesn't make sense — once the work
// is done or the job is dead, hide "Schedule…".
const SCHEDULE_HIDDEN_STAGES: ReadonlySet<JobStage> = new Set([
  'completed',
  'paid',
  'closed',
  'cancelled',
]);

export function JobStageSheet({
  visible,
  onDismiss,
  job,
  depositPaid,
  onSelect,
  onSchedule,
  title = 'Update Stage',
}: JobStageSheetProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const JOB_STAGE_META = jobStageMetaFor(themeColors);
  const showSchedule = !!onSchedule && !SCHEDULE_HIDDEN_STAGES.has(job.stage);

  // Only offer legal transitions from the shared state machine. This
  // changed in Phase-17 — the UI used to show every stage (trusting the
  // server to reject illegal edges), but that meant tradies could tap a
  // stage and hit a silent failure. Better to hide what you can't do.
  // 'scheduled' is dropped here when the dedicated Schedule row is
  // showing so the same action doesn't appear twice.
  const targets = React.useMemo<JobStage[]>(() => {
    return ALL_STAGES.filter(
      (s) =>
        s !== job.stage &&
        canTransition(job.stage, s, { depositPaid }) &&
        !(showSchedule && s === 'scheduled'),
    );
  }, [job.stage, depositPaid, showSchedule]);

  const totalRows = targets.length + (showSchedule ? 1 : 0);
  const anims = useStaggeredEntrance(totalRows, visible, 100, 40);

  const handleSelect = (target: JobStage) => {
    selectionTap();
    onSelect(target);
  };

  const handleSchedule = () => {
    selectionTap();
    onSchedule?.();
  };

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} title={title}>
      <View style={styles.optionsContainer}>
        {showSchedule ? (
          <Animated.View
            style={{
              opacity: anims[0],
              transform: [
                { translateY: anims[0].interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) },
                { scale: anims[0].interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }) },
              ],
            }}
          >
            <Pressable
              style={({ pressed }) => [
                styles.option,
                pressed && styles.optionPressed,
              ]}
              onPress={handleSchedule}
            >
              <View style={[styles.iconCircle, { backgroundColor: themeColors.infoSubtle }]}>
                <MaterialCommunityIcons
                  name={'calendar-clock-outline' as any}
                  size={22}
                  color={themeColors.info}
                />
              </View>
              <View style={styles.labelContainer}>
                <Text style={styles.optionLabel}>Schedule…</Text>
              </View>
              <MaterialCommunityIcons
                name="chevron-right"
                size={20}
                color={themeColors.textDisabled}
              />
            </Pressable>
          </Animated.View>
        ) : null}
        {targets.map((target, index) => {
          const meta = JOB_STAGE_META[target];
          // Offset by 1 when the schedule row owns the first stagger slot.
          const anim = anims[index + (showSchedule ? 1 : 0)];

          return (
            <Animated.View
              key={target}
              style={{
                opacity: anim,
                transform: [
                  { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) },
                  { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }) },
                ],
              }}
            >
              <Pressable
                style={({ pressed }) => [
                  styles.option,
                  pressed && styles.optionPressed,
                ]}
                onPress={() => handleSelect(target)}
              >
                <View style={[styles.iconCircle, { backgroundColor: meta.bgColor }]}>
                  <MaterialCommunityIcons
                    name={meta.icon as any}
                    size={22}
                    color={meta.color}
                  />
                </View>

                <View style={styles.labelContainer}>
                  <Text style={styles.optionLabel}>{meta.actionLabel}</Text>
                </View>

                <MaterialCommunityIcons
                  name="chevron-right"
                  size={20}
                  color={themeColors.textDisabled}
                />
              </Pressable>
            </Animated.View>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const useStyles = makeStyles((t) => ({
  optionsContainer: {
    gap: 10,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: t.colors.surfacePressed,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  optionPressed: {
    backgroundColor: t.colors.surfaceOverlay,
    transform: [{ scale: 0.98 }],
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  labelContainer: {
    flex: 1,
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: t.colors.text,
  },
}));
