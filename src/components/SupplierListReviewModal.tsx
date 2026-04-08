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
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import {
  Modal,
  Portal,
  Text,
  Button,
  TextInput,
  SegmentedButtons,
  Checkbox,
  Chip,
  IconButton,
  Divider,
} from 'react-native-paper';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import type { ExtractedItem } from '../services/supplierListImporter';
import type { FavoriteProductMapping } from '../types';

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
  return name.toLowerCase().trim().replace(/\s+/g, '_');
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
  const [supplierName, setSupplierName] = useState(initialSupplierName);
  const [rows, setRows] = useState<ReviewItemState[]>([]);
  const [keywordDraft, setKeywordDraft] = useState<Record<string, string>>({});

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
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onCancel}
        contentContainerStyle={styles.container}
      >
        <View style={styles.header}>
          <Text style={styles.title}>
            Found {initialItems.length} item{initialItems.length === 1 ? '' : 's'}. Review and save.
          </Text>
          <IconButton icon="close" onPress={onCancel} disabled={saving} />
        </View>

        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
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

                  <SegmentedButtons
                    value={row.unit}
                    onValueChange={unit => updateRow(row.uiKey, { unit })}
                    buttons={UNIT_OPTIONS}
                    density="small"
                    style={styles.unitPicker}
                  />

                  <View style={styles.keywordsWrap}>
                    {row.keywords.map(kw => (
                      <Chip
                        key={kw}
                        compact
                        onClose={() => removeKeyword(row.uiKey, kw)}
                        style={styles.keywordChip}
                      >
                        {kw}
                      </Chip>
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
                    <Text style={styles.rawLine} numberOfLines={2}>
                      Raw line: {row.rawLine}
                    </Text>
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

        <View style={styles.footer}>
          <Button mode="text" onPress={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            mode="contained"
            onPress={() => onSave(supplierName, rows)}
            disabled={saving || selectedCount === 0}
            loading={saving}
          >
            Save selected ({selectedCount})
          </Button>
        </View>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    margin: 16,
    borderRadius: 16,
    maxHeight: '92%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceLight,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  body: {
    flexGrow: 0,
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
    gap: 4,
    marginTop: 4,
  },
  confidenceChip: {
    height: 22,
  },
  newChip: {
    backgroundColor: '#22c55e22',
    height: 22,
  },
  newChipText: {
    color: '#22c55e',
    fontSize: 11,
  },
  changedChip: {
    backgroundColor: '#f59e0b22',
    height: 22,
  },
  changedChipText: {
    color: '#f59e0b',
    fontSize: 11,
  },
  unchangedChip: {
    backgroundColor: colors.surfaceLight,
    height: 22,
  },
  unchangedChipText: {
    color: colors.textMuted,
    fontSize: 11,
  },
  removedChip: {
    backgroundColor: '#ef444422',
    height: 22,
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
    marginTop: 8,
  },
  keywordsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  keywordChip: {
    height: 26,
  },
  keywordInput: {
    flex: 1,
    minWidth: 100,
    backgroundColor: 'transparent',
    height: 34,
  },
  rawLine: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 6,
    fontStyle: 'italic',
  },
  removedHint: {
    marginLeft: 40,
    marginTop: 4,
  },
  rowDivider: {
    marginTop: 12,
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
