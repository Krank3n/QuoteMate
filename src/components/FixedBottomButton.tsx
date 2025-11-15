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
  /** Optional secondary button label */
  secondaryLabel?: string;
  /** Optional secondary button press handler */
  secondaryOnPress?: () => void;
  /** Optional secondary button loading state */
  secondaryLoading?: boolean;
  /** Optional secondary button disabled state */
  secondaryDisabled?: boolean;
  /** Disable the solid background block - useful when transparency is desired */
  disableSolidBackground?: boolean;
}

export function FixedBottomButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  mode = 'contained',
  icon,
  buttonStyle,
  secondaryLabel,
  secondaryOnPress,
  secondaryLoading = false,
  secondaryDisabled = false,
  disableSolidBackground = false,
}: FixedBottomButtonProps) {
  const insets = useSafeAreaInsets();

  return (
    <>
      {/* Solid background that extends to the very bottom */}
      {!disableSolidBackground && Platform.OS !== 'ios' && <View style={styles.solidBackground} />}

      <View
        style={[
          styles.bottomActions,
             Platform.OS !== 'ios' && { marginBottom: Math.max(insets.bottom, 16) }
        ]}
        needsOffscreenAlphaCompositing={false}
        renderToHardwareTextureAndroid={true}
      >
        {secondaryLabel && secondaryOnPress && (
          <Button
            mode="outlined"
            onPress={secondaryOnPress}
            style={styles.secondaryButton}
            labelStyle={styles.secondaryButtonLabel}
            disabled={secondaryDisabled}
            loading={secondaryLoading}
          >
            {secondaryLoading ? '' : secondaryLabel}
          </Button>
        )}
        <Button
          mode={mode}
          onPress={onPress}
          style={[styles.button, buttonStyle, secondaryLabel && styles.buttonWithSecondary]}
          labelStyle={styles.buttonLabel}
          disabled={disabled}
          loading={loading}
          icon={icon}
        >
          {loading ? '' : label}
        </Button>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  solidBackground: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 60, // Covers button area + safe area
    backgroundColor: colors.surface,
    zIndex: 1,
  },
  bottomActions: {
    padding: 16,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    position: "absolute",
    bottom: 0,
    width: '100%',
    flexDirection: 'row',
    gap: 12,
    borderColor: colors.border,
    zIndex: 2, // Above the solid background
    ...(Platform.OS === 'android' && {
      elevation: 8, // Add shadow/elevation for Android
      backgroundColor: colors.surface, // Ensure solid background
    }),
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
    flex: 1,
    margin: 0,
  },
  buttonWithSecondary: {
    flex: 1,
  },
  buttonLabel: {
    color: colors.white,
    marginVertical: 16,
    marginHorizontal: 10,
  },
  secondaryButton: {
    borderWidth: 2,
    marginHorizontal: 10,
    borderColor: colors.primary,
    flex: 1,
    margin: 0,
  },
  secondaryButtonLabel: {
    color: colors.primary,
    marginVertical: 16,
    marginHorizontal: 0,
  },
});
