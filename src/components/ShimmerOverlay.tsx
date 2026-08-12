/**
 * ShimmerOverlay Component
 * A subtle, slow-moving light sweep that sits on top of card backgrounds.
 * Animates opacity alongside position so the loop reset is fully invisible.
 */

import React, { useEffect, useRef, useMemo } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { useThemeColors } from '../theme';

interface ShimmerOverlayProps {
  /** Duration of one full sweep in ms (default ~9000) */
  duration?: number;
  /** Pause between sweeps in ms (default ~1500) */
  pause?: number;
  /** Delay before first sweep in ms (default random 0–2000) */
  delay?: number;
  /** Peak opacity of the highlight band (default 0.045) */
  intensity?: number;
  /**
   * Band colour. Defaults to the theme's text colour — a light sheen on a dark
   * card, a dark one on a white card. A hardcoded white sweep simply vanishes
   * in light mode.
   *
   * MUST be a 6-digit hex: the gradient below appends a two-digit alpha to it.
   */
  tint?: string;
}

export function ShimmerOverlay({
  duration,
  pause,
  delay,
  intensity = 0.045,
  tint,
}: ShimmerOverlayProps) {
  const themeColors = useThemeColors();
  const bandTint = tint ?? themeColors.text;
  const progress = useRef(new Animated.Value(0)).current;

  const sweepMs = useRef(duration ?? 8000 + Math.random() * 4000).current;
  const pauseMs = useRef(pause ?? 1000 + Math.random() * 1500).current;
  const delayMs = useRef(delay ?? Math.random() * 2000).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: sweepMs,
          useNativeDriver: true,
        }),
        Animated.delay(pauseMs),
      ])
    );
    const timer = setTimeout(() => anim.start(), delayMs);
    return () => {
      clearTimeout(timer);
      anim.stop();
    };
  }, []);

  const gradientColors = useMemo(() => {
    const lo = `${bandTint}${Math.round(intensity * 255).toString(16).padStart(2, '0')}`;
    const hi = `${bandTint}${Math.round(intensity * 1.5 * 255).toString(16).padStart(2, '0')}`;
    return ['transparent', lo, hi, lo, 'transparent'] as const;
  }, [bandTint, intensity]);

  // Position: sweep left-to-right
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-250, 250],
  });

  // Opacity: invisible at start → fade in → visible → fade out → invisible at end
  // The reset from 1→0 happens while opacity is 0, so it's completely hidden.
  const bandOpacity = progress.interpolate({
    inputRange: [0, 0.08, 0.2, 0.8, 0.92, 1],
    outputRange: [0,  0,    1,   1,   0,    0],
  });

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.container]}
      pointerEvents="none"
    >
      <Animated.View
        style={[
          styles.band,
          { opacity: bandOpacity, transform: [{ translateX }] },
        ]}
      >
        <LinearGradient
          colors={gradientColors as unknown as [string, string, ...string[]]}
          start={{ x: 0, y: 0.3 }}
          end={{ x: 1, y: 0.7 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    borderRadius: 14,
  },
  band: {
    ...StyleSheet.absoluteFillObject,
    width: '140%',
  },
});
