/**
 * CoverageQuantityModal
 *
 * Bottom sheet that lets the tradie enter an area in m² (or m / m³) and
 * have the app calculate the units required from the linked favorite's
 * coverage spec. Built for an insulation flow but generalises to
 * tilers, painters, decking, etc.
 *
 * Pure presentational — calc lives in src/utils/coverageCalc.ts.
 */

import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Modal as RNModal,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { Text, TextInput, Button, IconButton } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../theme';
import {
  calculateUnits,
  formatCoverageSummary,
} from '../utils/coverageCalc';

interface Props {
  visible: boolean;
  materialName: string;
  /** e.g. 13.5 — m² covered by one unit. */
  coveragePerUnit: number;
  /** e.g. 'm²' | 'm' | 'm³'. */
  coverageUnit: string;
  /** Noun shown to the user — "bag", "box", "sheet". Inferred from `unit`. */
  packLabel: string;
  /** Optional rounding (e.g. bags delivered in 10s). */
  roundingIncrement?: number;
  /** Optional prefilled area (e.g. from job spec). */
  defaultArea?: number;
  onApply: (unitsToOrder: number) => void;
  onCancel: () => void;
}

const COMMON_INCREMENTS = [1, 5, 10, 20];

export function CoverageQuantityModal({
  visible,
  materialName,
  coveragePerUnit,
  coverageUnit,
  packLabel,
  roundingIncrement: defaultIncrement,
  defaultArea,
  onApply,
  onCancel,
}: Props) {
  const safeInsets = useSafeAreaInsets();
  const [areaText, setAreaText] = useState('');
  const [incrementOverride, setIncrementOverride] = useState<number | null>(null);

  useEffect(() => {
    if (visible) {
      setAreaText(defaultArea && defaultArea > 0 ? String(defaultArea) : '');
      setIncrementOverride(null);
    }
  }, [visible, defaultArea]);

  const area = parseFloat(areaText);
  const effectiveIncrement =
    incrementOverride !== null
      ? incrementOverride
      : defaultIncrement && defaultIncrement > 0
      ? defaultIncrement
      : 1;

  const result = useMemo(
    () =>
      calculateUnits({
        area: Number.isFinite(area) ? area : 0,
        coveragePerUnit,
        roundingIncrement: effectiveIncrement,
      }),
    [area, coveragePerUnit, effectiveIncrement]
  );

  const summary = formatCoverageSummary(result, packLabel, coverageUnit);
  const canApply = result.unitsToOrder > 0;

  return (
    <RNModal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTouch} onPress={onCancel} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.sheet, { paddingBottom: safeInsets.bottom + 12 }]}
        >
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Calculate from area</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {materialName}
              </Text>
            </View>
            <IconButton icon="close" onPress={onCancel} />
          </View>

          <Text style={styles.spec}>
            1 {packLabel} covers {coveragePerUnit} {coverageUnit}
          </Text>

          <TextInput
            label={`Total area to cover (${coverageUnit})`}
            value={areaText}
            onChangeText={setAreaText}
            mode="outlined"
            keyboardType="decimal-pad"
            placeholder="e.g. 175"
            style={styles.input}
            autoFocus
          />

          <Text style={styles.sectionLabel}>Order in packs of</Text>
          <View style={styles.incRow}>
            {COMMON_INCREMENTS.map((inc) => {
              const active = effectiveIncrement === inc;
              return (
                <TouchableOpacity
                  key={inc}
                  style={[styles.incBtn, active && styles.incBtnActive]}
                  onPress={() => setIncrementOverride(inc)}
                >
                  <Text style={[styles.incText, active && styles.incTextActive]}>
                    {inc === 1 ? 'Any' : inc}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {canApply ? (
            <View style={styles.resultCard}>
              <Text style={styles.resultBig}>
                {result.unitsToOrder} {result.unitsToOrder === 1 ? packLabel : `${packLabel}s`}
              </Text>
              <Text style={styles.resultMeta}>{summary}</Text>
            </View>
          ) : (
            <View style={styles.resultPlaceholder}>
              <Text style={styles.resultPlaceholderText}>
                Enter an area to see how many {packLabel}s you need.
              </Text>
            </View>
          )}

          <View style={styles.actions}>
            <Button mode="text" onPress={onCancel} style={{ flex: 1 }}>
              Cancel
            </Button>
            <Button
              mode="contained"
              onPress={() => onApply(result.unitsToOrder)}
              disabled={!canApply}
              style={{ flex: 1 }}
            >
              Apply
            </Button>
          </View>
        </KeyboardAvoidingView>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  backdropTouch: { flex: 1 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
  },
  header: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 13, color: colors.onSurface, marginTop: 2 },
  spec: { color: colors.onSurface, fontSize: 13, marginBottom: 12 },
  input: { backgroundColor: colors.surface, marginBottom: 12 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.onSurface,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  incRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  incBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.outline + '40',
    alignItems: 'center',
  },
  incBtnActive: { backgroundColor: colors.primary + '12', borderColor: colors.primary },
  incText: { color: colors.onSurface, fontWeight: '600' },
  incTextActive: { color: colors.primary },
  resultCard: {
    backgroundColor: colors.primary + '0E',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.primary + '30',
  },
  resultBig: { fontSize: 22, fontWeight: '700', color: colors.primary, marginBottom: 4 },
  resultMeta: { color: colors.onSurface, fontSize: 13 },
  resultPlaceholder: {
    backgroundColor: colors.surfaceDark || colors.background,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  resultPlaceholderText: { color: colors.onSurface, fontSize: 13 },
  actions: { flexDirection: 'row', gap: 8 },
});
