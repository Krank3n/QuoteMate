/**
 * Month Comparison Chart
 * Shows this month vs last month across key metrics
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { subMonths, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';

import { colors } from '../theme';
import { Quote } from '../types';
import { formatCurrency } from '../utils/quoteCalculator';
import { AnimatedNumber } from './AnimatedNumber';

interface MonthComparisonChartProps {
  quotes: Quote[];
}

interface Metric {
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  iconColor: string;
  current: number;
  previous: number;
  format?: (n: number) => string;
}

export function MonthComparisonChart({ quotes }: MonthComparisonChartProps) {
  const metrics = useMemo((): Metric[] => {
    const now = new Date();
    const thisStart = startOfMonth(now);
    const thisEnd = endOfMonth(now);
    const lastStart = startOfMonth(subMonths(now, 1));
    const lastEnd = endOfMonth(subMonths(now, 1));

    const thisMonth = quotes.filter((q) =>
      isWithinInterval(new Date(q.createdAt), { start: thisStart, end: thisEnd })
    );
    const lastMonth = quotes.filter((q) =>
      isWithinInterval(new Date(q.createdAt), { start: lastStart, end: lastEnd })
    );

    const thisAccepted = quotes.filter(
      (q) =>
        (q.status === 'accepted' || q.status === 'completed') &&
        isWithinInterval(new Date(q.updatedAt), { start: thisStart, end: thisEnd })
    );
    const lastAccepted = quotes.filter(
      (q) =>
        (q.status === 'accepted' || q.status === 'completed') &&
        isWithinInterval(new Date(q.updatedAt), { start: lastStart, end: lastEnd })
    );

    const thisRevenue = thisAccepted.reduce((s, q) => s + q.total, 0);
    const lastRevenue = lastAccepted.reduce((s, q) => s + q.total, 0);

    const thisAvgJob = thisAccepted.length > 0 ? thisRevenue / thisAccepted.length : 0;
    const lastAvgJob = lastAccepted.length > 0 ? lastRevenue / lastAccepted.length : 0;

    return [
      {
        label: 'Quotes\nCreated',
        icon: 'file-plus-outline',
        iconColor: colors.info,
        current: thisMonth.length,
        previous: lastMonth.length,
      },
      {
        label: 'Jobs\nWon',
        icon: 'handshake',
        iconColor: colors.primary,
        current: thisAccepted.length,
        previous: lastAccepted.length,
      },
      {
        label: 'Revenue\nEarned',
        icon: 'cash-multiple',
        iconColor: colors.secondary,
        current: thisRevenue,
        previous: lastRevenue,
        format: formatCurrency,
      },
      {
        label: 'Avg Job\nValue',
        icon: 'tag-outline',
        iconColor: colors.warning || colors.secondary,
        current: thisAvgJob,
        previous: lastAvgJob,
        format: formatCurrency,
      },
    ];
  }, [quotes]);

  return (
    <Surface style={styles.card}>
      <Text style={styles.title}>This Month vs Last Month</Text>

      <View style={styles.metricsRow}>
        {metrics.map((m) => {
          const diff = m.current - m.previous;
          const isUp = diff > 0;
          const isDown = diff < 0;
          const changeColor = isUp ? colors.success : isDown ? colors.error : colors.onSurface;

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

const styles = StyleSheet.create({
  card: {
    padding: 20,
    borderRadius: 16,
    backgroundColor: colors.surface,
    elevation: 2,
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
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
    backgroundColor: colors.surfaceGray3,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 8,
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginTop: 8,
    marginBottom: 2,
  },
  metricLabel: {
    fontSize: 11,
    color: colors.onSurface,
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
    color: colors.disabled,
  },
});
