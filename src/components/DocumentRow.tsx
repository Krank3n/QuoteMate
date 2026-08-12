/**
 * DocumentRow
 * Slim per-document row used inside ViewJobScreen to list attached
 * documents without the per-card swipe/menu/send buttons. Shows the doc
 * number, type, total, and the Phase-11 two-chip split (stage + payment).
 *
 * Tap row → view detail. Tap stage chip → StageSheet. Tap payment chip →
 * PaymentSheet.
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import type { Document } from '../types/document';
import type { Tokens } from '../theme';
import { makeStyles, useThemeColors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { PaymentChip, shouldShowPaymentChip } from './PaymentChip';
import { stageMetaFor } from './StageSheet';
import { selectionTap } from '../utils/haptics';

interface DocumentRowProps {
  doc: Document;
  onView: (doc: Document) => void;
  onStagePress?: (doc: Document) => void;
  onPaymentPress?: (doc: Document) => void;
  /** When supplied, an envelope quick-action renders on the right. */
  onSend?: (doc: Document) => void;
  /** When supplied, a card quick-action renders on the right. */
  onTakePayment?: (doc: Document) => void;
  /**
   * When supplied and the doc is a convertible quote, a 3-dots overflow
   * action renders that lets the tradie convert the quote to an invoice.
   */
  onConvertToInvoice?: (doc: Document) => void;
}

function stageShortLabel(stage: Document['stage'], themeColors: Tokens): string {
  return stageMetaFor(themeColors)[stage]?.chipLabel ?? stage;
}

function XeroSyncChip({ status }: { status?: Document['xeroSyncStatus'] }) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  // Render only the states the tradie should notice. 'not_synced'/'syncing'
  // are transient or expected and would just add visual noise.
  if (status === 'synced') {
    return (
      <View
        style={[
          styles.xeroChip,
          { backgroundColor: themeColors.moneySubtle, borderColor: themeColors.moneySubtle },
        ]}
      >
        <MaterialCommunityIcons name={'cloud-check' as any} size={12} color={themeColors.money} />
        <Text style={[styles.xeroLabel, { color: themeColors.money }]}>In Xero</Text>
      </View>
    );
  }
  if (status === 'error') {
    return (
      <View
        style={[
          styles.xeroChip,
          { backgroundColor: themeColors.errorSubtle, borderColor: themeColors.errorSubtle },
        ]}
      >
        <MaterialCommunityIcons name={'cloud-alert' as any} size={12} color={themeColors.error} />
        <Text style={[styles.xeroLabel, { color: themeColors.error }]}>Xero failed</Text>
      </View>
    );
  }
  return null;
}

export function DocumentRow({
  doc,
  onView,
  onStagePress,
  onPaymentPress,
  onSend,
  onTakePayment,
  onConvertToInvoice,
}: DocumentRowProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const meta = stageMetaFor(themeColors)[doc.stage];
  const label = stageShortLabel(doc.stage, themeColors);
  // Convert-to-invoice is only legal on a quote that hasn't already been
  // invoiced and is sitting in a stage where conversion makes sense.
  const canConvert =
    !!onConvertToInvoice &&
    doc.type === 'quote' &&
    !doc.invoicedAt &&
    (doc.stage === 'draft' || doc.stage === 'quote_accepted');
  const hasQuickActions = !!(onSend || onTakePayment || canConvert);
  // Doc stage chip is mostly redundant noise on the row — payment state
  // already lives in PaymentChip, and the job-level timeline above tells
  // the "where is it" story. Keep the chip only for the terminal-paid
  // state so a closed-out doc still calls itself out.
  const showStageChip = doc.stage === 'paid';

  return (
    <Pressable
      onPress={() => {
        selectionTap();
        onView(doc);
      }}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.iconCircle}>
        <MaterialCommunityIcons
          name={(doc.type === 'invoice' ? 'receipt' : 'file-document-outline') as any}
          size={18}
          color={themeColors.accentText}
        />
      </View>

      <View style={styles.main}>
        <View style={styles.titleRow}>
          <Text style={styles.docNumber} numberOfLines={1}>
            {doc.number || (doc.type === 'invoice' ? 'Invoice' : 'Quote')}
          </Text>
          <Text style={styles.amount}>{formatCurrency(Number(doc.total) || 0)}</Text>
        </View>

        <View style={styles.chipRow}>
          {showStageChip ? (
            onStagePress ? (
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  selectionTap();
                  onStagePress(doc);
                }}
                hitSlop={6}
                style={({ pressed }) => [pressed && { opacity: 0.7 }]}
              >
                <View
                  style={[
                    styles.stageChip,
                    { backgroundColor: meta.bgColor, borderColor: meta.color + '44' },
                  ]}
                >
                  <MaterialCommunityIcons name={meta.icon as any} size={12} color={meta.color} />
                  <Text style={[styles.stageLabel, { color: meta.color }]}>{label}</Text>
                </View>
              </Pressable>
            ) : (
              <View
                style={[
                  styles.stageChip,
                  { backgroundColor: meta.bgColor, borderColor: meta.color + '44' },
                ]}
              >
                <MaterialCommunityIcons name={meta.icon as any} size={12} color={meta.color} />
                <Text style={[styles.stageLabel, { color: meta.color }]}>{label}</Text>
              </View>
            )
          ) : null}

          {shouldShowPaymentChip(doc) ? (
            <PaymentChip doc={doc} onPress={onPaymentPress} />
          ) : null}
          <XeroSyncChip status={doc.xeroSyncStatus} />
        </View>
      </View>

      {hasQuickActions ? (
        <View style={styles.actions}>
          {onSend ? (
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                selectionTap();
                onSend(doc);
              }}
              hitSlop={6}
              style={({ pressed }) => [
                styles.actionButton,
                pressed && styles.actionButtonPressed,
              ]}
            >
              <MaterialCommunityIcons
                name={'email-send-outline' as any}
                size={18}
                color={themeColors.accentText}
              />
            </Pressable>
          ) : null}
          {onTakePayment ? (
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                selectionTap();
                onTakePayment(doc);
              }}
              hitSlop={6}
              style={({ pressed }) => [
                styles.actionButton,
                pressed && styles.actionButtonPressed,
              ]}
            >
              <MaterialCommunityIcons
                name={'credit-card-outline' as any}
                size={18}
                color={themeColors.accentText}
              />
            </Pressable>
          ) : null}
          {canConvert ? (
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                selectionTap();
                onConvertToInvoice!(doc);
              }}
              hitSlop={6}
              style={({ pressed }) => [
                styles.actionButton,
                pressed && styles.actionButtonPressed,
              ]}
            >
              <MaterialCommunityIcons
                name={'file-replace' as any}
                size={18}
                color={themeColors.accentText}
              />
            </Pressable>
          ) : null}
        </View>
      ) : (
        <MaterialCommunityIcons
          name={'chevron-right' as any}
          size={20}
          color={themeColors.textDisabled}
        />
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: t.colors.surfaceRaised,
    marginHorizontal: 16,
    marginBottom: 10,
  },
  rowPressed: {
    backgroundColor: t.colors.surfacePressed,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.colors.accentSubtle,
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
  docNumber: {
    fontSize: 14,
    fontWeight: '700',
    color: t.colors.text,
    flex: 1,
  },
  amount: {
    fontSize: 14,
    fontWeight: '700',
    color: t.colors.text,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  stageChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    gap: 4,
  },
  stageLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  xeroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    gap: 4,
  },
  xeroLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.colors.accentSubtle,
  },
  actionButtonPressed: {
    opacity: 0.7,
  },
}));
