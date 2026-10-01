/**
 * The time row on the job screen: hours logged against the quote's labour,
 * one tap into the Log time sheet. When the invoice's labour disagrees with
 * what was logged, a second line offers to charge the logged hours — naming
 * which way the money moves and by how much.
 */

import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import type { TimeEntry } from '../../shared/time/types';
import type { Document } from '../types/document';
import { jobTimeSummary } from '../utils/jobTimeSummary';
import { makeStyles, useThemeColors } from '../theme';
import { selectionTap } from '../utils/haptics';

interface JobTimeRowProps {
  entries: TimeEntry[];
  primaryDoc: Document | null;
  /** The read failed — say so rather than show "nothing logged". */
  loadFailed?: boolean;
  onPress: () => void;
  /** Present when charging the logged hours would change the invoice. */
  chargeLink?: { label: string; onPress: () => void };
}

export function JobTimeRow({ entries, primaryDoc, loadFailed, onPress, chargeLink }: JobTimeRowProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const summary = jobTimeSummary(entries, primaryDoc);
  const { title, sub, over, waiting } =
    loadFailed && entries.length === 0
      ? { title: "Couldn't load your hours", sub: 'Tap to try again', over: false, waiting: 0 }
      : summary;
  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.row}
        onPress={() => {
          selectionTap();
          onPress();
        }}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Time on this job. ${title}`}
      >
        <MaterialCommunityIcons
          name={(entries.length ? 'clock-outline' : 'clock-plus-outline') as any}
          size={20}
          color={over ? themeColors.warning : themeColors.accentText}
        />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={[styles.sub, (over || waiting > 0) && { color: themeColors.warning }]}>{sub}</Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={22} color={themeColors.textMuted} />
      </TouchableOpacity>
      {chargeLink ? (
        <TouchableOpacity
          style={styles.billRow}
          onPress={chargeLink.onPress}
          accessibilityRole="button"
          accessibilityLabel={chargeLink.label}
        >
          <MaterialCommunityIcons name="file-document-edit-outline" size={16} color={themeColors.accentText} />
          <Text style={styles.billText}>{chargeLink.label}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: t.colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: t.colors.text,
  },
  sub: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 2,
  },
  billRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
  },
  billText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.accentText,
  },
}));
