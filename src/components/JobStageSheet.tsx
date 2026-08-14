/**
 * JobStageSheet
 * Bottom sheet for changing a Job's stage — the door the card's timeline
 * pill opens. Filters legal transitions via canTransition (from the shared
 * Job state machine) and renders each target through StageOptionRow, the
 * same row the kebab's "Change status" submenu uses, so the two doors into
 * one action don't look like two different features.
 */

import React from 'react';
import { Animated } from 'react-native';

import type { Job, JobStage } from '../../shared/job/types';
import { legalStageTargets, shouldOfferSchedule } from '../utils/jobStageTargets';
import { isLiveInvoice, jobStatusLabel, STAGE_CHIP_LABELS } from '../utils/jobTimeline';
import type { Document } from '../types/document';
import type { Tokens } from '../theme';
import { useThemeColors } from '../theme';
import { selectionTap } from '../utils/haptics';
import { BottomSheet, useStaggeredEntrance } from './BottomSheet';
import { StageOptionList, StageOptionRow } from './StageOptionRow';

interface JobStageSheetProps {
  visible: boolean;
  onDismiss: () => void;
  job: Job;
  /** True if the job's primary doc has money against its deposit. Used
   *  by the shared state machine to gate `accepted → quoted`. */
  depositPaid?: boolean;
  onSelect: (targetStage: JobStage) => void;
  /**
   * Schedule action — when supplied, the "Mark as Scheduled…" row opens
   * the date picker instead of flipping the stage on its own (the picker
   * writes the date and the save path bumps the stage). A job that's
   * already scheduled gets a "Reschedule…" row instead, since the ladder
   * can't offer the stage it's standing on and the card's pill is the only
   * door to the date the list screens have.
   */
  onSchedule?: () => void;
  title?: string;
  /**
   * The job's primary document. Used to drop the quote-side stages once
   * it's a live invoice — see documentIsInvoice in jobStageTargets. Shared
   * with the kebab's submenu so the two doors offer the same list.
   */
  primaryDoc?: Document | null;
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
    chipLabel: STAGE_CHIP_LABELS.inquiry,
    actionLabel: 'Mark as Inquiry',
    icon: 'help-circle-outline',
    // Neutral for the same reason 'draft' is: nothing has happened on this job
    // yet. Giving it a real colour makes an untouched job look as active as a
    // sent one in the list.
    color: themeColors.neutral,
    bgColor: themeColors.neutralSubtle,
  },
  quoted: {
    chipLabel: STAGE_CHIP_LABELS.quoted,
    actionLabel: 'Mark as Quoted',
    icon: 'send-outline',
    color: themeColors.warning,
    bgColor: themeColors.warningSubtle,
  },
  accepted: {
    chipLabel: STAGE_CHIP_LABELS.accepted,
    actionLabel: 'Mark as Accepted',
    icon: 'check-circle-outline',
    color: themeColors.money,
    bgColor: themeColors.moneySubtle,
  },
  scheduled: {
    chipLabel: STAGE_CHIP_LABELS.scheduled,
    // Phrased like every other row in the list. It used to read
    // "Schedule…", which is the verb for the picker it opens but not the
    // status it sets — a tradie scanning the list for "Scheduled" found
    // nothing, and concluded the status didn't exist.
    actionLabel: 'Mark as Scheduled',
    icon: 'calendar-clock-outline',
    color: themeColors.info,
    bgColor: themeColors.infoSubtle,
  },
  in_progress: {
    chipLabel: STAGE_CHIP_LABELS.in_progress,
    actionLabel: 'Mark as In Progress',
    icon: 'hammer-wrench',
    color: themeColors.warning,
    bgColor: themeColors.warningSubtle,
  },
  completed: {
    chipLabel: STAGE_CHIP_LABELS.completed,
    actionLabel: 'Mark as Completed',
    icon: 'flag-checkered',
    color: themeColors.money,
    bgColor: themeColors.moneySubtle,
  },
  paid: {
    chipLabel: STAGE_CHIP_LABELS.paid,
    actionLabel: 'Mark as Paid',
    icon: 'cash-check',
    color: themeColors.money,
    bgColor: themeColors.moneySubtle,
  },
  closed: {
    chipLabel: STAGE_CHIP_LABELS.closed,
    actionLabel: 'Archive',
    icon: 'archive-outline',
    color: themeColors.textDisabled,
    bgColor: themeColors.surfacePressed,
  },
  cancelled: {
    chipLabel: STAGE_CHIP_LABELS.cancelled,
    actionLabel: 'Cancel Job',
    icon: 'close-octagon-outline',
    color: themeColors.error,
    bgColor: themeColors.errorSubtle,
  },
});

export function JobStageSheet({
  visible,
  onDismiss,
  job,
  depositPaid,
  onSelect,
  onSchedule,
  title = 'Change status',
  primaryDoc,
}: JobStageSheetProps) {
  const themeColors = useThemeColors();
  const JOB_STAGE_META = jobStageMetaFor(themeColors);
  const showSchedule = !!onSchedule && shouldOfferSchedule(job);

  // Shared with the kebab's "Change status" submenu — see legalStageTargets.
  const targets = React.useMemo<JobStage[]>(
    () =>
      legalStageTargets(job.stage, {
        depositPaid,
        documentIsInvoice: isLiveInvoice(primaryDoc),
      }),
    [job.stage, depositPaid, primaryDoc],
  );

  const handleSelect = (target: JobStage) => {
    selectionTap();
    onSelect(target);
  };

  const handleSchedule = () => {
    selectionTap();
    onSchedule?.();
  };

  // Echoes the pill the tradie just tapped — see jobStatusLabel.
  const currentLabel = jobStatusLabel(job, primaryDoc);

  // The legal stages in ladder order, with the date door in front of them
  // when the job already sits on 'scheduled' (the ladder can't offer the
  // stage it's on). Same list, same order as the kebab's submenu.
  const options: Array<{
    key: string;
    icon: string;
    color: string;
    label: string;
    onPress: () => void;
  }> = [
    ...(showSchedule && job.stage === 'scheduled'
      ? [
          {
            key: 'reschedule',
            icon: 'calendar-clock-outline',
            color: themeColors.info,
            label: 'Reschedule…',
            onPress: handleSchedule,
          },
        ]
      : []),
    ...targets.map((target) => {
      const meta = JOB_STAGE_META[target];
      // Scheduling writes a date; the stage follows from it. The ellipsis
      // is the app's mark for a row that opens more UI.
      const opensPicker = target === 'scheduled' && showSchedule;
      return {
        key: target,
        icon: meta.icon,
        color: meta.color,
        label: opensPicker ? `${meta.actionLabel}…` : meta.actionLabel,
        onPress: opensPicker ? handleSchedule : () => handleSelect(target),
      };
    }),
  ];

  const anims = useStaggeredEntrance(options.length, visible, 100, 40);

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      title={title}
      subtitle={`Currently ${currentLabel}`}
    >
      <StageOptionList>
        {options.map((option, index) => {
          const anim = anims[index];
          return (
            <Animated.View
              key={option.key}
              style={{
                opacity: anim,
                transform: [
                  { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) },
                  { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }) },
                ],
              }}
            >
              <StageOptionRow
                icon={option.icon}
                color={option.color}
                label={option.label}
                onPress={option.onPress}
              />
            </Animated.View>
          );
        })}
      </StageOptionList>
    </BottomSheet>
  );
}
