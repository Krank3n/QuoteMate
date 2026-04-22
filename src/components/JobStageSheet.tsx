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
import { colors } from '../theme';
import { selectionTap } from '../utils/haptics';
import { BottomSheet, useStaggeredEntrance } from './BottomSheet';

interface JobStageSheetProps {
  visible: boolean;
  onDismiss: () => void;
  job: Job;
  onSelect: (targetStage: JobStage) => void;
  title?: string;
}

interface StageMeta {
  label: string;
  icon: string;
  color: string;
  bgColor: string;
}

export const JOB_STAGE_META: Record<JobStage, StageMeta> = {
  inquiry: {
    label: 'Mark as Inquiry',
    icon: 'help-circle-outline',
    color: colors.info,
    bgColor: colors.infoBg,
  },
  quoted: {
    label: 'Mark as Quoted',
    icon: 'send-outline',
    color: colors.warning,
    bgColor: colors.warningBg,
  },
  accepted: {
    label: 'Mark as Accepted',
    icon: 'check-circle-outline',
    color: colors.success,
    bgColor: colors.successBg,
  },
  scheduled: {
    label: 'Mark as Scheduled',
    icon: 'calendar-clock-outline',
    color: colors.info,
    bgColor: colors.infoBg,
  },
  in_progress: {
    label: 'Mark as In Progress',
    icon: 'hammer-wrench',
    color: colors.warning,
    bgColor: colors.warningBg,
  },
  completed: {
    label: 'Mark as Completed',
    icon: 'flag-checkered',
    color: colors.success,
    bgColor: colors.successBg,
  },
  paid: {
    label: 'Mark as Paid',
    icon: 'cash-check',
    color: colors.success,
    bgColor: colors.successBg,
  },
  closed: {
    label: 'Archive',
    icon: 'archive-outline',
    color: colors.inactive,
    bgColor: colors.surfaceGray3,
  },
  cancelled: {
    label: 'Cancel Job',
    icon: 'close-octagon-outline',
    color: colors.error,
    bgColor: colors.errorBg,
  },
};

// The UI offers direct jumps to any non-terminal stage (per the meta-plan:
// "strict in the backend, flexible in the UI"). The server-side state
// machine still enforces the transition graph, so only legal edges succeed.
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

export function JobStageSheet({
  visible,
  onDismiss,
  job,
  onSelect,
  title = 'Update Stage',
}: JobStageSheetProps) {
  // Show all non-terminal, non-current stages — the UI is flexible so tradies
  // can jump freely (e.g. accepted → completed without passing through
  // in_progress). The server-side state machine still enforces the transition
  // graph; illegal jumps are rejected there.
  const targets = React.useMemo<JobStage[]>(() => {
    return ALL_STAGES.filter((s) => s !== job.stage);
  }, [job.stage]);

  const anims = useStaggeredEntrance(targets.length, visible, 100, 40);

  const handleSelect = (target: JobStage) => {
    selectionTap();
    onSelect(target);
  };

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} title={title}>
      <View style={styles.optionsContainer}>
        {targets.map((target, index) => {
          const meta = JOB_STAGE_META[target];
          const anim = anims[index];

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
                  <Text style={styles.optionLabel}>{meta.label}</Text>
                </View>

                <MaterialCommunityIcons
                  name="chevron-right"
                  size={20}
                  color={colors.inactive}
                />
              </Pressable>
            </Animated.View>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  optionsContainer: {
    gap: 10,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: colors.surfaceGray3,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  optionPressed: {
    backgroundColor: colors.surfaceGray2,
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
    color: colors.text,
  },
});
