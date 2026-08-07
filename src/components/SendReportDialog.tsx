/**
 * Send a service report — the same shape as sending a quote or invoice.
 *
 * Deliberately NOT SendDocumentDialog. That one is built around a Document:
 * it converts to Quote/Invoice, moves a draft→sent stage, offers a pay link
 * and guards on Square. A service report has no totals, nothing to pay and no
 * stage machine, so routing it through that abstraction would mean carrying
 * four concepts it doesn't have. What's shared is the part that should be —
 * ActionSheet, so the sheet a tradie sees is the one they already know.
 *
 * Email is first because it's the deliverable; Share and Export are the
 * fallbacks for when the customer wants it some other way.
 */

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Modal, Portal, Text, TextInput, Button } from 'react-native-paper';

import { ActionSheet } from './ActionSheet';
import { colors } from '../theme';
import { sendServiceReportEmail } from '../services/serviceReportSender';
import { trackEvent } from '../services/analyticsService';

export interface SendReportDialogProps {
  visible: boolean;
  onDismiss: () => void;
  reportId: string | null;
  reportNumber?: string;
  customerName?: string;
  customerEmail?: string;
  businessName?: string;
  /** Share the PDF via the OS sheet / print dialog. */
  onShare: () => void | Promise<void>;
  onSent?: () => void;
}

export function SendReportDialog({
  visible,
  onDismiss,
  reportId,
  reportNumber,
  customerName,
  customerEmail,
  businessName,
  onShare,
  onSent,
}: SendReportDialogProps) {
  const [composeVisible, setComposeVisible] = useState(false);
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  // Refill from the job each time the sheet opens — the customer may have been
  // added since it was last shown.
  useEffect(() => {
    if (visible) {
      setTo(customerEmail || '');
      setNote('');
      setError(null);
      setSentTo(null);
    }
  }, [visible, customerEmail]);

  const closeAll = () => {
    setComposeVisible(false);
    onDismiss();
  };

  const handleSend = async () => {
    const recipient = to.trim();
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      setError('Enter a valid email address.');
      return;
    }
    if (!reportId) {
      setError('Save the report before sending it.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      await sendServiceReportEmail({
        reportId,
        recipientEmail: recipient,
        emailBody: note.trim() || undefined,
        includePhotos: true,
      });
      trackEvent('report_sent', { method: 'email' });
      setSentTo(recipient);
      onSent?.();
    } catch (err: any) {
      setError(err?.message || 'Could not send the report. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const options = [
    {
      icon: 'email-outline',
      label: 'Email to customer',
      onPress: () => setComposeVisible(true),
    },
    {
      icon: 'share-variant',
      label: 'Share',
      onPress: async () => {
        trackEvent('report_shared', { method: 'share' });
        onDismiss();
        await onShare();
      },
    },
  ];

  return (
    <>
      <ActionSheet
        visible={visible && !composeVisible}
        onDismiss={onDismiss}
        title="Send report"
        subtitle={reportNumber ? `${reportNumber}${customerName ? ` · ${customerName}` : ''}` : undefined}
        options={options}
        // The compose step swaps in over this sheet, so it owns dismissal.
        dismissOnSelect={false}
      />

      <Portal>
        <Modal
          visible={composeVisible}
          onDismiss={sending ? () => {} : closeAll}
          contentContainerStyle={styles.modal}
        >
          <ScrollView keyboardShouldPersistTaps="handled">
            {sentTo ? (
              <View style={styles.done}>
                <Text style={styles.doneTitle}>Report sent</Text>
                <Text style={styles.doneBody}>
                  {`${reportNumber ? `${reportNumber} ` : ''}went to ${sentTo} with the PDF attached.`}
                </Text>
                <Button mode="contained" onPress={closeAll} style={styles.primary}>
                  Done
                </Button>
              </View>
            ) : (
              <>
                <Text style={styles.title}>Email report</Text>
                <Text style={styles.subtitle}>
                  {`The PDF goes across as an attachment${
                    businessName ? `, from ${businessName}` : ''
                  }. Replies come back to you.`}
                </Text>

                <TextInput
                  label="To"
                  value={to}
                  onChangeText={(v) => {
                    setTo(v);
                    setError(null);
                  }}
                  mode="outlined"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  style={styles.input}
                  disabled={sending}
                />
                <TextInput
                  label="Note (optional)"
                  value={note}
                  onChangeText={setNote}
                  mode="outlined"
                  multiline
                  numberOfLines={4}
                  placeholder="Anything you want to say above the report summary."
                  style={[styles.input, styles.noteInput]}
                  disabled={sending}
                />

                {!!error && <Text style={styles.error}>{error}</Text>}

                <View style={styles.actions}>
                  <Button mode="text" onPress={closeAll} disabled={sending}>
                    Cancel
                  </Button>
                  <Button
                    mode="contained"
                    onPress={handleSend}
                    loading={sending}
                    disabled={sending}
                    style={styles.primary}
                  >
                    {sending ? 'Sending' : 'Send report'}
                  </Button>
                </View>
              </>
            )}
          </ScrollView>
        </Modal>
      </Portal>
    </>
  );
}

const styles = StyleSheet.create({
  modal: {
    backgroundColor: colors.surface,
    margin: 20,
    borderRadius: 14,
    padding: 20,
    maxHeight: '86%',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 4,
    marginBottom: 14,
    lineHeight: 18,
  },
  input: {
    marginBottom: 12,
    backgroundColor: colors.surfaceDark,
  },
  noteInput: {
    minHeight: 96,
  },
  error: {
    color: colors.error,
    fontSize: 13,
    marginBottom: 8,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  primary: {
    borderRadius: 24,
  },
  done: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  doneTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  doneBody: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 18,
    lineHeight: 20,
  },
});
