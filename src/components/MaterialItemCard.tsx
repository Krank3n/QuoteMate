/**
 * MaterialItemCard
 * Reusable material card extracted from MaterialsListScreen.
 * Supports interactive mode (qty stepper, edit, delete) and read-only mode (templates).
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity, Pressable, Image, Platform, TextInput as RNTextInput, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { Material } from '../types';
import { CollapsibleSection } from './CollapsibleSection';

function formatTimeAgo(isoTimestamp: string): string {
  const now = new Date();
  const then = new Date(isoTimestamp);
  const secondsAgo = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (secondsAgo < 60) return 'Just now';
  if (secondsAgo < 3600) { const m = Math.floor(secondsAgo / 60); return `${m} min${m > 1 ? 's' : ''} ago`; }
  if (secondsAgo < 86400) { const h = Math.floor(secondsAgo / 3600); return `${h} hour${h > 1 ? 's' : ''} ago`; }
  const d = Math.floor(secondsAgo / 86400);
  return `${d} day${d > 1 ? 's' : ''} ago`;
}

interface MaterialItemCardProps {
  material: Material;
  isExpanded?: boolean;
  isFetching?: boolean;
  isRecentlyPriced?: boolean;
  isActive?: boolean; // From draggable-flatlist — true when this card is being dragged
  localQuantity?: number;
  drag?: () => void; // From draggable-flatlist — call to start dragging
  onToggleExpand?: () => void;
  onQuantityUpdate?: (delta: number) => void;
  onQuantityBlur?: (value: string) => void;
  onMoveToSection?: () => void;
  onOpenInStore?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  /**
   * Render a compact variant of the card — no qty stepper or drag handle,
   * but still supports expand/collapse for details. Used by the Saved Items
   * tab to display saved favorites/personal-rate items consistently with the
   * materials list. Tap the card body to expand; use the add arrow to add.
   */
  readOnly?: boolean;
  /** Add-to-quote handler for the readOnly variant. */
  onPress?: () => void;
}

