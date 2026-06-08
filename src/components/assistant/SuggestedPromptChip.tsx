import React from 'react';
import { Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors } from '../../theme';

interface Props {
  label: string;
  onPress: () => void;
}

export function SuggestedPromptChip({ label, onPress }: Props) {
  return (
    <TouchableOpacity style={styles.chip} onPress={onPress} accessibilityRole="button">
      <Text style={styles.label}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
  },
  label: {
    color: colors.text,
    fontSize: 13,
  },
});
