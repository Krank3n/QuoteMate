/**
 * Email Preview Modal
 * Shows AI-generated or default email body with edit capability
 * Allows regeneration (Pro) and sends via Brevo cloud function
 */

import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
  KeyboardAvoidingView,
} from 'react-native';
import {
  Text,
  TextInput,
  Button,
  ActivityIndicator,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../theme';
import { Quote, BusinessSettings } from '../types';
import { auth } from '../config/firebase';

const USE_EMULATOR = process.env.USE_FIREBASE_EMULATOR === 'true';
const FIREBASE_FUNCTIONS_URL = USE_EMULATOR
  ? 'http://127.0.0.1:5001/hansendev/us-central1'
  : 'https://us-central1-hansendev.cloudfunctions.net';

interface EmailPreviewModalProps {
  visible: boolean;
  onDismiss: () => void;
  quote: Quote;
  businessSettings: BusinessSettings | null;
  emailBody: string;
  onEmailBodyChange: (body: string) => void;
  onRegenerate: () => void;
  isPro: boolean;
  isRegenerating: boolean;
}

export function EmailPreviewModal({
  visible,
  onDismiss,
  quote,
  businessSettings,
  emailBody,
  onEmailBodyChange,
  onRegenerate,
  isPro,
  isRegenerating,
}: EmailPreviewModalProps) {
  const [recipientEmail, setRecipientEmail] = useState(quote.customerEmail || '');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Reset state when modal opens
  React.useEffect(() => {
    if (visible) {
      setRecipientEmail(quote.customerEmail || '');
      setSent(false);
    }
  }, [visible, quote.customerEmail]);

  const handleSend = async () => {
    if (!recipientEmail.trim()) {
      Alert.alert('Missing Email', 'Please enter the recipient email address.');
      return;
    }

    // Basic email validation
    if (!recipientEmail.includes('@') || !recipientEmail.includes('.')) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }

    setSending(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/sendQuoteEmail`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          quoteId: quote.id,
          emailBody: emailBody,
          recipientEmail: recipientEmail.trim(),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to send email');
      }

      setSent(true);
    } catch (error: any) {
      console.error('Send email error:', error);
      Alert.alert('Send Failed', error.message || 'Could not send the email. Please try again.');
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.container}>
          <View style={styles.successContainer}>
            <View style={styles.successIcon}>
              <MaterialCommunityIcons name="check-circle" size={64} color={colors.primary} />
            </View>
            <Text style={styles.successTitle}>Quote Sent!</Text>
            <Text style={styles.successSubtitle}>
              Your quote has been sent to {recipientEmail}
            </Text>
            <Text style={styles.successHint}>
              You'll be notified when your client responds.
            </Text>
            <Button
              mode="contained"
              onPress={onDismiss}
              style={styles.doneButton}
              contentStyle={styles.doneButtonContent}
            >
              Done
            </Button>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onDismiss} style={styles.headerButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Email Preview</Text>
          <View style={styles.headerButton} />
        </View>

        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          {/* Recipient */}
          <Text style={styles.fieldLabel}>To</Text>
          <TextInput
            value={recipientEmail}
            onChangeText={setRecipientEmail}
            mode="outlined"
            style={styles.recipientInput}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="client@email.com"
          />

          {/* Subject preview */}
          <Text style={styles.fieldLabel}>Subject</Text>
          <View style={styles.subjectPreview}>
            <Text style={styles.subjectText}>
              Quotation from {businessSettings?.businessName || 'Your Business'} - {quote.job.name}
            </Text>
          </View>

          {/* Email body */}
          <View style={styles.bodyHeader}>
            <Text style={styles.fieldLabel}>Email Body</Text>
            {isPro && (
              <TouchableOpacity
                onPress={onRegenerate}
                disabled={isRegenerating}
                style={styles.regenerateButton}
              >
                {isRegenerating ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <MaterialCommunityIcons name="refresh" size={18} color={colors.primary} />
                )}
                <Text style={styles.regenerateText}>
                  {isRegenerating ? 'Generating...' : 'Regenerate'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          <TextInput
            value={emailBody}
            onChangeText={onEmailBodyChange}
            mode="outlined"
            style={styles.bodyInput}
            multiline
            numberOfLines={10}
          />

          {/* Info note */}
          <View style={styles.infoNote}>
            <MaterialCommunityIcons name="information-outline" size={16} color={colors.textMuted} />
            <Text style={styles.infoText}>
              The email will include a pricing table, {quote.photos?.length ? 'job photos, ' : ''}accept/decline buttons, and your business details.
            </Text>
          </View>
        </ScrollView>

        {/* Send button */}
        <View style={styles.footer}>
          <Button
            mode="contained"
            onPress={handleSend}
            loading={sending}
            disabled={sending || !emailBody.trim() || !recipientEmail.trim()}
            style={styles.sendButton}
            contentStyle={styles.sendButtonContent}
            icon="send"
          >
            {sending ? 'Sending...' : 'Send Email'}
          </Button>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 16 : 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerButton: {
    minWidth: 60,
  },
  cancelText: {
    fontSize: 16,
    color: colors.text,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  recipientInput: {
    backgroundColor: colors.surface,
    marginBottom: 16,
    fontSize: 15,
  },
  subjectPreview: {
    backgroundColor: colors.surface,
    borderRadius: 4,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.surfaceLight,
  },
  subjectText: {
    fontSize: 15,
    color: colors.text,
  },
  bodyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  regenerateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  regenerateText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
  },
  bodyInput: {
    backgroundColor: colors.surface,
    marginBottom: 16,
    fontSize: 15,
    minHeight: 200,
  },
  infoNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.surface,
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sendButton: {
    borderRadius: 12,
  },
  sendButtonContent: {
    paddingVertical: 8,
  },
  successContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  successIcon: {
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 4,
  },
  successHint: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 32,
  },
  doneButton: {
    borderRadius: 12,
    minWidth: 120,
  },
  doneButtonContent: {
    paddingVertical: 8,
  },
});
