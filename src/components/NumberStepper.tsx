/**
 * NumberStepper
 * Compact +/- control for picking a small integer (Days, Hours/day, etc).
 * Optional unit label rendered after the value. Honours min / max bounds
 * and disables the relevant button at the edges.
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { colors } from '../theme';
import { selectionTap } from '../utils/haptics';

interface NumberStepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Singular form of the unit (auto-pluralised when value !== 1). */
  unit?: string;
}

export function NumberStepper({
  value,
  onChange,
  min = 1,
  max = 99,
  step = 1,
  unit,
}: NumberStepperProps) {
  const dec = () => {
    selectionTap();
    onChange(Math.max(min, value - step));
  };
  const inc = () => {
    selectionTap();
    onChange(Math.min(max, value + step));
  };

  const atMin = value <= min;
  const atMax = value >= max;
  const display = unit ? `${value} ${value === 1 ? unit : unit + 's'}` : String(value);

  return (
    <View style={styles.row}>
      <Pressable
        onPress={dec}
        disabled={atMin}
        hitSlop={6}
        style={({ pressed }) => [
          styles.button,
          atMin && styles.buttonDisabled,
          pressed && !atMin && styles.buttonPressed,
        ]}
      >
        <MaterialCommunityIcons
          name={'minus' as any}
          size={18}
          color={atMin ? colors.inactive : colors.text}
        />
      </Pressable>

      <Text style={styles.value}>{display}</Text>

      <Pressable
        onPress={inc}
        disabled={atMax}
        hitSlop={6}
        style={({ pressed }) => [
          styles.button,
          atMax && styles.buttonDisabled,
          pressed && !atMax && styles.buttonPressed,
        ]}
      >
        <MaterialCommunityIcons
          name={'plus' as any}
          size={18}
          color={atMax ? colors.inactive : colors.text}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceGray3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    backgroundColor: colors.surfaceGray2,
  },
  buttonDisabled: {
    backgroundColor: colors.surfaceGray3,
    opacity: 0.5,
  },
  value: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    minWidth: 80,
    textAlign: 'center',
  },
});
