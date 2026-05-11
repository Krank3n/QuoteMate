/**
 * PillToggle
 *
 * Segmented pill-style toggle for N-way mode switches. Active option
 * fills with primary; the row sits in surfaceGray3. fullWidth makes
 * options share width equally and stretches the row across its parent.
 */

import React from 'react';
import { View, StyleSheet, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../theme';
import { selectionTap } from '../utils/haptics';

export interface PillToggleOption<T extends string> {
  value: T;
  label: string;
  icon?: string;
  disabled?: boolean;
}

interface PillToggleProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: PillToggleOption<T>[];
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function PillToggle<T extends string>({
  value,
  onChange,
  options,
  fullWidth,
  style,
}: PillToggleProps<T>) {
  return (
    <View style={[styles.row, fullWidth && styles.rowFull, style]}>
      {options.map((opt) => {
        const active = opt.value === value;
        const disabled = !!opt.disabled;
        return (
          <Pressable
            key={opt.value}
            onPress={() => {
              if (disabled || active) return;
              selectionTap();
              onChange(opt.value);
            }}
            style={({ pressed }) => [
              styles.pill,
              fullWidth && styles.pillFull,
              active && styles.pillActive,
              disabled && !active && styles.pillDisabled,
              pressed && !disabled && !active && { opacity: 0.85 },
            ]}
          >
            {opt.icon ? (
              <MaterialCommunityIcons
                name={opt.icon as any}
                size={14}
                color={active ? colors.white : disabled ? colors.inactive : colors.text}
              />
            ) : null}
            <Text
              style={[
                styles.label,
                active && styles.labelActive,
                disabled && !active && styles.labelDisabled,
              ]}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 3,
    borderRadius: 999,
    backgroundColor: colors.surfaceGray3,
    gap: 2,
    alignSelf: 'flex-start',
  },
  rowFull: {
    alignSelf: 'stretch',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
  },
  pillFull: {
    flex: 1,
  },
  pillActive: {
    backgroundColor: colors.primary,
  },
  pillDisabled: {
    opacity: 0.5,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  labelActive: {
    color: colors.white,
  },
  labelDisabled: {
    color: colors.inactive,
  },
});
