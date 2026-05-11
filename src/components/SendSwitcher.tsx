/**
 * SendTypePill + SendSwitcher
 *
 * Pill toggle for "send as Quote vs Invoice". The pill IS the convert
 * trigger — tapping "Invoice" on a quote-shaped doc runs the convert
 * flow (after a confirm), which updates the store. SendDocumentButton
 * then re-renders for the new type and its email template / SMS copy
 * / payment link automatically match.
 *
 * Forward-only: once a doc is an invoice, the Quote side of the pill is
 * disabled. No un-invoicing.
 *
 * `SendTypePill` can be used stand-alone (e.g. JobPreview puts it in
 * its own row above the Back/Send buttons); `SendSwitcher` is the
 * combined pill + SendDocumentButton for simpler layouts.
 */

import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';

import type { Document } from '../types/document';
import type { BusinessSettings, Quote } from '../types';
import { useStore } from '../store/useStore';
import { colors } from '../theme';
import { SendDocumentButton } from './SendDocumentButton';
import { AlertModal } from './AlertModal';
import { PillToggle } from './PillToggle';

interface SendTypePillProps {
  doc: Document;
  /** Style for the wrapping view. */
  style?: any;
  /** Stretch the pill to fill its parent and split options 50/50. */
  fullWidth?: boolean;
}

interface SendSwitcherProps extends SendTypePillProps {
  businessSettings: BusinessSettings | null;
}

type SendMode = 'quote' | 'invoice';

export function SendTypePill({ doc, style, fullWidth }: SendTypePillProps) {
  const convertDocumentToInvoice = useStore((s) => s.convertDocumentToInvoice);
  const createInvoiceFromQuote = useStore((s) => s.createInvoiceFromQuote);
  const quotes = useStore((s) => s.quotes);
  const [converting, setConverting] = useState(false);
  const [confirmConvertVisible, setConfirmConvertVisible] = useState(false);
  const [lockedAlertVisible, setLockedAlertVisible] = useState(false);
  const [errorAlertVisible, setErrorAlertVisible] = useState(false);

  // Pill state is derived from current doc type — no ephemeral UI state.
  // Flipping to "invoice" IS the conversion, and the conversion bumps
  // doc.type, so the pill and the doc never disagree.
  const mode: SendMode = doc.type;
  const lockedToInvoice = doc.type === 'invoice';

  const runConvert = async () => {
    setConverting(true);
    try {
      // Prefer convertDocumentToInvoice if the unified doc has already
      // been mirrored in. If not (just saved — mirror trigger hasn't
      // caught up yet), fall back to the legacy createInvoiceFromQuote
      // path, which itself calls convertDocumentToInvoice internally
      // once the mirror's ready. Either way the client gets a shaped
      // Invoice.
      const legacyQuote: Quote | undefined = quotes.find((q) => q.id === doc.id);
      if (legacyQuote) {
        await createInvoiceFromQuote(legacyQuote);
      } else {
        await convertDocumentToInvoice(doc.id);
      }
    } catch {
      setErrorAlertVisible(true);
    } finally {
      setConverting(false);
    }
  };

  const handlePillPress = (target: SendMode) => {
    if (target === mode) return;
    if (target === 'quote') {
      // Forward-only — state machine has no invoice → quote edge.
      setLockedAlertVisible(true);
      return;
    }
    // target === 'invoice' and current is quote → confirm then convert.
    setConfirmConvertVisible(true);
  };

  return (
    <View style={[styles.pillWrapper, fullWidth && styles.pillWrapperFull, style]}>
      <PillToggle<SendMode>
        value={mode}
        onChange={handlePillPress}
        options={[
          { value: 'quote', label: 'Quote', icon: 'file-document-outline', disabled: lockedToInvoice },
          { value: 'invoice', label: 'Invoice', icon: 'receipt' },
        ]}
        fullWidth={fullWidth}
        style={fullWidth ? { flex: 1 } : undefined}
      />
      {converting ? (
        <View style={styles.converting}>
          <ActivityIndicator size={12} color={colors.primary} />
          <Text style={styles.convertingLabel}>Converting…</Text>
        </View>
      ) : null}

      <AlertModal
        visible={confirmConvertVisible}
        onDismiss={() => setConfirmConvertVisible(false)}
        type="warning"
        title="Turn this into an invoice?"
        message={`"${doc.job?.name || 'This job'}" becomes an invoice and can't be sent as a quote again.`}
        primaryButtonText="Convert"
        primaryButtonAction={() => {
          setConfirmConvertVisible(false);
          runConvert();
        }}
        secondaryButtonText="Cancel"
        secondaryButtonAction={() => setConfirmConvertVisible(false)}
      />

      <AlertModal
        visible={lockedAlertVisible}
        onDismiss={() => setLockedAlertVisible(false)}
        type="info"
        title="Already invoiced"
        message="Once a job is invoiced it stays an invoice. You can still re-send it, but it won't go out as a quote again."
        primaryButtonText="Got it"
        primaryButtonAction={() => setLockedAlertVisible(false)}
      />

      <AlertModal
        visible={errorAlertVisible}
        onDismiss={() => setErrorAlertVisible(false)}
        type="error"
        title="Could not convert"
        message="Save the quote first, then try again."
        primaryButtonText="OK"
        primaryButtonAction={() => setErrorAlertVisible(false)}
      />
    </View>
  );
}

export function SendSwitcher({ doc, businessSettings, style }: SendSwitcherProps) {
  const mode: SendMode = doc.type;
  return (
    <View style={[styles.wrapper, style]}>
      <SendTypePill doc={doc} />
      <SendDocumentButton
        doc={doc}
        businessSettings={businessSettings}
        buttonMode="contained"
        buttonLabel={mode === 'invoice' ? 'Send Invoice' : 'Send Quote'}
        buttonIcon="send"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 8,
  },
  pillWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pillWrapperFull: {
    alignSelf: 'stretch',
  },
  converting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  convertingLabel: {
    fontSize: 11,
    color: colors.textMuted,
  },
});
