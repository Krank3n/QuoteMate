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
// A paper <Modal> renders through <Portal> into the app's own React tree — the
// same window — so the keyboard provider reaches it and the controller's
// KeyboardAvoidingView works here. (A react-native <Modal> is a separate
// window and needs hooks/useKeyboardHeight instead.) Paper does no keyboard
// avoidance of its own. See components/keyboardAvoidance.guard.test.ts.
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Modal, Portal, Text, TextInput, Button, Switch } from 'react-native-paper';

import { ActionSheet } from './ActionSheet';
import { makeStyles, useThemeColors } from '../theme';
import { sendServiceReportEmail } from '../services/serviceReportSender';
import { generateReportEmail, getDefaultReportEmailBody } from '../services/llmService';
import { trackEvent } from '../services/analyticsService';

export interface SendReportDialogProps {
  visible: boolean;
  onDismiss: () => void;
  reportId: string | null;
  reportNumber?: string;
  customerName?: string;
  customerEmail?: string;
  businessName?: string;
  /** The tradie's own address, for the "email me a copy" toggle. */
  ownerEmail?: string;
  /** Report content, so the covering note can be written from the visit. */
  serviceType?: string;
  workCarriedOut?: string;
  recommendedWork?: string;
  natureOfProblem?: string;
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
  ownerEmail,
  serviceType,
  workCarriedOut,
  recommendedWork,
  natureOfProblem,
  onShare,
  onSent,
}: SendReportDialogProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const [composeVisible, setComposeVisible] = useState(false);
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  // Off by default, matching the quote/invoice toggle — an extra email every
  // send is a choice, not something to opt people into.
  const [sendCopyToSelf, setSendCopyToSelf] = useState(false);
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
      setSendCopyToSelf(false);
    }
  }, [visible, customerEmail]);

  /**
   * Write the covering note from the visit, the same courtesy the quote flow
   * extends. Falls back to the plain template rather than leaving the tradie
   * an empty box on a phone, on site.
   */
  const draftNote = async (replace: boolean) => {
    if (drafting) return;
    if (!replace && note.trim()) return;
    setDrafting(true);
    try {
      const body = await generateReportEmail({
        businessName: businessName || '',
        customerName: customerName || 'there',
        serviceType: serviceType || '',
        workCarriedOut,
        recommendedWork,
        natureOfProblem,
      });
      setNote(body);
    } catch {
      setNote(getDefaultReportEmailBody(customerName || '', serviceType || '', businessName || ''));
    } finally {
      setDrafting(false);
    }
  };

  // Draft as the compose step opens, so it's ready by the time they've
  // checked the address.
  useEffect(() => {
    if (composeVisible && !sentTo) void draftNote(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeVisible]);

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
        sendCopyToSelf,
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
          // Full-screen flex container; the card inside carries the width cap.
          // Putting the cap on this style instead lets the sheet span the whole
          // window on desktop — same structure AlertModal uses.
          contentContainerStyle={styles.modalContainer}
        >
          <KeyboardAvoidingView behavior="padding">
          <View style={styles.card}>
          <ScrollView keyboardShouldPersistTaps="handled">
            {sentTo ? (
              <View style={styles.done}>
                <Text style={styles.doneTitle}>Report sent</Text>
                <Text style={styles.doneBody}>
                  {`${reportNumber ? `${reportNumber} ` : ''}went to ${sentTo} with the PDF attached.`}
                </Text>
                <Button mode="contained" buttonColor={themeColors.accent} textColor={themeColors.onAccent} onPress={closeAll} style={styles.primary}>
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
                <View style={styles.noteHeader}>
                  <Text style={styles.noteLabel}>Message</Text>
                  <Button
                    mode="text"
                    compact
                    icon="refresh"
                    onPress={() => draftNote(true)}
                    disabled={sending || drafting}
                    loading={drafting}
                  >
                    Rewrite
                  </Button>
                </View>
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  mode="outlined"
                  multiline
                  numberOfLines={5}
                  placeholder={drafting ? 'Writing…' : 'A short note above the report summary.'}
                  style={[styles.input, styles.noteInput]}
                  disabled={sending || drafting}
                />

                {!!ownerEmail && (
                  <View style={styles.copyRow}>
                    <View style={styles.copyText}>
                      <Text style={styles.copyTitle}>Email me a copy</Text>
                      <Text style={styles.copySubtitle} numberOfLines={1}>
                        {`Keeps a copy at ${ownerEmail} for your records`}
                      </Text>
                    </View>
                    <Switch
                      value={sendCopyToSelf}
                      onValueChange={setSendCopyToSelf}
                      color={themeColors.accentText}
                      disabled={sending}
                    />
                  </View>
                )}

                {!!error && <Text style={styles.error}>{error}</Text>}

                <View style={styles.actions}>
                  <Button mode="text" onPress={closeAll} disabled={sending}>
                    Cancel
                  </Button>
                  <Button
                    mode="contained" buttonColor={themeColors.accent} textColor={themeColors.onAccent}
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
          </View>
          </KeyboardAvoidingView>
        </Modal>
      </Portal>
    </>
  );
}

const useStyles = makeStyles((t) => ({
  modalContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    // Full width on a phone, capped and centred on anything larger — without
    // the cap a two-field form ends up spanning a desktop window.
    width: '100%',
    maxWidth: 520,
    maxHeight: '86%',
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: 14,
    padding: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: t.colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: t.colors.textMuted,
    marginTop: 4,
    marginBottom: 14,
    lineHeight: 18,
  },
  input: {
    marginBottom: 12,
    backgroundColor: t.colors.surface,
  },
  noteInput: {
    minHeight: 120,
  },
  noteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  noteLabel: {
    fontSize: 12,
    color: t.colors.textMuted,
  },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    marginBottom: 4,
  },
  copyText: {
    flex: 1,
  },
  copyTitle: {
    fontSize: 14,
    color: t.colors.text,
  },
  copySubtitle: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 1,
  },
  error: {
    color: t.colors.error,
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
    color: t.colors.text,
  },
  doneBody: {
    fontSize: 14,
    color: t.colors.textMuted,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 18,
    lineHeight: 20,
  },
}));
