/**
 * WebContainer Component
 * Wraps content with a max-width (default 800px) and centers it on web only
 * Native mobile platforms (iOS/Android) render children directly without wrapper
 * This ensures proper layout and touch handling on mobile devices including iPad
 */

import React from 'react';
import { View, StyleSheet, Platform, ViewStyle } from 'react-native';

interface WebContainerProps {
  children: React.ReactNode;
  style?: ViewStyle;
  maxWidth?: number;
}

export function WebContainer({ children, style, maxWidth = 800 }: WebContainerProps) {
  // On native mobile (iOS/Android), render children directly without wrapper
  // This prevents layout issues on iPad and ensures proper touch handling
  if (Platform.OS !== 'web') {
    return <>{children}</>;
  }

  // On web, apply centered max-width container for better desktop UX
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
