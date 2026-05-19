/**
 * InlineAddMaterialRow
 *
 * Quick-add row that lives at the bottom of each section on the materials
 * list. Collapsed state mirrors the original dashed "+ Add material" footer
 * button; expanded state shows an inline form (name input + live catalog
 * search + qty/unit/price + Cancel/Save) so the user can add lines without
 * leaving the screen.
 *
 * The name field doubles as a search query: typing fires the existing
 * material-search orchestrator (Bunnings / Reece / local / AI) via
 * `useMaterialSearch`, and the result list renders right inside the card.
 * Tapping a result autofills name/unit/price; tapping Save with no result
 * commits a manual line. After Save, the form clears, the name input
 * refocuses, and the row stays expanded for rapid entry.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  TextInput as RNTextInput,
  ActivityIndicator,
} from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { colors } from '../theme';
import { Material, SupplierGroup, BusinessSettings, FavoriteProductMapping } from '../types';
import { generateId } from '../utils/generateId';
import { lightTap } from '../utils/haptics';
import { useMaterialSearch } from '../hooks/useMaterialSearch';
import { supplierPriceForGstMode, formatCurrency } from '../utils/quoteCalculator';
import { saveFavoriteProduct } from '../services/materialFavorites';
import { ActionSheet, ActionSheetOption } from './ActionSheet';

const UNITS: Material['unit'][] = ['each', 'm', 'm²', 'm³', 'L', 'kg', 'box', 'pack'];

export interface InlineAddMaterialAction {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  /** Short label shown alongside the icon when the row is expanded. */
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
}

export interface InlineAddMaterialRowProps {
  sectionName: string;
  onAdd: (material: Material) => void;
  /** GST mode of the current quote/invoice — affects how a picked supplier
   *  price is adjusted before being stored on the material. */
  pricesIncludeGst?: boolean;
  /** Search-config wiring (passed through to `useMaterialSearch`). */
  businessSettings?: BusinessSettings | null;
  supplierGroups: SupplierGroup[];
  selectedSupplierGroupId?: string;
  reeceConnected: boolean;
  onReeceReauthRequired?: () => void;
  /** Trailing icon buttons rendered alongside the row. Sit to the right of
   *  the collapsed pill, and underneath the form once it's expanded so the
   *  inputs get the full row width. */
  trailingActions?: InlineAddMaterialAction[];
  /** When 'edit', the same card is used to edit an existing material in
   *  place: starts expanded, fields prefill from `initialMaterial`, no
   *  trailing actions, Save commits via `onUpdate`, Cancel calls
   *  `onExitEdit`. */
  mode?: 'add' | 'edit';
  initialMaterial?: Material;
  onUpdate?: (material: Material) => void;
  onExitEdit?: () => void;
}

