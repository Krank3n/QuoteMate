/**
 * Cost Breakdown Chart
 * Shows materials vs labor vs markup split for accepted quotes
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import type { Tokens } from '../theme';
import { makeStyles, useThemeColors } from '../theme';
import { Quote } from '../types';
import { formatCurrency } from '../utils/quoteCalculator';

interface CostBreakdownChartProps {
  quotes: Quote[];
}

const segmentsFor = (themeColors: Tokens) => [
  { key: 'materials', label: 'Materials', color: themeColors.info, icon: 'package-variant' as const },
  { key: 'labor', label: 'Labor', color: themeColors.warning, icon: 'hammer-wrench' as const },
  { key: 'markup', label: 'Markup', color: themeColors.accentText, icon: 'percent-outline' as const },
];

export function CostBreakdownChart({ quotes }: CostBreakdownChartProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const SEGMENTS = segmentsFor(themeColors);
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
        {SEGMENTS.map((seg, i) => (
          <View
            key={seg.key}
            style={[
              styles.stackedSegment,
              {
                width: `${breakdown.percentages[i]}%`,
                backgroundColor: seg.color,
              },
              i === 0 && styles.stackedFirst,
              i === SEGMENTS.length - 1 && styles.stackedLast,
            ]}
          />
        ))}
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

const useStyles = makeStyles((t) => ({
  card: {
    padding: 20,
    borderRadius: 16,
    backgroundColor: t.colors.surfaceRaised,
    elevation: 2,
    marginBottom: 12,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: t.colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: t.colors.textSecondary,
    marginTop: 2,
  },
  // Stacked bar
  stackedBar: {
    flexDirection: 'row',
    height: 28,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: t.colors.surfacePressed,
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
    borderBottomColor: t.colors.surfaceOverlay,
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
    color: t.colors.text,
  },
  legendRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  legendAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.text,
  },
  legendPercent: {
    fontSize: 12,
    color: t.colors.textSecondary,
    width: 32,
    textAlign: 'right',
  },
}));
