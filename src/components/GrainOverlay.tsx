/**
 * GrainOverlay Component
 * Renders a subtle static noise/grain texture over card surfaces.
 * Pre-generates a fixed grid of tiny semi-transparent specks for a tactile feel.
 * Fully static — no animation overhead.
 */

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useThemeColors } from '../theme';

interface GrainOverlayProps {
  /** Number of grain specks (default 90) */
  density?: number;
  /** Peak opacity of individual specks (default 0.08) */
  intensity?: number;
  /** Speck colour. Defaults to the theme's text colour, so it is light specks
   *  on a dark card and dark specks on a white one. */
  tint?: string;
  /** Border radius to match parent card (default 14) */
  borderRadius?: number;
}

// Seeded pseudo-random for deterministic grain per instance
function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let seedCounter = 0;

export const GrainOverlay = React.memo(function GrainOverlay({
  density = 90,
  intensity = 0.08,
  tint,
  borderRadius = 14,
}: GrainOverlayProps) {
  const themeColors = useThemeColors();
  const speckTint = tint ?? themeColors.text;
  const specks = useMemo(() => {
    const rand = mulberry32(seedCounter++);
    const arr = [];
    for (let i = 0; i < density; i++) {
      const size = rand() > 0.7 ? 2 : 1;
      arr.push({
        key: i,
        left: `${rand() * 100}%` as const,
        top: `${rand() * 100}%` as const,
        width: size,
        height: size,
        opacity: rand() * intensity,
        borderRadius: rand() > 0.5 ? size / 2 : 0,
      });
    }
    return arr;
  }, [density, intensity]);

  return (
    <View
      style={[StyleSheet.absoluteFill, { borderRadius, overflow: 'hidden' }]}
      pointerEvents="none"
    >
      {specks.map((s) => (
        <View
          key={s.key}
          style={{
            position: 'absolute',
            left: s.left,
            top: s.top,
            width: s.width,
            height: s.height,
            borderRadius: s.borderRadius,
            backgroundColor: speckTint,
            opacity: s.opacity,
          }}
        />
      ))}
    </View>
  );
});
