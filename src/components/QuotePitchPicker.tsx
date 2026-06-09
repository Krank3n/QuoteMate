/**
 * QuotePitchPicker
 *
 * Card shown on JobPreviewScreen (and ViewJob scope card) that lets the
 * tradie pick a sales pitch for the current quote, fill in any
 * template variables, and see a live preview of what the customer will
 * read above the line items.
 *
 * Stateless / controlled \u2014 parent owns the Quote and persists via
 * onChange. The component manages local input strings + live derive eval.
 */

import React, { useMemo, useState, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, TextInput, Surface, Button } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import { colors } from '../theme';
import { resolvePitchVariables, renderPitch } from '../utils/salesPitch';
import type { SalesPitch } from '../types';

export interface QuotePitchPickerChange {
  pitchId?: string;
  pitchVariableValues?: Record<string, string>;
}

interface Props {
  /** User's library of pitches. */
  pitches: SalesPitch[];
  /** Currently selected pitch id (or undefined for none). */
  pitchId?: string;
  /** Per-quote overrides for variable values. */
  pitchVariableValues?: Record<string, string>;
  onChange: (partial: QuotePitchPickerChange) => void;
}

export function QuotePitchPicker({
  pitches,
  pitchId,
  pitchVariableValues,
  onChange,
}: Props) {
  const navigation = useNavigation<any>();
  const selected = useMemo(
    () => pitches.find((p) => p.id === pitchId) || null,
    [pitches, pitchId],
  );

  // Local input strings so typing feels instant. Synced down from props.
  const [values, setValues] = useState<Record<string, string>>(
    pitchVariableValues || {},
  );
  useEffect(() => {
    setValues(pitchVariableValues || {});
  }, [pitchVariableValues, pitchId]);

  const resolved = useMemo(() => {
    if (!selected) return {};
    return resolvePitchVariables(selected, values);
  }, [selected, values]);

  const previewBody = useMemo(() => {
    if (!selected) return '';
    return renderPitch(selected, resolved);
  }, [selected, resolved]);

  const handlePickPitch = (nextId: string | undefined) => {
    onChange({ pitchId: nextId, pitchVariableValues: undefined });
    setValues({});
  };

  const commitValue = (key: string, val: string) => {
    const next = { ...values, [key]: val };
    setValues(next);
    onChange({ pitchVariableValues: next });
  };

  return (
    <Surface style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.titleIcon}>
          <MaterialCommunityIcons name="bullhorn-outline" size={18} color={colors.primary} />
        </View>
        <Text style={styles.title}>Sales pitch</Text>
        <View style={{ flex: 1 }} />
        <Button
          mode="text"
          compact
          onPress={() => navigation.navigate('QuotePitch' as never)}
        >
          Manage
        </Button>
      </View>

      <Text style={styles.subtitle}>
        Renders above the line items on the customer PDF + email body.
      </Text>

      <View style={styles.chipRow}>
        <PitchChip
          label="None"
          active={!pitchId}
          onPress={() => handlePickPitch(undefined)}
        />
        {pitches.map((p) => (
          <PitchChip
            key={p.id}
            label={p.name}
            active={pitchId === p.id}
            onPress={() => handlePickPitch(p.id)}
          />
        ))}
      </View>

      {selected && (selected.variables?.length || 0) > 0 && (
        <View style={styles.varBlock}>
          <Text style={styles.varBlockLabel}>Fill in</Text>
          {(selected.variables || []).map((v) => {
            const isDerived = !!v.derive;
            const inputValue = values[v.key] ?? (isDerived ? resolved[v.key] || '' : v.defaultValue || '');
            return (
              <TextInput
                key={v.key}
                label={v.label + (isDerived ? ' (auto)' : '')}
                value={inputValue}
                onChangeText={(val) => commitValue(v.key, val)}
                onBlur={() => commitValue(v.key, inputValue)}
                mode="outlined"
                dense
                keyboardType={v.type === 'number' ? 'decimal-pad' : 'default'}
                style={styles.varInput}
                editable={!isDerived}
              />
            );
          })}
        </View>
      )}

      {selected && (
        <View style={styles.preview}>
          <Text style={styles.previewLabel}>Preview</Text>
          <Text style={styles.previewBody}>{previewBody}</Text>
        </View>
      )}
    </Surface>
  );
}

function PitchChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 12,
    padding: 14,
    borderRadius: 14,
    elevation: 2,
    backgroundColor: colors.surface,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: (colors.primaryBg || colors.primary + '12'),
  },
  title: { fontSize: 15, fontWeight: '700', color: colors.text },
  subtitle: { color: colors.textMuted || colors.onSurface, fontSize: 12, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: (colors.border || colors.outline + '40'),
    backgroundColor: colors.surface,
    maxWidth: 200,
  },
  chipActive: { backgroundColor: colors.primary + '12', borderColor: colors.primary },
  chipText: { color: colors.textMuted || colors.onSurface, fontWeight: '600', fontSize: 13 },
  chipTextActive: { color: colors.primary },
  varBlock: { marginTop: 12, gap: 8 },
  varBlockLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: colors.textMuted || colors.onSurface,
    letterSpacing: 0.6,
  },
  varInput: { backgroundColor: colors.surface },
  preview: {
    marginTop: 12,
    padding: 10,
    borderRadius: 8,
    backgroundColor: (colors.surfaceDark || colors.background),
    borderWidth: 1,
    borderColor: (colors.border || colors.outline + '30'),
  },
  previewLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: colors.textMuted || colors.onSurface,
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  previewBody: { color: colors.text, fontSize: 13, lineHeight: 18 },
});
