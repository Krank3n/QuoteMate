/**
 * Status Sheet Component
 * Clean bottom sheet for changing quote/invoice status
 * Tapping an option updates immediately — no confirm button needed
 */

import React from 'react';
import { View, StyleSheet, Pressable, Animated } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../theme';
import { selectionTap } from '../utils/haptics';
import { BottomSheet, useStaggeredEntrance } from './BottomSheet';

interface StatusOption {
  value: string;
  label: string;
  icon: string;
  color: string;
  bgColor: string;
}

interface StatusSheetProps {
  visible: boolean;
  onDismiss: () => void;
  currentStatus: string;
  onSelect: (status: string) => void;
  options: StatusOption[];
  title?: string;
}

export const QUOTE_STATUS_OPTIONS: StatusOption[] = [
  { value: 'draft', label: 'Draft', icon: 'file-document-edit-outline', color: colors.info, bgColor: colors.infoBg },
  { value: 'sent', label: 'Sent', icon: 'send-outline', color: colors.warning, bgColor: colors.warningBg },
  { value: 'accepted', label: 'Accepted', icon: 'check-circle-outline', color: colors.success, bgColor: colors.successBg },
  { value: 'rejected', label: 'Rejected', icon: 'close-circle-outline', color: colors.error, bgColor: colors.errorBg },
  { value: 'completed', label: 'Completed', icon: 'check-decagram', color: colors.primary, bgColor: colors.primaryBg },
];

export const INVOICE_STATUS_OPTIONS: StatusOption[] = [
  { value: 'draft', label: 'Draft', icon: 'file-document-edit-outline', color: colors.info, bgColor: colors.infoBg },
  { value: 'sent', label: 'Sent', icon: 'send-outline', color: colors.warning, bgColor: colors.warningBg },
  { value: 'paid', label: 'Paid', icon: 'check-circle-outline', color: colors.success, bgColor: colors.successBg },
  { value: 'cancelled', label: 'Cancelled', icon: 'close-circle-outline', color: colors.error, bgColor: colors.errorBg },
];

export function StatusSheet({
  visible,
  onDismiss,
  currentStatus,
  onSelect,
  options,
  title = 'Update Status',
}: StatusSheetProps) {
  const optionAnims = useStaggeredEntrance(options.length, visible, 100, 40);

  const handleSelect = (value: string) => {
    if (value === currentStatus) {
      onDismiss();
      return;
    }
    selectionTap();
    onSelect(value);
  };

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} title={title}>
      <View style={styles.optionsContainer}>
        {options.map((option, index) => {
          const isSelected = option.value === currentStatus;
          const anim = optionAnims[index];

          return (
            <Animated.View
              key={option.value}
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
                  isSelected && styles.optionSelected,
                  isSelected && { borderColor: option.color },
                  pressed && !isSelected && styles.optionPressed,
                ]}
                onPress={() => handleSelect(option.value)}
              >
                <View style={[styles.iconCircle, { backgroundColor: option.bgColor }]}>
                  <MaterialCommunityIcons
                    name={isSelected ? 'check' : option.icon as any}
                    size={22}
                    color={option.color}
                  />
                </View>

                <View style={styles.labelContainer}>
                  <Text style={[
                    styles.optionLabel,
                    isSelected && { color: option.color, fontWeight: '700' },
                  ]}>
                    {option.label}
                  </Text>
                  {isSelected && (
                    <Text style={styles.currentSubtext}>Currently selected</Text>
                  )}
                </View>

                {isSelected ? (
                  <View style={[styles.selectedDot, { backgroundColor: option.color }]} />
                ) : (
                  <MaterialCommunityIcons
                    name="chevron-right"
                    size={20}
                    color={colors.inactive}
                  />
                )}
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
  optionSelected: {
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
    borderWidth: 1.5,
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
  currentSubtext: {
    fontSize: 12,
    color: colors.inactive,
    marginTop: 1,
  },
  selectedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
