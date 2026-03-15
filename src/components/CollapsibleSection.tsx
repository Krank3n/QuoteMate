/**
 * Collapsible Section
 * Animates height and opacity for expand/collapse using Reanimated
 */

import React from 'react';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';

interface CollapsibleSectionProps {
  expanded: boolean;
  children: React.ReactNode;
  duration?: number;
}

export function CollapsibleSection({
  expanded,
  children,
  duration = 300,
}: CollapsibleSectionProps) {
  const height = useSharedValue(0);
  const animatedExpanded = useDerivedValue(() =>
    withTiming(expanded ? 1 : 0, {
      duration,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
    })
  );

  const animatedStyle = useAnimatedStyle(() => ({
    height: animatedExpanded.value * height.value,
    opacity: animatedExpanded.value,
    overflow: 'hidden' as const,
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Animated.View
        style={{ position: 'absolute', width: '100%' }}
        onLayout={(e) => {
          height.value = e.nativeEvent.layout.height;
        }}
      >
        {children}
      </Animated.View>
    </Animated.View>
  );
}
