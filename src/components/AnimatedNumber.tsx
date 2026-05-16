/**
 * Renders a (formatted) number. Previously animated a count-up via the JS
 * thread which caused jank on dashboard mount; now renders statically.
 * Props kept stable for callers.
 */

import React from 'react';
import { TextStyle } from 'react-native';
import { Text } from 'react-native-paper';

interface AnimatedNumberProps {
  value: number;
  format?: (n: number) => string;
  style?: TextStyle;
  duration?: number;
  delay?: number;
}

export function AnimatedNumber({ value, format, style }: AnimatedNumberProps) {
  const text = format ? format(value) : String(value);
  return <Text style={style}>{text}</Text>;
}
