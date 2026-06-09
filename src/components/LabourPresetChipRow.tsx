/**
 * LabourPresetChipRow
 *
 * Horizontal chip row + measured-area input that lets the tradie apply
 * one of their saved labour-rate presets to the current quote in one tap.
 *
 * Stateless / controlled. The parent owns the measured area + the act of
 * actually mutating the quote (it knows how laborHours / laborRate are
 * persisted). This component is pure UI + computation.
 */

import React, { useState, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, TextInput, Surface, Button } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import { colors } from '../theme';
import { computeLabourFromPreset, formatPresetRate } from '../utils/labourPreset';
import type { LabourRatePreset } from '../types';

interface Props {
  presets: LabourRatePreset[];
  /** Prefilled measured area when known (e.g. from job spec). */
  defaultMeasuredArea?: number;
  /** Label of the most recently applied preset for the "applied" badge. */
  currentSnapshotName?: string;
  onApplyPreset: (input: {
    preset: LabourRatePreset;
    measuredArea: number;
    computedLabourTotal: number;
  }) => void;
}

export function LabourPresetChipRow({
  presets,
  defaultMeasuredArea,
  currentSnapshotName,
  onApplyPreset,
}: Props) {
  const navigation = useNavigation<any>();
  const [areaText, setAreaText] = useState(
    defaultMeasuredArea && defaultMeasuredArea > 0 ? String(defaultMeasuredArea) : '',
  );

  const area = parseFloat(areaText);
  const measured = Number.isFinite(area) ? area : 0;

  const previews = useMemo(
    () => presets.map((p) => ({ preset: p, total: computeLabourFromPreset(p, measured) })),
    [presets, measured],
  );

  if (presets.length === 0) {
    return (
      <Surface style={styles.card}>
        <View style={styles.header}>
          <MaterialCommunityIcons name="tools" size={18} color={colors.primary} />
          <Text style={styles.title}>Labour rate presets</Text>
        </View>
        <Text style={styles.subtitle}>
          Save $/m² rates once, drop them on every quote.
        </Text>
        <Button
          mode="outlined"
          icon="plus"
          onPress={() => navigation.navigate('LabourRatePresets' as never)}
          style={{ marginTop: 8 }}
        >
          Set up presets
        </Button>
      </Surface>
    );
  }

  return (
    <Surface style={styles.card}>
      <View style={styles.header}>
        <MaterialCommunityIcons name="tools" size={18} color={colors.primary} />
        <Text style={styles.title}>Labour rate presets</Text>
        <View style={{ flex: 1 }} />
        <Button
          mode="text"
          compact
          onPress={() => navigation.navigate('LabourRatePresets' as never)}
        >
          Manage
        </Button>
      </View>

      {currentSnapshotName && (
        <View style={styles.appliedBanner}>
          <MaterialCommunityIcons
            name="check-circle-outline"
            size={14}
            color={colors.primary}
          />
          <Text style={styles.appliedBannerText}>
            Currently using: {currentSnapshotName}
          </Text>
        </View>
      )}

      <TextInput
        label="Measured area (m²)"
        value={areaText}
        onChangeText={setAreaText}
        mode="outlined"
        dense
        keyboardType="decimal-pad"
        placeholder="e.g. 240"
        style={styles.input}
      />

      <View style={styles.chipRow}>
        {previews.map(({ preset, total }) => {
          const disabled = measured <= 0;
          return (
            <TouchableOpacity
              key={preset.id}
              disabled={disabled}
              onPress={() =>
                onApplyPreset({
                  preset,
                  measuredArea: measured,
                  computedLabourTotal: total,
                })
              }
              style={[styles.chip, disabled && styles.chipDisabled]}
            >
              <Text style={styles.chipTitle} numberOfLines={1}>
                {preset.name}
              </Text>
              <Text style={styles.chipMeta}>{formatPresetRate(preset)}</Text>
              {!disabled && (
                <Text style={styles.chipTotal}>= ${total.toFixed(2)}</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: 14,
    elevation: 2,
    backgroundColor: colors.surface,
    marginBottom: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '700', color: colors.text },
  subtitle: { color: colors.textMuted || colors.onSurface, fontSize: 12, marginTop: 4 },
  appliedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary + '0E',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginTop: 8,
  },
  appliedBannerText: { color: colors.primary, fontSize: 12, fontWeight: '600' },
  input: { backgroundColor: colors.surface, marginTop: 10 },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.primary + '40',
    backgroundColor: colors.primary + '08',
    minWidth: 130,
  },
  chipDisabled: { opacity: 0.45 },
  chipTitle: { color: colors.text, fontSize: 13, fontWeight: '700' },
  chipMeta: { color: colors.onSurface, fontSize: 11, marginTop: 2 },
  chipTotal: { color: colors.primary, fontSize: 13, fontWeight: '700', marginTop: 4 },
});
