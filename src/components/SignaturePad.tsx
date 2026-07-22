/**
 * SignaturePad
 *
 * A lightweight, dependency-free signature capture pad that works on both
 * native and web. Built on PanResponder (no native module, no rebuild) so it
 * drops straight into the Expo + react-native-web setup, and renders the ink
 * with react-native-svg.
 *
 * Controlled component: the parent owns the SVG path `d` string via `value`
 * and receives updates through `onChange`. The pure `buildSvgPath` helper does
 * the stroke → path conversion so it can be unit tested in isolation.
 *
 * Gesture notes — this pad lives inside scrolling forms, so it:
 *  - refuses responder termination (the parent ScrollView can't steal a
 *    stroke mid-signature and turn it into a scroll), and
 *  - reports stroke start/end via onStrokeStart/onStrokeEnd so the parent
 *    can disable its own scrolling while ink is being laid down.
 *  - only lifts the path to the parent on stroke END, not per move-sample —
 *    per-sample setState in the parent re-renders the whole form and makes
 *    signing feel laggy on mid-range Androids. The in-flight stroke renders
 *    from local state only.
 *
 * onChange also reports the pad's measured width/height. The PDF renderer
 * needs the real capture-space dimensions for its viewBox — hardcoding one
 * clips any signature drawn on a pad with different proportions.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  PanResponder,
  TouchableOpacity,
  Text,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors } from '../theme';
import { buildSvgPath, pathHasInk, type Point } from './signaturePath';

const DEFAULT_HEIGHT = 180;

export interface SignaturePadSize {
  width: number;
  height: number;
}

interface SignaturePadProps {
  value?: string;
  onChange: (svgPath: string, size: SignaturePadSize) => void;
  height?: number;
  /** Stroke began — parent should disable its ScrollView. */
  onStrokeStart?: () => void;
  /** Stroke ended — parent can re-enable scrolling. */
  onStrokeEnd?: () => void;
}

export function SignaturePad({
  value,
  onChange,
  height = DEFAULT_HEIGHT,
  onStrokeStart,
  onStrokeEnd,
}: SignaturePadProps) {
  const [strokes, setStrokes] = useState<Point[][]>([]);

  // The PanResponder is created once, so it reaches the latest callbacks
  // through refs instead of stale closures.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onStrokeStartRef = useRef(onStrokeStart);
  onStrokeStartRef.current = onStrokeStart;
  const onStrokeEndRef = useRef(onStrokeEnd);
  onStrokeEndRef.current = onStrokeEnd;

  // When the parent clears the value externally (value === ''), drop the ink.
  useEffect(() => {
    if (!value) {
      setStrokes((prev) => (prev.length === 0 ? prev : []));
    }
  }, [value]);

  // Kept in refs so the once-created PanResponder always sees current state.
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const [size, setSize] = useState({ width: 0, height });
  const sizeRef = useRef(size);
  sizeRef.current = size;

  // Lift the finished ink to the parent — called on stroke end and clear,
  // never per move-sample.
  const commit = (next: Point[][]) => {
    const d = buildSvgPath(next);
    // Sub-threshold ink (taps, micro-twitches) commits as unsigned — an
    // invisible mark must never count as a signature on the customer PDF.
    onChangeRef.current(pathHasInk(d) ? d : '', {
      width: Math.round(sizeRef.current.width),
      height: Math.round(sizeRef.current.height),
    });
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // A signature must survive the parent ScrollView asking for the
      // gesture back — otherwise vertical pen movement scrolls the page
      // and abandons the stroke.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (e) => {
        onStrokeStartRef.current?.();
        const { locationX, locationY } = e.nativeEvent;
        setStrokes([...strokesRef.current, [{ x: locationX, y: locationY }]]);
      },
      onPanResponderMove: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        const current = strokesRef.current;
        if (current.length === 0) return;
        const next = current.slice(0, -1);
        const active = [...current[current.length - 1], { x: locationX, y: locationY }];
        setStrokes([...next, active]);
      },
      onPanResponderRelease: () => {
        onStrokeEndRef.current?.();
        commit(strokesRef.current);
      },
      // Termination shouldn't happen (we refuse requests) but if the OS
      // force-terminates, keep what was inked and unlock the parent.
      onPanResponderTerminate: () => {
        onStrokeEndRef.current?.();
        commit(strokesRef.current);
      },
    }),
  ).current;

  const handleClear = () => {
    setStrokes([]);
    commit([]);
  };

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height: h } = e.nativeEvent.layout;
    setSize({ width, height: h });
  };

  // Local strokes are the live view (they include the in-flight stroke);
  // fall back to the committed value when local state is empty (e.g. edit
  // mode hydrating an existing signature).
  const pathData = strokes.length > 0 ? buildSvgPath(strokes) : value ?? '';
  const hasInk = pathData.length > 0;

  return (
    <View style={[styles.container, { height }]}>
      <View style={styles.canvas} onLayout={onLayout} {...responder.panHandlers}>
        <Svg width={size.width} height={size.height} pointerEvents="none">
          {hasInk && (
            <Path
              d={pathData}
              stroke={colors.text}
              strokeWidth={2.5}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </Svg>
      </View>

      {hasInk && (
        <TouchableOpacity
          onPress={handleClear}
          style={styles.clearButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Clear signature"
        >
          <Text style={styles.clearText}>Clear</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    position: 'relative',
  },
  canvas: {
    flex: 1,
  },
  clearButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
  },
  clearText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
});
