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
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const optionAnims = useRef<Animated.Value[]>([]);
  // Keep animated values in sync with options length
  if (optionAnims.current.length !== options.length) {
    optionAnims.current = options.map(() => new Animated.Value(0));
  }

  useEffect(() => {
    if (visible) {
      // Reset option anims
      optionAnims.current.forEach(a => a.setValue(0));

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
        // Stagger option entrances alongside the sheet slide, with a small delay
        Animated.sequence([
          Animated.delay(100),
          Animated.stagger(
            40,
            optionAnims.current.map(anim =>
              Animated.spring(anim, {
                toValue: 1,
                tension: 80,
                friction: 8,
                useNativeDriver: true,
              })
            )
          ),
        ]),
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
      <View style={styles.sheetWrapper} pointerEvents="box-none">
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
          {options.map((option, index) => {
            const isSelected = option.value === currentStatus;
            const anim = optionAnims.current[index];

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

        {/* Safe area padding for bottom */}
        <View style={styles.bottomPadding} />
      </Animated.View>
      </View>
    </Portal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    zIndex: 1000,
  },
  sheetWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1001,
  },
  sheet: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -6 },
        shadowOpacity: 0.3,
        shadowRadius: 16,
      },
      android: {
        elevation: 20,
      },
    }),
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 2,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceGray,
    opacity: 0.6,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    paddingTop: 8,
    paddingBottom: 16,
  },
  optionsContainer: {
    paddingHorizontal: 16,
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
  bottomPadding: {
    height: 34,
  },
});
