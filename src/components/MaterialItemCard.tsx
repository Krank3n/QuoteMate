/**
 * MaterialItemCard
 * Reusable material card extracted from MaterialsListScreen.
 * Supports interactive mode (qty stepper, edit, delete) and read-only mode (templates).
 */

import React, { useState, useEffect, useRef } from 'react';
import { sectionUnitWord } from './sectionUnitWord';
import { View, StyleSheet, TouchableOpacity, Pressable, Image, Platform, TextInput as RNTextInput, ActivityIndicator, Animated, Easing } from 'react-native';
import { Text, Menu, Divider } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { makeStyles, useThemeColors } from '../theme';
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
  localQuantity?: number;
  onToggleExpand?: () => void;
  onQuantityUpdate?: (delta: number) => void;
  onQuantityBlur?: (value: string) => void;
  /**
   * Move this material to a different section. Pass the target section name,
   * or `null` for "Unsectioned". Triggered by the box-icon dropdown on the
   * left of the card — see the Menu wired around `package-variant` below.
   */
  onMoveToSection?: (sectionName: string | null) => void;
  /**
   * Section names the box-icon dropdown should offer (sorted, includes the
   * material's current section so we can render it with a checkmark). Pass
   * a memoised reference from the parent so the memo'd card doesn't re-render
   * on every parent tick.
   */
  availableSections?: string[];
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

