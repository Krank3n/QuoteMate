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
import { colors } from '../theme';
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
  label: string;
  icon: string;
  color: string;
  bgColor: string;
}

export const STAGE_META: Record<DocumentStage, StageMeta> = {
  draft: {
    label: 'Mark as Draft',
    icon: 'file-document-edit-outline',
    color: colors.info,
    bgColor: colors.infoBg,
  },
  quote_sent: {
    label: 'Mark as Sent',
    icon: 'send-outline',
    color: colors.warning,
    bgColor: colors.warningBg,
  },
  quote_accepted: {
    label: 'Mark as Accepted',
    icon: 'check-circle-outline',
    color: colors.success,
    bgColor: colors.successBg,
  },
  quote_rejected: {
    label: 'Mark as Rejected',
    icon: 'close-circle-outline',
    color: colors.error,
    bgColor: colors.errorBg,
  },
  invoice_sent: {
    // Intentionally phrased as the convert action — when a quote-side stage
    // transitions to invoice_sent, the only user-facing effect is the
    // quote→invoice conversion.
    label: 'Convert to Invoice',
    icon: 'file-swap-outline',
    color: colors.primary,
    bgColor: colors.primaryBg,
  },
  partially_paid: {
    label: 'Mark as Partially Paid',
    icon: 'progress-check',
    color: colors.info,
    bgColor: colors.infoBg,
  },
  paid: {
    label: 'Mark as Paid',
    icon: 'cash-check',
    color: colors.success,
    bgColor: colors.successBg,
  },
  cancelled: {
    label: 'Cancel',
    icon: 'close-octagon-outline',
    color: colors.error,
    bgColor: colors.errorBg,
  },
};

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
