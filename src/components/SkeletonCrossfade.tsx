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
}

const FADE_OUT_DURATION = 250;
const FADE_IN_DURATION = 350;
const FADE_IN_DELAY = 80;

export function SkeletonCrossfade({ loaded, skeleton, children }: SkeletonCrossfadeProps) {
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

  if (!loaded && !showSkeleton) {
    return <>{skeleton}</>;
  }

  if (loaded && !showSkeleton) {
    return <>{children}</>;
  }

  return (
    <View>
      {showSkeleton && (
        <Animated.View style={{ opacity: skeletonOpacity }}>
          {skeleton}
        </Animated.View>
      )}
      {loaded && (
        <Animated.View
          style={{
            opacity: contentOpacity,
            transform: [{ translateY: contentSlide }],
          }}
        >
          {children}
        </Animated.View>
      )}
    </View>
  );
}