function MaterialItemCardImpl({
  material,
  isExpanded = false,
  isFetching = false,
  isRecentlyPriced = false,
  localQuantity,
  onToggleExpand,
  onQuantityUpdate,
  onQuantityBlur,
  onMoveToSection,
  availableSections,
  onOpenInStore,
  onEdit,
  onDelete,
  readOnly = false,
  onPress,
}: MaterialItemCardProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  // Anchored dropdown for the box icon — lets the user move this material
  // to another section without leaving the card. Closed by default; opens on
  // tap, closes on selection or outside tap.
  const [sectionMenuOpen, setSectionMenuOpen] = useState(false);
  const hasMeaningfulBrand = material.brand &&
    material.brand.toLowerCase() !== 'bunnings' &&
    material.brand.toLowerCase() !== 'bunnings.com.au' &&
    material.brand.toLowerCase() !== 'reece' &&
    material.brand.toLowerCase() !== 'mitre 10';
  const hasDetails = material.imageUrl || material.description || hasMeaningfulBrand || material.stockCheckedAt || material.bunningsItemNumber || material.reeceItemNumber;
  const showLink = material.pricingSource === 'scraper' || material.pricingSource === 'api';
  // Show "Est." badge for:
  //  - materials priced by the LLM fallback (pricingSource === 'ai')
  //  - scraper results that came back as Claude guesses (pricingSource 'scraper'
  //    but priceConfidence === 'low', no productUrl/itemNumber)
  // These all need user verification because the price isn't from a live
  // scrape against the actual Bunnings product page.
  const isEstimate =
    material.pricingSource === 'ai' || material.priceConfidence === 'low';

  // Saved supplier-book rates are priced from the user's own book (pricingSource
  // 'manual') and carry the supplier name in favoriteProduct.store. Surface it
  // like the Bunnings/Reece badges. 'manual' is the placeholder store used when
  // no supplier was entered, so skip it. Long free-text names get ellipsised.
  const savedStoreRaw =
    material.pricingSource === 'manual' ? material.favoriteProduct?.store?.trim() : undefined;
  const savedStore =
    savedStoreRaw && savedStoreRaw.toLowerCase() !== 'manual' ? savedStoreRaw : undefined;

  const supplierLabel = material.reeceItemNumber
    ? { name: 'Reece', color: '#1f4e8e' }
    : material.bunningsItemNumber
      ? { name: 'Bunnings', color: '#0d7c3f' }
      : savedStore
        ? {
            name: savedStore.length > 18 ? `${savedStore.slice(0, 17)}…` : savedStore,
            color: themeColors.accentText,
          }
        : null;

  const qty = localQuantity ?? material.quantity;

  // A work item is a lump-sum scope line — a title, a scope paragraph and one
  // price the tradie typed. It has no unit price and no meaningful quantity,
  // so the subtitle carries the scope text instead, and the qty stepper is
  // hidden: one stray tap on "+" would silently double a five-figure line.
  const isWorkItem = material.kind === 'work';
  const scopeText = material.scope?.trim();

  // Box icon's interactive behaviour is gated by `onMoveToSection` —
  // without that callback (e.g. readOnly cards in the supplier book) we
  // render the same icon as a static decoration. During fetch the icon
  // becomes a spinner, so suppress tap then too.
  const sectionMenuEnabled = !!onMoveToSection && !isFetching && !readOnly;
  const currentSection = material.section || null;

  const statusIconNode = isFetching ? (
    <ActivityIndicator size={20} color={themeColors.accentText} />
  ) : isRecentlyPriced ? (
    <MaterialCommunityIcons name="check-circle" size={20} color={themeColors.money} />
  ) : (
    // A work item is labour, not stock — the parcel icon reads as something
    // that arrives on a pallet, which is exactly the wrong idea for
    // "Prepare and paint interior walls".
    <MaterialCommunityIcons
      name={isWorkItem ? 'clipboard-text-outline' : 'package-variant'}
      size={20}
      color={themeColors.textMuted}
    />
  );

  const topRow = (
    <View style={styles.itemTopRow}>
      {sectionMenuEnabled ? (
        <Menu
          visible={sectionMenuOpen}
          onDismiss={() => setSectionMenuOpen(false)}
          anchor={
            <TouchableOpacity
              onPress={() => setSectionMenuOpen(true)}
              style={styles.itemStatusIcon}
              accessibilityLabel="Move to section"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {statusIconNode}
            </TouchableOpacity>
          }
          contentStyle={styles.sectionMenuContent}
        >
          <Menu.Item
            title="Move to…"
            disabled
            titleStyle={styles.sectionMenuHeader}
          />
          <Divider />
          {(availableSections || []).map((name) => {
            const isCurrent = name === currentSection;
            return (
              <Menu.Item
                key={name}
                onPress={() => {
                  setSectionMenuOpen(false);
                  if (!isCurrent) onMoveToSection?.(name);
                }}
                title={name}
                disabled={isCurrent}
                leadingIcon={isCurrent ? 'check' : undefined}
              />
            );
          })}
          {currentSection && (
            <Menu.Item
              onPress={() => {
                setSectionMenuOpen(false);
                onMoveToSection?.(null);
              }}
              title="Unsectioned"
            />
          )}
        </Menu>
      ) : (
        <View style={styles.itemStatusIcon}>{statusIconNode}</View>
      )}
      <View style={styles.itemNameWrap}>
        <Text style={styles.itemName} numberOfLines={2}>{material.name}</Text>
        {isFetching ? (
          <Text style={styles.searchingLabel}>Searching...</Text>
        ) : isWorkItem ? (
          scopeText ? (
            <Text style={styles.itemUnitPrice} numberOfLines={3}>{scopeText}</Text>
          ) : null
        ) : (
          <Text style={styles.itemUnitPrice}>
            {material.templateBaseQuantity
              ? `${material.templateBaseQuantity}/${sectionUnitWord(material.section)} · `
              : ''}{formatCurrency(material.price)}
            {readOnly && material.unit ? ` / ${material.unit}` : ' ea.'}
            {material.packSize && material.packUnit && material.requiredQty
              ? `  ·  ${material.packSize} ${material.packUnit}/pack (need ${material.requiredQty} ${material.packUnit})`
              : ''}
            {readOnly && material.favoriteProduct?.coveragePerUnit && material.favoriteProduct?.coverageUnit
              ? `  ·  covers ${material.favoriteProduct.coveragePerUnit} ${material.favoriteProduct.coverageUnit}`
              : ''}
            {isEstimate ? (
              <Text style={{
                color: material.priceConfidence === 'high' ? themeColors.money
                  : material.priceConfidence === 'low' ? '#ef4444' : '#f59e0b',
                fontWeight: '600',
              }}>
                {'  ·  Est. — verify price'}
              </Text>
            ) : ''}
            {supplierLabel ? (
              <Text style={{ color: supplierLabel.color, fontWeight: '600' }}>
                {`  ·  ${supplierLabel.name}`}
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

  // Pulsing glow for items needing price verification. We loop a 0→1
  // Animated.Value and map it onto shadowOpacity (iOS/web) + border opacity
  // (Android fallback) so the amber outline gently breathes. The effect is
  // automatically removed once the user updates the price — that flips
  // pricingSource away from 'ai' and priceConfidence away from 'low', which
  // makes `isEstimate` false, so this glow stops mounting at all.
  const glowAnim = useRef(new Animated.Value(0)).current;
  const showVerifyGlow = isEstimate && !isFetching && !readOnly;
  useEffect(() => {
    if (!showVerifyGlow) {
      glowAnim.stopAnimation();
      glowAnim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(glowAnim, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [showVerifyGlow, glowAnim]);
  const glowOpacity = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.9] });

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
              <MaterialCommunityIcons name="plus-circle-outline" size={24} color={themeColors.accentText} />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.readOnlyActionsRow}>
          <View style={styles.readOnlyActionsLeft}>
            {hasDetails && (
              <MaterialCommunityIcons
                name={isExpanded ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={themeColors.textMuted}
              />
            )}
          </View>
          <View style={styles.itemActions}>
            {showLink && (
              <TouchableOpacity style={styles.actionBtn} onPress={onOpenInStore}>
                <MaterialCommunityIcons name="open-in-new" size={18} color={themeColors.accentText} />
              </TouchableOpacity>
            )}
            {onEdit && (
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={onEdit}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialCommunityIcons name="pencil" size={18} color={themeColors.textMuted} />
              </TouchableOpacity>
            )}
            {onDelete && (
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={onDelete}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialCommunityIcons name="delete-outline" size={18} color={themeColors.textMuted} />
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
        showVerifyGlow && styles.listItemNeedsVerify,
      ]}
    >
      {showVerifyGlow && (
        <Animated.View
          pointerEvents="none"
          style={[styles.verifyGlowRing, { opacity: glowOpacity }]}
        />
      )}
      <TouchableOpacity
        onPress={() => hasDetails && onToggleExpand?.()}
        disabled={!hasDetails}
        activeOpacity={0.7}
      >
        {topRow}
        <View style={styles.itemBottomRow}>
          {isWorkItem ? (
            // Empty spacer keeps the actions right-aligned in the
            // space-between row now the stepper is gone.
            <View style={styles.qtyRow} />
          ) : (
          <View style={styles.qtyRow}>
            <View style={styles.qtyStepper}>
              <Pressable
                style={({ pressed }) => [styles.qtyBtn, pressed && styles.qtyBtnPressed]}
                onPress={() => onQuantityUpdate?.(-1)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialCommunityIcons name="minus" size={16} color={themeColors.text} />
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
                <MaterialCommunityIcons name="plus" size={16} color={themeColors.text} />
              </Pressable>
            </View>
            <Text style={styles.qtyUnit}>{material.unit}</Text>
          </View>
          )}
          <View style={styles.itemActions}>
            {showLink && (
              <TouchableOpacity style={styles.actionBtn} onPress={onOpenInStore}>
                <MaterialCommunityIcons name="open-in-new" size={18} color={themeColors.accentText} />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.actionBtn} onPress={onEdit}>
              <MaterialCommunityIcons name="pencil" size={18} color={themeColors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={onDelete}>
              <MaterialCommunityIcons name="delete-outline" size={18} color={themeColors.textMuted} />
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
                {(material.reeceItemNumber || material.bunningsItemNumber) && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Item #:</Text>
                    <Text style={styles.detailValue}>{material.reeceItemNumber || material.bunningsItemNumber}</Text>
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

// Memo with a comparator that ignores function-prop identity. Parents commonly
// pass inline arrow handlers (`onEdit={() => …}`) which would otherwise bust
// memoization on every render — but the closure logic is stable and the data
// props are the ones that determine what to render.
export const MaterialItemCard = React.memo(MaterialItemCardImpl, (prev, next) => {
  return (
    prev.material === next.material &&
    prev.isExpanded === next.isExpanded &&
    prev.isFetching === next.isFetching &&
    prev.isRecentlyPriced === next.isRecentlyPriced &&
    prev.localQuantity === next.localQuantity &&
    prev.readOnly === next.readOnly &&
    // Ref equality is fine here — the parent memoises `availableSections`
    // so it only changes when the section list actually changes.
    prev.availableSections === next.availableSections
  );
});

const useStyles = makeStyles((t) => ({
  listItem: {
    backgroundColor: t.colors.surfaceRaised,
    marginHorizontal: 12,
    marginBottom: 10,
    borderRadius: 12,
    overflow: 'hidden',
  },
  listItemFetching: {
    backgroundColor: t.colors.surfaceRaised,
    borderLeftWidth: 3,
    borderLeftColor: t.colors.accent,
  },
  // Subtle amber tint + shadow on cards whose price still needs verifying.
  // The actual pulse comes from the absolutely-positioned `verifyGlowRing`
  // below — this just gives the card a faint resting warmth so it doesn't
  // look totally inert between pulses.
  listItemNeedsVerify: {
    ...Platform.select({
      ios: {
        shadowColor: '#f59e0b',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.35,
        shadowRadius: 8,
      },
      android: {
        // Android can't tint elevation shadows, so we rely on the ring overlay.
      },
      web: {
        boxShadow: '0 0 10px rgba(245, 158, 11, 0.35)',
      } as any,
    }),
  },
  verifyGlowRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#f59e0b',
    zIndex: 1,
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
  sectionMenuContent: {
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  sectionMenuHeader: {
    fontSize: 12,
    fontWeight: '600',
    color: t.colors.textMuted,
  },
  itemNameWrap: {
    flex: 1,
    marginRight: 12,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '600',
    color: t.colors.text,
    lineHeight: 20,
  },
  itemUnitPrice: {
    fontSize: 13,
    color: t.colors.textMuted,
    marginTop: 2,
  },
  itemPriceWrap: {
    alignItems: 'flex-end',
    marginTop: 2,
  },
  itemTotal: {
    fontSize: 16,
    fontWeight: '700',
    color: t.colors.money,
  },
  itemTotalSuccess: {
    color: t.colors.money,
  },
  searchingLabel: {
    fontSize: 13,
    color: t.colors.accentText,
    fontStyle: 'italic',
  },
  searchingPrice: {
    fontSize: 16,
    fontWeight: '600',
    color: t.colors.textMuted,
  },
  itemBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 12,
    paddingTop: 6,
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  qtyStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.bg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  qtyBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  qtyBtnPressed: {
    backgroundColor: t.colors.surfaceOverlay,
    transform: [{ scale: 0.9 }],
  },
  qtyInput: {
    fontSize: 15,
    fontWeight: '600',
    color: t.colors.text,
    minWidth: 36,
    textAlign: 'center',
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: t.colors.border,
  },
  qtyUnit: {
    fontSize: 13,
    color: t.colors.textMuted,
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
    backgroundColor: t.colors.surfaceRaised,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
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
    backgroundColor: t.colors.surfaceOverlay,
    borderWidth: 1,
    borderColor: t.colors.border,
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
    color: t.colors.textMuted,
    marginRight: 8,
    minWidth: 80,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '500',
    color: t.colors.text,
    flex: 1,
  },
}));
