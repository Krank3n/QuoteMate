/**
 * ScopeRow — the one-line row the job page is built from.
 *
 * Icon tile, small-caps label, a one- or two-line summary and a chevron.
 * JobScopeCard uses it for MATERIALS and LABOUR & MARKUP (chevron-right:
 * tapping jumps somewhere), and JobPhotosCard for PHOTOS (chevron-down /
 * chevron-up: tapping expands inline). Pass `expanded` to get the latter.
 *
 * `useScopeRowStyles` is exported for rows that need the same look but a
 * different anchor element (PaymentTermsRow wraps a Paper Menu).
 */

import React from 'react';
import { View, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { makeStyles, useThemeColors } from '../theme';
import { selectionTap } from '../utils/haptics';

export interface ScopeRowProps {
  icon: string;
  label: string;
  body: string;
  rightLabel?: string;
  muted?: boolean;
  onPress: () => void;
  /**
   * Leave undefined for a row that navigates (chevron-right). Set it for a
   * row that expands inline: true shows chevron-up, false chevron-down.
   */
  expanded?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}

export function ScopeRow({
  icon,
  label,
  body,
  rightLabel,
  muted,
  onPress,
  expanded,
  testID,
  accessibilityLabel,
}: ScopeRowProps) {
  const styles = useScopeRowStyles();
  const themeColors = useThemeColors();
  const chevron =
    expanded === undefined ? 'chevron-right' : expanded ? 'chevron-up' : 'chevron-down';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => {
        selectionTap();
        onPress();
      }}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowIcon}>
        <MaterialCommunityIcons
          name={icon as any}
          size={18}
          color={themeColors.accentText}
        />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text
          style={[styles.rowBodyText, muted && styles.rowBodyMuted]}
          numberOfLines={2}
        >
          {body}
        </Text>
      </View>
      {rightLabel ? (
        <Text style={styles.rowRight}>{rightLabel}</Text>
      ) : null}
      <MaterialCommunityIcons
        name={chevron as any}
        size={18}
        color={themeColors.textDisabled}
      />
    </Pressable>
  );
}

export const useScopeRowStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: 12,
    backgroundColor: t.colors.surfacePressed,
  },
  rowPressed: {
    opacity: 0.85,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: t.colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: t.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  rowBodyText: {
    fontSize: 13,
    color: t.colors.text,
    lineHeight: 18,
  },
  rowBodyMuted: {
    color: t.colors.textMuted,
    fontStyle: 'italic',
  },
  rowRight: {
    fontSize: 13,
    fontWeight: '700',
    color: t.colors.text,
  },
}));
