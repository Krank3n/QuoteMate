/**
 * Fixed Bottom Button Component
 * Reusable button that stays fixed at the bottom of the screen
 * Similar to the "Next: Labor & Markup" button in MaterialsListScreen
 */

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Platform, Animated, Easing, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { colors } from '../theme';
import { FooterButton } from './FooterButton';

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
  /** Custom button label style */
  labelStyle?: object;
  /** Optional secondary button label */
  secondaryLabel?: string;
  /** Optional secondary button press handler */
  secondaryOnPress?: () => void;
  /** Optional secondary button loading state */
  secondaryLoading?: boolean;
  /** Optional secondary button disabled state */
  secondaryDisabled?: boolean;
  /** Optional loading progress text (e.g. "Fetching 3 of 7...") */
  secondaryLoadingText?: string;
  /** Optional handler when tapping the loading button (e.g. to cancel) */
  secondaryLoadingOnPress?: () => void;
  /** Disable the solid background block - useful when transparency is desired */
  disableSolidBackground?: boolean;
  /** Ref forwarded to the secondary button wrapper for tour targeting */
  secondaryRef?: React.Ref<View>;
  /** Opt out of the iOS keyboard-sticky wrapper. Set to true when the screen
   *  already handles keyboard avoidance itself (e.g. wraps in
   *  KeyboardAvoidingView), to avoid double-translating the bar. */
  disableKeyboardSticky?: boolean;
}

/**
 * Animated pulsing border wrapper for the loading button
 */
function PulsingBorderButton({ children, loadingText, onPress }: { children: React.ReactNode; loadingText?: string; onPress?: () => void }) {
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const textAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Pulsing scale animation
    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    // Glow opacity animation
    const glowAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    // Text pulse animation (subtle scale)
    const textAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(textAnim, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(textAnim, {
          toValue: 0,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    pulseAnimation.start();
    glowAnimation.start();
    textAnimation.start();

    return () => {
      pulseAnimation.stop();
      glowAnimation.stop();
      textAnimation.stop();
    };
  }, [pulseAnim, glowAnim, textAnim]);

  const borderScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.06],
  });

  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 1],
  });

  const textScale = textAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.03],
  });

  const textOpacity = textAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.55, 1],
  });

  const Wrapper = onPress ? TouchableOpacity : View;
  const wrapperProps = onPress ? { onPress, activeOpacity: 0.7 } : {};

  return (
    <Wrapper {...wrapperProps} style={styles.pulsingBorderWrapper}>
      {/* Animated pulsing border */}
      <Animated.View
        style={[
          styles.pulsingBorder,
          {
            transform: [{ scale: borderScale }],
            opacity: glowOpacity,
          },
        ]}
      />

      {/* Button content */}
      <View style={styles.buttonContentWrapper}>
        <Animated.Text
          style={[
            styles.loadingText,
            {
              transform: [{ scale: textScale }],
              opacity: textOpacity,
            },
          ]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {loadingText || 'Fetching prices...'}
        </Animated.Text>
        {onPress && (
          <Text style={styles.cancelHint}>Tap to cancel</Text>
        )}
      </View>
    </Wrapper>
  );
}

export function FixedBottomButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  mode = 'contained',
  icon,
  buttonStyle,
  labelStyle,
  secondaryLabel,
  secondaryOnPress,
  secondaryLoading = false,
  secondaryDisabled = false,
  secondaryLoadingText,
  secondaryLoadingOnPress,
  disableSolidBackground = false,
  secondaryRef,
  disableKeyboardSticky = false,
}: FixedBottomButtonProps) {
  const insets = useSafeAreaInsets();

  // On iOS, KeyboardStickyView translates the bar above the keyboard.
  // On Android, soft-input "adjustResize" already handles it; on web it's static.
  const useSticky = Platform.OS === 'ios' && !disableKeyboardSticky;
  const Container: any = useSticky ? KeyboardStickyView : View;

  return (
    <>
      {/* Solid background that extends to the very bottom */}
      {!disableSolidBackground && Platform.OS !== 'ios' && (
        <View style={[styles.solidBackground, { height: 60 + insets.bottom }]} />
      )}

      <Container
        offset={useSticky ? { closed: 0, opened: insets.bottom } : undefined}
        style={[
          styles.bottomActions,
          Platform.OS === 'web'
            ? { paddingBottom: 12, marginBottom: insets.bottom }
            : { paddingBottom: Math.max(insets.bottom, 12) },
        ]}
        needsOffscreenAlphaCompositing={false}
        renderToHardwareTextureAndroid={true}
      >
        <View style={styles.bottomActionsInner}>
          {secondaryLabel && secondaryOnPress && (
            <View ref={secondaryRef} style={{ flex: 1 }}>
              {secondaryLoading ? (
                <PulsingBorderButton loadingText={secondaryLoadingText} onPress={secondaryLoadingOnPress}>
                  {secondaryLabel}
                </PulsingBorderButton>
              ) : (
                <FooterButton
                  mode="outlined"
                  label={secondaryLabel}
                  onPress={secondaryOnPress}
                  disabled={secondaryDisabled}
                />
              )}
            </View>
          )}
          <FooterButton
            mode={mode === 'contained' || mode === 'outlined' || mode === 'text' ? mode : 'contained'}
            label={label}
            onPress={onPress}
            icon={icon}
            loading={loading}
            disabled={disabled}
            style={buttonStyle}
            labelStyle={labelStyle}
          />
        </View>
      </Container>
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
    paddingTop: 10,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    position: "absolute",
    bottom: 0,
    width: '100%',
    alignItems: 'center',
    borderColor: colors.border,
    zIndex: 2, // Above the solid background
    ...(Platform.OS === 'android' && {
      elevation: 8, // Add shadow/elevation for Android
      backgroundColor: colors.surface, // Ensure solid background
    }),
    ...(Platform.OS === 'web' && {
      flexShrink: 0,
      position: 'relative' as any,
      width: '100%',
      boxShadow: '0 -2px 8px rgba(0,0,0,0.1)' as any,
    }),
  },
  bottomActionsInner: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    width: '100%',
    ...(Platform.OS === 'web' && {
      maxWidth: 800,
    }),
  },
  pulsingBorderWrapper: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 100,
    backgroundColor: colors.surface,
    height: '100%',
    flex: 1,
  },
  pulsingBorder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  buttonContentWrapper: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
    width: '100%',
    height: '100%',
  },
  loadingText: {
    fontSize: 15,
    width: '100%',
    fontWeight: '600',
    color: colors.primary,
    textAlign: 'center',
  },
  cancelHint: {
    fontSize: 11,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    marginTop: 2,
  },
});
