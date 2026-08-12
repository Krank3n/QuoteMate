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
import { makeStyles, useThemeColors } from '../theme';
import { BottomSheet } from './BottomSheet';
import { selectionTap, lightTap } from '../utils/haptics';

export type JobAction =
  | 'takePayment'
  | 'followUp'
  | 'edit'
  | 'send'
  | 'convertToInvoice'
  | 'duplicate'
  | 'service_report'
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

interface RowCtx {
  job: Job;
  primaryDoc: Document | null;
  xeroConnected: boolean;
}

interface RowDef {
  id: JobAction;
  label: string | ((ctx: RowCtx) => string);
  sub?: string | ((ctx: RowCtx) => string);
  icon: string | ((ctx: RowCtx) => string);
  tone?: 'normal' | 'danger';
  when: (ctx: RowCtx) => boolean;
}

function resolve<T>(value: T | ((ctx: RowCtx) => T), ctx: RowCtx): T {
  return typeof value === 'function' ? (value as (ctx: RowCtx) => T)(ctx) : value;
}

// Take Payment and Follow Up sit at the top — those are the
// everyday actions; everything else (edit, send, archive, delete)
// is less frequent.
export const ROWS: RowDef[] = [
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
    id: 'convertToInvoice',
    label: 'Convert to Invoice',
    sub: 'Job done? Turn this quote into an invoice',
    icon: 'file-swap-outline',
    // Quotes only, and never re-offer once invoiced — conversion is
    // one-way and the idempotent path already guards double-taps.
    when: ({ primaryDoc }) =>
      !!primaryDoc && primaryDoc.type === 'quote' && !primaryDoc.invoicedAt,
  },
  {
    id: 'duplicate',
    label: 'Duplicate',
    sub: 'Clone scope + checklist into a new Accepted job',
    icon: 'content-duplicate',
    when: () => true,
  },
  {
    id: 'service_report',
    label: 'Service report',
    sub: 'Leave-behind report for the visit',
    icon: 'clipboard-check-outline',
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
    label: ({ primaryDoc }) =>
      primaryDoc?.xeroSyncStatus === 'synced' ? 'Re-sync to Xero' : 'Push to Xero',
    sub: ({ primaryDoc }) => {
      if (primaryDoc?.xeroSyncStatus === 'error') return 'Last sync failed — tap to retry';
      const noun = primaryDoc?.type === 'invoice' ? 'invoice' : 'quote';
      return primaryDoc?.xeroSyncStatus === 'synced'
        ? `Re-push the latest ${noun} details to Xero`
        : `Sync this ${noun} to your Xero account`;
    },
    icon: ({ primaryDoc }) =>
      primaryDoc?.xeroSyncStatus === 'synced' ? 'cloud-check-outline' : 'cloud-upload-outline',
    when: ({ primaryDoc, xeroConnected }) => {
      if (!xeroConnected || !primaryDoc) return false;
      if (primaryDoc.stage === 'draft') return false;
      if (primaryDoc.type === 'invoice') return true;
      // Quote-side: visible once the quote has been sent or accepted.
      return primaryDoc.stage === 'quote_sent' || primaryDoc.stage === 'quote_accepted';
    },
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
  const styles = useStyles();
  const themeColors = useThemeColors();
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
          const label = resolve(row.label, ctx);
          const sub = row.sub ? resolve(row.sub, ctx) : undefined;
          const icon = resolve(row.icon, ctx);
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
                  name={icon as any}
                  size={20}
                  color={danger ? themeColors.error : themeColors.accent}
                />
              </View>
              <View style={styles.rowBody}>
                <Text
                  style={[
                    styles.rowLabel,
                    danger && { color: themeColors.error },
                  ]}
                >
                  {label}
                </Text>
                {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
              </View>
              <MaterialCommunityIcons
                name={'chevron-right' as any}
                size={20}
                color={themeColors.textDisabled}
              />
            </Pressable>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const useStyles = makeStyles((t) => ({
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
    backgroundColor: t.colors.surfacePressed,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  rowDanger: {
    borderColor: t.colors.errorSubtle,
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
    backgroundColor: t.colors.accentSubtle,
  },
  rowIconDanger: {
    backgroundColor: t.colors.errorSubtle,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: t.colors.text,
  },
  rowSub: {
    fontSize: 12,
    color: t.colors.textMuted,
    lineHeight: 16,
  },
}));
