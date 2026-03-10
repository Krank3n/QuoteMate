/**
 * Animated List Item
 * Wraps children with a staggered fade-in + slide-up entrance animation
 */

import React, { useEffect, useRef } from 'react';
import { Animated, ViewStyle } from 'react-native';

interface AnimatedListItemProps {
  index: number;
  children: React.ReactNode;
  style?: ViewStyle;
}

const STAGGER_DELAY = 60;
const DURATION = 350;
const SLIDE_DISTANCE = 20;

export function AnimatedListItem({ index, children, style }: AnimatedListItemProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(SLIDE_DISTANCE)).current;

  useEffect(() => {
    const delay = index * STAGGER_DELAY;

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: DURATION,
        delay,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: DURATION,
        delay,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
