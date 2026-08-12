/**
 * Stage Sheet Component
 * Bottom sheet for changing a Document's stage. Computes legal next stages
 * from the canTransition state machine and renders them as tappable rows.
 *
 * Replaces StatusSheet for document-driven flows. Matches StatusSheet's
 * visuals one-for-one so tradies don't see a UX shift.
 */

import React from 'react';
import { View, StyleSheet, Pressable, Animated } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import type { Document, DocumentStage } from '../types/document';
import { canTransition } from '../../shared/document/stage';
import type { Tokens } from '../theme';
import { makeStyles, useThemeColors } from '../theme';
import { selectionTap } from '../utils/haptics';
import { BottomSheet, useStaggeredEntrance } from './BottomSheet';

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
  title = 'Update Stage',
}: StageSheetProps) {
  const styles = useStyles();
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
    <BottomSheet visible={visible} onDismiss={onDismiss} title={title}>
      <View style={styles.optionsContainer}>
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
