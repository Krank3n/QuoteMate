/**
 * Month Comparison Chart
 * Shows this month vs last month across key metrics
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { makeStyles, useThemeColors } from '../theme';
import type { Document } from '../types/document';
import { monthComparison } from '../utils/insightsStats';
import { formatCurrency } from '../utils/quoteCalculator';
import { AnimatedNumber } from './AnimatedNumber';

interface MonthComparisonChartProps {
  documents: Document[];
}

interface Metric {
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  iconColor: string;
  current: number;
  previous: number;
  format?: (n: number) => string;
}

export function MonthComparisonChart({ documents }: MonthComparisonChartProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const metrics = useMemo((): Metric[] => {
    // "Revenue Earned" is money received, from the payment ledger — it used to
    // sum the total of accepted quotes, so it disagreed with the dashboard's
    // "Earned this month". See monthComparison.
    const { current, previous } = monthComparison(documents);

    return [
      {
        label: 'Quotes\nCreated',
        icon: 'file-plus-outline',
        iconColor: themeColors.info,
        current: current.quotesCreated,
        previous: previous.quotesCreated,
      },
      {
        label: 'Jobs\nWon',
        icon: 'handshake',
        iconColor: themeColors.accent,
        current: current.jobsWon,
        previous: previous.jobsWon,
      },
      {
        label: 'Revenue\nEarned',
        icon: 'cash-multiple',
        iconColor: themeColors.warning,
        current: current.revenueEarned,
        previous: previous.revenueEarned,
        format: formatCurrency,
      },
      {
        label: 'Avg Job\nValue',
        icon: 'tag-outline',
        iconColor: themeColors.warning,
        current: current.avgJobValue,
        previous: previous.avgJobValue,
        format: formatCurrency,
      },
    ];
  }, [documents, themeColors]);

  return (
    <Surface style={styles.card}>
      <Text style={styles.title}>This Month vs Last Month</Text>

      <View style={styles.metricsRow}>
        {metrics.map((m) => {
          const diff = m.current - m.previous;
          const isUp = diff > 0;
          const isDown = diff < 0;
          const changeColor = isUp ? themeColors.money : isDown ? themeColors.error : themeColors.textSecondary;

          let changeText: string;
          if (m.format) {
            changeText = `${isUp ? '+' : ''}${m.format(diff)}`;
          } else {
            changeText = `${isUp ? '+' : ''}${diff}`;
          }

          return (
            <View key={m.label} style={styles.metricCard}>
              <MaterialCommunityIcons name={m.icon} size={22} color={m.iconColor} />
              <AnimatedNumber
                value={m.current}
                format={m.format}
                style={styles.metricValue}
                delay={200}
              />
              <Text style={styles.metricLabel}>{m.label}</Text>

              {/* Change indicator */}
              <View style={styles.changeBadge}>
                {(isUp || isDown) && (
                  <MaterialCommunityIcons
                    name={isUp ? 'arrow-up-bold' : 'arrow-down-bold'}
                    size={12}
                    color={changeColor}
                  />
                )}
                <Text style={[styles.changeText, { color: changeColor }]}>
                  {changeText}
                </Text>
              </View>

              <Text style={styles.previousText}>
                {m.format ? m.format(m.previous) : m.previous} last mo
              </Text>
            </View>
          );
        })}
      </View>
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
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: t.colors.text,
    marginBottom: 18,
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCard: {
    flexBasis: '47%',
    flexGrow: 1,
    alignItems: 'center',
    backgroundColor: t.colors.surfacePressed,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 8,
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '700',
    color: t.colors.text,
    marginTop: 8,
    marginBottom: 2,
  },
  metricLabel: {
    fontSize: 11,
    color: t.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 15,
    marginBottom: 8,
  },
  changeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginBottom: 4,
  },
  changeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  previousText: {
    fontSize: 10,
    color: t.colors.textDisabled,
  },
}));
