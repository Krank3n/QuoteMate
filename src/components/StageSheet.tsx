/**
 * Stage Sheet Component
 * Bottom sheet for changing a Document's stage. Computes legal next stages
 * from the canTransition state machine and renders each one through
 * StageOptionRow — the same row the job-side status surfaces use, so a
 * tradie changing a document's status sees the list they already know from
 * the card pill and the kebab.
 */

import React from 'react';
import { Animated } from 'react-native';

import type { Document, DocumentStage } from '../types/document';
import { canTransition } from '../../shared/document/stage';
import type { Tokens } from '../theme';
import { useThemeColors } from '../theme';
import { selectionTap } from '../utils/haptics';
import { BottomSheet, useStaggeredEntrance } from './BottomSheet';
import { StageOptionList, StageOptionRow } from './StageOptionRow';

interface StageSheetProps {
  visible: boolean;
  onDismiss: () => void;
  doc: Document;
  onSelect: (targetStage: DocumentStage) => void;
  title?: string;
}

interface StageMeta {
  /** Static state name shown in chips ("Cancelled", "Invoice sent"). */
  chipLabel: string;
  /** Verb-y label shown as a row in the action sheet ("Mark as Sent",
   *  "Convert to Invoice"). */
  actionLabel: string;
  icon: string;
  color: string;
  bgColor: string;
}

export const stageMetaFor = (themeColors: Tokens): Record<DocumentStage, StageMeta> => ({
  draft: {
    chipLabel: 'Draft',
    actionLabel: 'Mark as Draft',
    icon: 'file-document-edit-outline',
    // Neutral, not info: a draft means nothing has happened yet. Reserving a
    // real colour for it competes with the stages that HAVE happened.
    color: themeColors.neutral,
    bgColor: themeColors.neutralSubtle,
  },
  quote_sent: {
    chipLabel: 'Quote sent',
    actionLabel: 'Mark as Sent',
    icon: 'send-outline',
    color: themeColors.warning,
    bgColor: themeColors.warningSubtle,
  },
  quote_accepted: {
    chipLabel: 'Accepted',
    actionLabel: 'Mark as Accepted',
    icon: 'check-circle-outline',
    color: themeColors.money,
    bgColor: themeColors.moneySubtle,
  },
  quote_rejected: {
    chipLabel: 'Rejected',
    actionLabel: 'Mark as Rejected',
    icon: 'close-circle-outline',
    color: themeColors.error,
    bgColor: themeColors.errorSubtle,
  },
  invoice_sent: {
    // actionLabel phrased as "Convert to Invoice" because that's what
    // selecting it does from a quote-side stage. Once the doc is an
    // invoice, the chip reads the plain state name.
    chipLabel: 'Invoice sent',
    actionLabel: 'Convert to Invoice',
    icon: 'file-swap-outline',
    color: themeColors.accentText,
    bgColor: themeColors.accentSubtle,
  },
  partially_paid: {
    chipLabel: 'Part paid',
    actionLabel: 'Mark as Partially Paid',
    icon: 'progress-check',
    color: themeColors.info,
    bgColor: themeColors.infoSubtle,
  },
  paid: {
    chipLabel: 'Paid',
    actionLabel: 'Mark as Paid',
    icon: 'cash-check',
    color: themeColors.money,
    bgColor: themeColors.moneySubtle,
  },
  cancelled: {
    chipLabel: 'Cancelled',
    actionLabel: 'Cancel',
    icon: 'close-octagon-outline',
    color: themeColors.error,
    bgColor: themeColors.errorSubtle,
  },
});

const ALL_STAGES: DocumentStage[] = [
  'draft',
  'quote_sent',
  'quote_accepted',
  'quote_rejected',
  'invoice_sent',
  'partially_paid',
  'paid',
  'cancelled',
];

export function StageSheet({
  visible,
  onDismiss,
  doc,
  onSelect,
  title = 'Change status',
}: StageSheetProps) {
  const themeColors = useThemeColors();
  const STAGE_META = stageMetaFor(themeColors);
  const targets = React.useMemo<DocumentStage[]>(() => {
    return ALL_STAGES.filter((s) => s !== doc.stage && canTransition(doc.stage, s));
  }, [doc.stage]);

  const anims = useStaggeredEntrance(targets.length, visible, 100, 40);

  const handleSelect = (target: DocumentStage) => {
    selectionTap();
    onSelect(target);
  };

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      title={title}
      // Same "Currently …" line the job-side surfaces carry, so the sheet
      // states what it's changing FROM rather than only what it can become.
      subtitle={`Currently ${STAGE_META[doc.stage]?.chipLabel ?? 'Draft'}`}
    >
      <StageOptionList>
        {targets.map((target, index) => {
          const meta = STAGE_META[target];
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
              <StageOptionRow
                icon={meta.icon}
                color={meta.color}
                label={meta.actionLabel}
                onPress={() => handleSelect(target)}
              />
            </Animated.View>
          );
        })}
      </StageOptionList>
    </BottomSheet>
  );
}
