/**
 * Send the accountant statement.
 *
 * A sibling of SendReportDialog rather than a reuse of it: that one is built
 * around a report — it writes a covering note from the visit, offers a share
 * option and talks about a customer. A statement goes to one address, the
 * tradie's accountant, with a period instead of a job. What's shared is the
 * part that should be: the Portal + Modal compose card, so the sheet a tradie
 * sees is the one they already know from sending a quote.
 *
 * The server remembers the accountant too, but the client's business-settings
 * save is a whole-document setDoc with no merge (firestoreService), so the
 * local copy has to carry the address or the next Business Profile save would
 * wipe it.
 */

import React, { useEffect, useState } from 'react';
import { View, ScrollView } from 'react-native';
// A paper <Modal> renders through <Portal> into the app's own React tree — the
// same window — so the keyboard provider reaches it and the controller's
// KeyboardAvoidingView works here. See components/keyboardAvoidance.guard.test.ts.
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Modal, Portal, Text, TextInput, Button, Switch } from 'react-native-paper';

import { auth } from '../config/firebase';
import { makeStyles, useThemeColors } from '../theme';
import { useStore } from '../store/useStore';
import { sendAccountantStatement } from '../services/statementSender';
import type { SendStatementResult } from '../services/statementSender';
import { trackEvent } from '../services/analyticsService';
import { isEmailAddress } from '../utils/sendFlow';
import type { StatementPeriod, StatementPreset } from '../utils/statementPeriods';
import type { StatementSummary } from '../../shared/statement/buildStatement';

export interface SendStatementSheetProps {
  visible: boolean;
  onDismiss: () => void;
  period: StatementPeriod;
  /** Which chip the period came from — carried on the analytics event. */
  preset: StatementPreset;
  /** Drives the one-line recap of what's about to go across. */
  summary: StatementSummary;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

export function SendStatementSheet({
  visible,
  onDismiss,
  period,
  preset,
  summary,
}: SendStatementSheetProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const businessSettings = useStore((s) => s.businessSettings);
  const setBusinessSettings = useStore((s) => s.setBusinessSettings);
  const ownerEmail = auth.currentUser?.email || '';

  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  // Off by default, matching the quote/invoice toggle — an extra email every
  // send is a choice, not something to opt people into.
  const [sendCopyToSelf, setSendCopyToSelf] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sentCounts, setSentCounts] = useState<SendStatementResult | null>(null);

  // Refill each time the sheet opens — the accountant may have been saved in
  // Business Profile since it was last shown. Keyed on `visible` ALONE and
  // reading the address off the store there: a first-ever send saves the
  // address, which would otherwise change the dependency while the sheet is
  // still open, wipe the confirmation and invite a second send.
  useEffect(() => {
    if (visible) {
      setTo(useStore.getState().businessSettings?.accountantEmail || '');
      setNote('');
      setError(null);
      setSentTo(null);
      setSentCounts(null);
      setSendCopyToSelf(false);
    }
  }, [visible]);

  const handleSend = async () => {
    const recipient = to.trim();
    if (!isEmailAddress(recipient)) {
      setError('Enter a valid email address.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const result = await sendAccountantStatement({
        fromMs: period.fromMs,
        toMs: period.toMs,
        recipientEmail: recipient,
        emailBody: note.trim() || undefined,
        sendCopyToSelf,
      });
      trackEvent('statement_sent', { preset });
      // Keep the address on the local settings copy as well as the server's:
      // saveBusinessSettings writes the whole document without merge, so the
      // next Business Profile save would otherwise drop what the server wrote.
      if (businessSettings && businessSettings.accountantEmail !== recipient) {
        // The server already saved it with merge, so a failure here costs
        // nothing the next successful save won't fix.
        setBusinessSettings({ ...businessSettings, accountantEmail: recipient }).catch(() => {});
      }
      setSentCounts(result || null);
      setSentTo(recipient);
    } catch (err: any) {
      setError(err?.message || 'Could not send the statement. Please try again.');
    } finally {
      setSending(false);
    }
  };

  // What the server says it actually emailed, when it said. The figures on
  // the card come from the phone's copy of the documents; these come from all
  // of them, so they are worth repeating back.
  const sentCountsLine =
    typeof sentCounts?.invoiceCount === 'number' && typeof sentCounts?.paymentCount === 'number'
      ? ` ${plural(sentCounts.invoiceCount, 'invoice')} and ${plural(sentCounts.paymentCount, 'payment')}.`
      : '';

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={sending ? () => {} : onDismiss}
        // Full-screen flex container; the card inside carries the width cap.
        contentContainerStyle={styles.modalContainer}
      >
        <KeyboardAvoidingView behavior="padding" automaticOffset>
        <View style={styles.card}>
        <ScrollView keyboardShouldPersistTaps="handled">
          {sentTo ? (
            <View style={styles.done}>
              <Text style={styles.doneTitle}>Statement sent</Text>
              <Text style={styles.doneBody}>
                {`Your statement for ${period.label} went to ${sentTo}, with the PDF and a spreadsheet attached.${sentCountsLine}`}
              </Text>
              <Button
                mode="contained"
                buttonColor={themeColors.accent}
                textColor={themeColors.onAccent}
                onPress={onDismiss}
                style={styles.primary}
              >
                Done
              </Button>
            </View>
          ) : (
            <>
              <Text style={styles.title}>Send to accountant</Text>
              <Text style={styles.subtitle}>
                {`${period.label} · ${plural(summary.invoiceCount, 'invoice')} · ${plural(summary.paymentCount, 'payment')}. The PDF and a spreadsheet (CSV) go across as attachments. Replies come back to you.`}
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
                label="Message (optional)"
                value={note}
                onChangeText={setNote}
                mode="outlined"
                multiline
                numberOfLines={4}
                placeholder="Leave blank and we'll write a short note with the period."
                style={[styles.input, styles.noteInput]}
                disabled={sending}
                // Explicit caret / selection colours, same as the email body
                // editor in DocumentEmailPreviewModal: never leave the Android
                // caret to whatever Paper derives.
                cursorColor={themeColors.text}
                selectionColor={themeColors.accentText}
                selectionHandleColor={themeColors.accentText}
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
                <Button mode="text" onPress={onDismiss} disabled={sending}>
                  Cancel
                </Button>
                <Button
                  mode="contained"
                  buttonColor={themeColors.accent}
                  textColor={themeColors.onAccent}
                  onPress={handleSend}
                  loading={sending}
                  disabled={sending}
                  style={styles.primary}
                >
                  {sending ? 'Sending' : 'Send statement'}
                </Button>
              </View>
            </>
          )}
        </ScrollView>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </Portal>
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
    // Full width on a phone, capped and centred on anything larger.
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
    minHeight: 96,
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
