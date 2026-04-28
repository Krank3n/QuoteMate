/**
 * Reece Order Modal
 *
 * Lets a connected plumber place an order against their Reece trade account
 * directly from a QuoteMate quote. Shape:
 *   1. On open, build a preview request from the quote's Reece-priced
 *      materials + the user's home branch → call /order-gateway/preview to
 *      get a server-validated total + cartage.
 *   2. User can change pickup vs delivery, branch, and required-by date.
 *      Each change re-fires the preview so totals stay live.
 *   3. Tap "Place order" → backend calls /check then /orders, writes a
 *      ReeceOrder snapshot onto the quote, returns the Reece order number.
 *
 * Reece bills the plumber on their trade account terms — QuoteMate never
 * touches money or fulfilment.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Portal, Modal, Text, Button, ActivityIndicator, Divider, TextInput } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { colors } from '../theme';
import { useStore } from '../store/useStore';
import { ActionSheet, type ActionSheetOption } from './ActionSheet';
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

interface ReeceOrderModalProps {
  visible: boolean;
  onDismiss: () => void;
  /** Materials with reeceItemNumber populated — only these get ordered. */
  materials: Material[];
  /** QuoteMate quote id, so the order is recorded in history. */
  quoteId?: string;
  /** Quote reference (e.g. "Q-001") — surfaced as the Reece order's PO number. */
  quoteReference?: string;
  /** Customer's address from the quote — pre-fills DELIVERY mode if present. */
  jobAddress?: string;
  /** Customer name — fallback if delivery contact name isn't otherwise known. */
  jobContactName?: string;
}

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

export function ReeceOrderModal({
  visible,
  onDismiss,
  materials,
  quoteId,
  quoteReference,
  jobAddress,
  jobContactName,
}: ReeceOrderModalProps) {
  const { businessSettings } = useStore();
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

  // Load connection + branches on open
  useEffect(() => {
    if (!visible) return;
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
  }, [visible, jobAddress]);

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
  // Throttled via a monotonic version counter to discard out-of-order results.
  useEffect(() => {
    if (status.kind === 'loading_branches' || status.kind === 'placing' || status.kind === 'placed') return;
    if (!orderRequest) {
      setStatus({ kind: 'reviewing' });
      setPreviewData(null);
      return;
    }
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
  }, [orderRequest, status.kind]);

  const handlePlace = async () => {
    if (!orderRequest) return;
    setStatus({ kind: 'placing' });
    const result = await placeReeceOrder({ ...orderRequest, quoteId });
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

  const branchOptions: ActionSheetOption[] = useMemo(() => {
    return branches
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((b) => {
        const suburb = [b.address?.suburb, b.address?.state, b.address?.postCode].filter(Boolean).join(' ');
        return {
          label: suburb ? `${b.name} — ${suburb}` : b.name,
          icon: 'store-outline',
          onPress: () => setPickupBranchNumber(b.branchNumber),
        };
      });
  }, [branches]);

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
      <Portal>
        <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.modal}>
          <View style={styles.placedContainer}>
            <MaterialCommunityIcons name="check-circle" size={64} color={colors.success} />
            <Text style={styles.placedTitle}>Order placed</Text>
            <Text style={styles.placedSubtitle}>
              Reece order #{status.reeceOrderNumber}. Reece will email you a confirmation and bill on your trade account.
            </Text>
            <Button mode="contained" buttonColor={colors.primary} onPress={onDismiss} style={styles.placedDoneButton}>
              Done
            </Button>
          </View>
        </Modal>
      </Portal>
    );
  }

  if (status.kind === 'error') {
    return (
      <Portal>
        <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.modal}>
          <View style={styles.placedContainer}>
            <MaterialCommunityIcons name="alert-circle" size={64} color={colors.error} />
            <Text style={styles.placedTitle}>Couldn’t open order</Text>
            <Text style={styles.placedSubtitle}>{status.message}</Text>
            <Button mode="contained" buttonColor={colors.primary} onPress={onDismiss} style={styles.placedDoneButton}>
              Close
            </Button>
          </View>
        </Modal>
      </Portal>
    );
  }

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.modal}>
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
                  label="Postcode"
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
            <Button mode="outlined" onPress={onDismiss} style={{ flex: 1 }}>
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

        <ActionSheet
          visible={branchPickerVisible}
          onDismiss={() => setBranchPickerVisible(false)}
          title="Pickup branch"
          options={branchOptions}
        />

        <ActionSheet
          visible={datePickerVisible}
          onDismiss={() => setDatePickerVisible(false)}
          title="When do you need it?"
          options={dateOptions}
        />
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modal: {
    backgroundColor: colors.surface,
    margin: 16,
    borderRadius: 16,
    maxHeight: '92%',
  },
  body: {
    padding: 20,
    paddingBottom: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
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
  placedContainer: { padding: 28, alignItems: 'center' },
  placedTitle: { fontSize: 20, fontWeight: '700', color: colors.text, marginTop: 14 },
  placedSubtitle: { fontSize: 14, color: colors.textMuted, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  placedDoneButton: { marginTop: 20, alignSelf: 'stretch' },
});
