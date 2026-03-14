/**
 * Full-screen SVG overlay with animated rounded-rect cutout
 * Uses state-driven SVG + Reanimated opacity for Android compatibility
 */

import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, useWindowDimensions, Animated } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { TargetRect } from './useTourRefs';

const PADDING = 8;
const RADIUS = 12;
const TRANSITION_MS = 300;

interface SpotlightOverlayProps {
  target: TargetRect | null;
  visible: boolean;
}

interface CutoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function buildCutoutPath(
  screenW: number,
  screenH: number,
  { x, y, w, h }: CutoutRect,
  r: number,
): string {
  const outer = `M0,0 H${screenW} V${screenH} H0 Z`;
  const inner = `M${x + r},${y} `
    + `H${x + w - r} `
    + `Q${x + w},${y} ${x + w},${y + r} `
    + `V${y + h - r} `
    + `Q${x + w},${y + h} ${x + w - r},${y + h} `
    + `H${x + r} `
    + `Q${x},${y + h} ${x},${y + h - r} `
    + `V${y + r} `
    + `Q${x},${y} ${x + r},${y} Z`;
  return `${outer} ${inner}`;
}

export function SpotlightOverlay({ target, visible }: SpotlightOverlayProps) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const [cutout, setCutout] = useState<CutoutRect>({ x: 0, y: 0, w: 0, h: 0 });
  const opacity = useRef(new Animated.Value(0)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (target && visible) {
      setCutout({
        x: target.x - PADDING,
        y: target.y - PADDING,
        w: target.width + PADDING * 2,
        h: target.height + PADDING * 2,
      });
      Animated.timing(opacity, {
        toValue: 1,
        duration: TRANSITION_MS,
        useNativeDriver: true,
      }).start();

      // Pulsing glow
      glowAnim.current?.stop();
      glowAnim.current = Animated.loop(
        Animated.sequence([
          Animated.timing(glowOpacity, { toValue: 0.8, duration: 1200, useNativeDriver: true }),
          Animated.timing(glowOpacity, { toValue: 0.3, duration: 1200, useNativeDriver: true }),
        ])
      );
      glowAnim.current.start();
    } else {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
      glowAnim.current?.stop();
    }
  }, [target, visible]);

  if (!visible) return null;

  const pathD = buildCutoutPath(screenW, screenH, cutout, RADIUS);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity }]} pointerEvents="none">
      <Svg width={screenW} height={screenH}>
        <Path
          d={pathD}
          fill="rgba(0,0,0,0.7)"
          fillRule="evenodd"
        />
      </Svg>
      <Animated.View
        style={[
          styles.glowBorder,
          {
            opacity: glowOpacity,
            left: cutout.x - 2,
            top: cutout.y - 2,
            width: cutout.w + 4,
            height: cutout.h + 4,
            borderRadius: RADIUS + 2,
          },
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  glowBorder: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#009868',
  },
});
