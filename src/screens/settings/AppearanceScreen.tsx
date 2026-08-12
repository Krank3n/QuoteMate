/**
 * Appearance — System / Light / Dark.
 *
 * Deliberately the first screen built on the new theme system: it uses
 * makeStyles and the semantic tokens exclusively, so it doubles as a live
 * end-to-end check that the architecture works before ~60 screens follow.
 *
 * Reachable only while LIGHT_MODE_ENABLED is true (see src/theme/config.ts) —
 * the Settings row that leads here is gated on the same flag.
 */

import React from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { makeStyles, useAppTheme } from '../../theme';
import type { AppearancePreference } from '../../services/appearance';
import { WebContainer } from '../../components/WebContainer';
import { lightTap } from '../../utils/haptics';
import { GridBackground } from '../../components/GridBackground';

interface Choice {
  value: AppearancePreference;
  label: string;
  description: string;
  icon: string;
}

const CHOICES: Choice[] = [
  {
    value: 'system',
    label: 'Match my phone',
    description: 'Follows your phone’s display setting',
    icon: 'cellphone-cog',
  },
  {
    value: 'light',
    label: 'Light',
    description: 'Best in bright sun on site',
    icon: 'white-balance-sunny',
  },
  {
    value: 'dark',
    label: 'Dark',
    description: 'Easier on the eyes indoors and at night',
    icon: 'weather-night',
  },
];

export function AppearanceScreen() {
  const { preference, setPreference, scheme } = useAppTheme();
  const styles = useStyles();

  return (
    <View style={styles.container}>
      <GridBackground />
      <ScrollView contentContainerStyle={styles.content}>
        <WebContainer>
          <Text style={styles.intro}>
            Choose how QuoteMate looks. Light mode is easier to read outdoors in glare.
          </Text>

          <View style={styles.group}>
            {CHOICES.map((choice, index) => {
              const selected = preference === choice.value;
              return (
                <Pressable
                  key={choice.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={choice.label}
                  onPress={() => {
                    lightTap();
                    setPreference(choice.value);
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    index > 0 && styles.rowDivided,
                    pressed && styles.rowPressed,
                  ]}
                >
                  <View style={[styles.iconTile, selected && styles.iconTileOn]}>
                    <MaterialCommunityIcons
                      name={choice.icon as any}
                      size={20}
                      color={selected ? styles.iconOn.color : styles.iconOff.color}
                    />
                  </View>

                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>{choice.label}</Text>
                    <Text style={styles.rowDescription}>{choice.description}</Text>
                  </View>

                  {selected && (
                    <MaterialCommunityIcons
                      name="check-circle"
                      size={22}
                      color={styles.check.color}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.footnote}>
            Currently showing the {scheme} theme.
          </Text>
        </WebContainer>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: { flex: 1, backgroundColor: t.colors.bg },
  content: { padding: t.space[4], paddingBottom: t.space[10] },

  intro: {
    ...t.type.body,
    color: t.colors.textMuted,
    marginBottom: t.space[4],
  },

  group: {
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: t.radius.lg,
    overflow: 'hidden',
    ...t.elevation[1],
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space[3],
    paddingHorizontal: t.space[4],
    paddingVertical: t.space[3],
    minHeight: 64, // thumb-friendly on a work site
  },
  rowDivided: { borderTopWidth: 1, borderTopColor: t.colors.border },
  rowPressed: { backgroundColor: t.colors.overlayPressed },

  iconTile: {
    width: 38,
    height: 38,
    borderRadius: t.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.neutralSubtle,
  },
  iconTileOn: { backgroundColor: t.colors.accentSubtle },
  // Colours read off the stylesheet so icon tints stay theme-driven without a
  // second useAppTheme() call in the render body.
  iconOn: { color: t.colors.accentText },
  iconOff: { color: t.colors.textMuted },
  check: { color: t.colors.accentText },

  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { ...t.type.subheading, color: t.colors.text },
  rowDescription: { ...t.type.caption, color: t.colors.textMuted, marginTop: 2 },

  footnote: {
    ...t.type.caption,
    color: t.colors.textMuted,
    marginTop: t.space[4],
    textAlign: 'center',
  },
}));
