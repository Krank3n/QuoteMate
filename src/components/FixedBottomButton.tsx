/**
 * Fixed Bottom Button Component
 * Reusable button that stays fixed at the bottom of the screen
 * Similar to the "Next: Labor & Markup" button in MaterialsListScreen
 */

import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Button } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';

interface FixedBottomButtonProps {
  /** Button label text */
  label: string;
  /** Called when button is pressed */
  onPress: () => void;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Whether the button is loading */
  loading?: boolean;
  /** Button mode - defaults to "contained" */
  mode?: 'text' | 'outlined' | 'contained' | 'elevated' | 'contained-tonal';
  /** Optional icon to show */
  icon?: string;
  /** Custom button style */
  buttonStyle?: object;
}

export function FixedBottomButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  mode = 'contained',
  icon,
  buttonStyle,
}: FixedBottomButtonProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bottomActions, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'android' ? 48 : 16) }]}>
      <Button
        mode={mode}
        onPress={onPress}
        style={[styles.button, buttonStyle]}
        labelStyle={styles.buttonLabel}
        disabled={disabled}
        loading={loading}
        icon={icon}
      >
        {label}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  bottomActions: {
    paddingHorizontal: 16,
    paddingTop: 16,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.border,
    ...(Platform.OS === 'web' && {
      flexShrink: 0,
      position: 'sticky' as any,
      bottom: 0,
      margin: '0 auto' as any,
      width: '100%',
      boxShadow: '0 -2px 8px rgba(0,0,0,0.1)' as any,
    }),
  },
  button: {
    paddingVertical: 8,
  },
  buttonLabel: {
    color: colors.white,
  },
});
