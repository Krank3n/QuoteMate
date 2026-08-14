/**
 * StageOptionRow — one row in a status list: small tinted icon, plain
 * label, nothing else.
 *
 * Shared by every surface that offers a status change: the kebab's "Change
 * status" submenu (JobActionsSheet), the card pill's job sheet
 * (JobStageSheet), and the document sheet on ViewJob's scope rows
 * (StageSheet). They were each built separately — a compact list under the
 * kebab, chunky icon-circle-and-chevron rows in the sheets — so the same
 * action looked like a different feature depending on which door you came
 * through. Keep new status surfaces on this row rather than restyling a
 * copy.
 */

import React from 'react';
import { Pressable, View } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { makeStyles } from '../theme';

export function StageOptionRow({
  icon,
  color,
  label,
  onPress,
}: {
  icon: string;
  color: string;
  label: string;
  onPress: () => void;
}) {
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.optionRow, pressed && styles.optionRowPressed]}
    >
      <MaterialCommunityIcons name={icon as any} size={18} color={color} />
      <Text style={styles.optionLabel}>{label}</Text>
    </Pressable>
  );
}

/**
 * The list these rows sit in. The kebab's submenu doesn't use it — it
 * wraps the same rows in its own indented, rail-marked container so the
 * submenu reads as belonging to the row above it.
 */
export function StageOptionList({ children }: { children: React.ReactNode }) {
  const styles = useStyles();
  return <View style={styles.optionList}>{children}</View>;
}

const useStyles = makeStyles((t) => ({
  optionList: {
    gap: 2,
    paddingBottom: 8,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  optionRowPressed: {
    opacity: 0.8,
  },
  optionLabel: {
    fontSize: 15,
    color: t.colors.text,
  },
}));
