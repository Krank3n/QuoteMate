/**
 * Quote Pipeline Chart
 * Shows quote funnel by status with win rate
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import type { Tokens } from '../theme';
import { makeStyles, useThemeColors } from '../theme';
import { Quote } from '../types';

interface QuotePipelineChartProps {
  quotes: Quote[];
}

const status_configFor = (themeColors: Tokens) => [
  { key: 'draft' as const, label: 'Draft', color: themeColors.surfaceOverlay, icon: 'file-edit-outline' as const },
  { key: 'sent' as const, label: 'Sent', color: themeColors.info, icon: 'send' as const },
  { key: 'accepted' as const, label: 'Accepted', color: themeColors.money, icon: 'check-circle-outline' as const },
  { key: 'completed' as const, label: 'Completed', color: themeColors.accentText, icon: 'check-decagram' as const },
  { key: 'rejected' as const, label: 'Rejected', color: themeColors.error, icon: 'close-circle-outline' as const },
];

export function QuotePipelineChart({ quotes }: QuotePipelineChartProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const STATUS_CONFIG = status_configFor(themeColors);
  const statusData = useMemo(() => {
    const total = Math.max(quotes.length, 1);
    return STATUS_CONFIG.map(({ key, label, color, icon }) => {
      const filtered = quotes.filter((q) => q.status === key);
      return {
        key,
        label,
        color,
        icon,
        count: filtered.length,
        ratio: filtered.length / total,
      };
    });
  }, [quotes]);

  const winRate = useMemo(() => {
    const won = quotes.filter((q) => q.status === 'accepted' || q.status === 'completed').length;
    const rejected = quotes.filter((q) => q.status === 'rejected').length;
    const decided = won + rejected;
    return decided > 0 ? Math.round((won / decided) * 100) : 0;
  }, [quotes]);

  if (quotes.length === 0) {
    return null;
  }

  return (
    <Surface style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Quote Pipeline</Text>
          <Text style={styles.subtitle}>{quotes.length} total quotes</Text>
        </View>
        <View style={styles.winRateBadge}>
          <MaterialCommunityIcons name="trophy-outline" size={14} color={themeColors.warning} />
          <Text style={styles.winRateText}>{winRate}% win rate</Text>
        </View>
      </View>

      {statusData.map((item) => (
        <View key={item.key} style={styles.row}>
          <View style={styles.rowLabel}>
            <MaterialCommunityIcons name={item.icon} size={16} color={item.color} />
            <Text style={styles.rowLabelText}>{item.label}</Text>
          </View>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                { width: `${item.ratio * 100}%`, backgroundColor: item.color },
              ]}
            />
          </View>
          <Text style={styles.rowCount}>{item.count}</Text>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
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
  winRateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: t.colors.warningSubtle,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  winRateText: {
    fontSize: 12,
    fontWeight: '700',
    color: t.colors.warning,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  rowLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 90,
    gap: 8,
  },
  rowLabelText: {
    fontSize: 13,
    color: t.colors.textSecondary,
  },
  barTrack: {
    flex: 1,
    height: 22,
    backgroundColor: t.colors.surfacePressed,
    borderRadius: 6,
    overflow: 'hidden',
    marginHorizontal: 10,
  },
  barFill: {
    height: '100%',
    borderRadius: 6,
    minWidth: 4,
  },
  rowCount: {
    fontSize: 14,
    fontWeight: '700',
    color: t.colors.text,
    width: 28,
    textAlign: 'right',
  },
}));
