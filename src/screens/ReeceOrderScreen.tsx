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
import { View, StyleSheet, ScrollView, TouchableOpacity, Dimensions, Keyboard, Platform, Pressable } from 'react-native';
import { Text, Button, ActivityIndicator, TextInput } from 'react-native-paper';
import { Calendar, DateData } from 'react-native-calendars';
import { format } from 'date-fns';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../theme';
import { useStore } from '../store/useStore';
import { BottomSheet } from '../components/BottomSheet';
import { WebContainer } from '../components/WebContainer';
import { FooterButton } from '../components/FooterButton';
import { PillToggle } from '../components/PillToggle';
import { AddressSearchInput } from '../components/AddressSearchInput';
import type { PlacesAddressDetails } from '../services/placesApi';
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

// Calendar theme — matches DueDateSheet / ScheduleJobSheet so the date
// picker on this screen feels like the rest of the app.
const CALENDAR_THEME = {
  backgroundColor: 'transparent',
  calendarBackground: 'transparent',
  textSectionTitleColor: colors.textMuted,
  dayTextColor: colors.text,
  todayTextColor: colors.primary,
  selectedDayTextColor: colors.white,
  selectedDayBackgroundColor: colors.primary,
  monthTextColor: colors.text,
  arrowColor: colors.primary,
  textDisabledColor: colors.inactive,
  textMonthFontWeight: '700' as const,
  textDayFontWeight: '500' as const,
  textDayHeaderFontWeight: '600' as const,
  textMonthFontSize: 15,
  textDayFontSize: 13,
  textDayHeaderFontSize: 11,
};

function isoDayFromIsoLocal(iso: string): string {
  // requiredByIso is "yyyy-MM-ddTHH:mm:ss" — strip the time portion to
  // produce the "yyyy-MM-dd" key Calendar uses for selection.
  return iso.slice(0, 10);
}

function dateFromIsoDay(isoDay: string): Date {
  // Anchor at noon local time — avoids edge cases where DST or "T00:00:00"
  // can roll the day backward in some timezones, and gives Reece a
  // sensible time-of-day for "needed by".
  return new Date(`${isoDay}T12:00:00`);
}

