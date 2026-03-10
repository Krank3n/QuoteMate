/**
 * Cost Breakdown Chart
 * Shows materials vs labor vs markup split for accepted quotes
 */

import React, { useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { colors } from '../theme';
import { Quote } from '../types';
import { formatCurrency } from '../utils/quoteCalculator';

interface CostBreakdownChartProps {
  quotes: Quote[];
}

const SEGMENTS = [
  { key: 'materials', label: 'Materials', color: colors.info, icon: 'package-variant' as const },
  { key: 'labor', label: 'Labor', color: colors.secondary, icon: 'hammer-wrench' as const },
  { key: 'markup', label: 'Markup', color: colors.primary, icon: 'percent-outline' as const },
];

export function CostBreakdownChart({ quotes }: CostBreakdownChartProps) {
  const animatedWidths = useRef(SEGMENTS.map(() => new Animated.Value(0))).current;

  const breakdown = useMemo(() => {
    const accepted = quotes.filter((q) => q.status === 'accepted' || q.status === 'completed');
    const materials = accepted.reduce((sum, q) => sum + q.materialsSubtotal, 0);
    const labor = accepted.reduce((sum, q) => sum + q.laborTotal, 0);
    const markup = accepted.reduce((sum, q) => sum + q.markupAmount, 0);
    const total = Math.max(materials + labor + markup, 1);

    return {
      values: [materials, labor, markup],
      percentages: [
        (materials / total) * 100,
        (labor / total) * 100,
        (markup / total) * 100,
      ],
      total,
      jobCount: accepted.length,
    };
  }, [quotes]);

  useEffect(() => {
    const animations = animatedWidths.map((anim, i) => {
      anim.setValue(0);
      return Animated.timing(anim, {
        toValue: breakdown.percentages[i],
        duration: 800,
        delay: 200 + i * 100,
        useNativeDriver: false,
      });
    });
    Animated.parallel(animations).start();
  }, [breakdown]);

  if (breakdown.jobCount === 0) {
    return null;
  }

  return (
    <Surface style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Cost Breakdown</Text>
          <Text style={styles.subtitle}>Across {breakdown.jobCount} accepted job{breakdown.jobCount !== 1 ? 's' : ''}</Text>
        </View>
      </View>

      {/* Stacked bar */}
      <View style={styles.stackedBar}>
        {SEGMENTS.map((seg, i) => {
          const width = animatedWidths[i].interpolate({
            inputRange: [0, 100],
            outputRange: ['0%', '100%'],
          });
          return (
            <Animated.View
              key={seg.key}
              style={[
                styles.stackedSegment,
                {
                  width,
                  backgroundColor: seg.color,
                },
                i === 0 && styles.stackedFirst,
                i === SEGMENTS.length - 1 && styles.stackedLast,
              ]}
            />
          );
        })}
      </View>

      {/* Legend rows */}
      {SEGMENTS.map((seg, i) => (
        <View key={seg.key} style={styles.legendRow}>
          <View style={styles.legendLeft}>
            <View style={[styles.legendDot, { backgroundColor: seg.color }]} />
            <MaterialCommunityIcons name={seg.icon} size={16} color={seg.color} style={{ marginRight: 8 }} />
            <Text style={styles.legendLabel}>{seg.label}</Text>
          </View>
          <View style={styles.legendRight}>
            <Text style={styles.legendAmount}>{formatCurrency(breakdown.values[i])}</Text>
            <Text style={styles.legendPercent}>{breakdown.percentages[i].toFixed(0)}%</Text>
          </View>
        </View>
      ))}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 20,
    borderRadius: 16,
    backgroundColor: colors.surface,
    elevation: 2,
    marginBottom: 12,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: colors.onSurface,
    marginTop: 2,
  },
  // Stacked bar
  stackedBar: {
    flexDirection: 'row',
    height: 28,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.surfaceGray3,
    marginBottom: 20,
    gap: 2,
  },
  stackedSegment: {
    height: '100%',
  },
  stackedFirst: {
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
  },
  stackedLast: {
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
  },
  // Legend
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.surfaceLight,
  },
  legendLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  legendLabel: {
    fontSize: 14,
    color: colors.text,
  },
  legendRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  legendAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  legendPercent: {
    fontSize: 12,
    color: colors.onSurface,
    width: 32,
    textAlign: 'right',
  },
});
