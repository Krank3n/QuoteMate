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
 *
 * The same card also enters WORK ITEMS — lump-sum scope lines, which is how
 * every labour-dominant trade quotes. The Material | Work item chip pair
 * swaps the qty stepper and unit chip for a scope paragraph, relabels the
 * price as the line total, and shuts the supplier search off entirely: there
 * is no product behind "Interior surfaces to be painted", so searching for
 * one can only overwrite what the tradie typed. Rather than a new screen,
 * because this row is already mounted in every section footer, the
 * unsectioned footer and edit mode — so the affordance appears everywhere.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  TextInput as RNTextInput,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { makeStyles, useThemeColors } from '../theme';
import { Material, SupplierGroup, BusinessSettings, FavoriteProductMapping } from '../types';
import { generateId } from '../utils/generateId';
import { lightTap } from '../utils/haptics';
import { useMaterialSearch } from '../hooks/useMaterialSearch';
import { supplierPriceForGstMode, formatCurrency } from '../utils/quoteCalculator';
import { saveFavoriteProduct } from '../services/materialFavorites';
import { ActionSheet, ActionSheetOption } from './ActionSheet';
import { PillToggle, type PillToggleOption } from './PillToggle';

const UNITS: Material['unit'][] = ['each', 'm', 'm²', 'm³', 'L', 'kg', 'box', 'pack'];

/** Is this row a product, or a lump-sum scope line? */
const ENTRY_KIND_OPTIONS: PillToggleOption<'material' | 'work'>[] = [
  { value: 'material', label: 'Material' },
  { value: 'work', label: 'Work item' },
];

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
  /** Trailing action handlers — built into icon+label buttons internally so
   *  the parent passes one stable function (useCallback) and identity is
   *  preserved across renders. The handler receives the row's
   *  `sectionName`, so the same callback can be shared across every
   *  section. Pass `undefined` to hide an action. */
  onInvoicePress?: (sectionName: string) => void;
  onSupplierBookPress?: (sectionName: string) => void;
  /** When 'edit', the same card is used to edit an existing material in
   *  place: starts expanded, fields prefill from `initialMaterial`, no
   *  trailing actions, Save commits via `onUpdate`, Cancel calls
   *  `onExitEdit`. */
  mode?: 'add' | 'edit';
  initialMaterial?: Material;
  onUpdate?: (material: Material) => void;
  onExitEdit?: () => void;
}

interface ResolvedAction {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}

/**
 * Outer wrapper for the inline add row. When the row is collapsed in 'add'
 * mode it renders a lightweight pill that owns no hooks beyond a single
 * useState — important because the materials list mounts one of these per
 * section, and the previous all-in-one component dragged `useMaterialSearch`
 * (with its own state, refs, callbacks, effects) along even when idle. The
 * heavy `InlineAddMaterialForm` now only mounts when the user taps to expand
 * or when the row is being used in 'edit' mode.
 */
function InlineAddMaterialRowImpl(props: InlineAddMaterialRowProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const isEdit = props.mode === 'edit';
  const [expanded, setExpanded] = useState(isEdit);

  // Build the trailing-action list from the primitive handlers. Stable so
  // long as the handlers and sectionName are stable — which they should be
  // when the parent uses useCallback (see MaterialsListScreen).
  const trailingActions = useMemo<ResolvedAction[]>(() => {
    if (isEdit) return [];
    const out: ResolvedAction[] = [];
    if (props.onInvoicePress) {
      const cb = props.onInvoicePress;
      const sn = props.sectionName;
      out.push({
        icon: 'receipt',
        label: 'From invoice',
        accessibilityLabel: 'Add from invoice',
        onPress: () => cb(sn),
      });
    }
    if (props.onSupplierBookPress) {
      const cb = props.onSupplierBookPress;
      const sn = props.sectionName;
      out.push({
        icon: 'book-open-page-variant',
        label: 'Supplier book',
        accessibilityLabel: 'Open Supplier Book',
        onPress: () => cb(sn),
      });
    }
    return out;
  }, [isEdit, props.onInvoicePress, props.onSupplierBookPress, props.sectionName]);

  if (!expanded && !isEdit) {
    return (
      <CollapsedAddPill
        trailingActions={trailingActions}
        onExpand={() => setExpanded(true)}
      />
    );
  }

  return (
    <InlineAddMaterialForm
      {...props}
      trailingActions={trailingActions}
      onRequestCollapse={() => setExpanded(false)}
    />
  );
}

/**
 * Memoized so the per-section row doesn't re-render every time the parent
 * `MaterialsListScreen` re-renders. Relies on the parent passing stable
 * (useCallback'd) `onAdd`, `onInvoicePress`, `onSupplierBookPress`, and
 * `onReeceReauthRequired` callbacks and stable `businessSettings` /
 * `supplierGroups` references.
 */
