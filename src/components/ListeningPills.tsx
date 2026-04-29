import React, { useEffect, useRef } from 'react';
import { Animated, LayoutAnimation, Platform, ScrollView, StyleSheet, UIManager } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../theme';
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
  const scale = useRef(new Animated.Value(1)).current;
  const colorAnim = useRef(new Animated.Value(active ? 1 : 0)).current;
  const prevActive = useRef(active);

  useEffect(() => {
    if (prevActive.current === active) return;
    prevActive.current = active;

    // Smooth the width change as the label appears/disappears.
    LayoutAnimation.configureNext(
      LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity)
    );

    Animated.parallel([
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.06, duration: 110, useNativeDriver: false }),
        Animated.timing(scale, { toValue: 1,    duration: 130, useNativeDriver: false }),
      ]),
      Animated.timing(colorAnim, {
        toValue: active ? 1 : 0,
        duration: 200,
        useNativeDriver: false,
      }),
    ]).start();
  }, [active, scale, colorAnim]);

  const backgroundColor = colorAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.surfaceGray2, colors.primary],
  });
  const borderColor = colorAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.border, colors.primary],
  });

  return (
    <Animated.View
      accessibilityLabel={`${label} ${active ? 'checked' : 'unchecked'}`}
      style={[
        styles.pill,
        active && styles.pillActive,
        { backgroundColor, borderColor, transform: [{ scale }] },
      ]}
    >
      <MaterialCommunityIcons
        name={active ? 'check-circle' : 'checkbox-blank-circle-outline'}
        size={12}
        color={active ? colors.white : colors.textSecondary}
        style={!active && styles.iconWithLabel}
      />
      {!active && (
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          {label}
        </Text>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
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
});
