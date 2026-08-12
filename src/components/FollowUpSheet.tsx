/**
 * FollowUpSheet — "nudge the customer" sheet.
 *
 * Three rows:
 *  - SMS: native opens the prefilled SMS composer; web copies the
 *    message to the clipboard (browsers can't dial sms:).
 *  - Email: sends via the Brevo backend (same endpoint as the main
 *    Send flow), so delivery doesn't depend on a mailto: handler.
 *  - Pay Link: native share sheet, with a clipboard fallback when
 *    Web Share API isn't available (desktop browsers).
 *
 * Message copy gets progressively firmer as the doc ages past
 * reasonable follow-up thresholds.
 */

import React, { useMemo, useState } from 'react';
import { View, StyleSheet, Pressable, Platform, Share, Alert } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';

import type { Document } from '../types/document';
import { documentToQuote, documentToInvoice } from '../types/documentAdapter';
import { makeStyles, useThemeColors } from '../theme';
import { BottomSheet } from './BottomSheet';
import { selectionTap, lightTap } from '../utils/haptics';
import { ensureCanDeliver } from '../utils/quoteDeliveryGuard';
import { auth } from '../config/firebase';
import { cleanSmsRecipient, openSmsComposer } from '../utils/smsComposer';

const USE_EMULATOR = process.env.USE_FIREBASE_EMULATOR === 'true';
const FIREBASE_FUNCTIONS_URL = USE_EMULATOR
  ? 'http://127.0.0.1:5001/hansendev/us-central1'
  : 'https://us-central1-hansendev.cloudfunctions.net';

const IS_WEB = Platform.OS === 'web';

export type FollowUpTone = 'gentle' | 'firm' | 'overdue';

interface FollowUpSheetProps {
  visible: boolean;
  onDismiss: () => void;
  doc: Document;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  businessName: string;
  jobName: string;
  tone: FollowUpTone;
}

function resolvePayLink(doc: Document): string | null {
  return (
    doc.activePaymentLink?.url ||
    doc.squarePaymentLinkUrl ||
    doc.depositPaymentLinkUrl ||
    null
  );
}

/** Per-tone SMS/email body templates. */
function buildMessage(args: {
  tone: FollowUpTone;
  docType: Document['type'];
  customerName: string;
  businessName: string;
  jobName: string;
  payLink: string | null;
}): string {
  const { tone, docType, customerName, businessName, jobName, payLink } = args;
  const signOff = `— ${businessName}`;
  const linkLine = payLink ? `\n\nPay here: ${payLink}` : '';

  if (docType === 'quote') {
    if (tone === 'gentle') {
      return `Hi ${customerName}, just checking in on the ${jobName} quote. Happy to answer any questions or tweak the scope — let me know how you'd like to proceed.${linkLine}\n${signOff}`;
    }
    if (tone === 'firm') {
      return `Hi ${customerName}, following up on the ${jobName} quote I sent. If you'd like to go ahead, hit reply or tap the link to pay the deposit and I'll lock it in.${linkLine}\n${signOff}`;
    }
    return `Hi ${customerName}, haven't heard back on the ${jobName} quote — if timing has shifted just let me know. Happy to revise or hold the price if you're still keen.${linkLine}\n${signOff}`;
  }

  // invoice
  if (tone === 'gentle') {
    return `Hi ${customerName}, friendly reminder on the ${jobName} invoice — happy to answer any questions.${linkLine}\n${signOff}`;
  }
  if (tone === 'firm') {
    return `Hi ${customerName}, circling back on the outstanding invoice for ${jobName}. Paying via the link below is the quickest way to settle.${linkLine}\n${signOff}`;
  }
  return `Hi ${customerName}, the invoice for ${jobName} is now overdue. Could you let me know when it'll be settled, or use the link below to pay right now?${linkLine}\n${signOff}`;
}

