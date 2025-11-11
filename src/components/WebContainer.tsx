/**
 * WebContainer Component
 * Wraps content with a max-width on web for better UI
 * Mobile apps remain unchanged (full width)
 */

import React from 'react';
import { View, StyleSheet, Platform, ViewStyle } from 'react-native';

interface WebContainerProps {
  children: React.ReactNode;
  style?: ViewStyle;
  maxWidth?: number;
}

export function WebContainer({ children, style, maxWidth = 800 }: WebContainerProps) {
  if (Platform.OS !== 'web') {
    // On mobile, just render children without wrapper
    return <>{children}</>;
  }

  // Extract flex from style to apply to wrapper
  const styleArray = Array.isArray(style) ? style : [style];
  const hasFlex = styleArray.some(s => s && typeof s === 'object' && 'flex' in s);

  return (
    <View style={[styles.webWrapper, hasFlex && { flex: 1 }]}>
      <View style={[styles.webContainer, { maxWidth }, style]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  webWrapper: {
    alignItems: 'center',
    width: '100%',
  },
  webContainer: {
    width: '100%',
    alignSelf: 'center',
  },
});
