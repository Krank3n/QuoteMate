/**
 * JobActionsSheet — the 3-dot menu on a JobCard.
 *
 * List-view counterpart to the Danger row on ViewJob. Covers the
 * "I don't want to open the job, just do the thing" path — mainly
 * for cleaners and other tradies with high-volume recurring work
 * where Duplicate + Send + Take Payment need to be one tap each.
 *
 * Pure presentational component: it only reports the picked action
 * back to the parent; the parent owns the side-effects.
 */

import React from 'react';
import { Platform, View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import type { Job } from '../../shared/job/types';
import type { Document } from '../types/document';
import { colors } from '../theme';
import { BottomSheet } from './BottomSheet';
import { selectionTap, lightTap } from '../utils/haptics';

export type JobAction =
  | 'takePayment'
  | 'followUp'
  | 'edit'
  | 'send'
  | 'duplicate'
  | 'exportPdf'
  | 'pushToXero'
  | 'archive'
  | 'unarchive'
  | 'delete';

interface JobActionsSheetProps {
  visible: boolean;
  onDismiss: () => void;
  job: Job | null;
  /** The primary doc on the job, if any. Drives whether the doc-level
   *  actions (Send, Take Payment, Export, Xero) render. */
  primaryDoc?: Document | null;
  xeroConnected?: boolean;
  onSelect: (action: JobAction, job: Job) => void;
}

interface RowDef {
  id: JobAction;
  label: string;
  sub?: string;
  icon: string;
  tone?: 'normal' | 'danger';
  when: (args: {
    job: Job;
    primaryDoc: Document | null;
    xeroConnected: boolean;
  }) => boolean;
}

// Take Payment and Follow Up sit at the top — those are the
// everyday actions; everything else (edit, send, archive, delete)
// is less frequent.
const ROWS: RowDef[] = [
  {
    id: 'takePayment',
    label: 'Take Payment',
    sub: 'Tap to pay or share the Square link',
    icon: 'credit-card-outline',
    // iOS payments are gated off until Tap to Pay is approved and a Square
    // reader is available for App Review demo. Re-enable by removing the
    // Platform.OS check here and restoring the iOS usage strings in
    // plugins/withSquareSDK.js IOS_USAGE_STRINGS.
    when: ({ primaryDoc }) => !!primaryDoc && Platform.OS === 'android',
  },
  {
    id: 'followUp',
    label: 'Follow Up',
    sub: 'Send a nudge by SMS, email, or pay link',
    icon: 'bell-outline',
    when: ({ primaryDoc }) =>
      !!primaryDoc &&
      (primaryDoc.stage === 'quote_sent' ||
        primaryDoc.stage === 'invoice_sent' ||
        primaryDoc.stage === 'partially_paid'),
  },
  {
    id: 'send',
    label: 'Send',
    sub: 'Email / SMS / Share / PDF',
    icon: 'send-outline',
    when: ({ primaryDoc }) => !!primaryDoc,
  },
  {
    id: 'duplicate',
    label: 'Duplicate',
    sub: 'Clone scope + checklist into a new Accepted job',
    icon: 'content-duplicate',
    when: () => true,
  },
  {
    id: 'exportPdf',
    label: 'Export PDF',
    sub: 'Save or share the document as PDF',
    icon: 'file-pdf-box',
    when: ({ primaryDoc }) => !!primaryDoc,
  },
  {
    id: 'pushToXero',
    label: 'Push to Xero',
    sub: 'Sync this invoice to your Xero account',
    icon: 'cloud-upload-outline',
    when: ({ primaryDoc, xeroConnected }) =>
      !!xeroConnected &&
      !!primaryDoc &&
      primaryDoc.type === 'invoice' &&
      primaryDoc.stage !== 'draft',
  },
  {
    id: 'archive',
    label: 'Archive',
    sub: 'Move into the Archived filter',
    icon: 'archive-outline',
    when: ({ job }) => !job.archivedAt,
  },
  {
    id: 'unarchive',
    label: 'Unarchive',
    sub: 'Move back to the active list',
    icon: 'archive-arrow-up-outline',
    when: ({ job }) => !!job.archivedAt,
  },
  {
    id: 'delete',
    label: 'Delete',
    sub: 'Cascades to attached docs. Archive instead if anything is paid.',
    icon: 'trash-can-outline',
    tone: 'danger',
    when: () => true,
  },
];

export function JobActionsSheet({
  visible,
  onDismiss,
  job,
  primaryDoc,
  xeroConnected,
  onSelect,
}: JobActionsSheetProps) {
  if (!job) return null;
  const ctx = {
    job,
    primaryDoc: primaryDoc ?? null,
    xeroConnected: !!xeroConnected,
  };
  const rows = ROWS.filter((r) => r.when(ctx));

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      title={job.name || 'Untitled job'}
      subtitle={job.customerName || undefined}
      scrollable
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