export function FollowUpSheet({
  visible,
  onDismiss,
  doc,
  customerName,
  customerPhone,
  customerEmail,
  businessName,
  jobName,
  tone,
}: FollowUpSheetProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const navigation = useNavigation<any>();
  const payLink = useMemo(() => resolvePayLink(doc), [doc]);
  const message = useMemo(
    () =>
      buildMessage({
        tone,
        docType: doc.type,
        customerName,
        businessName,
        jobName,
        payLink,
      }),
    [tone, doc.type, customerName, businessName, jobName, payLink],
  );

  const [sendingEmail, setSendingEmail] = useState(false);

  const subtitle = doc.type === 'quote' ? 'Nudge on the quote' : 'Nudge on the invoice';

  /**
   * Free-tier delivery gate. Pro / trial users skip the network round-trip.
   * Free users without a connected Square account get an Alert routing them
   * to SquareIntegration before any follow-up message is composed.
   */
  const passesDeliveryGate = async (): Promise<boolean> => {
    const gate = await ensureCanDeliver({
      kind: doc.type === 'invoice' ? 'invoice' : 'quote',
      doc: { id: doc.id, squarePaymentLinkUrl: payLink || undefined, requireDeposit: doc.requireDeposit, depositPercentage: doc.depositPercentage },
    });
    if (gate.ok) return true;
    Alert.alert(
      gate.reason === 'connect_square' ? 'Connect Square to follow up' : 'Square link unavailable',
      gate.message,
      [
        { text: 'Not now', style: 'cancel', onPress: onDismiss },
        gate.reason === 'connect_square' && {
          text: 'Connect Square',
          onPress: () => {
            onDismiss();
            navigation.navigate('SquareIntegration' as never);
          },
        },
        {
          text: 'Upgrade to Pro',
          onPress: () => {
            onDismiss();
            navigation.navigate('Paywall' as never, { source: 'follow_up_sheet' } as never);
          },
        },
      ].filter(Boolean) as any
    );
    return false;
  };

  const handleSMS = async () => {
    selectionTap();
    const phone = cleanSmsRecipient(customerPhone || '');
    if (!phone) {
      Alert.alert('No phone on file', 'Add a phone number to the customer to send an SMS.');
      return;
    }
    if (!(await passesDeliveryGate())) return;

    try {
      const result = await openSmsComposer(phone, message);
      if (result === 'cancelled') return;
      if (result === 'copied') {
        Alert.alert(
          'Message copied',
          `Phone: ${customerPhone}\n\nThe follow-up message is on your clipboard — paste it into your SMS or messaging app.`,
        );
      }
      onDismiss();
    } catch {
      Alert.alert('Error', 'Could not open SMS.');
    }
  };

  const handleEmail = async () => {
    selectionTap();
    if (!(await passesDeliveryGate())) return;
    if (!customerEmail) {
      // No email on file — fall back to the OS share sheet so the tradie
      // can punt the drafted body into WhatsApp / Messenger / whatever.
      // On desktop web (no native share), copy to clipboard instead.
      if (IS_WEB && typeof navigator !== 'undefined' && !(navigator as any).share) {
        try {
          await Clipboard.setStringAsync(message);
          Alert.alert('Message copied', 'The follow-up message is on your clipboard.');
          onDismiss();
        } catch {
          Alert.alert('Error', 'Could not copy the message.');
        }
        return;
      }
      await Share.share({ message, title: subtitle });
      onDismiss();
      return;
    }

    const subject =
      doc.type === 'quote'
        ? `Quote for ${jobName} — ${businessName}`
        : `Invoice for ${jobName} — ${businessName}`;

    // Send via Brevo backend so it actually works everywhere (no reliance
    // on a mailto: handler being configured on the device). Same endpoint
    // the main "Send" flow uses.
    setSendingEmail(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        Alert.alert('Not signed in', 'Sign in again to send the follow-up.');
        return;
      }
      const endpoint =
        doc.type === 'invoice'
          ? `${FIREBASE_FUNCTIONS_URL}/sendInvoiceEmail`
          : `${FIREBASE_FUNCTIONS_URL}/sendQuoteEmail`;
      const body =
        doc.type === 'invoice'
          ? {
              invoiceId: doc.id,
              invoice: documentToInvoice(doc),
              emailBody: message,
              recipientEmail: customerEmail.trim(),
              subject,
              includePhotos: false,
            }
          : {
              quoteId: doc.id,
              quote: documentToQuote(doc),
              emailBody: message,
              recipientEmail: customerEmail.trim(),
              subject,
              includePhotos: false,
            };
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to send follow-up.');
      }
      Alert.alert('Follow-up sent', `Sent to ${customerEmail}.`);
      onDismiss();
    } catch (error: any) {
      Alert.alert('Send Failed', error?.message || 'Could not send the follow-up email.');
    } finally {
      setSendingEmail(false);
    }
  };

  const handleSharePayLink = async () => {
    lightTap();
    if (!payLink) {
      Alert.alert(
        'No pay link yet',
        'Send the document first so a Square pay link is generated.',
      );
      return;
    }

    // On web, Share.share routes to the Web Share API. Desktop Chrome/
    // Firefox don't expose it, so feature-detect and fall back to the
    // clipboard. Mobile native gets the OS share sheet as before.
    if (IS_WEB && typeof navigator !== 'undefined' && !(navigator as any).share) {
      try {
        await Clipboard.setStringAsync(payLink);
        Alert.alert('Link copied', 'The Square pay link is on your clipboard.');
        onDismiss();
      } catch {
        Alert.alert('Error', 'Could not copy the pay link.');
      }
      return;
    }

    try {
      await Share.share({
        message: payLink,
        url: payLink,
        title: doc.type === 'quote' ? 'Deposit link' : 'Payment link',
      });
      onDismiss();
    } catch {
      // User-cancelled — no-op. Share.share rejects on both cancel and
      // failure; there's no reliable way to tell them apart on iOS.
    }
  };

  const handleShareMessage = async () => {
    lightTap();
    if (IS_WEB && typeof navigator !== 'undefined' && !(navigator as any).share) {
      try {
        await Clipboard.setStringAsync(message);
        Alert.alert('Message copied', 'The follow-up message is on your clipboard.');
      } catch {
        Alert.alert('Error', 'Could not copy the message.');
      }
      return;
    }
    try {
      await Share.share({ message, title: subtitle });
    } catch {
      // ignore
    }
  };

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} title="Follow up" subtitle={subtitle}>
      <View style={styles.container}>
        <View style={styles.preview}>
          <Text style={styles.previewLabel}>Message</Text>
          <Text style={styles.previewBody} numberOfLines={6}>
            {message}
          </Text>
          <Pressable onPress={handleShareMessage} hitSlop={8} style={styles.copyMessage}>
            <MaterialCommunityIcons
              name={(IS_WEB ? 'content-copy' : 'share-variant') as any}
              size={14}
              color={themeColors.accentText}
            />
            <Text style={styles.copyMessageLabel}>
              {IS_WEB ? 'Copy message' : 'Share message'}
            </Text>
          </Pressable>
        </View>

        <Row
          icon="message-text"
          label={IS_WEB ? 'Copy SMS message' : 'Send SMS'}
          sub={
            customerPhone
              ? IS_WEB
                ? `${customerPhone} — copy & paste`
                : customerPhone
              : 'No phone on file'
          }
          disabled={!customerPhone}
          onPress={handleSMS}
        />
        <Row
          icon="email-outline"
          label={sendingEmail ? 'Sending…' : 'Send Email'}
          sub={
            customerEmail
              ? sendingEmail
                ? 'Delivering via QuoteMate'
                : customerEmail
              : IS_WEB
                ? 'No email on file — message will be copied'
                : 'Use the share sheet'
          }
          onPress={handleEmail}
          disabled={sendingEmail}
          rightAccessory={sendingEmail ? <ActivityIndicator size={16} /> : undefined}
        />
        <Row
          icon="link-variant"
          label={IS_WEB ? 'Copy Pay Link' : 'Share Pay Link'}
          sub={payLink ? 'Square payment link' : 'No link yet — send the doc first'}
          disabled={!payLink}
          onPress={handleSharePayLink}
        />
      </View>
    </BottomSheet>
  );
}

