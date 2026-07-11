/**
 * FloorplanTakeoffCard — takeoff summary for a job whose photos included an
 * architectural plan/drawing.
 *
 * Surfaces the measured geometry (total area, per-zone areas, perimeter, waste
 * volume) plus a confidence chip and an assumptions footnote. The three
 * headline numbers are editable when the parent supplies `onEdit`: correcting
 * a number IS the calibration — no extra fields, toggles or jargon. A
 * corrected value shows the measured figure underneath ("measured 760"), and
 * correcting the total offers a one-tap "scale the other areas to match".
 */

import React, { useState } from 'react';
import { View, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { FloorplanAnalysis } from '../types';
import { resolvedTakeoff, TakeoffEditField } from '../services/floorplanTakeoff';
import { colors } from '../theme';

interface FloorplanTakeoffCardProps {
  analysis: FloorplanAnalysis;
  /** Called with the corrected value when the tradie edits a number. */
  onEdit?: (field: TakeoffEditField, value: number) => void;
  /** Called when the tradie accepts scaling the zone areas by an area factor. */
  onScaleZones?: (areaFactor: number) => void;
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
  medium: 'Measurements estimated from plan — tap a number to correct it',
  high: "Measurements match the plan's stated scale",
};

export function FloorplanTakeoffCard({ analysis, onEdit, onScaleZones }: FloorplanTakeoffCardProps) {
  const takeoff = resolvedTakeoff(analysis);
  const zones = (takeoff.zones ?? []).filter(
    (z) => typeof z.areaM2 === 'number' && z.areaM2 > 0,
  );
  const conf = CONFIDENCE_META[takeoff.confidence] ?? CONFIDENCE_META.medium;
  const assumptions = (takeoff.assumptions ?? '').trim();

  const totalArea = typeof takeoff.totalAreaM2 === 'number' ? takeoff.totalAreaM2 : 0;
  const perimeter = typeof takeoff.perimeterM === 'number' ? takeoff.perimeterM : 0;
  const removalBin = typeof takeoff.removalBinM3 === 'number' ? takeoff.removalBinM3 : 0;

  const [editingField, setEditingField] = useState<TakeoffEditField | null>(null);
  const [draft, setDraft] = useState('');
  // Set after a total-area correction while zones exist: the area factor the
  // tradie can apply to the other areas with one tap.
  const [pendingZoneFactor, setPendingZoneFactor] = useState<number | null>(null);

  // A detected plan with no usable metrics renders as a hollow header (just a
  // title + confidence chip), which reads as "measured" while showing nothing.
  // Don't show the card at all in that case.
  const hasAnyContent =
    totalArea > 0 || perimeter > 0 || removalBin > 0 || zones.length > 0 || !!assumptions;
  if (!hasAnyContent) {
    return null;
  }

  const guidance = onEdit
    ? CONFIDENCE_GUIDANCE[takeoff.confidence]
    : CONFIDENCE_GUIDANCE[takeoff.confidence]?.replace(' — tap a number to correct it', '');

  const startEdit = (field: TakeoffEditField, current: number) => {
    if (!onEdit) return;
    setEditingField(field);
    setDraft(fmt(current));
  };

  const commitEdit = () => {
    if (!editingField || !onEdit) return;
    const value = parseFloat(draft.replace(',', '.'));
    const field = editingField;
    setEditingField(null);
    if (!isFinite(value) || value <= 0) return;
    const previous =
      field === 'totalAreaM2' ? totalArea : field === 'perimeterM' ? perimeter : removalBin;
    if (previous > 0 && Math.abs(value - previous) / previous < 0.001) return;
    onEdit(field, value);
    if (field === 'totalAreaM2' && previous > 0 && zones.length > 0 && onScaleZones) {
      setPendingZoneFactor(value / previous);
    }
  };

  const metricRow = (
    field: TakeoffEditField,
    icon: string,
    label: string,
    value: number,
    unit: string,
  ) => {
    if (value <= 0) return null;
    const measured =
      field === 'totalAreaM2'
        ? analysis.totalAreaM2
        : field === 'perimeterM'
          ? analysis.perimeterM
          : analysis.removalBinM3;
    const corrected =
      typeof analysis.corrected?.[field] === 'number' &&
      typeof measured === 'number' &&
      Math.abs(analysis.corrected[field]! - measured) / measured >= 0.001;

    if (editingField === field) {
      return (
        <View style={styles.row}>
          <View style={styles.rowIcon}>
            <MaterialCommunityIcons name={icon as any} size={18} color={colors.primary} />
          </View>
          <Text style={styles.rowLabel}>{label}</Text>
          <TextInput
            style={styles.editInput}
            value={draft}
            onChangeText={setDraft}
            keyboardType="decimal-pad"
            autoFocus
            selectTextOnFocus
            onSubmitEditing={commitEdit}
            onBlur={commitEdit}
            accessibilityLabel={`Edit ${label.toLowerCase()}`}
          />
          <Text style={styles.editUnit}>{unit}</Text>
        </View>
      );
    }

    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => startEdit(field, value)}
        disabled={!onEdit}
        accessibilityRole={onEdit ? 'button' : undefined}
        accessibilityLabel={onEdit ? `${label} ${fmt(value)} ${unit}. Tap to correct.` : undefined}
      >
        <View style={styles.rowIcon}>
          <MaterialCommunityIcons name={icon as any} size={18} color={colors.primary} />
        </View>
        <Text style={styles.rowLabel}>{label}</Text>
        <View style={styles.rowValueBlock}>
          <Text style={styles.rowValue}>{`${fmt(value)} ${unit}`}</Text>
          {corrected && typeof measured === 'number' ? (
            <Text style={styles.rowMeasured}>{`measured ${fmt(measured)}`}</Text>
          ) : null}
        </View>
        {onEdit ? (
          <MaterialCommunityIcons
            name={'pencil-outline' as any}
            size={15}
            color={colors.textMuted}
          />
        ) : null}
      </TouchableOpacity>
    );
  };

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

      {metricRow('totalAreaM2', 'vector-square', 'Total area', totalArea, 'm²')}
      {metricRow('perimeterM', 'vector-polyline', 'Perimeter', perimeter, 'm')}
      {metricRow('removalBinM3', 'dump-truck', 'Waste volume', removalBin, 'm³')}

      {pendingZoneFactor !== null && onScaleZones ? (
        <View style={styles.scalePrompt}>
          <Text style={styles.scalePromptText}>Scale the other areas to match?</Text>
          <TouchableOpacity
            style={styles.scalePromptButton}
            onPress={() => {
              onScaleZones(pendingZoneFactor);
              setPendingZoneFactor(null);
            }}
          >
            <Text style={styles.scalePromptButtonText}>Scale them</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setPendingZoneFactor(null)}>
            <Text style={styles.scalePromptDismiss}>Keep as measured</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {zones.length > 0 ? (
        <View style={styles.zonesBlock}>
          <Text style={styles.zonesHeading}>Areas</Text>
          {zones.map((z, i) => {
            // Net edge length (boundary minus doorways/openings) — the
            // quotable skirting/coving run for this zone, when measured.
            const netEdge =
              typeof z.perimeterM === 'number' && z.perimeterM > 0
                ? Math.max(0, z.perimeterM - (z.openingsDeductionM ?? 0))
                : undefined;
            return (
              <View key={`${z.code ?? z.label}-${i}`} style={styles.zoneRow}>
                {z.code ? (
                  <View style={styles.zoneChip}>
                    <Text style={styles.zoneChipText}>{z.code}</Text>
                  </View>
                ) : null}
                <Text style={styles.zoneLabel} numberOfLines={1}>
                  {z.label}
                </Text>
                {netEdge !== undefined ? (
                  <Text style={styles.zoneEdge}>{`edge ${fmt(netEdge)} m`}</Text>
                ) : null}
                <Text style={styles.zoneValue}>{fmt(z.areaM2!)} m²</Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {assumptions ? <Text style={styles.assumptions}>{assumptions}</Text> : null}
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
  rowValueBlock: {
    alignItems: 'flex-end',
  },
  rowValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  rowMeasured: {
    fontSize: 11,
    color: colors.textMuted,
  },
  editInput: {
    minWidth: 72,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'right',
  },
  editUnit: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  scalePrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: colors.primaryBg,
    flexWrap: 'wrap',
  },
  scalePromptText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
    minWidth: 140,
  },
  scalePromptButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  scalePromptButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.surface,
  },
  scalePromptDismiss: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
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
  zoneEdge: {
    fontSize: 12,
    color: colors.textSecondary,
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
