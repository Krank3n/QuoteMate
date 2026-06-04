/**
 * RangeSlider
 *
 * A lightweight, dependency-free slider that works on both native and web.
 * Built on PanResponder (no native module, no rebuild) so it drops straight
 * into the Expo + react-native-web setup. The parent owns the value and
 * formats the label — this just reports the snapped number as you drag.
 */
import React, { useRef, useState } from 'react';
import { View, StyleSheet, PanResponder, type LayoutChangeEvent } from 'react-native';

import { colors } from '../theme';

const THUMB_SIZE = 26;

interface RangeSliderProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
}

export function RangeSlider({ min, max, step = 1, value, onChange }: RangeSliderProps) {
  const [width, setWidth] = useState(0);

  // The PanResponder is created once, so it reads the latest props/width
  // through this ref instead of a stale closure.
  const cfg = useRef({ min, max, step, width, onChange });
  cfg.current = { min, max, step, width, onChange };

  const handleX = (x: number) => {
    const { min, max, step, width, onChange } = cfg.current;
    if (width <= 0) return;
    const ratio = Math.min(Math.max(x / width, 0), 1);
    const raw = min + ratio * (max - min);
    const snapped = Math.round((raw - min) / step) * step + min;
    onChange(Math.min(Math.max(snapped, min), max));
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => handleX(e.nativeEvent.locationX),
      onPanResponderMove: (e) => handleX(e.nativeEvent.locationX),
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const ratio = max > min ? Math.min(Math.max((value - min) / (max - min), 0), 1) : 0;
  const thumbLeft = ratio * width - THUMB_SIZE / 2;

  return (
    <View style={styles.container} onLayout={onLayout} {...responder.panHandlers}>
      <View style={styles.track} />
      <View style={[styles.fill, { width: `${ratio * 100}%` }]} />
      <View style={[styles.thumb, { left: thumbLeft }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 40,
    justifyContent: 'center',
  },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceLight,
  },
  fill: {
    position: 'absolute',
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: colors.white,
    borderWidth: 3,
    borderColor: colors.primary,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
});