export const InlineAddMaterialRow = React.memo(InlineAddMaterialRowImpl);

function CollapsedAddPill({
  trailingActions,
  onExpand,
}: {
  trailingActions?: ResolvedAction[];
  onExpand: () => void;
}) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  return (
    <View style={styles.collapsedRow}>
      <TouchableOpacity style={styles.collapsedBtn} onPress={onExpand} activeOpacity={0.7}>
        <MaterialCommunityIcons name="plus" size={16} color={themeColors.accentText} />
        <Text style={styles.collapsedText}>Add Material</Text>
      </TouchableOpacity>
      {trailingActions && trailingActions.length > 0 && (
        <View style={styles.actionsStrip}>
          {trailingActions.map((action, idx) => (
            <TouchableOpacity
              key={`${action.icon}-${idx}`}
              style={styles.actionIconBtn}
              onPress={action.onPress}
              accessibilityLabel={action.accessibilityLabel}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialCommunityIcons name={action.icon} size={20} color={themeColors.accentText} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

interface InlineAddMaterialFormProps extends InlineAddMaterialRowProps {
  /** Resolved trailing-action descriptors, built once by the wrapper from
   *  the primitive `on*Press` props above. */
  trailingActions: ResolvedAction[];
  /** Called by the form's Cancel button in add mode. Edit mode uses
   *  `onExitEdit` from the public props instead. */
  onRequestCollapse: () => void;
}

function InlineAddMaterialForm({
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
  onRequestCollapse,
}: InlineAddMaterialFormProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const isEdit = mode === 'edit';
  const [name, setName] = useState(initialMaterial?.name ?? '');
  const [qty, setQty] = useState(initialMaterial ? String(initialMaterial.quantity) : '1');
  const [price, setPrice] = useState(initialMaterial ? String(initialMaterial.price ?? '') : '');
  const [unit, setUnit] = useState<Material['unit']>(initialMaterial?.unit ?? 'each');
  // 'work' turns this card into a lump-sum scope line. Sticky across
  // rapid-entry saves — a painter typing three scope lines shouldn't have to
  // re-pick the mode each time.
  const [entryKind, setEntryKind] = useState<'material' | 'work'>(
    initialMaterial?.kind === 'work' ? 'work' : 'material',
  );
  const isWork = entryKind === 'work';
  const [scope, setScope] = useState(initialMaterial?.scope ?? '');
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
    // A work item has no product behind it, so nothing is searched for: no
    // debounced supplier fetch, no results, no chance of a supplier row
    // overwriting the tradie's title or price.
    if (isWork) return;
    search.setQuery(next);
  }, [nameError, search, isWork]);

  const resetForm = useCallback(() => {
    setName('');
    setQty('1');
    setPrice('');
    setScope('');
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
    // resetForm/saveToBook reset are unnecessary since the wrapper unmounts
    // this form on collapse, but we keep them in case of in-place reuse.
    resetForm();
    setSaveToBook(false);
    onRequestCollapse();
  }, [isEdit, onExitEdit, onRequestCollapse, resetForm]);

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

    if (isWork) {
      // A lump-sum scope line. quantity 1 and unit 'each' are bookkeeping, not
      // display: they keep totalPrice = quantity × price true, so every
      // existing calculator, adapter and Xero mapper works unchanged. $0 is a
      // legitimate line total ("General preparation — included").
      const workBase: Material = initialMaterial ? { ...initialMaterial } : ({} as Material);
      return {
        ...workBase,
        id: initialMaterial?.id ?? generateId(),
        name: trimmed,
        kind: 'work',
        scope: scope.trim() || undefined,
        quantity: 1,
        unit: 'each',
        price: parsedPrice,
        totalPrice: parsedPrice,
        // Belt and braces on top of the `kind` guards: the pricing pipeline
        // already skips manual overrides, so a work item stays protected even
        // if a future gate is written without knowing about `kind`.
        manualPriceOverride: true,
        pricingSource: 'manual',
        section: initialMaterial ? initialMaterial.section : (sectionName || undefined),
        // Product metadata cannot survive the conversion — a scope line with a
        // Bunnings item number would show a supplier badge and a product link.
        ...(initialMaterial
          ? {
              bunningsItemNumber: undefined,
              reeceItemNumber: undefined,
              reeceUnitOfMeasure: undefined,
              productUrl: undefined,
              imageUrl: undefined,
              favoriteProduct: undefined,
              packSize: undefined,
              packUnit: undefined,
              requiredQty: undefined,
              requiredUnit: undefined,
              templateBaseQuantity: undefined,
              priceConfidence: undefined,
              asPriced: undefined,
            }
          : {}),
      } as Material;
    }

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
      // qty stepper applies. Switching a work item back to a material clears
      // the scope fields so the row stops rendering as one.
      ...(initialMaterial ? { templateBaseQuantity: undefined, kind: undefined, scope: undefined } : {}),
      ...extra,
    } as Material;
  }, [name, qty, price, unit, scope, isWork, sectionName, initialMaterial]);

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
    setScope('');
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
          <MaterialCommunityIcons name={action.icon} size={18} color={themeColors.accentText} />
          <Text style={styles.expandedActionLabel} numberOfLines={1}>{action.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  ) : null;

  const visibleResults = isWork ? [] : search.results.slice(0, 5);
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
      <PillToggle
        value={entryKind}
        onChange={(k) => {
          setEntryKind(k);
          // Drop any supplier results and any picked result — they belong to
          // the other mode, and a stale one reappearing on the way back would
          // attach a product to a scope line.
          selectedResultRef.current = null;
          search.clearResults();
        }}
        options={ENTRY_KIND_OPTIONS}
      />

      <View style={[styles.nameRow, nameError && styles.nameRowError]}>
        <RNTextInput
          ref={nameInputRef}
          style={styles.nameInputInner}
          value={name}
          onChangeText={handleNameChange}
          placeholder={isWork ? 'Work item name' : 'Material name'}
          placeholderTextColor={themeColors.textMuted}
          returnKeyType={isWork ? 'done' : 'search'}
          onSubmitEditing={isWork ? undefined : runFullSearch}
          autoFocus
        />
        {!isWork && (
        <TouchableOpacity
          style={[
            styles.searchIconBtn,
            name.trim() ? styles.searchIconBtnActive : styles.searchIconBtnIdle,
          ]}
          onPress={runFullSearch}
          disabled={!name.trim() || fullSearchActive}
          accessibilityLabel="Search supplier catalogs"
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          {fullSearchActive ? (
            <ActivityIndicator size="small" color={themeColors.onAccent} />
          ) : (
            <MaterialCommunityIcons
              name="magnify"
              size={22}
              color={name.trim() ? '#FFFFFF' : themeColors.accent}
            />
          )}
        </TouchableOpacity>
        )}
      </View>

      {isWork && (
        <RNTextInput
          style={styles.scopeInput}
          value={scope}
          onChangeText={setScope}
          placeholder="Scope of works — what's included"
          placeholderTextColor={themeColors.textMuted}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />
      )}

      {visibleResults.length > 0 && (
        <View style={styles.resultsList}>
          {showCustomTopRow && (
            <TouchableOpacity
              style={[styles.resultRow, styles.resultRowCustom]}
              onPress={handleSave}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="plus-circle-outline" size={18} color={themeColors.accentText} />
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
              {item.imageUrl ? (
                <Image
                  source={{ uri: item.imageUrl }}
                  style={styles.resultRowThumb}
                  resizeMode="contain"
                />
              ) : (
                <View style={styles.resultRowThumbFallback}>
                  <MaterialCommunityIcons
                    name={item.isAiEstimate ? 'robot' : (item.isLocalSource ? 'bookmark-outline' : 'magnify')}
                    size={18}
                    color={themeColors.textMuted}
                  />
                </View>
              )}
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
        {isWork ? (
          // No quantity, no unit — a scope line is one lump sum. The price
          // field is relabelled so it can't be read as a unit rate.
          <Text style={styles.lineTotalLabel}>Line total</Text>
        ) : (
        <>
        <View style={styles.qtyStepper}>
          <Pressable style={({ pressed }) => [styles.qtyBtn, pressed && styles.qtyBtnPressed]} onPress={decrementQty}>
            <MaterialCommunityIcons name="minus" size={14} color={themeColors.text} />
          </Pressable>
          <RNTextInput
            style={styles.qtyInput}
            value={qty}
            onChangeText={setQty}
            keyboardType="decimal-pad"
            selectTextOnFocus
          />
          <Pressable style={({ pressed }) => [styles.qtyBtn, pressed && styles.qtyBtnPressed]} onPress={incrementQty}>
            <MaterialCommunityIcons name="plus" size={14} color={themeColors.text} />
          </Pressable>
        </View>

        <TouchableOpacity style={styles.unitChip} onPress={() => setUnitSheetVisible(true)}>
          <Text style={styles.unitChipText}>{unit}</Text>
          <MaterialCommunityIcons name="chevron-down" size={14} color={themeColors.textMuted} />
        </TouchableOpacity>
        </>
        )}

        <View style={styles.priceWrap}>
          <Text style={styles.priceDollar}>$</Text>
          <RNTextInput
            style={styles.priceInput}
            value={price}
            onChangeText={setPrice}
            placeholder="0.00"
            placeholderTextColor={themeColors.textMuted}
            keyboardType="decimal-pad"
          />
        </View>
      </View>

      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.cancelBtn} onPress={collapse}>
          <MaterialCommunityIcons name="close" size={16} color={themeColors.textMuted} />
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        {!isWork && (
        <TouchableOpacity
          style={[styles.saveToBookChip, saveToBook && styles.saveToBookChipActive]}
          onPress={() => setSaveToBook(v => !v)}
          accessibilityLabel="Also save to supplier book"
          accessibilityState={{ checked: saveToBook }}
        >
          <MaterialCommunityIcons
            name={saveToBook ? 'bookmark-check' : 'bookmark-outline'}
            size={16}
            color={saveToBook ? themeColors.accent : themeColors.textMuted}
          />
          <Text style={[styles.saveToBookText, saveToBook && styles.saveToBookTextActive]} numberOfLines={1}>
            Save to book
          </Text>
        </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
          <MaterialCommunityIcons name="check" size={16} color={themeColors.onAccent} />
          <Text style={styles.saveText}>Save</Text>
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

const useStyles = makeStyles((t) => ({
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
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceRaised,
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
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceRaised,
  },
  expandedActionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.accentText,
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
    borderColor: t.colors.accent,
    borderStyle: 'dashed',
  },
  collapsedText: {
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.accentText,
  },
  expandedCard: {
    flex: 1,
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.colors.border,
    padding: 12,
    gap: 8,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.bg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.colors.border,
    paddingLeft: 10,
    paddingRight: 0,
    overflow: 'hidden',
  },
  nameRowError: {
    borderColor: t.colors.error,
  },
  nameInputInner: {
    flex: 1,
    fontSize: 15,
    color: t.colors.text,
    paddingVertical: 8,
  },
  searchIconBtn: {
    width: 44,
    height: '100%',
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    // Pinned to the right edge of the input — radius only on the right
    // corners so it tucks into the bordered nameRow without floating.
    borderTopRightRadius: 7,
    borderBottomRightRadius: 7,
  },
  // Idle: empty name → faint primary-tinted pill so the button still reads as
  // tappable (just clearly inactive). Active state below takes over once the
  // user types something.
  searchIconBtnIdle: {
    backgroundColor: t.colors.accentSubtle,
  },
  searchIconBtnActive: {
    backgroundColor: t.colors.accent,
  },
  resultsList: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.bg,
    overflow: 'hidden',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.border,
  },
  resultRowThumb: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: t.colors.alwaysLight,
  },
  // Same footprint as the thumbnail so result rows don't shift when some
  // results have images and others (AI estimates / favourites) don't.
  resultRowThumbFallback: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: t.colors.bg,
    borderWidth: 1,
    borderColor: t.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultRowCustom: {
    backgroundColor: t.colors.accentSubtle,
  },
  resultRowTextCustom: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.accentText,
  },
  resultRowBody: {
    flex: 1,
    gap: 2,
  },
  resultRowName: {
    fontSize: 13,
    color: t.colors.text,
  },
  resultRowMeta: {
    fontSize: 11,
    color: t.colors.textMuted,
  },
  resultRowPrice: {
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.text,
  },
  scopeInput: {
    minHeight: 88,
    fontSize: 14,
    lineHeight: 20,
    color: t.colors.text,
    backgroundColor: t.colors.bg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  lineTotalLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.textMuted,
  },
  fieldsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
    transform: [{ scale: 0.92 }],
  },
  qtyInput: {
    fontSize: 14,
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
  unitChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: t.colors.bg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  unitChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.text,
  },
  priceWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.bg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.colors.border,
    paddingHorizontal: 10,
  },
  priceDollar: {
    fontSize: 14,
    color: t.colors.textMuted,
    marginRight: 4,
  },
  priceInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.text,
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
    borderColor: t.colors.border,
    backgroundColor: t.colors.bg,
  },
  cancelText: {
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.textMuted,
  },
  saveToBookChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.bg,
  },
  saveToBookChipActive: {
    borderColor: t.colors.accent,
    backgroundColor: t.colors.accentSubtle,
  },
  saveToBookText: {
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.textMuted,
  },
  saveToBookTextActive: {
    color: t.colors.accentText,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: t.colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.colors.accent,
  },
  saveText: {
    fontSize: 13,
    fontWeight: '700',
    color: t.colors.onAccent,
  },
}));
