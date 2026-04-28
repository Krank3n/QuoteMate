/**
 * Reece Order Screen
 *
 * Full-screen view for placing a Reece trade-account order from a QuoteMate
 * quote. Promoted from a modal so the multi-step flow (branch select →
 * preview → confirm) gets full real estate on small devices, native back
 * gesture, and proper safe-area handling. Same internal flow as before:
 *   1. On mount, build a preview from the quote's Reece-priced materials +
 *      home branch → /order-gateway/preview for a server-validated total.
 *   2. User changes pickup/delivery, branch, required-by date — each change
 *      re-fires the preview so totals stay live.
 *   3. Tap "Place order" → backend calls /check then /orders, writes a
 *      ReeceOrder snapshot onto the quote, returns the Reece order number.
 *
 * Reece bills the plumber on their trade account terms — QuoteMate never
 * touches money or fulfilment.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Dimensions, Keyboard } from 'react-native';
import { Text, Button, ActivityIndicator, Divider, TextInput } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute } from '@react-navigation/native';

import { colors } from '../theme';
import { useStore } from '../store/useStore';
import { ActionSheet, type ActionSheetOption } from '../components/ActionSheet';
import { BottomSheet } from '../components/BottomSheet';
import {
  listReeceBranches,
  previewReeceOrder,
  placeReeceOrder,
  getReeceConnectionStatus,
  type ReeceBranch,
  type ReeceFulfillmentInput,
  type ReeceOrderProductInput,
  type ReeceOrderRequestInput,
  type ReeceConnectionStatus,
} from '../services/reeceApi';
import type { Material } from '../types';

type Status =
  | { kind: 'loading_branches' }
  | { kind: 'previewing' }
  | { kind: 'reviewing' }
  | { kind: 'placing' }
  | { kind: 'placed'; reeceOrderNumber: string }
  | { kind: 'error'; message: string };

function isoLocal(d: Date): string {
  // Reece expects yyyy-MM-dd'T'HH:mm:ss with no Z suffix — local-time-ish.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

function shortDateLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

function parseAddress(raw?: string): { addressLine1: string; suburb?: string; state?: string; postCode: string } | null {
  if (!raw) return null;
  // Best-effort parse: assumes "<street>, <suburb> <state> <postcode>" or
  // "<street>, <suburb>, <state> <postcode>" — fall back to dumping the
  // whole string into addressLine1 with a best-guess postcode extract.
  const trimmed = raw.trim();
  const postCodeMatch = trimmed.match(/(\b\d{4}\b)\s*$/);
  const postCode = postCodeMatch ? postCodeMatch[1] : '';
  if (!postCode) return null;
  const withoutPost = trimmed.replace(/\s*\b\d{4}\b\s*$/, '').trim();
  const parts = withoutPost.split(',').map((p) => p.trim()).filter(Boolean);
  const tail = parts[parts.length - 1] || '';
  const stateMatch = tail.match(/\b(VIC|NSW|QLD|SA|WA|TAS|NT|ACT)\b\s*$/i);
  const state = stateMatch ? stateMatch[1].toUpperCase() : undefined;
  const suburbCandidate = state ? tail.replace(/\b(VIC|NSW|QLD|SA|WA|TAS|NT|ACT)\b\s*$/i, '').trim() : tail;
  const addressLine1 = parts.slice(0, parts.length - 1).join(', ') || withoutPost;
  return { addressLine1, suburb: suburbCandidate || undefined, state, postCode };
}

export function ReeceOrderScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const docId: string | undefined = route.params?.docId;

  // Resolve the doc from wherever it currently lives. The wizard writes to
  // currentQuote / currentInvoice; saved jobs read from documents. Try all
  // three so a single docId param works for every entry point.
  const { businessSettings, currentQuote, currentInvoice, documents } = useStore();
  const doc = useMemo(() => {
    if (!docId) return null;
    if (currentQuote?.id === docId) return currentQuote as any;
    if (currentInvoice?.id === docId) return currentInvoice as any;
    return documents.find((d) => d.id === docId) ?? null;
  }, [docId, currentQuote, currentInvoice, documents]);

  const materials: Material[] = doc?.materials ?? [];
  const quoteReference: string | undefined = doc?.quoteNumber || doc?.invoiceNumber;
  const jobAddress: string | undefined = doc?.jobAddress;
  const jobContactName: string | undefined = doc?.customerName;

  const orderableMaterials = useMemo(
    () => materials.filter((m) => !!m.reeceItemNumber && !!m.reeceUnitOfMeasure && m.quantity > 0 && m.price > 0),
    [materials],
  );

  const [status, setStatus] = useState<Status>({ kind: 'loading_branches' });
  const [connection, setConnection] = useState<ReeceConnectionStatus | null>(null);
  const [branches, setBranches] = useState<ReeceBranch[]>([]);
  const [fulfillmentMode, setFulfillmentMode] = useState<'PICKUP' | 'DELIVERY'>('PICKUP');
  const [pickupBranchNumber, setPickupBranchNumber] = useState<string | null>(null);
  const [deliveryAddressLine, setDeliveryAddressLine] = useState('');
  const [deliveryPostCode, setDeliveryPostCode] = useState('');
  const [deliverySuburb, setDeliverySuburb] = useState('');
  const [deliveryState, setDeliveryState] = useState('');
  const [deliveryContactName, setDeliveryContactName] = useState(jobContactName || '');
  const [requiredByIso, setRequiredByIso] = useState(() => isoLocal(addDays(new Date(), 1)));
  const [comment, setComment] = useState('');
  const [previewData, setPreviewData] = useState<any | null>(null);
  const [violations, setViolations] = useState<string[]>([]);
  const [branchPickerVisible, setBranchPickerVisible] = useState(false);
  const [datePickerVisible, setDatePickerVisible] = useState(false);

  // Throttled preview refetch — avoid spamming the API as the user toggles.
  const previewVersionRef = useRef(0);

  // Load connection + branches on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus({ kind: 'loading_branches' });
      setViolations([]);
      const [conn, b] = await Promise.all([getReeceConnectionStatus(), listReeceBranches()]);
      if (cancelled) return;
      setConnection(conn);
      setBranches(b.branches || []);
      if (b.notConnected || conn.connected !== true) {
        setStatus({ kind: 'error', message: 'Reece is not connected. Connect it from Settings first.' });
        return;
      }
      if (b.reauthRequired) {
        setStatus({ kind: 'error', message: 'Your Reece sign-in expired. Reconnect Reece from Settings.' });
        return;
      }
      // Default to home branch
      if (conn.homeBranchNumber) {
        setPickupBranchNumber(conn.homeBranchNumber);
      } else if (b.branches && b.branches.length > 0) {
        setPickupBranchNumber(b.branches[0].branchNumber);
      }
      // Default delivery fields from quote address
      const parsed = parseAddress(jobAddress);
      if (parsed) {
        setDeliveryAddressLine(parsed.addressLine1);
        setDeliveryPostCode(parsed.postCode);
        if (parsed.suburb) setDeliverySuburb(parsed.suburb);
        if (parsed.state) setDeliveryState(parsed.state);
      }
      setStatus({ kind: 'previewing' });
    })();
    return () => {
      cancelled = true;
    };
  }, [jobAddress]);

  // Build the ReeceOrderRequest from current state
  const orderRequest: ReeceOrderRequestInput | null = useMemo(() => {
    if (orderableMaterials.length === 0) return null;
    if (!businessSettings?.businessName) return null;

    const products: ReeceOrderProductInput[] = orderableMaterials.map((m) => ({
      productId: Number(m.reeceItemNumber),
      quantity: m.quantity,
      unitOfMeasure: m.reeceUnitOfMeasure!,
      // The price in the Material is GST-inclusive in some flows but Reece
      // wants ex-GST. Materials priced via Reece API are stored as the price
      // returned by the price endpoint (which can be either inc or ex). We
      // approximate ex-GST by dividing by 1.1 — the spec says GST is fixed
      // at 10% in AU. Refining later by tracking which side of GST the
      // stored price is on.
      unitPriceExcludingGst: Math.round((m.price / 1.1) * 100) / 100,
    }));

    let fulfillment: ReeceFulfillmentInput;
    if (fulfillmentMode === 'PICKUP') {
      if (!pickupBranchNumber) return null;
      fulfillment = { type: 'PICKUP', pickupBranch: pickupBranchNumber };
    } else {
      if (!deliveryAddressLine || !deliveryPostCode || !deliveryContactName) return null;
      fulfillment = {
        type: 'DELIVERY',
        deliveryDetails: {
          contactName: deliveryContactName,
          deliveryAddress: {
            addressLine1: deliveryAddressLine,
            postCode: deliveryPostCode,
            suburb: deliverySuburb || undefined,
            state: deliveryState || undefined,
          },
        },
      };
    }

    return {
      orderByName: businessSettings.businessName,
      orderByPhone: businessSettings.phone || undefined,
      orderByEmail: businessSettings.email || undefined,
      requiredByDateTime: requiredByIso,
      fulfillment,
      products,
      orderNumber: quoteReference || undefined,
      comment: comment || undefined,
    };
  }, [
    orderableMaterials,
    businessSettings?.businessName,
    businessSettings?.phone,
    businessSettings?.email,
    fulfillmentMode,
    pickupBranchNumber,
    deliveryAddressLine,
    deliveryPostCode,
    deliverySuburb,
    deliveryState,
    deliveryContactName,
    requiredByIso,
    quoteReference,
    comment,
  ]);

  // Re-fetch the preview whenever any input that affects pricing changes.
  // Stale results are discarded via a monotonic version counter. Crucially,
  // status.kind is NOT in the dep array — the effect itself transitions
  // status (previewing → reviewing), so including it would self-trigger an
  // infinite loop and burn through Reece's rate limit (the 429 you saw).
  // A 300ms debounce smooths rapid input toggles (mode/branch/date).
  useEffect(() => {
    if (status.kind === 'loading_branches' || status.kind === 'placing' || status.kind === 'placed') return;
    if (!orderRequest) {
      setStatus({ kind: 'reviewing' });
      setPreviewData(null);
      return;
    }
    // 120ms is enough to coalesce rapid input toggles (e.g. typing in the
    // postcode field) without making explicit selections feel laggy.
    const debounce = setTimeout(() => {
      const myVersion = ++previewVersionRef.current;
      setStatus({ kind: 'previewing' });
      (async () => {
        const result = await previewReeceOrder(orderRequest);
        if (myVersion !== previewVersionRef.current) return; // stale
        if (result.reauthRequired) {
          setStatus({ kind: 'error', message: 'Your Reece sign-in expired. Reconnect Reece from Settings.' });
          return;
        }
        if (result.notConnected) {
          setStatus({ kind: 'error', message: 'Reece is not connected. Connect it from Settings first.' });
          return;
        }
        if (result.violations) {
          setViolations(result.violations.map((v) => `${v.fieldName}: ${v.message}`));
          setPreviewData(null);
        } else if (result.errors) {
          setViolations(result.errors.map((e) => e.message));
          setPreviewData(null);
        } else {
          setViolations([]);
          setPreviewData(result.preview);
        }
        setStatus({ kind: 'reviewing' });
      })();
    }, 120);
    return () => clearTimeout(debounce);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderRequest]);

  const handleClose = () => navigation.goBack();

  const handlePlace = async () => {
    if (!orderRequest) return;
    setStatus({ kind: 'placing' });
    const result = await placeReeceOrder({ ...orderRequest, quoteId: docId });
    if (result.reeceOrderNumber) {
      setStatus({ kind: 'placed', reeceOrderNumber: result.reeceOrderNumber });
    } else if (result.violations) {
      setViolations(result.violations.map((v) => `${v.fieldName}: ${v.message}`));
      setStatus({ kind: 'reviewing' });
    } else if (result.errors) {
      setViolations(result.errors.map((e) => e.message));
      setStatus({ kind: 'reviewing' });
    } else {
      setStatus({ kind: 'error', message: 'Could not place the order. Please try again.' });
    }
  };

  const dateOptions: ActionSheetOption[] = useMemo(() => {
    const today = new Date();
    return [
      { days: 1, label: 'Tomorrow' },
      { days: 2, label: 'In 2 days' },
      { days: 3, label: 'In 3 days' },
      { days: 7, label: 'In a week' },
      { days: 14, label: 'In 2 weeks' },
    ].map(({ days, label }) => {
      const d = addDays(today, days);
      const dateStr = d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
      return {
        label: `${label} — ${dateStr}`,
        icon: 'calendar',
        onPress: () => setRequiredByIso(isoLocal(d)),
      };
    });
  }, []);

  const selectedBranch = useMemo(
    () => branches.find((b) => b.branchNumber === pickupBranchNumber) || null,
    [branches, pickupBranchNumber],
  );

  // ----- Render --------------------------------------------------------

  const renderHeader = () => (
    <View style={styles.headerRow}>
      <MaterialCommunityIcons name="pipe" size={26} color={colors.primary} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={styles.title}>Order from Reece</Text>
        {connection?.displayName ? (
          <Text style={styles.subtitle}>{connection.displayName}</Text>
        ) : null}
      </View>
    </View>
  );

  const renderViolations = () =>
    violations.length > 0 ? (
      <View style={styles.violationsBox}>
        <MaterialCommunityIcons name="alert-circle-outline" size={18} color={colors.error} />
        <View style={{ flex: 1, marginLeft: 8 }}>
          {violations.map((v, i) => (
            <Text key={i} style={styles.violationText}>{v}</Text>
          ))}
        </View>
      </View>
    ) : null;

  if (status.kind === 'placed') {
    return (
      <View style={styles.screen}>
        <View style={styles.placedContainer}>
          <MaterialCommunityIcons name="check-circle" size={64} color={colors.success} />
          <Text style={styles.placedTitle}>Order placed</Text>
          <Text style={styles.placedSubtitle}>
            Reece order #{status.reeceOrderNumber}. Reece will email you a confirmation and bill on your trade account.
          </Text>
          <Button mode="contained" buttonColor={colors.primary} onPress={handleClose} style={styles.placedDoneButton}>
            Done
          </Button>
        </View>
      </View>
    );
  }

  if (status.kind === 'error') {
    return (
      <View style={styles.screen}>
        <View style={styles.placedContainer}>
          <MaterialCommunityIcons name="alert-circle" size={64} color={colors.error} />
          <Text style={styles.placedTitle}>Couldn’t open order</Text>
          <Text style={styles.placedSubtitle}>{status.message}</Text>
          <Button mode="contained" buttonColor={colors.primary} onPress={handleClose} style={styles.placedDoneButton}>
            Close
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {renderHeader()}

        {/* Fulfilment mode toggle */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Fulfilment</Text>
          <View style={styles.modeRow}>
            {(['PICKUP', 'DELIVERY'] as const).map((mode) => {
              const selected = fulfillmentMode === mode;
              return (
                <Button
                  key={mode}
                  mode={selected ? 'contained' : 'outlined'}
                  onPress={() => setFulfillmentMode(mode)}
                  style={styles.modeButton}
                  buttonColor={selected ? colors.primary : undefined}
                  icon={mode === 'PICKUP' ? 'storefront-outline' : 'truck-outline'}
                >
                  {mode === 'PICKUP' ? 'Pickup' : 'Delivery'}
                </Button>
              );
            })}
          </View>
        </View>

        {/* Pickup branch picker */}
        {fulfillmentMode === 'PICKUP' ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Pickup branch</Text>
            <Button
              mode="outlined"
              onPress={() => setBranchPickerVisible(true)}
              icon="store-outline"
              contentStyle={{ justifyContent: 'flex-start' }}
              style={styles.pickerButton}
            >
              {selectedBranch ? selectedBranch.name : 'Choose a branch'}
            </Button>
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Delivery</Text>
            <TextInput
              label="Contact name"
              value={deliveryContactName}
              onChangeText={setDeliveryContactName}
              mode="outlined"
              style={styles.input}
            />
            <TextInput
              label="Address line"
              value={deliveryAddressLine}
              onChangeText={setDeliveryAddressLine}
              mode="outlined"
              style={styles.input}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                label="Suburb"
                value={deliverySuburb}
                onChangeText={setDeliverySuburb}
                mode="outlined"
                style={[styles.input, { flex: 2 }]}
              />
              <TextInput
                label="State"
                value={deliveryState}
                onChangeText={setDeliveryState}
                mode="outlined"
                style={[styles.input, { flex: 1 }]}
              />
              <TextInput
                label="P/code"
                value={deliveryPostCode}
                onChangeText={setDeliveryPostCode}
                mode="outlined"
                keyboardType="number-pad"
                style={[styles.input, { flex: 1 }]}
              />
            </View>
          </View>
        )}

        {/* Required-by date */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Required by</Text>
          <Button
            mode="outlined"
            onPress={() => setDatePickerVisible(true)}
            icon="calendar"
            contentStyle={{ justifyContent: 'flex-start' }}
            style={styles.pickerButton}
          >
            {shortDateLabel(requiredByIso)}
          </Button>
        </View>

        {/* Reference / comment */}
        <View style={styles.section}>
          <TextInput
            label="Reference (optional)"
            value={quoteReference || ''}
            mode="outlined"
            style={styles.input}
            disabled
          />
          <TextInput
            label="Note for branch staff (optional)"
            value={comment}
            onChangeText={setComment}
            mode="outlined"
            multiline
            numberOfLines={2}
            style={styles.input}
          />
        </View>

        <Divider style={styles.divider} />

        {/* Line items */}
        <Text style={styles.sectionLabel}>Items ({orderableMaterials.length})</Text>
        {orderableMaterials.length === 0 ? (
          <Text style={styles.emptyHint}>
            No Reece-priced materials in this quote. Tap “Fetch prices” with Reece selected as your store, then come back.
          </Text>
        ) : (
          orderableMaterials.map((m) => (
            <View key={m.id} style={styles.lineRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lineName} numberOfLines={2}>{m.name}</Text>
                <Text style={styles.lineMeta}>
                  {m.quantity} × {m.reeceUnitOfMeasure || m.unit} · ${m.price.toFixed(2)}
                </Text>
              </View>
              <Text style={styles.lineTotal}>${(m.quantity * m.price).toFixed(2)}</Text>
            </View>
          ))
        )}

        {/* Totals from preview */}
        {previewData ? (
          <View style={styles.totalsBox}>
            {Number(previewData.cartageFee || 0) > 0 ? (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Cartage</Text>
                <Text style={styles.totalValue}>${Number(previewData.cartageFee).toFixed(2)}</Text>
              </View>
            ) : null}
            {previewData.totalExcludingGst != null ? (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Subtotal (ex GST)</Text>
                <Text style={styles.totalValue}>${Number(previewData.totalExcludingGst).toFixed(2)}</Text>
              </View>
            ) : null}
            {previewData.totalIncludingGst != null ? (
              <View style={styles.totalRow}>
                <Text style={[styles.totalLabel, styles.totalLabelStrong]}>Total (inc GST)</Text>
                <Text style={[styles.totalValue, styles.totalValueStrong]}>
                  ${Number(previewData.totalIncludingGst).toFixed(2)}
                </Text>
              </View>
            ) : null}
          </View>
        ) : status.kind === 'previewing' ? (
          <View style={styles.previewingBox}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.previewingText}>Refreshing total from Reece...</Text>
          </View>
        ) : null}

        {renderViolations()}

        {/* Actions */}
        <View style={styles.actionsRow}>
          <Button mode="outlined" onPress={handleClose} style={{ flex: 1 }}>
            Cancel
          </Button>
          <Button
            mode="contained"
            buttonColor={colors.primary}
            onPress={handlePlace}
            loading={status.kind === 'placing'}
            disabled={
              status.kind === 'placing' ||
              status.kind === 'previewing' ||
              !orderRequest ||
              violations.length > 0 ||
              orderableMaterials.length === 0
            }
            style={{ flex: 2 }}
          >
            Place order with Reece
          </Button>
        </View>
      </ScrollView>

      <BranchPicker
        visible={branchPickerVisible}
        onDismiss={() => setBranchPickerVisible(false)}
        branches={branches}
        loading={status.kind === 'loading_branches'}
        selectedBranchNumber={pickupBranchNumber}
        homeBranchNumber={connection?.homeBranchNumber || null}
        onSelect={setPickupBranchNumber}
      />

      <ActionSheet
        visible={datePickerVisible}
        onDismiss={() => setDatePickerVisible(false)}
        title="When do you need it?"
        options={dateOptions}
      />
    </View>
  );
}

