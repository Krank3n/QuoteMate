/**
 * SpreadsheetColumnMapperModal
 *
 * Shown after a CSV / XLSX is parsed when we couldn't auto-detect which
 * column holds the product name and which holds the price (or when the
 * user wants to override our guess). The user picks a header for each
 * supplier-book field. Name + Price are required; everything else is
 * optional.
 *
 * Once confirmed, the parent calls `buildExtractFromMapping()` and hands
 * the result to the standard review modal.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal as RNModal,
} from 'react-native';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { Text, Button, IconButton, Divider } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { makeStyles, useThemeColors } from '../theme';
import type { ColumnMapping, ParsedSpreadsheet } from '../services/spreadsheetParser';

interface FieldDef {
  key: keyof ColumnMapping;
  label: string;
  required: boolean;
  hint?: string;
}

const FIELDS: FieldDef[] = [
  { key: 'name', label: 'Product name', required: true, hint: 'e.g. "Description" or "Item"' },
  { key: 'price', label: 'Price', required: true, hint: 'Unit price column (we strip $ / GST text)' },
  { key: 'unit', label: 'Unit', required: false, hint: 'each, m, m², kg, L…' },
  { key: 'qty', label: 'Pack quantity', required: false },
  { key: 'coveragePerUnit', label: 'Coverage per unit', required: false, hint: 'How much area / length one unit covers' },
  { key: 'coverageUnit', label: 'Coverage unit', required: false, hint: 'm², m³ or m' },
  { key: 'keywords', label: 'Keywords / tags', required: false, hint: 'Comma-separated' },
];

interface Props {
  visible: boolean;
  parsed: ParsedSpreadsheet | null;
  /** Initial best-guess (may be partial). */
  initialMapping?: Partial<ColumnMapping> | null;
  onCancel: () => void;
  onConfirm: (mapping: ColumnMapping) => void;
}

