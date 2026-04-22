/**
 * SendSwitcher
 *
 * Pill toggle for "send as Quote vs Invoice" paired with the canonical
 * SendDocumentButton. The pill IS the convert trigger — tapping "Invoice"
 * on a quote-shaped doc runs convertDocumentToInvoice (after a confirm),
 * which updates the store. SendDocumentButton then re-renders for the
 * new type and its email template / SMS copy / payment link automatically
 * match.
 *
 * Forward-only: once a doc is an invoice, the Quote side of the pill is
 * disabled. No un-invoicing.
 */

import React, { useState } from 'react';
import { View, StyleSheet, Pressable, Alert } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import type { Document } from '../types/document';
import type { BusinessSettings } from '../types';
import { useStore } from '../store/useStore';
import { colors } from '../theme';
import { selectionTap } from '../utils/haptics';
import { SendDocumentButton } from './SendDocumentButton';

interface SendSwitcherProps {
  doc: Document;
  businessSettings: BusinessSettings | null;
  /** Style for the wrapping view (e.g. to fit a bottom-bar half-width). */
  style?: any;
}

type SendMode = 'quote' | 'invoice';

export function SendSwitcher({ doc, businessSettings, style }: SendSwitcherProps) {
  const convertDocumentToInvoice = useStore((s) => s.convertDocumentToInvoice);
  const [converting, setConverting] = useState(false);

  // The pill state is derived from the current doc type — no ephemeral UI
  // state. Flipping to "invoice" IS the conversion, and the conversion
  // bumps doc.type. Prevents the pill and the doc from ever disagreeing.
  const mode: SendMode = doc.type;
  const lockedToInvoice = doc.type === 'invoice';

  const handlePillPress = (target: SendMode) => {
    if (target === mode) return;
    if (target === 'quote') {
      // Forward-only — state machine has no invoice → quote edge.
      Alert.alert(
        'Already invoiced',
        'Once a job is invoiced it stays an invoice. You can still re-send it, but it won’t go out as a quote again.',
      );
      return;
    }
    // target === 'invoice' and current is quote → confirm then convert.
    Alert.alert(
      'Turn this into an invoice?',
      `"${doc.job?.name || 'This job'}" becomes an invoice and can’t be sent as a quote again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Convert',
          style: 'destructive',
          onPress: async () => {
            setConverting(true);
            try {
              await convertDocumentToInvoice(doc.id);
            } catch {
              Alert.alert('Error', 'Could not convert to invoice. Please try again.');
            } finally {
              setConverting(false);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.wrapper, style]}>
      <View style={styles.pillRow}>
        <PillOption
          label="Quote"
          icon="file-document-outline"
          active={mode === 'quote'}
          disabled={lockedToInvoice}
          onPress={() => handlePillPress('quote')}
        />
        <PillOption
          label="Invoice"
          icon="receipt"
          active={mode === 'invoice'}
          disabled={false}
          onPress={() => handlePillPress('invoice')}
        />
        {converting ? (
          <View style={styles.converting}>
            <ActivityIndicator size={12} color={colors.primary} />
            <Text style={styles.convertingLabel}>Converting…</Text>
          </View>
        ) : null}
      </View>

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

function PillOption({
  label,
  icon,
  active,
  disabled,
  onPress,
}: {
  label: string;
  icon: string;
  active: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        selectionTap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.pill,
        active && styles.pillActive,
        disabled && !active && styles.pillDisabled,
        pressed && !disabled && { opacity: 0.8 },
      ]}
    >
      <MaterialCommunityIcons
        name={icon as any}
        size={14}
        color={active ? colors.white : disabled ? colors.inactive : colors.text}
      />
      <Text
        style={[
          styles.pillLabel,
          active && styles.pillLabelActive,
          disabled && !active && styles.pillLabelDisabled,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 8,
  },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    padding: 3,
    borderRadius: 999,
    backgroundColor: colors.surfaceGray3,
    gap: 2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  pillActive: {
    backgroundColor: colors.primary,
  },
  pillDisabled: {
    opacity: 0.5,
  },
  pillLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  pillLabelActive: {
    color: colors.white,
  },
  pillLabelDisabled: {
    color: colors.inactive,
  },
  converting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 8,
  },
  convertingLabel: {
    fontSize: 11,
    color: colors.textMuted,
  },
});
