/**
 * FloorplanTakeoffCard — read-only takeoff summary for a job whose photos
 * included an architectural plan/drawing.
 *
 * Surfaces the measured geometry (total area, per-zone areas, perimeter, waste
 * volume) plus a confidence chip and an assumptions footnote, so the tradie can
 * see and sanity-check what was read off the plan instead of trusting silently
 * baked-in numbers. Read-only in this PR — no edit affordances yet.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { FloorplanAnalysis } from '../types';
import { resolvedTakeoff } from '../services/floorplanTakeoff';
import { colors } from '../theme';

interface FloorplanTakeoffCardProps {
  analysis: FloorplanAnalysis;
}

const CONFIDENCE_META: Record<
  FloorplanAnalysis['confidence'],
  { label: string; color: string; bg: string }
> = {
  high: { label: 'High confidence', color: colors.success, bg: colors.successBg },
  medium: { label: 'Medium confidence', color: colors.warning, bg: colors.warningBg },
  low: { label: 'Low confidence', color: colors.error, bg: colors.errorBg },
};

function fmt(n: number): string {
  // Trim trailing zeros: 12.50 → "12.5", 12.00 → "12".
  return Number(n.toFixed(1)).toString();
}

// One-line guidance under the confidence chip so the tradie knows what the
// chip means for the numbers, rather than just colour-coded anxiety.
const CONFIDENCE_GUIDANCE: Record<FloorplanAnalysis['confidence'], string> = {
  low: 'Measurements may be approximate — check before quoting',
  medium: 'Measurements estimated from plan',
  high: "Measurements match the plan's stated scale",
};

export function FloorplanTakeoffCard({ analysis }: FloorplanTakeoffCardProps) {
  const takeoff = resolvedTakeoff(analysis);
  const zones = (takeoff.zones ?? []).filter(
    (z) => typeof z.areaM2 === 'number' && z.areaM2 > 0,
  );
  const conf = CONFIDENCE_META[takeoff.confidence] ?? CONFIDENCE_META.medium;
  const assumptions = (takeoff.assumptions ?? '').trim();

  const totalArea = typeof takeoff.totalAreaM2 === 'number' ? takeoff.totalAreaM2 : 0;
  const perimeter = typeof takeoff.perimeterM === 'number' ? takeoff.perimeterM : 0;
  const removalBin = typeof takeoff.removalBinM3 === 'number' ? takeoff.removalBinM3 : 0;

  // A detected plan with no usable metrics renders as a hollow header (just a
  // title + confidence chip), which reads as "measured" while showing nothing.
  // Don't show the card at all in that case.
  const hasAnyContent =
    totalArea > 0 || perimeter > 0 || removalBin > 0 || zones.length > 0 || !!assumptions;
  if (!hasAnyContent) {
    return null;
  }

  const guidance = CONFIDENCE_GUIDANCE[takeoff.confidence];

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.iconBadge}>
            <MaterialCommunityIcons
              name={'ruler-square' as any}
              size={16}
              color={colors.primary}
            />
          </View>
          <Text style={styles.title}>Measured from plan</Text>
        </View>
        <View style={[styles.confChip, { backgroundColor: conf.bg }]}>
          <Text style={[styles.confLabel, { color: conf.color }]}>{conf.label}</Text>
        </View>
      </View>

      {guidance ? <Text style={styles.guidance}>{guidance}</Text> : null}

      {typeof takeoff.totalAreaM2 === 'number' && takeoff.totalAreaM2 > 0 ? (
        <MetricRow
          icon="vector-square"
          label="Total area"
          value={`${fmt(takeoff.totalAreaM2)} m²`}
        />
      ) : null}

      {typeof takeoff.perimeterM === 'number' && takeoff.perimeterM > 0 ? (
        <MetricRow
          icon="vector-polyline"
          label="Perimeter"
          value={`${fmt(takeoff.perimeterM)} m`}
        />
      ) : null}

      {typeof takeoff.removalBinM3 === 'number' && takeoff.removalBinM3 > 0 ? (
        <MetricRow
          icon="dump-truck"
          label="Waste volume"
          value={`${fmt(takeoff.removalBinM3)} m³`}
        />
      ) : null}

      {zones.length > 0 ? (
        <View style={styles.zonesBlock}>
          <Text style={styles.zonesHeading}>Areas</Text>
          {zones.map((z, i) => (
            <View key={`${z.code ?? z.label}-${i}`} style={styles.zoneRow}>
              {z.code ? (
                <View style={styles.zoneChip}>
                  <Text style={styles.zoneChipText}>{z.code}</Text>
                </View>
              ) : null}
              <Text style={styles.zoneLabel} numberOfLines={1}>
                {z.label}
              </Text>
              <Text style={styles.zoneValue}>{fmt(z.areaM2!)} m²</Text>
            </View>
          ))}
        </View>
      ) : null}

      {assumptions ? <Text style={styles.assumptions}>{assumptions}</Text> : null}
    </View>
  );
}

function MetricRow({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <MaterialCommunityIcons name={icon as any} size={18} color={colors.primary} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.surface,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  confChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    flexShrink: 0,
  },
  confLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  guidance: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: 12,
    backgroundColor: colors.surfaceGray3,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
  },
  rowValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  zonesBlock: {
    gap: 6,
    paddingTop: 2,
  },
  zonesHeading: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  zoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  zoneChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: colors.surfaceGray3,
  },
  zoneChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
  },
  zoneLabel: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
  },
  zoneValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  assumptions: {
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: 'italic',
    lineHeight: 17,
    paddingTop: 2,
  },
});
