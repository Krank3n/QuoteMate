/**
 * InvoiceReviewModal
 *
 * Full-screen modal shown after a supplier invoice/receipt is extracted.
 * Sister component to SupplierListReviewModal but tuned for adding items
 * straight to the current quote: each row has an editable QUANTITY field
 * and the footer says "Add N items to quote" instead of "Save…".
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal as RNModal,
} from 'react-native';
// Not react-native's: under edge-to-edge Android no longer resizes the window
// for the keyboard, so RN's KeyboardAvoidingView does nothing there. See
// components/keyboardAvoidance.guard.test.ts.
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import {
  Text,
  Button,
  TextInput,
  Checkbox,
  Chip,
  IconButton,
  Divider,
} from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Tokens } from '../theme';
import { makeStyles, useThemeColors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import type { ExtractedItem } from '../services/supplierListImporter';

export interface InvoiceReviewRow extends ExtractedItem {
  qty: number;
  selected: boolean;
  uiKey: string;
}

interface Props {
  visible: boolean;
  initialSupplierName: string;
  initialItems: ExtractedItem[];
  saving: boolean;
  onCancel: () => void;
  onConfirm: (supplierName: string, rows: InvoiceReviewRow[]) => void;
}

const UNIT_OPTIONS = [
  { value: 'each', label: 'ea' },
  { value: 'm', label: 'm' },
  { value: 'm²', label: 'm²' },
  { value: 'm³', label: 'm³' },
  { value: 'L', label: 'L' },
  { value: 'kg', label: 'kg' },
  { value: 'box', label: 'box' },
  { value: 'pack', label: 'pack' },
];

function confidenceColor(confidence: ExtractedItem['confidence'], themeColors: Tokens): string {
  if (confidence === 'high') return themeColors.money || '#22c55e';
  if (confidence === 'low') return themeColors.error || '#ef4444';
  return themeColors.warning || '#f59e0b';
}

function clampQty(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 9999) return 9999;
  return Math.round(n);
}

export function InvoiceReviewModal({
  visible,
  initialSupplierName,
  initialItems,
  saving,
  onCancel,
  onConfirm,
}: Props) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const safeInsets = useSafeAreaInsets();
  const [supplierName, setSupplierName] = useState(initialSupplierName);
  const [rows, setRows] = useState<InvoiceReviewRow[]>([]);

  useEffect(() => {
    if (!visible) return;
    setSupplierName(initialSupplierName);

    const built: InvoiceReviewRow[] = initialItems.map((item, idx) => ({
      ...item,
      qty: clampQty(item.qty ?? 1),
      selected: true,
      uiKey: `inv-${idx}-${item.name}`,
    }));

    // Low-confidence rows surface first so the user reviews them before tapping save.
    const confRank: Record<ExtractedItem['confidence'], number> = {
      low: 0,
      medium: 1,
      high: 2,
    };
    built.sort((a, b) => confRank[a.confidence] - confRank[b.confidence]);

    setRows(built);
  }, [visible, initialItems, initialSupplierName]);

  const selectedCount = useMemo(() => rows.filter(r => r.selected).length, [rows]);
  const lineTotal = (row: InvoiceReviewRow) => row.qty * row.price;
  const cartTotal = useMemo(
    () => rows.filter(r => r.selected).reduce((sum, r) => sum + lineTotal(r), 0),
    [rows],
  );

  const updateRow = (uiKey: string, patch: Partial<InvoiceReviewRow>) => {
    setRows(prev => prev.map(r => (r.uiKey === uiKey ? { ...r, ...patch } : r)));
  };

  const toggleAll = (value: boolean) => {
    setRows(prev => prev.map(r => ({ ...r, selected: value })));
  };

  return (
    <RNModal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        style={styles.fullScreen}
        behavior="padding"
      >
        <View style={[styles.header, { paddingTop: safeInsets.top + 8 }]}>
          <View style={styles.headerTextWrap}>
            <Text style={styles.title}>
              Found {initialItems.length} item{initialItems.length === 1 ? '' : 's'}
            </Text>
            <Text style={styles.subtitle}>Review qty, price, and add to quote</Text>
          </View>
          <IconButton icon="close" onPress={onCancel} disabled={saving} />
        </View>

        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          keyboardShouldPersistTaps="handled"
        >
          <TextInput
            label="Supplier (optional)"
            value={supplierName}
            onChangeText={setSupplierName}
            mode="outlined"
            style={styles.supplierInput}
            dense
          />

          <View style={styles.bulkActions}>
            <Button mode="text" compact onPress={() => toggleAll(true)} disabled={saving}>
              Select all
            </Button>
            <Button mode="text" compact onPress={() => toggleAll(false)} disabled={saving}>
              Select none
            </Button>
          </View>

          {rows.map(row => (
            <View key={row.uiKey} style={styles.row}>
              <View style={styles.rowHeader}>
                <Checkbox
                  status={row.selected ? 'checked' : 'unchecked'}
                  onPress={() => updateRow(row.uiKey, { selected: !row.selected })}
                  disabled={saving}
                />
                <View style={styles.rowHeaderText}>
                  <TextInput
                    value={row.name}
                    onChangeText={name => updateRow(row.uiKey, { name })}
                    mode="flat"
                    dense
                    style={styles.nameInput}
                  />
                  <View style={styles.chipsRow}>
                    <Chip
                      compact
                      style={[
                        styles.confidenceChip,
                        { backgroundColor: confidenceColor(row.confidence, themeColors) + '22' },
                      ]}
                      textStyle={{ color: confidenceColor(row.confidence, themeColors), fontSize: 11 }}
                    >
                      {row.confidence}
                    </Chip>
                  </View>
                </View>
              </View>

              <View style={styles.qtyRow}>
                <TextInput
                  label="Qty"
                  value={row.qty.toString()}
                  onChangeText={v =>
                    updateRow(row.uiKey, { qty: clampQty(parseInt(v, 10) || 1) })
                  }
                  mode="outlined"
                  dense
                  keyboardType="number-pad"
                  style={styles.qtyInput}
                />
                <TextInput
                  label="Unit price"
                  value={row.price.toString()}
                  onChangeText={v => updateRow(row.uiKey, { price: parseFloat(v) || 0 })}
                  mode="outlined"
                  dense
                  keyboardType="decimal-pad"
                  style={styles.priceInput}
                />
                <View style={styles.lineTotalWrap}>
                  <Text style={styles.lineTotalLabel}>Line</Text>
                  <Text style={styles.lineTotalValue}>{formatCurrency(lineTotal(row))}</Text>
                </View>
              </View>

              <View style={styles.unitPicker}>
                {UNIT_OPTIONS.map(opt => {
                  const active = row.unit === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      onPress={() => updateRow(row.uiKey, { unit: opt.value })}
                      style={[styles.unitBtn, active && styles.unitBtnActive]}
                      disabled={saving}
                    >
                      <Text
                        style={[styles.unitBtnText, active && styles.unitBtnTextActive]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {row.rawLine && (
                <View style={styles.rawLineWrap}>
                  <Text style={styles.rawLine} numberOfLines={2}>
                    Raw: {row.rawLine}
                  </Text>
                </View>
              )}

              <Divider style={styles.rowDivider} />
            </View>
          ))}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: safeInsets.bottom + 12 }]}>
          <View style={styles.footerSummary}>
            <Text style={styles.footerSummaryLabel}>
              {selectedCount} item{selectedCount === 1 ? '' : 's'}
            </Text>
            <Text style={styles.footerSummaryTotal}>{formatCurrency(cartTotal)}</Text>
          </View>
          <View style={styles.footerButtons}>
            <Button mode="text" onPress={onCancel} disabled={saving}>
              Cancel
            </Button>
            <Button
              mode="contained" buttonColor={themeColors.accent} textColor={themeColors.onAccent}
              onPress={() => onConfirm(supplierName, rows)}
              disabled={saving || selectedCount === 0}
              loading={saving}
            >
              Add to quote
            </Button>
          </View>
        </View>
      </KeyboardAvoidingView>
    </RNModal>
  );
}

const useStyles = makeStyles((t) => ({
  fullScreen: {
    flex: 1,
    backgroundColor: t.colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.surfaceOverlay,
  },
  headerTextWrap: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: t.colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 2,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: 16,
  },
  supplierInput: {
    marginBottom: 12,
  },
  bulkActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 8,
  },
  row: {
    marginBottom: 4,
    backgroundColor: t.colors.surface,
    borderRadius: 12,
    padding: 12,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  rowHeaderText: {
    flex: 1,
    marginLeft: 4,
  },
  nameInput: {
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 6,
    columnGap: 6,
    marginTop: 6,
  },
  confidenceChip: {},
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  qtyInput: {
    width: 80,
  },
  priceInput: {
    flex: 1,
  },
  lineTotalWrap: {
    width: 80,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  lineTotalLabel: {
    fontSize: 10,
    color: t.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  lineTotalValue: {
    fontSize: 14,
    fontWeight: '700',
    color: t.colors.text,
    marginTop: 2,
  },
  unitPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  unitBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: t.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: t.colors.surfaceOverlay,
  },
  unitBtnActive: {
    backgroundColor: t.colors.accentSubtle,
    borderColor: t.colors.accent,
  },
  unitBtnText: {
    fontSize: 13,
    color: t.colors.textMuted,
    fontWeight: '500',
  },
  unitBtnTextActive: {
    color: t.colors.accentText,
    fontWeight: '600',
  },
  rawLineWrap: {
    marginTop: 8,
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  rawLine: {
    fontSize: 11,
    color: t.colors.textMuted,
    fontStyle: 'italic',
  },
  rowDivider: {
    marginTop: 12,
    backgroundColor: 'transparent',
    height: 8,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: t.colors.surfaceOverlay,
  },
  footerSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  footerSummaryLabel: {
    fontSize: 12,
    color: t.colors.textMuted,
  },
  footerSummaryTotal: {
    fontSize: 16,
    fontWeight: '700',
    color: t.colors.text,
  },
  footerButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
}));
