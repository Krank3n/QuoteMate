/**
 * The Jobs list sort control.
 *
 * A menu behind a compact button rather than a row of pills, for two reasons.
 * Five pills don't fit a phone width, and a second always-visible pill row
 * competes with the filter chips right above it — two stacked rows of pills
 * read as "which of these am I looking at". This costs no vertical space at
 * all: it shares the chip row.
 *
 * It shows the active sort IN WORDS, which an icon-only button can't. That
 * matters more here than compactness: the whole point of the sort control is
 * that the order on screen is explained, so the thing naming the order has to
 * be legible.
 */

import React, { useState } from 'react';
import { Pressable } from 'react-native';
import { Menu, Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { makeStyles, useThemeColors } from '../theme';
import { selectionTap } from '../utils/haptics';
import { JOB_SORTS, jobSortMeta, type JobSortKey } from '../utils/jobSort';

interface JobSortMenuProps {
  value: JobSortKey;
  onChange: (key: JobSortKey) => void;
}

export function JobSortMenu({ value, onChange }: JobSortMenuProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const [open, setOpen] = useState(false);
  const active = jobSortMeta(value);

  return (
    <Menu
      visible={open}
      onDismiss={() => setOpen(false)}
      anchor={
        <Pressable
          onPress={() => {
            selectionTap();
            setOpen(true);
          }}
          // Short by design; the touch area extends past the visual bounds.
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          accessibilityRole="button"
          accessibilityLabel={`Sort: ${active.label}`}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        >
          <MaterialCommunityIcons
            name={'sort-variant' as any}
            size={16}
            color={themeColors.textSecondary}
          />
          <Text style={styles.buttonLabel} numberOfLines={1}>
            {active.label}
          </Text>
          <MaterialCommunityIcons
            name={'chevron-down' as any}
            size={16}
            color={themeColors.textMuted}
          />
        </Pressable>
      }
      contentStyle={styles.menu}
    >
      {JOB_SORTS.map((sort) => (
        <Menu.Item
          key={sort.key}
          onPress={() => {
            setOpen(false);
            if (sort.key === value) return;
            selectionTap();
            onChange(sort.key);
          }}
          title={sort.label}
          leadingIcon={sort.icon}
          trailingIcon={sort.key === value ? 'check' : undefined}
          titleStyle={sort.key === value ? styles.itemActive : styles.item}
        />
      ))}
    </Menu>
  );
}

const useStyles = makeStyles((t) => ({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    // Fixed height to match the filter chips it sits beside — they share a row,
    // and two nearly-equal heights read as a mistake.
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceRaised,
    flexShrink: 0,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonLabel: {
    fontSize: 12,
    fontFamily: 'Archivo-SemiBold',
    color: t.colors.textSecondary,
  },
  menu: {
    backgroundColor: t.colors.surfaceRaised,
  },
  item: {
    fontSize: 14,
    color: t.colors.text,
  },
  itemActive: {
    fontSize: 14,
    fontFamily: 'Archivo-Bold',
    // accentText, not accent — the latter is a fill and reads at 2.35:1 as
    // text on a light surface (see the paletteUsage guard).
    color: t.colors.accentText,
  },
}));
