/**
 * TapRipple Component
 * Cross-platform ripple effect that radiates from the actual touch point.
 * Wraps children in a Pressable and renders an expanding, fading circle on press.
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  Animated,
  GestureResponderEvent,
  LayoutChangeEvent,
  Pressable,
  PressableProps,
  StyleSheet,
  View,
} from 'react-native';

interface Ripple {
  id: number;
  x: number;
  y: number;
  scale: Animated.Value;
  opacity: Animated.Value;
}

interface TapRippleProps extends Omit<PressableProps, 'onPressIn' | 'onPressOut'> {
  /** Ripple colour (default semi-transparent white) */
  rippleColor?: string;
  /** Max radius the ripple grows to — if omitted, auto-calculated from layout */
  rippleRadius?: number;
  /** Duration of the expand + fade in ms (default 500) */
  duration?: number;
  /** Called alongside the ripple effect on press in */
  onPressIn?: (e: GestureResponderEvent) => void;
  /** Called on press out */
  onPressOut?: (e: GestureResponderEvent) => void;
  children: React.ReactNode;
}

let nextId = 0;

export function TapRipple({
  rippleColor = 'rgba(255,255,255,0.18)',
  rippleRadius,
  duration = 500,
  children,
  onPress,
  onPressIn: onPressInProp,
  onPressOut,
  style,
  ...rest
}: TapRippleProps) {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const layoutRef = useRef({ width: 0, height: 0 });

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    layoutRef.current = { width, height };
  }, []);

  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
      onPressInProp?.(e);

      const { locationX, locationY } = e.nativeEvent;
      const { width, height } = layoutRef.current;

      // Calculate radius to cover the farthest corner from the tap point
      const maxDist = rippleRadius ?? Math.sqrt(
        Math.max(locationX, width - locationX) ** 2 +
        Math.max(locationY, height - locationY) ** 2
      );

      const scale = new Animated.Value(0);
      const opacity = new Animated.Value(1);
      const id = nextId++;

      const ripple: Ripple = { id, x: locationX, y: locationY, scale, opacity };
      setRipples((prev) => [...prev, ripple]);

      Animated.parallel([
        Animated.timing(scale, {
          toValue: maxDist / 50, // scale relative to base 100px diameter circle
          duration,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setRipples((prev) => prev.filter((r) => r.id !== id));
      });
    },
    [onPressInProp, rippleRadius, duration],
  );

  return (
    <Pressable
      onPressIn={handlePressIn}
      onPressOut={onPressOut}
      onPress={onPress}
      style={style}
      onLayout={onLayout}
      {...rest}
    >
      {children}
      <View style={[StyleSheet.absoluteFill, styles.rippleContainer]} pointerEvents="none">
        {ripples.map((ripple) => (
          <Animated.View
            key={ripple.id}
            style={[
              styles.rippleCircle,
              {
                backgroundColor: rippleColor,
                left: ripple.x - 50,
                top: ripple.y - 50,
                transform: [{ scale: ripple.scale }],
                opacity: ripple.opacity,
              },
            ]}
          />
        ))}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rippleContainer: {
    overflow: 'hidden',
    borderRadius: 14,
  },
  rippleCircle: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
  },
});