export function InlineAddMaterialRow({
  sectionName,
  onAdd,
  pricesIncludeGst = false,
  businessSettings,
  supplierGroups,
  selectedSupplierGroupId,
  reeceConnected,
  onReeceReauthRequired,
  trailingActions,
  mode = 'add',
  initialMaterial,
  onUpdate,
  onExitEdit,
}: InlineAddMaterialRowProps) {
  const isEdit = mode === 'edit';
  // Edit mode is always expanded — there's no collapsed pill, the parent
  // mounts this in place of the material row.
  const [expanded, setExpanded] = useState(isEdit);
  const [name, setName] = useState(initialMaterial?.name ?? '');
  const [qty, setQty] = useState(initialMaterial ? String(initialMaterial.quantity) : '1');
  const [price, setPrice] = useState(initialMaterial ? String(initialMaterial.price ?? '') : '');
  const [unit, setUnit] = useState<Material['unit']>(initialMaterial?.unit ?? 'each');
  const [nameError, setNameError] = useState(false);
  const [unitSheetVisible, setUnitSheetVisible] = useState(false);
  // Sticky across rapid-entry saves so a tradie filling in several lines
  // from the same supplier doesn't have to retick. Resets on Cancel.
  const [saveToBook, setSaveToBook] = useState(false);
  // Result the user picked from the dropdown — kept so its metadata
  // (itemNumber/url/imageUrl/pricingSource) gets carried onto the saved
  // material. Cleared whenever the user edits the name field after picking.
  const selectedResultRef = useRef<any>(null);

  const nameInputRef = useRef<RNTextInput | null>(null);

  const search = useMaterialSearch({
    enabled: true,
    businessSettings,
    supplierGroups,
    selectedSupplierGroupId,
    reeceConnected,
    onReeceReauthRequired,
    debounceMs: 300,
    // Typing only hits cheap sources (local supplier book + Reece). The
    // expensive scraper/web/AI chain runs only when the user taps the
    // magnifier — see `runFullSearch` below.
    autoMode: 'light',
  });

  // Tracked separately from `search.isSearching` so the magnifier spinner
  // shows for *user-initiated* full searches only — not the silent debounced
  // light auto-fire that would otherwise flicker the icon after every pause.
  const [fullSearchActive, setFullSearchActive] = useState(false);
  const runFullSearch = useCallback(async () => {
    if (!name.trim()) return;
    setFullSearchActive(true);
    try {
      await search.runSearch(name.trim(), 'full');
    } finally {
      setFullSearchActive(false);
    }
  }, [name, search]);

  // Drive the search hook from the local name input. Clearing the input
  // also clears any prior result selection so the next Save commits as
  // manual rather than carrying stale metadata.
  const handleNameChange = useCallback((next: string) => {
    setName(next);
    if (nameError && next.trim()) setNameError(false);
    if (selectedResultRef.current && next !== selectedResultRef.current.productName) {
      selectedResultRef.current = null;
    }
    search.setQuery(next);
  }, [nameError, search]);

  const expand = useCallback(() => {
    setExpanded(true);
    // Focus on the next tick so the input has mounted.
    setTimeout(() => nameInputRef.current?.focus(), 0);
  }, []);

  const resetForm = useCallback(() => {
    setName('');
    setQty('1');
    setPrice('');
    setNameError(false);
    selectedResultRef.current = null;
    search.clearResults();
  }, [search]);

  const collapse = useCallback(() => {
    // In edit mode the parent owns mount/unmount of this card — hand control
    // back rather than collapsing into a pill (the pill belongs to add mode).
    if (isEdit) {
      onExitEdit?.();
      return;
    }
    resetForm();
    setSaveToBook(false);
    setExpanded(false);
  }, [isEdit, onExitEdit, resetForm]);

  const pickResult = useCallback((item: any) => {
    selectedResultRef.current = item;
    const adjustedPrice = supplierPriceForGstMode(item.price || 0, pricesIncludeGst);
    setName(item.productName || '');
    if (item.unit) setUnit(item.unit as Material['unit']);
    setPrice(adjustedPrice ? String(adjustedPrice) : '');
    setNameError(false);
    // Hide the dropdown until the user types something new — they've made
    // their choice, no need to keep showing other matches.
    search.clearResults();
    // Send focus to the qty field so they can tweak the count immediately.
    // We don't keep a ref on qty input — tapping is fine.
  }, [pricesIncludeGst, search]);

  const buildMaterial = useCallback((): Material | null => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const parsedQty = parseFloat(qty) || 1;
    const parsedPrice = parseFloat(price) || 0;
    const picked = selectedResultRef.current;
    // Defaults for a manually-typed line.
    let pricingSource: Material['pricingSource'] = 'manual';
    let manualPriceOverride = true;
    const extra: Partial<Material> = {};

    if (picked && picked.productName === trimmed) {
      // User adopted a search result verbatim — carry through its metadata.
      if (picked.isAiEstimate) {
        pricingSource = 'ai';
        manualPriceOverride = false;
        extra.description = picked.description;
      } else if (picked.isLocalSource) {
        const fav = picked.favoriteProduct as FavoriteProductMapping | undefined;
        manualPriceOverride = picked.localSource === 'favorite' && fav?.isPersonalRate === true;
        pricingSource = manualPriceOverride ? 'manual' : 'scraper';
        if (fav) extra.favoriteProduct = fav;
      } else if (picked.reeceItemNumber) {
        pricingSource = 'scraper';
        manualPriceOverride = false;
        extra.reeceItemNumber = picked.reeceItemNumber;
        if (picked.reeceUnitOfMeasure) extra.reeceUnitOfMeasure = picked.reeceUnitOfMeasure;
      } else if (picked.isScraperResult) {
        pricingSource = 'scraper';
        manualPriceOverride = false;
        if ((picked.store || '').toLowerCase().includes('bunnings') && picked.itemNumber) {
          extra.bunningsItemNumber = picked.itemNumber;
        }
      }
      if (picked.imageUrl) extra.imageUrl = picked.imageUrl;
      if (picked.productUrl) extra.productUrl = picked.productUrl;
      if (picked.brand) extra.brand = picked.brand;
      extra.searchTerm = picked.productName;
    }

    // In edit mode preserve the original id and keep any fields not exposed
    // in the inline form (description/brand/templateBaseQuantity/etc.) — we
    // only overwrite what the user actually edited. A picked supplier
    // result still replaces the metadata above via `extra`.
    const base: Material = initialMaterial
      ? { ...initialMaterial }
      : ({} as Material);

    return {
      ...base,
      id: initialMaterial?.id ?? generateId(),
      name: trimmed,
      quantity: parsedQty,
      unit,
      price: parsedPrice,
      totalPrice: parsedPrice * parsedQty,
      manualPriceOverride,
      pricingSource,
      section: initialMaterial ? initialMaterial.section : (sectionName || undefined),
      // Editing breaks any template-derived quantity link — same rule the
      // qty stepper applies.
      ...(initialMaterial ? { templateBaseQuantity: undefined } : {}),
      ...extra,
    } as Material;
  }, [name, qty, price, unit, sectionName, initialMaterial]);

  const handleSave = useCallback(() => {
    const material = buildMaterial();
    if (!material) {
      setNameError(true);
      nameInputRef.current?.focus();
      return;
    }
    if (isEdit) {
      onUpdate?.(material);
      lightTap();
      // Persist a favorite if the user opted in (same as add mode).
      if (saveToBook) {
        const picked = selectedResultRef.current;
        const isPickedSupplier = picked && picked.productName === material.name;
        const favPayload = {
          productName: material.name,
          store: isPickedSupplier ? (picked.store || 'manual') : 'manual',
          unit: material.unit,
          price: material.price,
          ...(isPickedSupplier && picked.itemNumber ? { itemNumber: picked.itemNumber } : {}),
          ...(material.productUrl ? { productUrl: material.productUrl } : {}),
          ...(material.imageUrl ? { imageUrl: material.imageUrl } : {}),
          source: 'manual' as const,
          lastUpdatedAt: new Date().toISOString(),
        };
        saveFavoriteProduct(material.name, material.name, favPayload).catch(() => {
          /* non-blocking */
        });
      }
      onExitEdit?.();
      return;
    }
    onAdd(material);
    lightTap();

    // When the user has ticked "Save to book", also persist a favorite so
    // this material is reachable from the Supplier Book next time. Fire-and-
    // forget — the quote-side save has already succeeded; a failed favorite
    // write shouldn't block the rapid-entry flow.
    if (saveToBook) {
      const picked = selectedResultRef.current;
      const isPickedSupplier = picked && picked.productName === material.name;
      const favPayload = {
        productName: material.name,
        store: isPickedSupplier ? (picked.store || 'manual') : 'manual',
        unit: material.unit,
        price: material.price,
        ...(isPickedSupplier && picked.itemNumber ? { itemNumber: picked.itemNumber } : {}),
        ...(material.productUrl ? { productUrl: material.productUrl } : {}),
        ...(material.imageUrl ? { imageUrl: material.imageUrl } : {}),
        source: 'manual' as const,
        lastUpdatedAt: new Date().toISOString(),
      };
      saveFavoriteProduct(material.name, material.name, favPayload).catch(() => {
        /* non-blocking */
      });
    }

    // Rapid-entry mode: clear the form but keep unit + saveToBook sticky,
    // stay expanded and refocus the name input so the user can add another
    // line straight away.
    setName('');
    setQty('1');
    setPrice('');
    setNameError(false);
    selectedResultRef.current = null;
    search.clearResults();
    setTimeout(() => nameInputRef.current?.focus(), 0);
  }, [buildMaterial, isEdit, onAdd, onExitEdit, onUpdate, search, saveToBook]);

  const incrementQty = useCallback(() => {
    const n = parseFloat(qty) || 0;
    setQty(String(Math.max(1, n + 1)));
  }, [qty]);

  const decrementQty = useCallback(() => {
    const n = parseFloat(qty) || 0;
    setQty(String(Math.max(1, n - 1)));
  }, [qty]);

  const unitOptions: ActionSheetOption[] = UNITS.map(u => ({
    icon: 'ruler',
    label: u,
    onPress: () => setUnit(u),
  }));

  // Reset search when the row collapses externally (e.g. a parent unmount).
  useEffect(() => {
    if (!expanded) {
      // Clear hook state when collapsed so a future expansion starts clean.
      search.clearResults();
    }
    // search instance is stable per render; not adding to deps to avoid
    // re-running clearResults on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const collapsedActionsStrip = trailingActions && trailingActions.length > 0 ? (
    <View style={styles.actionsStrip}>
      {trailingActions.map((action, idx) => (
        <TouchableOpacity
          key={`${action.icon}-${idx}`}
          style={styles.actionIconBtn}
          onPress={action.onPress}
          accessibilityLabel={action.accessibilityLabel}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialCommunityIcons name={action.icon} size={20} color={colors.primary} />
        </TouchableOpacity>
      ))}
    </View>
  ) : null;

  // When the row is expanded the trailing actions get a full-width labeled
  // strip below the form — there's no compact pill to sit next to, so we
  // use the real estate for an icon + short label per action. Hidden in
  // edit mode since "From invoice" / "Supplier book" only make sense for
  // adding new materials.
  const expandedActionsStrip = !isEdit && trailingActions && trailingActions.length > 0 ? (
    <View style={styles.expandedActionsStrip}>
      {trailingActions.map((action, idx) => (
        <TouchableOpacity
          key={`${action.icon}-${idx}`}
          style={styles.expandedActionBtn}
          onPress={action.onPress}
          accessibilityLabel={action.accessibilityLabel}
        >
          <MaterialCommunityIcons name={action.icon} size={18} color={colors.primary} />
          <Text style={styles.expandedActionLabel} numberOfLines={1}>{action.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  ) : null;

  if (!expanded && !isEdit) {
    return (
      <View style={styles.collapsedRow}>
        <TouchableOpacity style={styles.collapsedBtn} onPress={expand} activeOpacity={0.7}>
          <MaterialCommunityIcons name="plus" size={16} color={colors.primary} />
          <Text style={styles.collapsedText}>Add Material</Text>
        </TouchableOpacity>
        {collapsedActionsStrip}
      </View>
    );
  }

  const visibleResults = search.results.slice(0, 5);
  // Only offer "Add as custom" alongside actual search results — without
  // results it tempts the user to commit before they've typed qty/price.
  // The bottom Save button is the manual-entry path when no results exist.
  const showCustomTopRow =
    name.trim().length > 0 &&
    !selectedResultRef.current &&
    visibleResults.length > 0;

  return (
    <View style={styles.expandedWrap}>
    <View style={styles.expandedCard}>
      <View style={[styles.nameRow, nameError && styles.nameRowError]}>
        <RNTextInput
          ref={nameInputRef}
          style={styles.nameInputInner}
          value={name}
          onChangeText={handleNameChange}
          placeholder="Material name"
          placeholderTextColor={colors.textMuted}
          returnKeyType="search"
          onSubmitEditing={runFullSearch}
          autoFocus
        />
        <TouchableOpacity
          style={styles.searchIconBtn}
          onPress={runFullSearch}
          disabled={!name.trim() || fullSearchActive}
          accessibilityLabel="Search supplier catalogs"
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          {fullSearchActive ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <MaterialCommunityIcons
              name="magnify"
              size={20}
              color={name.trim() ? colors.primary : colors.textMuted}
            />
          )}
        </TouchableOpacity>
      </View>

      {visibleResults.length > 0 && (
        <View style={styles.resultsList}>
          {showCustomTopRow && (
            <TouchableOpacity
              style={[styles.resultRow, styles.resultRowCustom]}
              onPress={handleSave}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="plus-circle-outline" size={18} color={colors.primary} />
              <Text style={styles.resultRowTextCustom} numberOfLines={1}>
                Add &quot;{name.trim()}&quot; as a custom item
              </Text>
            </TouchableOpacity>
          )}
          {visibleResults.map((item, idx) => (
            <TouchableOpacity
              key={`${item.productName || ''}-${item.itemNumber || ''}-${idx}`}
              style={styles.resultRow}
              onPress={() => pickResult(item)}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name={item.isAiEstimate ? 'robot' : (item.isLocalSource ? 'bookmark-outline' : 'magnify')}
                size={16}
                color={colors.textMuted}
              />
              <View style={styles.resultRowBody}>
                <Text style={styles.resultRowName} numberOfLines={1}>
                  {item.productName || item.description}
                </Text>
                {!!item.store && (
                  <Text style={styles.resultRowMeta} numberOfLines={1}>
                    {item.store}
                  </Text>
                )}
              </View>
              {!!item.price && (
                <Text style={styles.resultRowPrice}>{formatCurrency(item.price)}</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.fieldsRow}>
        <View style={styles.qtyStepper}>
          <Pressable style={({ pressed }) => [styles.qtyBtn, pressed && styles.qtyBtnPressed]} onPress={decrementQty}>
            <MaterialCommunityIcons name="minus" size={14} color={colors.text} />
          </Pressable>
          <RNTextInput
            style={styles.qtyInput}
            value={qty}
            onChangeText={setQty}
            keyboardType="decimal-pad"
            selectTextOnFocus
          />
          <Pressable style={({ pressed }) => [styles.qtyBtn, pressed && styles.qtyBtnPressed]} onPress={incrementQty}>
            <MaterialCommunityIcons name="plus" size={14} color={colors.text} />
          </Pressable>
        </View>

        <TouchableOpacity style={styles.unitChip} onPress={() => setUnitSheetVisible(true)}>
          <Text style={styles.unitChipText}>{unit}</Text>
          <MaterialCommunityIcons name="chevron-down" size={14} color={colors.textMuted} />
        </TouchableOpacity>

        <View style={styles.priceWrap}>
          <Text style={styles.priceDollar}>$</Text>
          <RNTextInput
            style={styles.priceInput}
            value={price}
            onChangeText={setPrice}
            placeholder="0.00"
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
          />
        </View>
      </View>

      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.cancelBtn} onPress={collapse}>
          <MaterialCommunityIcons name="close" size={16} color={colors.textMuted} />
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.saveToBookChip, saveToBook && styles.saveToBookChipActive]}
          onPress={() => setSaveToBook(v => !v)}
          accessibilityLabel="Also save to supplier book"
          accessibilityState={{ checked: saveToBook }}
        >
          <MaterialCommunityIcons
            name={saveToBook ? 'bookmark-check' : 'bookmark-outline'}
            size={16}
            color={saveToBook ? colors.primary : colors.textMuted}
          />
          <Text style={[styles.saveToBookText, saveToBook && styles.saveToBookTextActive]} numberOfLines={1}>
            Save to book
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
          <MaterialCommunityIcons name="check" size={16} color="#FFFFFF" />
          <Text style={styles.saveText}>{isEdit ? 'Save changes' : 'Save to List'}</Text>
        </TouchableOpacity>
      </View>

      <ActionSheet
        visible={unitSheetVisible}
        onDismiss={() => setUnitSheetVisible(false)}
        title="Unit"
        options={unitOptions}
      />
    </View>
    {expandedActionsStrip}
    </View>
  );
}

const styles = StyleSheet.create({
  collapsedRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  expandedWrap: {
    gap: 8,
  },
  actionsStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionIconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  expandedActionsStrip: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  expandedActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  expandedActionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  collapsedBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: 'dashed',
  },
  collapsedText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  expandedCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 8,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingLeft: 10,
    paddingRight: 4,
  },
  nameRowError: {
    borderColor: colors.error,
  },
  nameInputInner: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    paddingVertical: 8,
  },
  searchIconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultsList: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  resultRowCustom: {
    backgroundColor: colors.primary + '14',
  },
  resultRowTextCustom: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  resultRowBody: {
    flex: 1,
    gap: 2,
  },
  resultRowName: {
    fontSize: 13,
    color: colors.text,
  },
  resultRowMeta: {
    fontSize: 11,
    color: colors.textMuted,
  },
  resultRowPrice: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  fieldsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
    backgroundColor: 'rgba(255,255,255,0.08)',
    transform: [{ scale: 0.92 }],
  },
  qtyInput: {
    fontSize: 14,
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
  unitChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  unitChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  priceWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
  },
  priceDollar: {
    fontSize: 14,
    color: colors.textMuted,
    marginRight: 4,
  },
  priceInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    paddingVertical: 8,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  cancelText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  saveToBookChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  saveToBookChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '18',
  },
  saveToBookText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  saveToBookTextActive: {
    color: colors.primary,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  saveText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
