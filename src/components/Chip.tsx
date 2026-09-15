/**
 * Chip
 *
 * The little pill toggle the Record Payment sheet has always used for
 * amounts, methods and dates — lifted out of that screen so the Insights
 * period selector shows the same control a tradie has already tapped, rather
 * than a second one that looks nearly like it.
 */

import React from 'react';
import { Pressable } from 'react-native';
import { Text } from 'react-native-paper';

import { makeStyles } from '../theme';

interface ChipProps {
  label: string;
  active?: boolean;
  onPress: () => void;
}

export function Chip({ label, active, onPress }: ChipProps) {
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      // react-native-web drops accessibilityState.selected on buttons;
      // the explicit alias reaches the DOM (and assistive tech) on web.
      aria-selected={!!active}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        pressed && !active && { opacity: 0.85 },
      ]}
    >
      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  chip: {
    // 10 matches PillToggle and keeps the tap target near the 44pt guideline
    // for gloved on-site thumbs.
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceOverlay,
  },
  chipActive: {
    backgroundColor: t.colors.accent,
    borderColor: t.colors.accent,
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.text,
  },
  chipLabelActive: {
    color: t.colors.onAccent,
  },
}));
