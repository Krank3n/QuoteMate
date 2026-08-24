/**
 * DueDateSheet
 *
 * Tiny bottom sheet with a month calendar for picking / clearing a due
 * date on a JobChecklistItem (or any ms-epoch date field). Single tap
 * on a day commits and dismisses — lighter than ScheduleJobSheet
 * because checklist items don't need times.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Button } from 'react-native-paper';
import { Calendar, DateData } from 'react-native-calendars';
import { format } from 'date-fns';

import type { Tokens } from '../theme';
import { makeStyles, useThemeColors } from '../theme';
import { BottomSheet } from './BottomSheet';

interface DueDateSheetProps {
  visible: boolean;
  onDismiss: () => void;
  /** Current value as ms-epoch; undefined means "no date set". */
  value?: number;
  onChange: (next: number | undefined) => void;
  title?: string;
  /** Label for the clear/reset button. Defaults to "Clear date". */
  clearLabel?: string;
}

const calendarThemeFor = (themeColors: Tokens) => ({
  backgroundColor: 'transparent',
  calendarBackground: 'transparent',
  textSectionTitleColor: themeColors.textMuted,
  dayTextColor: themeColors.text,
  todayTextColor: themeColors.accent,
  selectedDayTextColor: themeColors.alwaysLight,
  selectedDayBackgroundColor: themeColors.accent,
  monthTextColor: themeColors.text,
  arrowColor: themeColors.accent,
  textDisabledColor: themeColors.textDisabled,
  textMonthFontWeight: '700' as const,
  textDayFontWeight: '500' as const,
  textDayHeaderFontWeight: '600' as const,
  textMonthFontSize: 15,
  textDayFontSize: 13,
  textDayHeaderFontSize: 11,
});

function toIsoDay(ms?: number): string | undefined {
  if (!ms) return undefined;
  try {
    return format(new Date(ms), 'yyyy-MM-dd');
  } catch {
    return undefined;
  }
}

function fromIsoDay(iso: string): number {
  return new Date(`${iso}T00:00:00`).getTime();
}

export function DueDateSheet({
  visible,
  onDismiss,
  value,
  onChange,
  title = 'Due date',
  clearLabel = 'Clear date',
}: DueDateSheetProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const CALENDAR_THEME = calendarThemeFor(themeColors);
  const selected = toIsoDay(value);

  const markedDates = useMemo(() => {
    if (!selected) return {};
    return {
      [selected]: {
        selected: true,
        selectedColor: themeColors.accent,
        selectedTextColor: themeColors.alwaysLight,
      },
    };
  }, [selected]);

  const handleDayPress = (day: DateData) => {
    onChange(fromIsoDay(day.dateString));
    onDismiss();
  };

  const handleClear = () => {
    onChange(undefined);
    onDismiss();
  };

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} title={title}>
      <View style={styles.content}>
        <View style={styles.calendarCard}>
          <Calendar
            theme={CALENDAR_THEME}
            firstDay={1}
            current={selected}
            markedDates={markedDates}
            onDayPress={handleDayPress}
            enableSwipeMonths
          />
        </View>

        {value ? (
          <Button
            mode="text"
            icon={'calendar-remove-outline' as any}
            textColor={themeColors.error}
            onPress={handleClear}
            style={styles.clear}
          >
            {clearLabel}
          </Button>
        ) : null}
      </View>
    </BottomSheet>
  );
}

const useStyles = makeStyles((t) => ({
  content: {
    paddingVertical: 4,
    gap: 8,
  },
  calendarCard: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: t.colors.surface,
    paddingVertical: 4,
  },
  clear: {
    alignSelf: 'center',
  },
}));
