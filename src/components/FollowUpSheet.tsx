/**
 * FollowUpSheet — "nudge the customer" sheet.
 *
 * Three rows: SMS (opens the phone's SMS composer prefilled), Email
 * (opens the shared SendDocumentDialog with the follow-up body drafted
 * in), and Copy Link (drops the Square pay link onto the clipboard).
 *
 * Message copy gets progressively firmer as the doc ages past
 * reasonable follow-up thresholds.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable, Linking, Platform, Share, Alert } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import type { Document } from '../types/document';
import { colors } from '../theme';
import { BottomSheet } from './BottomSheet';
import { selectionTap, lightTap } from '../utils/haptics';

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

  const subtitle = doc.type === 'quote' ? 'Nudge on the quote' : 'Nudge on the invoice';

  const handleSMS = async () => {
    selectionTap();
    const phone = (customerPhone || '').replace(/\s+/g, '');
    if (!phone) {
      Alert.alert('No phone on file', 'Add a phone number to the customer to send an SMS.');
      return;
    }
    const url =
      Platform.OS === 'ios'
        ? `sms:${phone}&body=${encodeURIComponent(message)}`
        : `sms:${phone}?body=${encodeURIComponent(message)}`;
    try {
      await Linking.openURL(url);
      onDismiss();
    } catch {
      Alert.alert('Error', 'Could not open SMS.');
    }
  };

  const handleEmail = async () => {
    selectionTap();
    if (!customerEmail) {
      // No email? Share sheet is the next best — works in WhatsApp /
      // Messenger / anything installed. We'll still draft the same body.
      await Share.share({ message, title: subtitle });
      onDismiss();
      return;
    }
    const subject =
      doc.type === 'quote'
        ? `Quote for ${jobName} — ${businessName}`
        : `Invoice for ${jobName} — ${businessName}`;
    const url = `mailto:${encodeURIComponent(customerEmail)}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(message)}`;
    try {
      await Linking.openURL(url);
      onDismiss();
    } catch {
      Alert.alert('Error', 'Could not open the email composer.');
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
              name={'share-variant' as any}
              size={14}
              color={colors.primary}
            />
            <Text style={styles.copyMessageLabel}>Share message</Text>
          </Pressable>
        </View>

        <Row
          icon="message-text"
          label="Send SMS"
          sub={customerPhone ? customerPhone : 'No phone on file'}
          disabled={!customerPhone}
          onPress={handleSMS}
        />
        <Row
          icon="email-outline"
          label="Send Email"
          sub={customerEmail ? customerEmail : 'Use the share sheet'}
          onPress={handleEmail}
        />
        <Row
          icon="link-variant"
          label="Share Pay Link"
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
}: {
  icon: string;
  label: string;
  sub?: string;
  onPress: () => void;
  disabled?: boolean;
}) {
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
          color={disabled ? colors.inactive : colors.primary}
        />
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.rowLabel, disabled && { color: colors.inactive }]}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      <MaterialCommunityIcons
        name={'chevron-right' as any}
        size={20}
        color={colors.inactive}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
    paddingBottom: 8,
  },
  preview: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surfaceGray3,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  previewLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  previewBody: {
    fontSize: 13,
    color: colors.text,
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
    color: colors.primary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.surfaceGray3,
    borderWidth: 1,
    borderColor: colors.border,
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
    backgroundColor: colors.primaryBg,
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
    color: colors.text,
  },
  rowSub: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