function Row({
  icon,
  label,
  sub,
  onPress,
  disabled,
  rightAccessory,
}: {
  icon: string;
  label: string;
  sub?: string;
  onPress: () => void;
  disabled?: boolean;
  rightAccessory?: React.ReactNode;
}) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.row,
        disabled && styles.rowDisabled,
        pressed && !disabled && styles.rowPressed,
      ]}
    >
      <View style={styles.rowIcon}>
        <MaterialCommunityIcons
          name={icon as any}
          size={20}
          color={disabled ? themeColors.textDisabled : themeColors.accent}
        />
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.rowLabel, disabled && { color: themeColors.textDisabled }]}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      {rightAccessory !== undefined ? (
        rightAccessory
      ) : (
        <MaterialCommunityIcons
          name={'chevron-right' as any}
          size={20}
          color={themeColors.textDisabled}
        />
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    gap: 10,
    paddingBottom: 8,
  },
  preview: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: t.colors.surfacePressed,
    borderWidth: 1,
    borderColor: t.colors.border,
    gap: 6,
  },
  previewLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: t.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  previewBody: {
    fontSize: 13,
    color: t.colors.text,
    lineHeight: 18,
  },
  copyMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  copyMessageLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: t.colors.accentText,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: t.colors.surfacePressed,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  rowDisabled: {
    opacity: 0.5,
  },
  rowPressed: {
    opacity: 0.8,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: t.colors.text,
  },
  rowSub: {
    fontSize: 12,
    color: t.colors.textMuted,
  },
}));