export function MaterialItemCard({
  material,
  isExpanded = false,
  isFetching = false,
  isRecentlyPriced = false,
  isActive = false,
  localQuantity,
  drag,
  onToggleExpand,
  onQuantityUpdate,
  onQuantityBlur,
  onMoveToSection,
  onOpenInStore,
  onEdit,
  onDelete,
  readOnly = false,
  onPress,
}: MaterialItemCardProps) {
  const hasMeaningfulBrand = material.brand &&
    material.brand.toLowerCase() !== 'bunnings' &&
    material.brand.toLowerCase() !== 'bunnings.com.au' &&
    material.brand.toLowerCase() !== 'reece' &&
    material.brand.toLowerCase() !== 'mitre 10';
  const hasDetails = material.imageUrl || material.description || hasMeaningfulBrand || material.stockCheckedAt || material.bunningsItemNumber;
  const showLink = material.pricingSource === 'scraper' || material.pricingSource === 'api';
  // Show "Est." badge for:
  //  - materials priced by the LLM fallback (pricingSource === 'ai')
  //  - scraper results that came back as Claude guesses (pricingSource 'scraper'
  //    but priceConfidence === 'low', no productUrl/itemNumber)
  // These all need user verification because the price isn't from a live
  // scrape against the actual Bunnings product page.
  const isEstimate =
    material.pricingSource === 'ai' || material.priceConfidence === 'low';

  const qty = localQuantity ?? material.quantity;

  const topRow = (
    <View style={styles.itemTopRow}>
      {drag && (
        <TouchableOpacity onLongPress={drag} delayLongPress={150} style={styles.dragHandle}>
          <MaterialCommunityIcons name="drag" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      )}
      <View style={styles.itemStatusIcon}>
        {isFetching ? (
          <ActivityIndicator size={20} color={colors.primary} />
        ) : isRecentlyPriced ? (
          <MaterialCommunityIcons name="check-circle" size={20} color={colors.success} />
        ) : (
          <MaterialCommunityIcons name="package-variant" size={20} color={colors.textMuted} />
        )}
      </View>
      <View style={styles.itemNameWrap}>
        <Text style={styles.itemName} numberOfLines={2}>{material.name}</Text>
        {isFetching ? (
          <Text style={styles.searchingLabel}>Searching...</Text>
        ) : (
          <Text style={styles.itemUnitPrice}>
            {material.templateBaseQuantity ? (() => {
              // Derive unit word from section name: "Fence Bay" → "/bay", "Deck Section" → "/section"
              const sectionWords = (material.section || '').split(/\s+/);
              const unitWord = sectionWords.length > 0 ? sectionWords[sectionWords.length - 1].toLowerCase() : 'unit';
              return `${material.templateBaseQuantity}/${unitWord} · `;
            })() : ''}{formatCurrency(material.price)}
            {readOnly && material.unit ? ` / ${material.unit}` : ' ea.'}
            {material.packSize && material.packUnit && material.requiredQty
              ? `  ·  ${material.packSize} ${material.packUnit}/pack (need ${material.requiredQty} ${material.packUnit})`
              : ''}
            {readOnly && material.favoriteProduct?.coveragePerUnit && material.favoriteProduct?.coverageUnit
              ? `  ·  covers ${material.favoriteProduct.coveragePerUnit} ${material.favoriteProduct.coverageUnit}`
              : ''}
            {isEstimate ? (
              <Text style={{
                color: material.priceConfidence === 'high' ? colors.success
                  : material.priceConfidence === 'low' ? '#ef4444' : '#f59e0b',
                fontWeight: '600',
              }}>
                {'  ·  Est. — verify price'}
              </Text>
            ) : ''}
          </Text>
        )}
      </View>
      <View style={styles.itemPriceWrap}>
        {isFetching ? (
          <Text style={styles.searchingPrice}>...</Text>
        ) : (
          <Text style={[styles.itemTotal, isRecentlyPriced && styles.itemTotalSuccess]}>
            {formatCurrency(material.totalPrice)}
          </Text>
        )}
      </View>
    </View>
  );

  // Saved Items variant — mirrors the interactive card layout but without
  // qty stepper or drag handle. Tapping the card body expands/collapses
  // details (image, description, brand, etc.). An add-arrow on the right
  // adds the item to the quote.
  if (readOnly) {
    return (
      <View style={[styles.listItem, styles.listItemReadOnly]}>
        <View style={styles.readOnlyTopArea}>
          <TouchableOpacity
            style={styles.readOnlyBodyTap}
            onPress={() => hasDetails && onToggleExpand?.()}
            disabled={!hasDetails}
            activeOpacity={0.7}
          >
            {topRow}
          </TouchableOpacity>
          {onPress && (
            <TouchableOpacity
              style={styles.addArrowBtn}
              onPress={onPress}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialCommunityIcons name="plus-circle-outline" size={24} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.readOnlyActionsRow}>
          <View style={styles.readOnlyActionsLeft}>
            {hasDetails && (
              <MaterialCommunityIcons
                name={isExpanded ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.textMuted}
              />
            )}
          </View>
          <View style={styles.itemActions}>
            {showLink && (
              <TouchableOpacity style={styles.actionBtn} onPress={onOpenInStore}>
                <MaterialCommunityIcons name="open-in-new" size={18} color={colors.primary} />
              </TouchableOpacity>
            )}
            {onEdit && (
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={onEdit}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialCommunityIcons name="pencil" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            )}
            {onDelete && (
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={onDelete}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialCommunityIcons name="delete-outline" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        </View>
        {hasDetails && (
          <CollapsibleSection expanded={isExpanded}>
            <View style={styles.expandedContent}>
              <View style={styles.detailsContainer}>
                {material.imageUrl && (
                  <Image source={{ uri: material.imageUrl }} style={styles.productImage} resizeMode="contain" />
                )}
                <View style={styles.detailsColumn}>
                  {material.description && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Description:</Text>
                      <Text style={styles.detailValue}>{material.description}</Text>
                    </View>
                  )}
                  {hasMeaningfulBrand && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Brand:</Text>
                      <Text style={styles.detailValue}>{material.brand}</Text>
                    </View>
                  )}
                  {material.bunningsItemNumber && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Item #:</Text>
                      <Text style={styles.detailValue}>{material.bunningsItemNumber}</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          </CollapsibleSection>
        )}
      </View>
    );
  }

  // Full interactive card
  return (
    <View
      style={[
        styles.listItem,
        isFetching && styles.listItemFetching,
        isActive && styles.listItemDragging,
      ]}
    >
      <TouchableOpacity
        onPress={() => hasDetails && onToggleExpand?.()}
        disabled={!hasDetails}
        activeOpacity={0.7}
      >
        {topRow}
        <View style={styles.itemBottomRow}>
          <View style={styles.qtyRow}>
            <View style={styles.qtyStepper}>
              <Pressable
                style={({ pressed }) => [styles.qtyBtn, pressed && styles.qtyBtnPressed]}
                onPress={() => onQuantityUpdate?.(-1)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialCommunityIcons name="minus" size={16} color={colors.text} />
              </Pressable>
              <RNTextInput
                style={styles.qtyInput}
                key={`${material.id}-${qty}`}
                defaultValue={String(qty)}
                onEndEditing={(e) => onQuantityBlur?.(e.nativeEvent.text)}
                keyboardType="number-pad"
                selectTextOnFocus
                returnKeyType="done"
              />
              <Pressable
                style={({ pressed }) => [styles.qtyBtn, pressed && styles.qtyBtnPressed]}
                onPress={() => onQuantityUpdate?.(1)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialCommunityIcons name="plus" size={16} color={colors.text} />
              </Pressable>
            </View>
            <Text style={styles.qtyUnit}>{material.unit}</Text>
          </View>
          <View style={styles.itemActions}>
            {showLink && (
              <TouchableOpacity style={styles.actionBtn} onPress={onOpenInStore}>
                <MaterialCommunityIcons name="open-in-new" size={18} color={colors.primary} />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.actionBtn} onPress={onEdit}>
              <MaterialCommunityIcons name="pencil" size={18} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={onDelete}>
              <MaterialCommunityIcons name="delete-outline" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
      {hasDetails && (
        <CollapsibleSection expanded={isExpanded}>
          <View style={styles.expandedContent}>
            <View style={styles.detailsContainer}>
              {material.imageUrl && (
                <Image source={{ uri: material.imageUrl }} style={styles.productImage} resizeMode="contain" />
              )}
              <View style={styles.detailsColumn}>
                {material.description && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Description:</Text>
                    <Text style={styles.detailValue}>{material.description}</Text>
                  </View>
                )}
                {hasMeaningfulBrand && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Brand:</Text>
                    <Text style={styles.detailValue}>{material.brand}</Text>
                  </View>
                )}
                {material.stockCheckedAt && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Last checked:</Text>
                    <Text style={styles.detailValue}>{formatTimeAgo(material.stockCheckedAt)}</Text>
                  </View>
                )}
                {material.bunningsItemNumber && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Item #:</Text>
                    <Text style={styles.detailValue}>{material.bunningsItemNumber}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </CollapsibleSection>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  listItem: {
    backgroundColor: colors.surface,
    marginHorizontal: 12,
    marginBottom: 10,
    borderRadius: 12,
    overflow: 'hidden',
  },
  listItemFetching: {
    backgroundColor: colors.surface,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  listItemDragging: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
    borderWidth: 2,
    borderColor: colors.primary,
    transform: [{ scale: 1.02 }],
  },
  listItemReadOnly: {
    marginBottom: 8,
  },
  readOnlyTopArea: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  readOnlyBodyTap: {
    flex: 1,
  },
  addArrowBtn: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  readOnlyActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 10,
    paddingTop: 2,
  },
  readOnlyActionsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 4,
  },
  itemStatusIcon: {
    width: 28,
    marginTop: 2,
  },
  itemNameWrap: {
    flex: 1,
    marginRight: 12,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 20,
  },
  itemUnitPrice: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  itemPriceWrap: {
    alignItems: 'flex-end',
    marginTop: 2,
  },
  itemTotal: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
  },
  itemTotalSuccess: {
    color: colors.success,
  },
  searchingLabel: {
    fontSize: 13,
    color: colors.primary,
    fontStyle: 'italic',
  },
  searchingPrice: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textMuted,
  },
  itemBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 12,
    paddingTop: 6,
  },
  dragHandle: {
    paddingRight: 4,
    paddingVertical: 6,
    marginTop: 2,
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  qtyStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  qtyBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  qtyBtnPressed: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    transform: [{ scale: 0.9 }],
  },
  qtyInput: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    minWidth: 36,
    textAlign: 'center',
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
  qtyUnit: {
    fontSize: 13,
    color: colors.textMuted,
    marginLeft: 8,
  },
  itemActions: {
    flexDirection: 'row',
    gap: 4,
  },
  actionBtn: {
    padding: 8,
    borderRadius: 8,
  },
  expandedContent: {
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  detailsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'flex-start',
  },
  productImage: {
    width: Platform.OS === 'web' ? 100 : 80,
    height: Platform.OS === 'web' ? 100 : 80,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  detailsColumn: {
    flex: 1,
    minWidth: 200,
  },
  detailRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted,
    marginRight: 8,
    minWidth: 80,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.text,
    flex: 1,
  },
});