function todayIsoDay(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function formatViolation(v: { fieldName: string; message: string }): string {
  // Reece's address validator reports "postcode is mandatory" / "Address
  // Validation Error" against the deliveryAddress field even when the real
  // issue is that suburb/state/postcode don't form a recognised AU address.
  // Surface a hint the tradie can actually act on.
  const isAddrField = /deliveryAddress/i.test(v.fieldName);
  const looksLikeAddrValidation =
    /postcode/i.test(v.message) || /address validation/i.test(v.message);
  if (isAddrField && looksLikeAddrValidation) {
    return "Reece couldn't validate this address. Check that the address line, suburb, state, and postcode all match a real Australian address.";
  }
  return `${v.fieldName}: ${v.message}`;
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
  const insets = useSafeAreaInsets();
  const docId: string | undefined = route.params?.docId;

  // Resolve the doc from wherever it currently lives. The wizard writes to
  // currentQuote / currentInvoice; saved jobs read from documents. Try all
  // three so a single docId param works for every entry point.
  const businessSettings = useStore((s) => s.businessSettings);
  const currentQuote = useStore((s) => s.currentQuote);
  const currentInvoice = useStore((s) => s.currentInvoice);
  const documents = useStore((s) => s.documents);
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
  // Display string for the "selected" card. Empty = no address picked yet.
  const [selectedFormattedAddress, setSelectedFormattedAddress] = useState('');
  // True = user has dropped the search and is editing the four fields by hand.
  const [addressManual, setAddressManual] = useState(false);
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
      // Default delivery fields from the quote's job address. Only seed the
      // "selected" card if the parse yielded a complete address — partial
      // parses (no suburb / state) would just fail Reece validation, so let
      // the user search instead.
      const parsed = parseAddress(jobAddress);
      if (parsed && parsed.suburb && parsed.state && parsed.postCode) {
        setDeliveryAddressLine(parsed.addressLine1);
        setDeliverySuburb(parsed.suburb);
        setDeliveryState(parsed.state);
        setDeliveryPostCode(parsed.postCode);
        setSelectedFormattedAddress(jobAddress || '');
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
      // Reece's address validator needs the full triple — suburb + state +
      // postcode — to match against AU Post records, not just postcode alone.
      if (
        !deliveryAddressLine ||
        !deliverySuburb ||
        !deliveryState ||
        !deliveryPostCode ||
        !deliveryContactName
      ) {
        return null;
      }
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
          setViolations(result.violations.map(formatViolation));
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
      setViolations(result.violations.map(formatViolation));
      setStatus({ kind: 'reviewing' });
    } else if (result.errors) {
      setViolations(result.errors.map((e) => e.message));
      setStatus({ kind: 'reviewing' });
    } else {
      setStatus({ kind: 'error', message: 'Could not place the order. Please try again.' });
    }
  };

  // Quick-pick chips at the top of the date sheet — most Reece orders are
  // "tomorrow" or "this week", so a single tap should cover the common case.
  const quickPicks = useMemo(() => {
    const today = new Date();
    return [
      { days: 1, label: 'Tomorrow' },
      { days: 2, label: '+2 days' },
      { days: 7, label: 'In a week' },
      { days: 14, label: 'In 2 weeks' },
    ].map(({ days, label }) => ({
      label,
      sublabel: addDays(today, days).toLocaleDateString('en-AU', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }),
      isoDay: format(addDays(today, days), 'yyyy-MM-dd'),
    }));
  }, []);

  const selectedIsoDay = isoDayFromIsoLocal(requiredByIso);

  const requiredDateMarked = useMemo(
    () => ({
      [selectedIsoDay]: {
        selected: true,
        selectedColor: colors.primary,
        selectedTextColor: colors.white,
      },
    }),
    [selectedIsoDay],
  );

  const handlePickIsoDay = (isoDay: string) => {
    setRequiredByIso(isoLocal(dateFromIsoDay(isoDay)));
    setDatePickerVisible(false);
  };

  const selectedBranch = useMemo(
    () => branches.find((b) => b.branchNumber === pickupBranchNumber) || null,
    [branches, pickupBranchNumber],
  );

  // ----- Render --------------------------------------------------------

  const renderHeader = () => (
    <View style={styles.headerCard}>
      <View style={styles.reeceIconWrap}>
        <MaterialCommunityIcons name="pipe" size={28} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Order from Reece</Text>
        {connection?.displayName ? (
          <Text style={styles.subtitle}>{connection.displayName}</Text>
        ) : (
          <Text style={styles.subtitle}>Bills to your trade account</Text>
        )}
      </View>
    </View>
  );

  const renderCardHeader = (icon: string, title: string, trailing?: React.ReactNode) => (
    <View style={styles.cardHeader}>
      <MaterialCommunityIcons name={icon as any} size={18} color={colors.primary} />
      <Text style={styles.cardTitle}>{title}</Text>
      {trailing ? <View style={styles.cardHeaderTrailing}>{trailing}</View> : null}
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
        <WebContainer style={styles.flexFill}>
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
        </WebContainer>
      </View>
    );
  }

  if (status.kind === 'error') {
    return (
      <View style={styles.screen}>
        <WebContainer style={styles.flexFill}>
          <View style={styles.placedContainer}>
            <MaterialCommunityIcons name="alert-circle" size={64} color={colors.error} />
            <Text style={styles.placedTitle}>Couldn’t open order</Text>
            <Text style={styles.placedSubtitle}>{status.message}</Text>
            <Button mode="contained" buttonColor={colors.primary} onPress={handleClose} style={styles.placedDoneButton}>
              Close
            </Button>
          </View>
        </WebContainer>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <WebContainer>
        {renderHeader()}

        {/* Delivery & timing card */}
        <View style={styles.card}>
          {renderCardHeader('truck-delivery-outline', 'Delivery & timing')}

          <Text style={styles.fieldLabel}>Fulfilment</Text>
          <PillToggle<'PICKUP' | 'DELIVERY'>
            value={fulfillmentMode}
            onChange={setFulfillmentMode}
            options={[
              { value: 'PICKUP', label: 'Pickup', icon: 'storefront-outline' },
              { value: 'DELIVERY', label: 'Delivery', icon: 'truck-outline' },
            ]}
            fullWidth
          />

          {fulfillmentMode === 'PICKUP' ? (
            <View style={styles.cardSubsection}>
              <Text style={styles.fieldLabel}>Pickup branch</Text>
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
            <View style={styles.cardSubsection}>
              <Text style={styles.fieldLabel}>Delivery details</Text>
              <TextInput
                label="Contact name"
                value={deliveryContactName}
                onChangeText={setDeliveryContactName}
                mode="outlined"
                style={styles.input}
              />

              {addressManual ? (
                <>
                  <Text style={styles.deliveryHint}>
                    All fields required — Reece checks the address against
                    Australia Post records.
                  </Text>
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
                  <TouchableOpacity
                    onPress={() => {
                      setAddressManual(false);
                      setDeliveryAddressLine('');
                      setDeliverySuburb('');
                      setDeliveryState('');
                      setDeliveryPostCode('');
                      setSelectedFormattedAddress('');
                    }}
                    style={styles.addressLinkRow}
                  >
                    <MaterialCommunityIcons name="magnify" size={16} color={colors.primary} />
                    <Text style={styles.addressLinkText}>Use address search instead</Text>
                  </TouchableOpacity>
                </>
              ) : selectedFormattedAddress ? (
                <View style={styles.selectedAddressCard}>
                  <MaterialCommunityIcons name="map-marker-check" size={20} color={colors.success} />
                  <Text style={styles.selectedAddressText} numberOfLines={2}>
                    {selectedFormattedAddress}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      setSelectedFormattedAddress('');
                      setDeliveryAddressLine('');
                      setDeliverySuburb('');
                      setDeliveryState('');
                      setDeliveryPostCode('');
                    }}
                    hitSlop={8}
                  >
                    <Text style={styles.addressLinkText}>Change</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <AddressSearchInput
                    onAddressSelect={(addr: PlacesAddressDetails) => {
                      setDeliveryAddressLine(addr.addressLine1);
                      setDeliverySuburb(addr.suburb);
                      setDeliveryState(addr.state);
                      setDeliveryPostCode(addr.postCode);
                      setSelectedFormattedAddress(addr.formattedAddress);
                    }}
                    style={styles.input}
                  />
                  <TouchableOpacity
                    onPress={() => setAddressManual(true)}
                    style={styles.addressLinkRow}
                  >
                    <MaterialCommunityIcons name="pencil-outline" size={16} color={colors.primary} />
                    <Text style={styles.addressLinkText}>Can't find it? Enter manually</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          <View style={styles.cardSubsection}>
            <Text style={styles.fieldLabel}>Required by</Text>
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
        </View>

        {/* Reference & notes card */}
        <View style={styles.card}>
          {renderCardHeader('text-box-outline', 'Reference & notes')}
          <TextInput
            label="Reference"
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

        {/* Items + totals card */}
        <View style={styles.card}>
          {renderCardHeader(
            'package-variant-closed',
            'Items',
            orderableMaterials.length > 0 ? (
              <View style={styles.countChip}>
                <Text style={styles.countChipText}>{orderableMaterials.length}</Text>
              </View>
            ) : null,
          )}

          {orderableMaterials.length === 0 ? (
            <Text style={styles.emptyHint}>
              No Reece-priced materials in this quote. Tap “Fetch prices” with Reece selected as your store, then come back.
            </Text>
          ) : (
            orderableMaterials.map((m, idx) => (
              <View
                key={m.id}
                style={[
                  styles.lineRow,
                  idx === orderableMaterials.length - 1 && styles.lineRowLast,
                ]}
              >
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
                <View style={[styles.totalRow, styles.totalRowGrand]}>
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
        </View>

        {renderViolations()}
        </WebContainer>
      </ScrollView>

      {/* Fixed footer — same shape + spacing as the wizard footers and the
          ViewJob sticky bar. Cancel sits on the left, Place order on the
          right with the heavier flex weight to match the primary action. */}
      <View style={[styles.footerBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.footerRow}>
          <FooterButton
            mode="outlined"
            label="Cancel"
            onPress={handleClose}
            style={{ flex: 1 }}
          />
          <FooterButton
            mode="contained"
            label="Place order with Reece"
            onPress={handlePlace}
            loading={status.kind === 'placing'}
            disabled={
              status.kind === 'placing' ||
              status.kind === 'previewing' ||
              !orderRequest ||
              violations.length > 0 ||
              orderableMaterials.length === 0
            }
            style={{ flex: 1 }}
          />
        </View>
      </View>

      <BranchPicker
        visible={branchPickerVisible}
        onDismiss={() => setBranchPickerVisible(false)}
        branches={branches}
        loading={status.kind === 'loading_branches'}
        selectedBranchNumber={pickupBranchNumber}
        homeBranchNumber={connection?.homeBranchNumber || null}
        onSelect={setPickupBranchNumber}
      />

      <BottomSheet
        visible={datePickerVisible}
        onDismiss={() => setDatePickerVisible(false)}
        title="When do you need it?"
        scrollable
        maxHeightRatio={0.9}
      >
        <View style={dateSheetStyles.content}>
          {/* Selected-date summary pill — same pattern as ScheduleJobSheet */}
          <View style={dateSheetStyles.summaryPill}>
            <MaterialCommunityIcons
              name={'calendar-clock' as any}
              size={16}
              color={colors.primary}
            />
            <Text style={dateSheetStyles.summaryText}>
              {shortDateLabel(requiredByIso)}
            </Text>
          </View>

          {/* Quick-pick chips */}
          <View style={dateSheetStyles.chipsRow}>
            {quickPicks.map((q) => {
              const selected = q.isoDay === selectedIsoDay;
              return (
                <Pressable
                  key={q.label}
                  onPress={() => handlePickIsoDay(q.isoDay)}
                  style={({ pressed }) => [
                    dateSheetStyles.chip,
                    selected && dateSheetStyles.chipSelected,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text
                    style={[
                      dateSheetStyles.chipLabel,
                      selected && dateSheetStyles.chipLabelSelected,
                    ]}
                  >
                    {q.label}
                  </Text>
                  <Text
                    style={[
                      dateSheetStyles.chipSublabel,
                      selected && dateSheetStyles.chipSublabelSelected,
                    ]}
                  >
                    {q.sublabel}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Calendar for any other date */}
          <View style={dateSheetStyles.calendarCard}>
            <Calendar
              theme={CALENDAR_THEME}
              firstDay={1}
              current={selectedIsoDay}
              minDate={todayIsoDay()}
              markedDates={requiredDateMarked}
              onDayPress={(day: DateData) => handlePickIsoDay(day.dateString)}
              enableSwipeMonths
            />
          </View>
        </View>
      </BottomSheet>
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
  flexFill: {
    flex: 1,
  },
  body: {
    padding: 20,
    paddingBottom: 120, // clearance for the sticky FooterBar below
  },
  headerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    elevation: 2,
  },
  reeceIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  cardHeaderTrailing: {
    marginLeft: 'auto',
  },
  cardSubsection: {
    marginTop: 14,
  },
  fieldLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 6,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  countChip: {
    minWidth: 24,
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 11,
    backgroundColor: colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  pickerButton: { borderColor: colors.border },
  input: { marginBottom: 8, backgroundColor: colors.surface },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  lineRowLast: {
    borderBottomWidth: 0,
  },
  lineName: { fontSize: 14, color: colors.text, fontWeight: '500' },
  lineMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  lineTotal: { fontSize: 14, color: colors.text, fontWeight: '600', marginLeft: 12 },
  emptyHint: { fontSize: 13, color: colors.textMuted, lineHeight: 18, fontStyle: 'italic' },
  deliveryHint: { fontSize: 12, color: colors.textMuted, lineHeight: 16, marginBottom: 8 },
  selectedAddressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceGray3,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
    marginBottom: 8,
  },
  selectedAddressText: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
  },
  addressLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  addressLinkText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
  },
  totalsBox: {
    marginTop: 14,
    paddingTop: 12,
    paddingHorizontal: 12,
    paddingBottom: 8,
    borderRadius: 12,
    backgroundColor: colors.primaryBg,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  totalRowGrand: {
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.primary + '55',
  },
  totalLabel: { fontSize: 13, color: colors.textMuted },
  totalLabelStrong: { fontSize: 14, color: colors.text, fontWeight: '700' },
  totalValue: { fontSize: 13, color: colors.text },
  totalValueStrong: { fontSize: 18, color: colors.primary, fontWeight: '800' },
  previewingBox: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  previewingText: { marginLeft: 8, fontSize: 12, color: colors.textMuted },
  violationsBox: {
    flexDirection: 'row',
    backgroundColor: colors.error + '15',
    borderRadius: 8,
    padding: 10,
    marginTop: 12,
  },
  violationText: { fontSize: 12, color: colors.error, lineHeight: 16 },
  footerBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 10,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.15,
        shadowRadius: 6,
      },
      android: { elevation: 8 },
      web: {
        boxShadow: '0 -2px 12px rgba(0,0,0,0.2)' as any,
      },
    }),
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    width: '100%',
    ...(Platform.OS === 'web' && {
      maxWidth: 800,
      alignSelf: 'center' as any,
    }),
  },
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

const dateSheetStyles = StyleSheet.create({
  content: {
    paddingVertical: 4,
    gap: 14,
  },
  summaryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.surfaceGray3,
    alignSelf: 'stretch',
  },
  summaryText: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '700',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexGrow: 1,
    flexBasis: '47%',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.surfaceDark,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: {
    backgroundColor: colors.primaryBg,
    borderColor: colors.primary,
  },
  chipLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  chipLabelSelected: {
    color: colors.primary,
  },
  chipSublabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  chipSublabelSelected: {
    color: colors.primary,
  },
  calendarCard: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.surfaceDark,
    paddingVertical: 4,
  },
});
