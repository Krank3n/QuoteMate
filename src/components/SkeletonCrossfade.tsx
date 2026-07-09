/**
 * SkeletonCrossfade
 * Smoothly crossfades from skeleton placeholders to real content
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

interface SkeletonCrossfadeProps {
  loaded: boolean;
  skeleton: React.ReactNode;
  children: React.ReactNode;
  /**
   * Set when the content must fill a flex parent (e.g. a FlatList that
   * scrolls). The wrappers are content-sized by default, which would give a
   * flex:1 child no height.
   */
  fill?: boolean;
}

const FADE_OUT_DURATION = 250;
const FADE_IN_DURATION = 350;
const FADE_IN_DELAY = 80;

export function SkeletonCrossfade({ loaded, skeleton, children, fill }: SkeletonCrossfadeProps) {
  const [showSkeleton, setShowSkeleton] = useState(!loaded);
  const skeletonOpacity = useRef(new Animated.Value(loaded ? 0 : 1)).current;
  const contentOpacity = useRef(new Animated.Value(loaded ? 1 : 0)).current;
  const contentSlide = useRef(new Animated.Value(loaded ? 0 : 8)).current;

  useEffect(() => {
    if (loaded && showSkeleton) {
      Animated.parallel([
        Animated.timing(skeletonOpacity, {
          toValue: 0,
          duration: FADE_OUT_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(contentOpacity, {
          toValue: 1,
          duration: FADE_IN_DURATION,
          delay: FADE_IN_DELAY,
          useNativeDriver: true,
        }),
        Animated.timing(contentSlide, {
          toValue: 0,
          duration: FADE_IN_DURATION,
          delay: FADE_IN_DELAY,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setShowSkeleton(false);
      });
    }
  }, [loaded]);

  // The tree shape is deliberately constant: children always live inside the
  // same View > Animated.View slot. Returning bare `{children}` once the
  // crossfade finished (the previous shape) changed their position in the
  // tree, so React unmounted and remounted them — replaying every entrance
  // animation inside (visible as the content blinking and fading in twice).
  const fillStyle = fill ? styles.fill : undefined;
  return (
    <View style={fillStyle}>
      {showSkeleton && (
        <Animated.View style={{ opacity: skeletonOpacity }}>
          {skeleton}
        </Animated.View>
      )}
      {loaded && (
        <Animated.View
          style={[
            fillStyle,
            {
              opacity: contentOpacity,
              transform: [{ translateY: contentSlide }],
            },
          ]}
        >
          {children}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
