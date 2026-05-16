/**
 * Revenue Chart Component
 * Beautiful animated bar chart with revenue breakdown for Dashboard
 */

import React, { useState, useMemo } from 'react';
import { View, StyleSheet, Pressable, TouchableOpacity } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { format, subMonths, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';

import { colors } from '../theme';
import { Quote } from '../types';
import { formatCurrency } from '../utils/quoteCalculator';

interface RevenueChartProps {
  quotes: Quote[];
  onMonthPress?: (monthLabel: string) => void;
}

interface MonthData {
  label: string;
  shortLabel: string;
  revenue: number;
  count: number;
  start: Date;
  end: Date;
}

export function RevenueChart({ quotes, onMonthPress }: RevenueChartProps) {
  const [showBreakdown, setShowBreakdown] = useState(false);

  // Calculate monthly data for last 6 months
  const monthlyData = useMemo(() => {
    const now = new Date();
    const months: MonthData[] = [];

    for (let i = 5; i >= 0; i--) {
      const monthDate = subMonths(now, i);
      const start = startOfMonth(monthDate);
      const end = endOfMonth(monthDate);

      const monthQuotes = quotes.filter(
        (q) =>
          (q.status === 'accepted' || q.status === 'completed') &&
          isWithinInterval(new Date(q.updatedAt), { start, end })
      );

      months.push({
        label: format(monthDate, 'MMMM yyyy'),
        shortLabel: format(monthDate, 'MMM'),
        revenue: monthQuotes.reduce((sum, q) => sum + q.total, 0),
        count: monthQuotes.length,
        start,
        end,
      });
    }

    return months;
  }, [quotes]);

  const maxRevenue = useMemo(
    () => Math.max(...monthlyData.map((m) => m.revenue), 1),
    [monthlyData]
  );

  const currentMonth = monthlyData[5];
  const lastMonth = monthlyData[4];
  const trendPercent =
    lastMonth.revenue > 0
      ? ((currentMonth.revenue - lastMonth.revenue) / lastMonth.revenue) * 100
      : currentMonth.revenue > 0
      ? 100
      : 0;
  const isTrendUp = trendPercent >= 0;

  // Total across all 6 months
  const sixMonthTotal = monthlyData.reduce((sum, m) => sum + m.revenue, 0);
  const avgMonthly = sixMonthTotal / 6;

  return (
    <View style={styles.container}>
      {/* Chart Card */}
      <Surface style={styles.chartCard}>
        <View style={styles.chartHeader}>
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.chartTitle}>Revenue Trend</Text>
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: isTrendUp ? colors.successBg : colors.errorBg,
                paddingHorizontal: 7,
                paddingVertical: 3,
                borderRadius: 8,
                gap: 2,
              }}>
                <MaterialCommunityIcons
                  name={isTrendUp ? 'trending-up' : 'trending-down'}
                  size={13}
                  color={isTrendUp ? colors.success : colors.error}
                />
                <Text style={{
                  fontSize: 11,
                  fontWeight: '700',
                  color: isTrendUp ? colors.success : colors.error,
                }}>
                  {isTrendUp ? '+' : ''}{trendPercent.toFixed(0)}%
                </Text>
              </View>
            </View>
            <Text style={styles.chartSubtitle}>Last 6 months</Text>
          </View>
          <View style={styles.totalBadge}>
            <Text style={styles.totalLabel}>6-mo total</Text>
            <Text style={styles.totalValue}>{formatCurrency(sixMonthTotal)}</Text>
          </View>
        </View>

        {/* Bar Chart */}
        <View style={styles.chartArea}>
          {/* Grid lines (no labels — keeps chart full width) */}
          <View style={styles.gridLines}>
            {[1, 0.75, 0.5, 0.25, 0].map((ratio) => (
              <View key={ratio} style={styles.gridLine} />
            ))}
          </View>

          {/* Bars */}
          <View style={styles.barsContainer}>
            {monthlyData.map((month, i) => {
              const heightPct = `${(month.revenue / maxRevenue) * 100}%` as const;
              const isCurrentMonth = i === 5;

              return (
                <Pressable
                  key={month.shortLabel}
                  style={styles.barColumn}
                  onPress={() => onMonthPress?.(month.label)}
                >
                  <View style={styles.barWrapper}>
                    <View
                      style={[
                        styles.bar,
                        {
                          height: heightPct,
                          backgroundColor: isCurrentMonth
                            ? colors.primary
                            : colors.surfaceLight,
                        },
                      ]}
                    >
                      {isCurrentMonth && <View style={styles.barGlow} />}
                    </View>
                  </View>
                  <Text
                    style={[
                      styles.barLabel,
                      isCurrentMonth && styles.barLabelActive,
                    ]}
                  >
                    {month.shortLabel}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Surface>

      {/* Revenue Breakdown — collapsible */}
      <Surface style={styles.breakdownCard}>
        <TouchableOpacity
          style={styles.breakdownHeader}
          onPress={() => setShowBreakdown(!showBreakdown)}
          activeOpacity={0.7}
        >
          <Text style={styles.breakdownTitle}>Monthly Breakdown</Text>
          <View style={styles.breakdownToggle}>
            <Text style={styles.breakdownToggleText}>{showBreakdown ? 'Hide' : 'Details'}</Text>
            <MaterialCommunityIcons
              name={showBreakdown ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.onSurface}
            />
          </View>
        </TouchableOpacity>

        {showBreakdown && (
          <>
            {monthlyData
              .slice()
              .reverse()
              .map((month) => (
                <View key={month.label} style={styles.breakdownRow}>
                  <View style={styles.breakdownLeft}>
                    <View
                      style={[
                        styles.breakdownDot,
                        {
                          backgroundColor:
                            month === currentMonth ? colors.primary : colors.surfaceLight,
                        },
                      ]}
                    />
                    <Text style={styles.breakdownMonth}>{month.label}</Text>
                  </View>
                  <View style={styles.breakdownRight}>
                    <Text style={styles.breakdownAmount}>
                      {formatCurrency(month.revenue)}
                    </Text>
                    <Text style={styles.breakdownCount}>
                      {month.count} job{month.count !== 1 ? 's' : ''}
                    </Text>
                  </View>
                </View>
              ))}

            {/* Average */}
            <View style={styles.averageRow}>
              <View style={styles.breakdownLeft}>
                <MaterialCommunityIcons
                  name="chart-line"
                  size={16}
                  color={colors.secondary}
                />
                <Text style={[styles.breakdownMonth, { color: colors.secondary, marginLeft: 8 }]}>
                  Monthly Average
                </Text>
              </View>
              <Text style={[styles.breakdownAmount, { color: colors.secondary }]}>
                {formatCurrency(avgMonthly)}
              </Text>
            </View>
          </>
        )}
      </Surface>
    </View>
  );
}

const CHART_HEIGHT = 160;

const styles = StyleSheet.create({
  container: {
    marginBottom: 0,
  },
  // Chart Card
  chartCard: {
    padding: 20,
    borderRadius: 16,
    backgroundColor: colors.surface,
    elevation: 2,
    marginBottom: 12,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  chartSubtitle: {
    fontSize: 12,
    color: colors.onSurface,
    marginTop: 2,
  },
  totalBadge: {
    alignItems: 'flex-end',
  },
  totalLabel: {
    fontSize: 11,
    color: colors.onSurface,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  totalValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
    marginTop: 2,
  },
  // Chart Area
  chartArea: {
    height: CHART_HEIGHT + 30,
    position: 'relative',
  },
  gridLines: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: CHART_HEIGHT,
    justifyContent: 'space-between',
  },
  gridLine: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.surfaceLight,
  },
  barsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    height: CHART_HEIGHT,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
  },
  barWrapper: {
    width: '65%',
    height: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  bar: {
    width: '100%',
    borderRadius: 6,
    minHeight: 4,
    overflow: 'hidden',
  },
  barGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  barLabel: {
    fontSize: 11,
    color: colors.onSurface,
    marginTop: 8,
    fontWeight: '500',
  },
  barLabelActive: {
    color: colors.primary,
    fontWeight: '700',
  },
  // Breakdown Card
  breakdownCard: {
    padding: 20,
    borderRadius: 16,
    backgroundColor: colors.surface,
    elevation: 2,
    marginBottom: 12,
  },
  breakdownHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  breakdownTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  breakdownToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  breakdownToggleText: {
    fontSize: 13,
    color: colors.onSurface,
    fontWeight: '500',
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.surfaceLight,
  },
  breakdownLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  breakdownDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 12,
  },
  breakdownMonth: {
    fontSize: 14,
    color: colors.text,
  },
  breakdownRight: {
    alignItems: 'flex-end',
  },
  breakdownAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  breakdownCount: {
    fontSize: 11,
    color: colors.onSurface,
    marginTop: 2,
  },
  averageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 14,
    marginTop: 4,
  },
});
