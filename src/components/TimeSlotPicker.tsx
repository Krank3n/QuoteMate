/**
 * TimeSlotPicker
 * Horizontal scroll of half-hour time chips (default 7am – 6pm) plus a
 * "No time" chip that clears any existing time. Values are minutes-since-
 * midnight integers so the caller can fold them into a full datetime
 * without timezone drift.
 *
 * Built for ScheduleJobSheet — tradies don't book for 3:47pm, so a curated
 * chip row is faster and less fiddly than a wheel / OS picker.
 */

import React, { useRef, useEffect } from 'react';
import { ScrollView, StyleSheet, Pressable, View } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { makeStyles, useThemeColors } from '../theme';
import { selectionTap } from '../utils/haptics';

interface TimeSlotPickerProps {
  /** Minutes since midnight (e.g. 9:00am = 540). `null` = no time set. */
  value: number | null;
  onChange: (minutesSinceMidnight: number | null) => void;
  /** Start-of-day in hours — default 5. Tradies start early. */
  startHour?: number;
  /** End-of-day in hours — default 19. */
  endHour?: number;
  /** Step between slots in minutes — default 30. */
  stepMinutes?: number;
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hour12 = ((h + 11) % 12) + 1;
  const suffix = h < 12 ? 'am' : 'pm';
  const mm = m === 0 ? '' : `:${m.toString().padStart(2, '0')}`;
  return `${hour12}${mm}${suffix}`;
}

/** Pull minutes-since-midnight out of a ms-epoch timestamp, or null if at
 * exactly midnight (the "date-only" convention from the original sheet). */
export function minutesFromTimestamp(ms?: number): number | null {
  if (!ms) return null;
  const d = new Date(ms);
  const minutes = d.getHours() * 60 + d.getMinutes();
  return minutes === 0 ? null : minutes;
}

/** Combine a day ISO (yyyy-MM-dd) with minutes-since-midnight into ms epoch.
 * If minutes is null, returns midnight on that day (date-only). */
export function combineDayAndMinutes(dayIso: string, minutes: number | null): number {
  const base = new Date(`${dayIso}T00:00:00`);
  base.setMinutes(minutes ?? 0);
  return base.getTime();
}

export function TimeSlotPicker({
  value,
  onChange,
  startHour = 5,
  endHour = 19,
  stepMinutes = 30,
}: TimeSlotPickerProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const scrollRef = useRef<ScrollView>(null);
  const chipRefs = useRef<Record<number, { x: number; w: number }>>({});

  const slots: number[] = [];
  for (let m = startHour * 60; m <= endHour * 60; m += stepMinutes) {
    slots.push(m);
  }

  // Scroll the selected chip into view on first render / when value changes
  // so tapping a day that already has a time puts it under the user's eye.
  useEffect(() => {
    if (value == null) return;
    const layout = chipRefs.current[value];
    if (!layout || !scrollRef.current) return;
    scrollRef.current.scrollTo({ x: Math.max(0, layout.x - 32), animated: true });
  }, [value]);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      <Pressable
        onPress={() => {
          selectionTap();
          onChange(null);
        }}
        style={({ pressed }) => [
          styles.chip,
          styles.noneChip,
          value === null && styles.chipSelected,
          pressed && { opacity: 0.8 },
        ]}
      >
        <MaterialCommunityIcons
          name={'clock-outline' as any}
          size={14}
          color={value === null ? themeColors.alwaysLight : themeColors.textMuted}
        />
        <Text style={[styles.chipLabel, value === null && styles.chipLabelSelected]}>
          No time
        </Text>
      </Pressable>

      {slots.map((minutes) => {
        const selected = value === minutes;
        return (
          <Pressable
            key={minutes}
            onLayout={(e) => {
              chipRefs.current[minutes] = {
                x: e.nativeEvent.layout.x,
                w: e.nativeEvent.layout.width,
              };
            }}
            onPress={() => {
              selectionTap();
              onChange(minutes);
            }}
            style={({ pressed }) => [
              styles.chip,
              selected && styles.chipSelected,
              pressed && { opacity: 0.8 },
            ]}
          >
            <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
              {formatMinutes(minutes)}
            </Text>
          </Pressable>
        );
      })}

      <View style={{ width: 16 }} />
    </ScrollView>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    paddingHorizontal: 4,
    paddingVertical: 8,
    gap: 8,
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: t.colors.surfacePressed,
    borderWidth: 1,
    borderColor: 'transparent',
    minWidth: 62,
    alignItems: 'center',
  },
  noneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 92,
  },
  chipSelected: {
    backgroundColor: t.colors.accent,
    borderColor: t.colors.accent,
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.text,
  },
  chipLabelSelected: {
    color: t.colors.onAccent,
  },
}));
