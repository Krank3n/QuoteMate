/**
 * PaymentSheet
 * Payment history for a Document + shortcut to record a manual one. Read-mostly:
 * Square/Stripe webhook events are the canonical source for automated
 * payments; this sheet just surfaces them and funnels manual entries back
 * to the existing RecordPaymentScreen for invoices.
 *
 * Pairs with PaymentChip — tapping the chip opens this sheet.
 */

import React from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Text, Button, Divider } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { format } from 'date-fns';

import type { Document } from '../types/document';
import type { DocumentPayment } from '../../shared/document/types';
import { makeStyles, useThemeColors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { BottomSheet } from './BottomSheet';
import { isEditablePayment } from '../utils/editablePayment';
import { selectionTap } from '../utils/haptics';

interface PaymentSheetProps {
  /** Opens the editor for a manually recorded payment. Omit and rows stay read-only. */
  onEditPayment?: (doc: Document, payment: DocumentPayment) => void;
  visible: boolean;
  onDismiss: () => void;
  doc: Document;
  onRecordPayment?: (doc: Document) => void;
}

function paymentKindLabel(kind: DocumentPayment['kind']): string {
  switch (kind) {
    case 'deposit': return 'Deposit';
    case 'balance': return 'Balance';
    case 'manual': return 'Manual';
  }
}

function methodLabel(method?: DocumentPayment['method']): string {
  switch (method) {
    case 'square': return 'Square';
    case 'bank': return 'Bank transfer';
    case 'cash': return 'Cash';
    case 'other': return 'Other';
    default: return 'Unknown';
  }
}

function formatPaidAt(ms: number): string {
  try {
    return format(new Date(ms), 'd MMM yyyy, h:mm a');
  } catch {
    return '';
  }
}

export function PaymentSheet({ visible, onDismiss, doc, onRecordPayment, onEditPayment }: PaymentSheetProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const payments = (doc.payments || []).slice().sort(
    (a, b) => (b.paidAt || 0) - (a.paidAt || 0),
  );
  const total = Number(doc.total) || 0;
  const paid = Number(doc.paidTotal) || 0;
  const balance = Math.max(0, total - paid);

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} title="Payments" scrollable>
      <View style={styles.summaryRow}>
        <SummaryCell label="Total" value={formatCurrency(total)} />
        <SummaryCell label="Paid" value={formatCurrency(paid)} />
        <SummaryCell
          label="Balance"
          value={formatCurrency(balance)}
          accent={balance > 0}
        />
      </View>

      <Divider style={styles.divider} />

      {payments.length === 0 ? (
        <View style={styles.empty}>
          <MaterialCommunityIcons
            name={'cash-multiple' as any}
            size={28}
            color={themeColors.textMuted}
          />
          <Text style={styles.emptyText}>No payments recorded yet.</Text>
        </View>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {payments.map((p) => {
            // Square entries mirror a real transaction and stay read-only —
            // see isEditablePayment.
            const editable = isEditablePayment(p) && !!onEditPayment;
            const RowWrapper: any = editable ? Pressable : View;
            return (
            <RowWrapper
              key={p.id}
              {...(editable
                ? {
                    onPress: () => {
                      selectionTap();
                      onEditPayment!(doc, p);
                    },
                    style: ({ pressed }: { pressed: boolean }) => [
                      styles.row,
                      pressed && { opacity: 0.7 },
                    ],
                    accessibilityLabel: `Edit payment of ${formatCurrency(p.amount)}`,
                  }
                : { style: styles.row })}
            >
              <View style={styles.rowIconCircle}>
                <MaterialCommunityIcons
                  name={
                    p.method === 'square'
                      ? ('credit-card-outline' as any)
                      : p.method === 'bank'
                        ? ('bank-outline' as any)
                        : p.method === 'cash'
                          ? ('cash' as any)
                          : ('cash-multiple' as any)
                  }
                  size={20}
                  color={themeColors.accentText}
                />
              </View>
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle}>
                  {paymentKindLabel(p.kind)} · {methodLabel(p.method)}
                </Text>
                {p.paidAt ? (
                  <Text style={styles.rowMeta}>{formatPaidAt(p.paidAt)}</Text>
                ) : null}
                {p.notes ? <Text style={styles.rowNotes}>{p.notes}</Text> : null}
              </View>
              <Text style={styles.rowAmount}>{formatCurrency(p.amount)}</Text>
              {editable ? (
                <MaterialCommunityIcons
                  name={'pencil-outline' as any}
                  size={16}
                  color={themeColors.textMuted}
                />
              ) : null}
            </RowWrapper>
            );
          })}
        </ScrollView>
      )}

      {doc.type === 'invoice' && onRecordPayment ? (
        <Button
          mode="contained" buttonColor={themeColors.accent} textColor={themeColors.onAccent}
          icon={'plus' as any}
          onPress={() => {
            onDismiss();
            onRecordPayment(doc);
          }}
          style={styles.recordButton}
        >
          Record a payment
        </Button>
      ) : null}
    </BottomSheet>
  );
}

function SummaryCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  return (
    <View style={styles.summaryCell}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, accent ? { color: themeColors.warning } : undefined]}>
        {value}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 4,
  },
  summaryCell: { flex: 1 },
  summaryLabel: {
    fontSize: 10,
    color: t.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '700',
    color: t.colors.text,
    marginTop: 2,
  },
  divider: {
    marginVertical: 12,
    backgroundColor: t.colors.border,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
    color: t.colors.textMuted,
  },
  list: {
    maxHeight: 320,
  },
  listContent: {
    paddingVertical: 4,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  rowIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowMain: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.text,
  },
  rowMeta: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 1,
  },
  rowNotes: {
    fontSize: 12,
    color: t.colors.textSecondary,
    marginTop: 2,
  },
  rowAmount: {
    fontSize: 14,
    fontWeight: '700',
    color: t.colors.text,
  },
  recordButton: {
    marginTop: 16,
    borderRadius: 12,
  },
}));
