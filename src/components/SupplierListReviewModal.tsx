/**
 * SupplierListReviewModal
 *
 * Full-screen modal shown after a supplier price list is extracted.
 * The user reviews each line item, edits as needed, and selects which
 * rows to persist via bulkSaveFavorites().
 *
 * Supports two modes:
 *  - fresh import: all items show as NEW
 *  - refresh: items are diffed against a previous import (matched by
 *    sourceRef + productName) and annotated with NEW / $X→$Y / UNCHANGED
 *    / REMOVED chips.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal as RNModal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
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
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import type { ExtractedItem } from '../services/supplierListImporter';
import type { FavoriteProductMapping } from '../types';
import { adjustPrice, GstAction } from '../utils/priceAdjust';

export interface ReviewItemState extends ExtractedItem {
  // Tracks whether this row should be saved.
  selected: boolean;
  // Diff metadata (only populated in refresh mode).
  diffStatus?: 'new' | 'priceChanged' | 'unchanged' | 'removed';
  previousPrice?: number;
  // A stable key for the editable list.
  uiKey: string;
}

interface Props {
  visible: boolean;
  initialSupplierName: string;
  initialItems: ExtractedItem[];
  /**
   * When provided, compute a diff against these existing favorites (keyed by
   * slug). Used for the refresh flow. Items in this list not matched by the
   * new extraction are shown with a "REMOVED" chip.
   */
  existingForDiff?: Array<FavoriteProductMapping & { key: string }>;
  /**
   * Existing personal-rate supplier names. Rendered as tappable chips above
   * the supplier name input so the user can consolidate the new import under
   * an existing supplier instead of typing a slight variant.
   */
  existingSupplierNames?: string[];
  saving: boolean;
  onCancel: () => void;
  onSave: (supplierName: string, items: ReviewItemState[]) => void;
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

function slugKey(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, '_').replace(/\//g, '-');
}

function confidenceColor(c: ExtractedItem['confidence']): string {
  if (c === 'high') return colors.success || '#22c55e';
  if (c === 'low') return colors.error || '#ef4444';
  return colors.warning || '#f59e0b';
}

