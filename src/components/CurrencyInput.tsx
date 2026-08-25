/**
 * CurrencyInput — shared dollar-amount field with draft/commit semantics.
 *
 * The committed `value` is the source of truth: while focused the raw text is
 * a local draft, and blur/submit parses it, rounds to cents, clamps to any
 * given bounds, and fires `onCommit`. Junk input or an unchanged figure fires
 * nothing — the field snaps back to the committed value.
 *
 * Two looks:
 *  - 'inline': compact boxed figure with a pencil, for editing a number that
 *    sits among read-only numbers (TakePaymentSheet's deposit).
 *  - 'field': full-width labelled form row (Record Payment's amount).
 */

import React, { useState } from 'react';
import { View, TextInput, Platform } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { makeStyles, useThemeColors } from '../theme';

interface CurrencyInputProps {
  /** Committed dollar figure; renders as value.toFixed(2) while not editing. */
  value: number;
  /**
   * Fired on blur/submit with the parsed, cent-rounded, clamped figure.
   * Not fired on unparseable input or an unchanged value.
   */
  onCommit: (next: number) => void;
  /** Clamp bounds applied at commit. Omit to accept any figure. */
  min?: number;
  max?: number;
  variant?: 'inline' | 'field';
  /** 'field' variant only. */
  label?: string;
  accessibilityLabel: string;
  editable?: boolean;
  autoFocus?: boolean;
  testID?: string;
}

export function CurrencyInput({
  value,
  onCommit,
  min,
  max,
  variant = 'field',
  label,
  accessibilityLabel,
  editable = true,
  autoFocus,
  testID,
}: CurrencyInputProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  // Raw text while the field has focus; null when blurred (shows `value`).
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    const raw = draft;
    setDraft(null);
    if (raw === null) return;
    const parsed = parseFloat(raw.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(parsed)) return;
    let next = Math.round(parsed * 100) / 100;
    if (min !== undefined) next = Math.max(next, min);
    if (max !== undefined) next = Math.min(next, max);
    if (next === value) return;
    onCommit(next);
  };

  const input = (
    <TextInput
      style={variant === 'inline' ? styles.inlineInput : styles.fieldInput}
      value={draft ?? value.toFixed(2)}
      onChangeText={setDraft}
      onFocus={() => setDraft(value.toFixed(2))}
      onBlur={commit}
      onSubmitEditing={commit}
      keyboardType="decimal-pad"
      returnKeyType="done"
      selectTextOnFocus
      editable={editable}
      autoFocus={autoFocus}
      accessibilityLabel={accessibilityLabel}
      placeholder="0.00"
      placeholderTextColor={themeColors.textFaint}
      testID={testID}
    />
  );

  if (variant === 'inline') {
    return (
      <View style={styles.inlineBox}>
        <Text style={styles.currency}>$</Text>
        {input}
        <MaterialCommunityIcons
          name="pencil"
          size={13}
          color={themeColors.textMuted}
        />
      </View>
    );
  }

  return (
    <View>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <View style={styles.fieldBox}>
        <Text style={styles.currency}>$</Text>
        {input}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  // Reads as an input rather than a number: boxed, with a pencil.
  inlineBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
    backgroundColor: t.colors.surfaceRaised,
  },
  currency: {
    fontSize: 18,
    fontWeight: '700',
    color: t.colors.money,
  },
  inlineInput: {
    // Fixed rather than flexible: react-native-web grows a bare input to fill
    // the row, which shoves the "$" off to the far edge.
    width: 92,
    flexGrow: 0,
    flexShrink: 0,
    fontSize: 18,
    fontWeight: '700',
    color: t.colors.money,
    textAlign: 'center',
    padding: 0,
    // Web (react-native-web) draws its own focus ring on the raw input.
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null),
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.textSecondary,
    marginBottom: 6,
  },
  fieldBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
    backgroundColor: t.colors.surfaceRaised,
  },
  fieldInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: t.colors.money,
    padding: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null),
  },
}));
