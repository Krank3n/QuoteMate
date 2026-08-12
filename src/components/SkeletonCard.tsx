/**
 * SkeletonCard Component
 * Animated shimmer placeholder matching the QuoteCard / InvoiceCard layout
 */

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { Card, Divider } from 'react-native-paper';
import { makeStyles, useThemeColors } from '../theme';

const SHIMMER_DURATION = 1000;

function ShimmerBlock({ width, height = 12, borderRadius = 6, style }: {
  width: number | string;
  height?: number;
  borderRadius?: number;
  style?: any;
}) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: SHIMMER_DURATION, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: SHIMMER_DURATION, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        { width: width as any, height, borderRadius, backgroundColor: themeColors.border, opacity },
        style,
      ]}
    />
  );
}

export function SkeletonCard({ index = 0 }: { index?: number }) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      delay: index * 80,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim, index]);

  return (
    <Animated.View style={{ opacity: fadeAnim }}>
      <Card style={styles.card}>
        <Card.Content style={styles.cardContent}>
          {/* Header row */}
          <View style={styles.header}>
            {/* Left: number, name, job */}
            <View style={styles.infoLeft}>
              <ShimmerBlock width={72} height={10} />
              <ShimmerBlock width={140} height={14} style={{ marginTop: 6 }} />
              <ShimmerBlock width={100} height={12} style={{ marginTop: 6 }} />
            </View>
            {/* Right: price + status */}
            <View style={styles.infoRight}>
              <ShimmerBlock width={80} height={16} />
              <ShimmerBlock width={56} height={22} borderRadius={11} style={{ marginTop: 8 }} />
            </View>
          </View>

          <Divider style={styles.divider} />

          {/* Footer row */}
          <View style={styles.footer}>
            <View style={styles.footerLeft}>
              <ShimmerBlock width={52} height={10} />
              <ShimmerBlock width={32} height={10} style={{ marginLeft: 12 }} />
            </View>
            <ShimmerBlock width={64} height={10} />
          </View>
        </Card.Content>
      </Card>
    </Animated.View>
  );
}

export function SkeletonCardList({ count = 3 }: { count?: number }) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} index={i} />
      ))}
    </>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    marginBottom: 12,
    backgroundColor: t.colors.surfaceRaised,
  },
  cardContent: {
    paddingTop: 16,
    paddingBottom: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  infoLeft: {
    flex: 1,
  },
  infoRight: {
    alignItems: 'flex-end',
  },
  divider: {
    marginVertical: 12,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
}));
