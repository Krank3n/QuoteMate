/**
 * Animated Number
 * Counts up from 0 to the target value on mount
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, TextStyle } from 'react-native';
import { Text } from 'react-native-paper';

interface AnimatedNumberProps {
  value: number;
  format?: (n: number) => string;
  style?: TextStyle;
  duration?: number;
  delay?: number;
}

export function AnimatedNumber({
  value,
  format,
  style,
  duration = 800,
  delay = 0,
}: AnimatedNumberProps) {
  const [displayValue, setDisplayValue] = useState(0);
  const animRef = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Reset for new values
    animRef.setValue(0);
    setDisplayValue(0);

    const listener = animRef.addListener(({ value: v }) => {
      setDisplayValue(Math.round(v));
    });

    Animated.timing(animRef, {
      toValue: value,
      duration,
      delay,
      useNativeDriver: false, // Can't use native driver for listener-based value reads
    }).start();

    return () => {
      animRef.removeListener(listener);
    };
  }, [value]);

  const text = format ? format(displayValue) : String(displayValue);

  return <Text style={style}>{text}</Text>;
}
