/**
 * Status Sheet Component
 * Clean bottom sheet for changing quote/invoice status
 * Tapping an option updates immediately — no confirm button needed
 */

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Pressable, Animated, Dimensions, Platform } from 'react-native';
import { Portal, Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../theme';
import { selectionTap } from '../utils/haptics';

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

const SCREEN_HEIGHT = Dimensions.get('window').height;

export const QUOTE_STATUS_OPTIONS: StatusOption[] = [
  { value: 'draft', label: 'Draft', icon: 'file-document-edit-outline', color: colors.info, bgColor: colors.infoBg },
  { value: 'sent', label: 'Sent', icon: 'send-outline', color: colors.warning, bgColor: colors.warningBg },
  { value: 'accepted', label: 'Accepted', icon: 'check-circle-outline', color: colors.success, bgColor: colors.successBg },
  { value: 'rejected', label: 'Rejected', icon: 'close-circle-outline', color: colors.error, bgColor: colors.errorBg },
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
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 65,
          friction: 11,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: SCREEN_HEIGHT,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  const handleSelect = (value: string) => {
    if (value === currentStatus) {
      onDismiss();
      return;
    }
    selectionTap();
    onSelect(value);
  };

  if (!visible) return null;

  return (
    <Portal>
      {/* Backdrop */}
      <Animated.View
        style={[
          styles.backdrop,
          { opacity: backdropAnim },
        ]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View
        style={[
          styles.sheet,
          { transform: [{ translateY: slideAnim }] },
        ]}
      >
        {/* Handle */}
        <View style={styles.handleContainer}>
          <View style={styles.handle} />
        </View>

        <Text style={styles.title}>{title}</Text>

        <View style={styles.optionsContainer}>
          {options.map((option) => {
            const isSelected = option.value === currentStatus;
            return (
              <Pressable
                key={option.value}
                style={[
                  styles.option,
                  isSelected && { backgroundColor: option.bgColor, borderColor: option.color },
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
                <Text style={[
                  styles.optionLabel,
                  isSelected && { color: option.color, fontWeight: '700' },
                ]}>
                  {option.label}
                </Text>
                {isSelected && (
                  <Text style={[styles.currentBadge, { color: option.color }]}>Current</Text>
                )}
              </Pressable>
            );
          })}
        </View>

        {/* Safe area padding for bottom */}
        <View style={styles.bottomPadding} />
      </Animated.View>
    </Portal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    zIndex: 1000,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    zIndex: 1001,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.25,
        shadowRadius: 12,
      },
      android: {
        elevation: 16,
      },
    }),
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceGray,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    paddingVertical: 12,
  },
  optionsContainer: {
    paddingHorizontal: 16,
    gap: 8,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.surfaceGray3,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  currentBadge: {
    fontSize: 12,
    fontWeight: '600',
  },
  bottomPadding: {
    height: 34,
  },
});
