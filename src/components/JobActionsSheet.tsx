/**
 * JobActionsSheet — the 3-dot menu on a JobCard.
 *
 * List-view counterpart to the Danger row on ViewJob. Covers the
 * "I don't want to open the job, just do the thing" path — mainly
 * for cleaners and other tradies with high-volume recurring work
 * where Duplicate + Archive need to be one tap each, not two.
 *
 * Pure presentational component: it only reports the picked action
 * back to the parent; the parent owns the side-effects.
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import type { Job } from '../../shared/job/types';
import { colors } from '../theme';
import { BottomSheet } from './BottomSheet';
import { selectionTap, lightTap } from '../utils/haptics';

export type JobAction = 'duplicate' | 'archive' | 'unarchive' | 'stage' | 'delete';

interface JobActionsSheetProps {
  visible: boolean;
  onDismiss: () => void;
  job: Job | null;
  onSelect: (action: JobAction, job: Job) => void;
}

interface Row {
  id: JobAction;
  label: string;
  sub?: string;
  icon: string;
  tone?: 'normal' | 'danger';
  when: (job: Job) => boolean;
}

const ROWS: Row[] = [
  {
    id: 'duplicate',
    label: 'Duplicate',
    sub: 'Clone scope + checklist into a new Accepted job',
    icon: 'content-duplicate',
    when: () => true,
  },
  {
    id: 'stage',
    label: 'Change stage',
    sub: 'Move the job forward or back',
    icon: 'swap-horizontal',
    when: (job) => job.stage !== 'cancelled' && job.stage !== 'closed',
  },
  {
    id: 'archive',
    label: 'Archive',
    sub: 'Move into the Archived filter',
    icon: 'archive-outline',
    when: (job) => !job.archivedAt,
  },
  {
    id: 'unarchive',
    label: 'Unarchive',
    sub: 'Move back to the active list',
    icon: 'archive-arrow-up-outline',
    when: (job) => !!job.archivedAt,
  },
  {
    id: 'delete',
    label: 'Delete',
    sub: 'Can only delete jobs with no attached docs',
    icon: 'trash-can-outline',
    tone: 'danger',
    when: () => true,
  },
];

export function JobActionsSheet({
  visible,
  onDismiss,
  job,
  onSelect,
}: JobActionsSheetProps) {
  if (!job) return null;
  const rows = ROWS.filter((r) => r.when(job));

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      title={job.name || 'Untitled job'}
      subtitle={job.customerName || undefined}
    >
      <View style={styles.list}>
        {rows.map((row) => {
          const danger = row.tone === 'danger';
          return (
            <Pressable
              key={row.id}
              onPress={() => {
                danger ? selectionTap() : lightTap();
                onSelect(row.id, job);
              }}
              style={({ pressed }) => [
                styles.row,
                danger && styles.rowDanger,
                pressed && styles.rowPressed,
              ]}
            >
              <View
                style={[
                  styles.rowIcon,
                  danger ? styles.rowIconDanger : styles.rowIconNormal,
                ]}
              >
                <MaterialCommunityIcons
                  name={row.icon as any}
                  size={20}
                  color={danger ? colors.error : colors.primary}
                />
              </View>
              <View style={styles.rowBody}>
                <Text
                  style={[
                    styles.rowLabel,
                    danger && { color: colors.error },
                  ]}
                >
                  {row.label}
                </Text>
                {row.sub ? <Text style={styles.rowSub}>{row.sub}</Text> : null}
              </View>
              <MaterialCommunityIcons
                name={'chevron-right' as any}
                size={20}
                color={colors.inactive}
              />
            </Pressable>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 8,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.surfaceGray3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowDanger: {
    borderColor: colors.error + '44',
  },
  rowPressed: {
    opacity: 0.8,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconNormal: {
    backgroundColor: colors.primaryBg,
  },
  rowIconDanger: {
    backgroundColor: colors.errorBg,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  rowSub: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 16,
  },
});