/**
 * Searchable branch picker as a bottom sheet. Reece has hundreds of
 * branches Australia-wide; a flat ActionSheet list isn't usable. Shows the
 * user's home branch pinned to the top, then alpha-sorted branches, with a
 * search box that matches against name + suburb + state + postcode. Shows
 * a centered spinner while branches are still loading from Reece.
 */
function BranchPicker({
  visible,
  onDismiss,
  branches,
  loading,
  selectedBranchNumber,
  homeBranchNumber,
  onSelect,
}: {
  visible: boolean;
  onDismiss: () => void;
  branches: ReeceBranch[];
  loading: boolean;
  selectedBranchNumber: string | null;
  homeBranchNumber: string | null;
  onSelect: (branchNumber: string) => void;
}) {
  const [query, setQuery] = useState('');

  // Reset search when sheet opens — feels stale otherwise on second open.
  useEffect(() => {
    if (visible) setQuery('');
  }, [visible]);

  const filtered = useMemo(() => {
    const sorted = [...branches].sort((a, b) => {
      if (a.branchNumber === homeBranchNumber) return -1;
      if (b.branchNumber === homeBranchNumber) return 1;
      return a.name.localeCompare(b.name);
    });
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((b) => {
      const bag = `${b.name} ${b.address?.suburb ?? ''} ${b.address?.state ?? ''} ${b.address?.postCode ?? ''}`.toLowerCase();
      return bag.includes(q);
    });
  }, [branches, query, homeBranchNumber]);

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      title="Pickup branch"
      scrollable={false}
      maxHeightRatio={0.85}
      footer={
        <View style={branchPickerStyles.footerWrap}>
          <Button mode="outlined" onPress={onDismiss}>
            Cancel
          </Button>
        </View>
      }
    >
      <TextInput
        mode="outlined"
        placeholder="Search by name, suburb, or postcode"
        value={query}
        onChangeText={setQuery}
        left={<TextInput.Icon icon="magnify" />}
        style={branchPickerStyles.search}
        editable={!loading}
      />
      {loading ? (
        <View style={branchPickerStyles.loadingWrap}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={branchPickerStyles.loadingText}>Loading branches…</Text>
        </View>
      ) : filtered.length === 0 ? (
        <Text style={branchPickerStyles.empty}>
          {branches.length === 0 ? 'No branches available.' : 'No branches match.'}
        </Text>
      ) : (
        <ScrollView style={branchPickerStyles.list} keyboardShouldPersistTaps="handled">
          {filtered.map((b) => {
            const suburb = [b.address?.suburb, b.address?.state, b.address?.postCode].filter(Boolean).join(' ');
            const isSelected = b.branchNumber === selectedBranchNumber;
            const isHome = b.branchNumber === homeBranchNumber;
            return (
              <TouchableOpacity
                key={b.branchNumber}
                onPress={() => {
                  // Dismiss the keyboard before everything else so its
                  // animation doesn't stack on top of the sheet-close
                  // animation. Without this, the user sees a ~500ms gap
                  // between tap and the sheet visibly closing.
                  Keyboard.dismiss();
                  onSelect(b.branchNumber);
                  onDismiss();
                }}
                style={[branchPickerStyles.row, isSelected && branchPickerStyles.rowSelected]}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <View style={branchPickerStyles.rowHeader}>
                    <Text style={branchPickerStyles.rowName}>{b.name}</Text>
                    {isHome ? <Text style={branchPickerStyles.homeChip}>Home</Text> : null}
                  </View>
                  {suburb ? <Text style={branchPickerStyles.rowMeta}>{suburb}</Text> : null}
                </View>
                {isSelected ? (
                  <MaterialCommunityIcons name="check" size={20} color={colors.primary} />
                ) : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  body: {
    padding: 20,
    paddingBottom: 32,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  section: { marginBottom: 14 },
  sectionLabel: { fontSize: 13, color: colors.textMuted, marginBottom: 6, fontWeight: '600' },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeButton: { flex: 1 },
  pickerButton: { borderColor: colors.border },
  input: { marginBottom: 8, backgroundColor: colors.surface },
  divider: { marginVertical: 12, backgroundColor: colors.border },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  lineName: { fontSize: 14, color: colors.text, fontWeight: '500' },
  lineMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  lineTotal: { fontSize: 14, color: colors.text, fontWeight: '600', marginLeft: 12 },
  emptyHint: { fontSize: 13, color: colors.textMuted, lineHeight: 18, fontStyle: 'italic' },
  totalsBox: { marginTop: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  totalLabel: { fontSize: 13, color: colors.textMuted },
  totalLabelStrong: { fontSize: 14, color: colors.text, fontWeight: '700' },
  totalValue: { fontSize: 13, color: colors.text },
  totalValueStrong: { fontSize: 16, color: colors.text, fontWeight: '700' },
  previewingBox: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  previewingText: { marginLeft: 8, fontSize: 12, color: colors.textMuted },
  violationsBox: {
    flexDirection: 'row',
    backgroundColor: colors.error + '15',
    borderRadius: 8,
    padding: 10,
    marginTop: 12,
  },
  violationText: { fontSize: 12, color: colors.error, lineHeight: 16 },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 18 },
  placedContainer: {
    flex: 1,
    padding: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placedTitle: { fontSize: 22, fontWeight: '700', color: colors.text, marginTop: 14 },
  placedSubtitle: { fontSize: 14, color: colors.textMuted, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  placedDoneButton: { marginTop: 24, alignSelf: 'stretch' },
});

// BottomSheet's content area takes its natural size in non-scrollable mode,
// so a long branch list would push the footer past the sheet's maxHeight
// cap (and get clipped by overflow:'hidden'). Bounding the list to ~half
// the screen leaves room for handle + title + search + footer + safe area.
const SCREEN_HEIGHT = Dimensions.get('window').height;

const branchPickerStyles = StyleSheet.create({
  search: {
    backgroundColor: colors.surface,
    marginBottom: 8,
  },
  list: {
    maxHeight: SCREEN_HEIGHT * 0.5,
  },
  loadingWrap: {
    paddingVertical: 32,
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  empty: {
    fontSize: 13,
    color: colors.textMuted,
    fontStyle: 'italic',
    paddingVertical: 24,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowSelected: {
    backgroundColor: colors.primaryBg,
    borderRadius: 8,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    flexShrink: 1,
  },
  rowMeta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  homeChip: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.primary,
    backgroundColor: colors.primaryBg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  footerWrap: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
});
