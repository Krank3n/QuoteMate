import React, { useEffect, useRef } from 'react';
import { LayoutAnimation, Platform, ScrollView, StyleSheet, UIManager, View } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { makeStyles, useThemeColors } from '../theme';
import { PillSpec } from '../data/nichePills';
import { PillState } from '../hooks/usePillMatcher';

// LayoutAnimation drives the smooth shrink-to-icon transition; on Android
// it has to be opted into explicitly.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface ListeningPillsProps {
  pills: PillSpec[];
  state: PillState;
}

/**
 * Passive display: pills tick themselves on as the dictation transcript
 * matches their keywords. Completed pills shrink to icon-only so the
 * remaining items keep their labels and stay readable without scrolling.
 */
export function ListeningPills({ pills, state }: ListeningPillsProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  if (pills.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.scroll}
    >
      {pills.map(pill => (
        <Pill key={pill.id} label={pill.label} active={!!state[pill.id]} />
      ))}
    </ScrollView>
  );
}

interface PillProps {
  label: string;
  active: boolean;
}

function Pill({ label, active }: PillProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const prevActive = useRef(active);

  useEffect(() => {
    if (prevActive.current === active) return;
    prevActive.current = active;

    // Smooth the width change as the label appears/disappears.
    LayoutAnimation.configureNext(
      LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity)
    );
  }, [active]);

  const backgroundColor = active ? themeColors.accent : themeColors.surfaceOverlay;
  const borderColor = active ? themeColors.accent : themeColors.border;

  return (
    <View
      accessibilityLabel={`${label} ${active ? 'checked' : 'unchecked'}`}
      style={[
        styles.pill,
        active && styles.pillActive,
        { backgroundColor, borderColor },
      ]}
    >
      <MaterialCommunityIcons
        name={active ? 'check-circle' : 'checkbox-blank-circle-outline'}
        size={12}
        color={active ? themeColors.alwaysLight : themeColors.textMuted}
        style={!active && styles.iconWithLabel}
      />
      {!active && (
        <Text style={[styles.label, { color: themeColors.textMuted }]}>
          {label}
        </Text>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  scroll: {
    marginBottom: 8,
  },
  row: {
    paddingVertical: 4,
    paddingHorizontal: 2,
    gap: 6,
    flexDirection: 'row',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillActive: {
    paddingHorizontal: 5,
  },
  iconWithLabel: {
    marginRight: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
}));