export function SpreadsheetColumnMapperModal({
  visible,
  parsed,
  initialMapping,
  onCancel,
  onConfirm,
}: Props) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardHeight();
  const [mapping, setMapping] = useState<Partial<ColumnMapping>>({});

  useEffect(() => {
    if (visible) {
      setMapping(initialMapping ?? {});
    }
  }, [visible, initialMapping]);

  const headers = parsed?.headers ?? [];
  const sample = parsed?.rows?.[0];

  const canConfirm = !!mapping.name && !!mapping.price;

  const fieldOptions = useMemo(
    () => [{ value: '__none__', label: 'None' }, ...headers.map(h => ({ value: h, label: h }))],
    [headers],
  );

  const handlePick = (field: keyof ColumnMapping, header: string) => {
    setMapping(prev => {
      const next = { ...prev };
      if (header === '__none__') {
        delete next[field];
      } else {
        next[field] = header;
      }
      return next;
    });
  };

  const handleConfirm = () => {
    if (!canConfirm) return;
    // Spread first so detected-but-not-editable fields (dimensions, itemNumber,
    // notes, and a composed multi-column name) survive confirmation.
    onConfirm({
      ...mapping,
      name: mapping.name!,
      price: mapping.price!,
    } as ColumnMapping);
  };

  // A composed name (Style/Range + Colour) can't be shown as a single chip.
  const composedName = Array.isArray(mapping.name) ? mapping.name : null;

  return (
    <RNModal
      visible={visible}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={onCancel}
    >
      {/* A <Modal> is its own native window and does not get the app's
          keyboard-avoiding provider on Android — see hooks/useKeyboardHeight. */}
      <View style={[styles.flex, { paddingBottom: keyboardInset }]}>
        <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
          <View style={styles.header}>
            <IconButton icon="close" onPress={onCancel} accessibilityLabel="Cancel" />
            <View style={styles.headerTextWrap}>
              <Text style={styles.title}>Map columns</Text>
              <Text style={styles.subtitle}>
                {headers.length
                  ? `We need to know which column is which. ${parsed?.rows.length ?? 0} rows found.`
                  : 'No columns detected in this file.'}
              </Text>
            </View>
          </View>

          <Divider />

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {headers.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons
                  name="file-alert-outline"
                  size={42}
                  color={themeColors.textMuted}
                />
                <Text style={styles.emptyText}>
                  We couldn't read any column headers. Make sure the first row of your
                  sheet contains column names (Item, Price, Unit, …).
                </Text>
              </View>
            ) : (
              <>
                {FIELDS.map(field => {
                  const selected = mapping[field.key];
                  return (
                    <View key={field.key} style={styles.fieldBlock}>
                      <View style={styles.fieldLabelRow}>
                        <Text style={styles.fieldLabel}>
                          {field.label}
                          {field.required ? <Text style={styles.required}> *</Text> : null}
                        </Text>
                        {field.key === 'name' && composedName ? (
                          <Text style={styles.fieldHint}>
                            Combined from: {composedName.join(' + ')}. Pick a single
                            column to override.
                          </Text>
                        ) : field.hint ? (
                          <Text style={styles.fieldHint}>{field.hint}</Text>
                        ) : null}
                      </View>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.chipRow}
                      >
                        {fieldOptions.map(opt => {
                          const isSelected =
                            (opt.value === '__none__' && !selected) || selected === opt.value;
                          return (
                            <TouchableOpacity
                              key={`${field.key}-${opt.value}`}
                              style={[styles.chip, isSelected && styles.chipActive]}
                              onPress={() => handlePick(field.key, opt.value)}
                            >
                              <Text
                                style={[
                                  styles.chipLabel,
                                  isSelected && styles.chipLabelActive,
                                ]}
                                numberOfLines={1}
                              >
                                {opt.label}
                              </Text>
                              {opt.value !== '__none__' && sample?.[opt.value] ? (
                                <Text
                                  style={[
                                    styles.chipSample,
                                    isSelected && styles.chipSampleActive,
                                  ]}
                                  numberOfLines={1}
                                >
                                  {sample[opt.value]}
                                </Text>
                              ) : null}
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    </View>
                  );
                })}

                <View style={styles.helpCard}>
                  <MaterialCommunityIcons
                    name="information-outline"
                    size={18}
                    color={themeColors.textMuted}
                  />
                  <Text style={styles.helpText}>
                    Tip: column headers should sit on the first row of the sheet. If your
                    file has a title or logo above the table, trim those rows in your
                    spreadsheet app first.
                  </Text>
                </View>
              </>
            )}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: insets.bottom + 8 }]}>
            <Button mode="text" onPress={onCancel} style={styles.cancelButton}>
              Cancel
            </Button>
            <Button
              mode="contained" buttonColor={themeColors.accent} textColor={themeColors.onAccent}
              onPress={handleConfirm}
              disabled={!canConfirm}
              style={styles.confirmButton}
            >
              Continue
            </Button>
          </View>
        </View>
      </View>
    </RNModal>
  );
}

const useStyles = makeStyles((t) => ({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: t.colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  headerTextWrap: {
    flex: 1,
    paddingRight: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: t.colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: t.colors.textMuted,
    marginTop: 2,
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 24 },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 24,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: t.colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  fieldBlock: {
    marginBottom: 18,
  },
  fieldLabelRow: {
    marginBottom: 8,
  },
  fieldLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: t.colors.text,
  },
  required: {
    color: t.colors.error,
  },
  fieldHint: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 2,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 16,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
    backgroundColor: t.colors.surfaceRaised,
    minWidth: 80,
    maxWidth: 200,
  },
  chipActive: {
    borderColor: t.colors.accent,
    backgroundColor: t.colors.accentSubtle,
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.text,
  },
  chipLabelActive: {
    color: t.colors.accentText,
  },
  chipSample: {
    fontSize: 11,
    color: t.colors.textMuted,
    marginTop: 2,
  },
  chipSampleActive: {
    color: t.colors.accentText,
  },
  helpCard: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: t.colors.surfaceOverlay,
    marginTop: 8,
  },
  helpText: {
    flex: 1,
    fontSize: 12,
    color: t.colors.textMuted,
    lineHeight: 17,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.colors.borderStrong,
    backgroundColor: t.colors.bg,
  },
  cancelButton: {},
  confirmButton: { minWidth: 120 },
}));
