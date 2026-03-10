/**
 * Animated Status Chip
 * Wraps a Chip with a bounce animation when the status value changes
 */

import React, { useEffect, useRef } from 'react';
import { Animated, ViewStyle, TextStyle } from 'react-native';
import { Chip } from 'react-native-paper';

interface AnimatedChipProps {
  children: React.ReactNode;
  status: string;
  style?: ViewStyle | ViewStyle[];
  textStyle?: TextStyle;
  onPress?: (e: any) => void;
}

export function AnimatedChip({ children, status, style, textStyle, onPress }: AnimatedChipProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const prevStatus = useRef(status);

  useEffect(() => {
    if (prevStatus.current !== status) {
      prevStatus.current = status;
      // Bounce animation on status change
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.15,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 4,
          tension: 100,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [status]);

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <Chip
        style={style}
        textStyle={textStyle}
        onPress={onPress}
      >
        {children}
      </Chip>
    </Animated.View>
  );
}
