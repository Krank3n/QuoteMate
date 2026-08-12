/**
 * GridBackground
 *
 * The faint blueprint grid from the marketing site's hero variant B — 1px lines
 * at ~3.5% black on 40px cells. On the web that is two `linear-gradient`
 * background images; React Native has no repeating background, so the lines are
 * drawn as plain Views. At a 40px cell that is roughly 20 horizontal and 10
 * vertical hairlines on a phone — cheap, static, and no new dependency
 * (react-native-svg is not installed).
 *
 * LIGHT MODE ONLY. On the near-black dark canvas the same grid reads as scuff
 * marks rather than paper, so it renders nothing there.
 *
 * Sits behind content: absolutely positioned and `pointerEvents="none"`, so it
 * never intercepts a tap.
 */

import React, { useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { useAppTheme } from '../theme';
import { cream } from '../theme/palette';

interface GridBackgroundProps {
  /** Cell size in px. Defaults to the site's 40px. */
  cell?: number;
}

export function GridBackground({ cell = cream.gridCell }: GridBackgroundProps) {
  const { scheme } = useAppTheme();
  const { width, height } = useWindowDimensions();

  const lines = useMemo(() => {
    // +2 so the grid still covers the screen while a list bounces past its end.
    const cols = Math.ceil(width / cell) + 2;
    const rows = Math.ceil(height / cell) + 2;
    return {
      vertical: Array.from({ length: cols }, (_, i) => i * cell),
      horizontal: Array.from({ length: rows }, (_, i) => i * cell),
    };
  }, [width, height, cell]);

  if (scheme !== 'light') return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {lines.vertical.map((x) => (
        <View key={`v${x}`} style={[styles.vertical, { left: x }]} />
      ))}
      {lines.horizontal.map((y) => (
        <View key={`h${y}`} style={[styles.horizontal, { top: y }]} />
      ))}
    </View>
  );
}

// StyleSheet.hairlineWidth would be sub-pixel on a 3x screen and effectively
// disappear; the site's grid is a true 1px line.
const styles = StyleSheet.create({
  vertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: cream.grid,
  },
  horizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: cream.grid,
  },
});
