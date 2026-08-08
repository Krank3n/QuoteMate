/**
 * ServiceReportRow
 * Minimised service report as it appears on the Job screen, beside the
 * documents attached to the same job.
 *
 * A report isn't a Document — no money, no stage, no line items — so it
 * can't literally be a DocumentRow. But to the tradie scanning a job it is
 * the same kind of thing ("a thing I made for this customer that I can tap
 * to open"), so it borrows DocumentRow's grammar exactly: leading icon
 * circle, title row with a right-hand value, then a chip strip. Where a doc
 * puts its total, a report puts the visit date — that's the number that
 * identifies a visit.
 *
 * Tap row → open the report (resume a draft, or view a sent one).
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { colors } from '../theme';
import { selectionTap } from '../utils/haptics';
import type { ReportRowMeta } from '../screens/ServiceReport/reportDraft';

interface ServiceReportRowProps {
  /**
   * 'card' (default) draws its own surface — the standalone row.
   * 'nested' drops the background, radius and outer margins so it can sit
   * inside a parent card without stacking a surface on a surface, or
   * indenting itself another 16px.
   */
  variant?: 'card' | 'nested';
  meta: ReportRowMeta;
  onPress: () => void;
}

/** Chip colours mirror the stage chips: draft is muted, done is green. */
function statusChipColors(status: ReportRowMeta['status']): {
  color: string;
  bg: string;
  icon: string;
} {
  return status === 'sent'
    ? { color: colors.success, bg: colors.successBg, icon: 'send-check' }
    : { color: colors.textMuted, bg: colors.surfaceGray3, icon: 'pencil-outline' };
}

export function ServiceReportRow({ meta, onPress, variant = 'card' }: ServiceReportRowProps) {
  const status = statusChipColors(meta.status);

  return (
    <Pressable
      onPress={() => {
        selectionTap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.row,
        variant === 'nested' && styles.rowNested,
        pressed && (variant === 'nested' ? styles.rowNestedPressed : styles.rowPressed),
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${meta.title}, ${meta.statusLabel}`}
    >
      <View style={styles.iconCircle}>
        <MaterialCommunityIcons
          name={'clipboard-check-outline' as any}
          size={18}
          color={colors.primary}
        />
      </View>

      <View style={styles.main}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {meta.title}
          </Text>
          {meta.visitLabel ? (
            <Text style={styles.visit}>{meta.visitLabel}</Text>
          ) : null}
        </View>

        <View style={styles.chipRow}>
          <View
            style={[
              styles.chip,
              { backgroundColor: status.bg, borderColor: status.color + '44' },
            ]}
          >
            <MaterialCommunityIcons
              name={status.icon as any}
              size={12}
              color={status.color}
            />
            <Text style={[styles.chipLabel, { color: status.color }]}>
              {meta.statusLabel}
            </Text>
          </View>

          {/* The report number is reference data, not state — it reads as a
              quiet label rather than another coloured chip. */}
          {meta.number ? <Text style={styles.number}>{meta.number}</Text> : null}

          {/* What the docket actually carries. Photos and a customer
              signature are the two things a tradie checks before sending,
              so they earn a glanceable spot instead of a tap. */}
          {meta.photoCount > 0 ? (
            <View style={styles.metaChip}>
              <MaterialCommunityIcons
                name={'image-outline' as any}
                size={12}
                color={colors.textMuted}
              />
              <Text style={styles.metaChipLabel}>{meta.photoCount}</Text>
            </View>
          ) : null}
          {meta.signed ? (
            <View style={styles.metaChip}>
              <MaterialCommunityIcons
                name={'draw-pen' as any}
                size={12}
                color={colors.textMuted}
              />
              <Text style={styles.metaChipLabel}>Signed</Text>
            </View>
          ) : null}
        </View>

        {meta.detail ? <Text style={styles.detail}>{meta.detail}</Text> : null}
      </View>

      <MaterialCommunityIcons
        name={'chevron-right' as any}
        size={20}
        color={colors.inactive}
      />
    </Pressable>
  );
}

// Metrics copied from DocumentRow rather than re-picked, so a report row and
// a document row line up pixel-for-pixel when they stack on the same job.
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    marginBottom: 10,
  },
  rowNested: {
    backgroundColor: 'transparent',
    marginHorizontal: 0,
    marginBottom: 0,
    padding: 2,
  },
  rowPressed: {
    backgroundColor: colors.surfaceGray3,
  },
  rowNestedPressed: {
    opacity: 0.7,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  main: {
    flex: 1,
    gap: 6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  visit: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    gap: 4,
  },
  chipLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  number: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  metaChipLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  detail: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