export function SupplierListReviewModal({
  visible,
  initialSupplierName,
  initialItems,
  existingForDiff,
  existingSupplierNames,
  saving,
  onCancel,
  onSave,
}: Props) {
  const safeInsets = useSafeAreaInsets();
  const [supplierName, setSupplierName] = useState(initialSupplierName);
  const [rows, setRows] = useState<ReviewItemState[]>([]);
  const [keywordDraft, setKeywordDraft] = useState<Record<string, string>>({});
  // Inline bulk-adjust controls applied to every row's price on Save. Useful
  // when the supplier's PDF is a year out of date ("add 5.8%") or the prices
  // are quoted ex-GST and need flipping to inc-GST before they land in the
  // supplier book.
  const [bulkPercentText, setBulkPercentText] = useState('');
  const [bulkGstAction, setBulkGstAction] = useState<GstAction>('none');

  // Build initial rows whenever the modal opens with new data.
  useEffect(() => {
    if (!visible) return;
    setSupplierName(initialSupplierName);

    const existingByKey = new Map<string, FavoriteProductMapping & { key: string }>();
    if (existingForDiff) {
      for (const e of existingForDiff) existingByKey.set(e.key, e);
    }

    const matchedKeys = new Set<string>();
    const built: ReviewItemState[] = initialItems.map((item, idx) => {
      const key = slugKey(item.name);
      matchedKeys.add(key);
      const prev = existingByKey.get(key);

      let diffStatus: ReviewItemState['diffStatus'] | undefined;
      let previousPrice: number | undefined;
      if (existingForDiff) {
        if (!prev) diffStatus = 'new';
        else if (prev.price !== item.price) {
          diffStatus = 'priceChanged';
          previousPrice = prev.price;
        } else {
          diffStatus = 'unchanged';
        }
      }

      return {
        ...item,
        selected: true,
        diffStatus,
        previousPrice,
        uiKey: `${key}-${idx}`,
      };
    });

    // Append REMOVED rows (existing items not in the fresh extraction).
    if (existingForDiff) {
      for (const prev of existingForDiff) {
        if (!matchedKeys.has(prev.key)) {
          built.push({
            name: prev.productName,
            price: prev.price || 0,
            unit: prev.unit || 'each',
            keywords: prev.keywords || [],
            confidence: 'medium',
            coveragePerUnit: prev.coveragePerUnit,
            coverageUnit: prev.coverageUnit,
            rawLine: undefined,
            selected: false,
            diffStatus: 'removed',
            previousPrice: prev.price,
            uiKey: `removed-${prev.key}`,
          });
        }
      }
    }

    // Sort: low-confidence first, then medium, then high. Within each
    // group, new > priceChanged > unchanged > removed.
    const confRank: Record<ExtractedItem['confidence'], number> = {
      low: 0,
      medium: 1,
      high: 2,
    };
    const diffRank: Record<string, number> = {
      new: 0,
      priceChanged: 1,
      unchanged: 2,
      removed: 3,
    };
    built.sort((a, b) => {
      const c = confRank[a.confidence] - confRank[b.confidence];
      if (c !== 0) return c;
      return (diffRank[a.diffStatus || 'new'] || 0) - (diffRank[b.diffStatus || 'new'] || 0);
    });

    setRows(built);
    setKeywordDraft({});
  }, [visible, initialItems, initialSupplierName, existingForDiff]);

  const selectedCount = useMemo(() => rows.filter(r => r.selected).length, [rows]);

  const updateRow = (uiKey: string, patch: Partial<ReviewItemState>) => {
    setRows(prev => prev.map(r => (r.uiKey === uiKey ? { ...r, ...patch } : r)));
  };

  const addKeyword = (uiKey: string) => {
    const draft = (keywordDraft[uiKey] || '').trim().toLowerCase();
    if (!draft) return;
    setRows(prev =>
      prev.map(r =>
        r.uiKey === uiKey && !r.keywords.includes(draft)
          ? { ...r, keywords: [...r.keywords, draft] }
          : r
      )
    );
    setKeywordDraft(prev => ({ ...prev, [uiKey]: '' }));
  };

  const removeKeyword = (uiKey: string, kw: string) => {
    setRows(prev =>
      prev.map(r =>
        r.uiKey === uiKey ? { ...r, keywords: r.keywords.filter(k => k !== kw) } : r
      )
    );
  };

  const toggleAll = (value: boolean) => {
    setRows(prev => prev.map(r => ({ ...r, selected: r.diffStatus === 'removed' ? r.selected : value })));
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
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.header, { paddingTop: safeInsets.top + 8 }]}>
          <View style={styles.headerTextWrap}>
            <Text style={styles.title}>
              Found {initialItems.length} item{initialItems.length === 1 ? '' : 's'}
            </Text>
            <Text style={styles.subtitle}>Review and save</Text>
          </View>
          <IconButton icon="close" onPress={onCancel} disabled={saving} />
        </View>

        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          keyboardShouldPersistTaps="handled"
        >
          <TextInput
            label="Supplier name"
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

          {/* Bulk price uplift + GST flip controls. Applied to every selected
              row's price when the user hits Save. */}
          <View style={styles.bulkAdjustWrap}>
            <Text style={styles.bulkAdjustLabel}>Adjust all prices on save (optional)</Text>
            <View style={styles.bulkAdjustRow}>
              <TextInput
                label="Price increase %"
                value={bulkPercentText}
                onChangeText={setBulkPercentText}
                mode="outlined"
                dense
                keyboardType="decimal-pad"
                placeholder="e.g. 5.8"
                style={styles.bulkAdjustPercent}
                right={<TextInput.Affix text="%" />}
              />
              <View style={styles.bulkAdjustGstGroup}>
                {([
                  { value: 'none', label: 'No GST change' },
                  { value: 'addGst', label: '+10% GST' },
                  { value: 'removeGst', label: '−10% GST' },
                ] as { value: GstAction; label: string }[]).map(opt => {
                  const active = bulkGstAction === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      onPress={() => setBulkGstAction(opt.value)}
                      style={[styles.bulkAdjustGstBtn, active && styles.bulkAdjustGstBtnActive]}
                      disabled={saving}
                    >
                      <Text style={[styles.bulkAdjustGstText, active && styles.bulkAdjustGstTextActive]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
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
                      style={[styles.confidenceChip, { backgroundColor: confidenceColor(row.confidence) + '22' }]}
                      textStyle={{ color: confidenceColor(row.confidence), fontSize: 11 }}
                    >
                      {row.confidence}
                    </Chip>
                    {row.diffStatus === 'new' && (
                      <Chip compact style={styles.newChip} textStyle={styles.newChipText}>NEW</Chip>
                    )}
                    {row.diffStatus === 'priceChanged' && row.previousPrice !== undefined && (
                      <Chip compact style={styles.changedChip} textStyle={styles.changedChipText}>
                        {formatCurrency(row.previousPrice)} → {formatCurrency(row.price)}
                      </Chip>
                    )}
                    {row.diffStatus === 'unchanged' && (
                      <Chip compact style={styles.unchangedChip} textStyle={styles.unchangedChipText}>unchanged</Chip>
                    )}
                    {row.diffStatus === 'removed' && (
                      <Chip compact style={styles.removedChip} textStyle={styles.removedChipText}>REMOVED</Chip>
                    )}
                  </View>
                </View>
              </View>

              {row.diffStatus !== 'removed' && (
                <>
                  <View style={styles.priceRow}>
                    <TextInput
                      label="Price"
                      value={row.price.toString()}
                      onChangeText={v => updateRow(row.uiKey, { price: parseFloat(v) || 0 })}
                      mode="outlined"
                      dense
                      keyboardType="decimal-pad"
                      style={styles.priceInput}
                    />
                    <TextInput
                      label="Coverage"
                      value={row.coveragePerUnit?.toString() || ''}
                      onChangeText={v =>
                        updateRow(row.uiKey, {
                          coveragePerUnit: v ? parseFloat(v) || undefined : undefined,
                        })
                      }
                      mode="outlined"
                      dense
                      keyboardType="decimal-pad"
                      style={styles.coverageInput}
                      placeholder="(optional)"
                    />
                  </View>

                  <View style={styles.unitPicker}>
                    {UNIT_OPTIONS.map(opt => {
                      const active = row.unit === opt.value;
                      return (
                        <TouchableOpacity
                          key={opt.value}
                          onPress={() => updateRow(row.uiKey, { unit: opt.value })}
                          style={[
                            styles.unitBtn,
                            active && styles.unitBtnActive,
                          ]}
                          disabled={saving}
                        >
                          <Text
                            style={[
                              styles.unitBtnText,
                              active && styles.unitBtnTextActive,
                            ]}
                          >
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <View style={styles.keywordsWrap}>
                    {row.keywords.map(kw => (
                      <View key={kw} style={styles.keywordPill}>
                        <Text style={styles.keywordPillText}>{kw}</Text>
                        <TouchableOpacity
                          onPress={() => removeKeyword(row.uiKey, kw)}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          style={styles.keywordPillClose}
                        >
                          <Text style={styles.keywordPillCloseText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                    <TextInput
                      value={keywordDraft[row.uiKey] || ''}
                      onChangeText={v => setKeywordDraft(prev => ({ ...prev, [row.uiKey]: v }))}
                      onSubmitEditing={() => addKeyword(row.uiKey)}
                      mode="flat"
                      dense
                      placeholder="+ keyword"
                      style={styles.keywordInput}
                    />
                  </View>

                  {row.rawLine && (
                    <View style={styles.rawLineWrap}>
                      <Text style={styles.rawLine} numberOfLines={2}>
                        Raw: {row.rawLine}
                      </Text>
                    </View>
                  )}
                </>
              )}

              {row.diffStatus === 'removed' && (
                <View style={styles.removedHint}>
                  <Text style={styles.rawLine}>
                    Not found in the new list. Check to delete; leave unchecked to keep.
                  </Text>
                </View>
              )}

              <Divider style={styles.rowDivider} />
            </View>
          ))}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: safeInsets.bottom + 12 }]}>
          <Button mode="text" onPress={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            mode="contained"
            onPress={() => {
              const percent = parseFloat(bulkPercentText);
              const pct = Number.isFinite(percent) ? percent : 0;
              if (pct === 0 && bulkGstAction === 'none') {
                onSave(supplierName, rows);
                return;
              }
              const adjusted = rows.map(r =>
                r.diffStatus === 'removed'
                  ? r
                  : { ...r, price: adjustPrice(r.price || 0, { percent: pct, gstAction: bulkGstAction }) }
              );
              onSave(supplierName, adjusted);
            }}
            disabled={saving || selectedCount === 0}
            loading={saving}
          >
            Save selected ({selectedCount})
          </Button>
        </View>
      </KeyboardAvoidingView>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  fullScreen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceLight,
  },
  headerTextWrap: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textMuted,
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
  bulkAdjustWrap: {
    backgroundColor: colors.surfaceDark,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  bulkAdjustLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.onSurface,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  bulkAdjustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  bulkAdjustPercent: {
    width: 140,
    backgroundColor: colors.surface,
  },
  bulkAdjustGstGroup: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    flex: 1,
  },
  bulkAdjustGstBtn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.outline + '40',
  },
  bulkAdjustGstBtnActive: {
    backgroundColor: colors.primary + '12',
    borderColor: colors.primary,
  },
  bulkAdjustGstText: { color: colors.onSurface, fontSize: 12, fontWeight: '600' },
  bulkAdjustGstTextActive: { color: colors.primary },
  row: {
    marginBottom: 4,
    backgroundColor: colors.surfaceDark,
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
  newChip: {
    backgroundColor: '#22c55e22',
  },
  newChipText: {
    color: '#22c55e',
    fontSize: 11,
  },
  changedChip: {
    backgroundColor: '#f59e0b22',
  },
  changedChipText: {
    color: '#f59e0b',
    fontSize: 11,
  },
  unchangedChip: {
    backgroundColor: colors.surfaceLight,
  },
  unchangedChipText: {
    color: colors.textMuted,
    fontSize: 11,
  },
  removedChip: {
    backgroundColor: '#ef444422',
  },
  removedChipText: {
    color: '#ef4444',
    fontSize: 11,
  },
  priceRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  priceInput: {
    flex: 1,
  },
  coverageInput: {
    flex: 1,
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceLight,
  },
  unitBtnActive: {
    backgroundColor: colors.primaryBg,
    borderColor: colors.primary,
  },
  unitBtnText: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
  },
  unitBtnTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  keywordsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  keywordPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingLeft: 10,
    paddingRight: 4,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.surfaceLight,
  },
  keywordPillText: {
    fontSize: 12,
    color: colors.text,
    marginRight: 4,
  },
  keywordPillClose: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keywordPillCloseText: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: '700',
  },
  keywordInput: {
    flex: 1,
    minWidth: 100,
    backgroundColor: 'transparent',
    fontSize: 13,
  },
  rawLineWrap: {
    marginTop: 8,
    backgroundColor: colors.surface,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  rawLine: {
    fontSize: 11,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  removedHint: {
    marginLeft: 40,
    marginTop: 4,
  },
  rowDivider: {
    marginTop: 12,
    backgroundColor: 'transparent',
    height: 8,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceLight,
  },
});
