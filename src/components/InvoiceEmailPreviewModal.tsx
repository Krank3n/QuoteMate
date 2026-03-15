/**
 * Invoice Email Preview Modal
 * Shows AI-generated or default email body with edit capability
 * Sends invoice via Brevo cloud function with PDF attachment
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
  KeyboardAvoidingView,
  Animated,
} from 'react-native';
import {
  Text,
  TextInput,
  Button,
  Switch,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import { colors } from '../theme';
import { Invoice, BusinessSettings } from '../types';
import { formatCurrency } from '../utils/quoteCalculator';
import { auth } from '../config/firebase';
import { AlertModal } from './AlertModal';

// AI Email Generation Steps
const EMAIL_STEPS = [
  { icon: 'file-document-outline', text: 'Reading invoice details...' },
  { icon: 'head-cog-outline', text: 'Crafting email tone...' },
  { icon: 'text-box-outline', text: 'Writing email body...' },
  { icon: 'check-circle-outline', text: 'Finalizing...' },
];

const STEP_HEIGHT = 32;
const VISIBLE_STEPS = 3;
const STEP_INTERVAL = 1800;

function EmailGeneratingState() {
  const [currentStep, setCurrentStep] = useState(0);
  const scrollAnim = useRef(new Animated.Value(0)).current;
  const stepOpacities = useRef(EMAIL_STEPS.map((_, i) => new Animated.Value(i === 0 ? 1 : 0))).current;
  const pulseAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 1000, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    EMAIL_STEPS.forEach((_, index) => {
      if (index === 0) return;
      const timer = setTimeout(() => {
        setCurrentStep(index);

        Animated.timing(stepOpacities[index], {
          toValue: 1,
          duration: 350,
          useNativeDriver: true,
        }).start();

        if (index >= VISIBLE_STEPS) {
          Animated.timing(scrollAnim, {
            toValue: (index - VISIBLE_STEPS + 1) * STEP_HEIGHT,
            duration: 400,
            useNativeDriver: true,
          }).start();

          const fadeOutIndex = index - VISIBLE_STEPS;
          if (fadeOutIndex >= 0) {
            Animated.timing(stepOpacities[fadeOutIndex], {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }).start();
          }
        }
      }, index * STEP_INTERVAL);
      timers.push(timer);
    });

    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <View style={styles.generatingContainer}>
      <Animated.View style={[styles.generatingIconWrapper, { opacity: pulseAnim }]}>
        <MaterialCommunityIcons name="email-edit-outline" size={48} color={colors.primary} />
      </Animated.View>

      <Text style={styles.generatingTitle}>Generating your email...</Text>

      <View style={styles.stepsWindow}>
        <Animated.View
          style={[
            styles.stepsTrack,
            { transform: [{ translateY: Animated.multiply(scrollAnim, -1) }] },
          ]}
        >
          {EMAIL_STEPS.map((step, index) => (
            <Animated.View
              key={index}
              style={[
                styles.stepRow,
                { opacity: stepOpacities[index] },
              ]}
            >
              <MaterialCommunityIcons
                name={index < currentStep ? 'check-circle' as any : step.icon as any}
                size={16}
                color={index < currentStep ? colors.success : index === currentStep ? colors.primary : colors.textMuted}
              />
              <Text
                style={[
                  styles.stepText,
                  index < currentStep && styles.stepTextDone,
                  index === currentStep && styles.stepTextActive,
                ]}
                numberOfLines={1}
              >
                {step.text}
              </Text>
            </Animated.View>
          ))}
        </Animated.View>
      </View>
    </View>
  );
}

const USE_EMULATOR = process.env.USE_FIREBASE_EMULATOR === 'true';
const FIREBASE_FUNCTIONS_URL = USE_EMULATOR
  ? 'http://127.0.0.1:5001/hansendev/us-central1'
  : 'https://us-central1-hansendev.cloudfunctions.net';

interface InvoiceEmailPreviewModalProps {
  visible: boolean;
  onDismiss: () => void;
  invoice: Invoice;
  businessSettings: BusinessSettings | null;
  emailBody: string;
  onEmailBodyChange: (body: string) => void;
  onRegenerate: () => void;
  isPro: boolean;
  isRegenerating: boolean;
  photoCount?: number;
}

export function InvoiceEmailPreviewModal({
  visible,
  onDismiss,
  invoice,
  businessSettings,
  emailBody,
  onEmailBodyChange,
  onRegenerate,
  isPro,
  isRegenerating,
  photoCount = 0,
}: InvoiceEmailPreviewModalProps) {
  const insets = useSafeAreaInsets();
  const [recipientEmail, setRecipientEmail] = useState(invoice.customerEmail || '');
  const [subject, setSubject] = useState(
    `Invoice from ${businessSettings?.businessName || 'Your Business'} - ${invoice.job.name}`
  );
  const [sending, setSending] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [sent, setSent] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [emailError, setEmailError] = useState('');
  const ownerEmail = auth.currentUser?.email || '';
  const hasPhotos = photoCount > 0;
  const [includePhotos, setIncludePhotos] = useState(true);

  // Alert modal state
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertType, setAlertType] = useState<'success' | 'error'>('success');
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');

  const showAlert = (type: 'success' | 'error', title: string, message: string) => {
    setAlertType(type);
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertVisible(true);
  };

  const validateEmail = (email: string): string => {
    const trimmed = email.trim();
    if (!trimmed) return 'Email address is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'Please enter a valid email address';
    return '';
  };

  // Reset state when modal opens
  React.useEffect(() => {
    if (visible) {
      setRecipientEmail(invoice.customerEmail || '');
      setSubject(`Invoice from ${businessSettings?.businessName || 'Your Business'} - ${invoice.job.name}`);
      setSent(false);
      setEmailTouched(false);
      setEmailError('');
    }
  }, [visible, invoice.customerEmail, invoice.job.name, businessSettings?.businessName]);

  const handleEmailChange = (text: string) => {
    setRecipientEmail(text);
    if (emailTouched) {
      setEmailError(validateEmail(text));
    }
  };

  const handleEmailBlur = () => {
    setEmailTouched(true);
    setEmailError(validateEmail(recipientEmail));
  };

  const handleSend = async () => {
    const error = validateEmail(recipientEmail);
    if (error) {
      setEmailTouched(true);
      setEmailError(error);
      return;
    }

    setSending(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/sendInvoiceEmail`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          invoiceId: invoice.id,
          emailBody: emailBody,
          recipientEmail: recipientEmail.trim(),
          includePhotos: hasPhotos && includePhotos,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to send email');
      }

      setSent(true);
    } catch (error: any) {
      console.error('Send invoice email error:', error);
      showAlert('error', 'Send Failed', error.message || 'Could not send the email. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleTestSend = async () => {
    if (!ownerEmail) {
      showAlert('error', 'No Email', 'Could not find your account email.');
      return;
    }

    setSendingTest(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/sendInvoiceEmail`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          invoiceId: invoice.id,
          emailBody: emailBody,
          recipientEmail: ownerEmail,
          isTestSend: true,
          includePhotos: hasPhotos && includePhotos,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to send test email');
      }

      showAlert('success', 'Test Sent', `A test email has been sent to ${ownerEmail}`);
    } catch (error: any) {
      console.error('Test send error:', error);
      showAlert('error', 'Test Failed', error.message || 'Could not send test email.');
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" statusBarTranslucent>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity onPress={onDismiss} style={styles.headerButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Invoice Email</Text>
          <View style={styles.headerButton} />
        </View>

        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          {/* Recipient Card */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionIconCircle, { backgroundColor: colors.infoBg }]}>
                <MaterialCommunityIcons name="account-outline" size={18} color={colors.info} />
              </View>
              <Text style={styles.sectionTitle}>Recipient</Text>
            </View>
            <TextInput
              value={recipientEmail}
              onChangeText={handleEmailChange}
              onBlur={handleEmailBlur}
              mode="outlined"
              style={styles.recipientInput}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="client@email.com"
              placeholderTextColor={colors.textMuted}
              error={emailTouched && !!emailError}
            />
            {emailTouched && !!emailError && (
              <Text style={styles.emailErrorText}>{emailError}</Text>
            )}
          </View>

          {/* Subject Card */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionIconCircle, { backgroundColor: colors.warningBg }]}>
                <MaterialCommunityIcons name="tag-outline" size={18} color={colors.secondary} />
              </View>
              <Text style={styles.sectionTitle}>Subject</Text>
            </View>
            <TextInput
              value={subject}
              onChangeText={setSubject}
              mode="outlined"
              style={styles.subjectInput}
            />
          </View>

          {/* Email Body Card */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionIconCircle, { backgroundColor: colors.primaryBg }]}>
                <MaterialCommunityIcons name="email-edit-outline" size={18} color={colors.primary} />
              </View>
              <Text style={[styles.sectionTitle, { flex: 1 }]}>Email Body</Text>
              {isPro && !isRegenerating && (
                <TouchableOpacity
                  onPress={onRegenerate}
                  style={styles.regenerateButton}
                >
                  <MaterialCommunityIcons name="refresh" size={16} color={colors.primary} />
                  <Text style={styles.regenerateText}>Regenerate</Text>
                </TouchableOpacity>
              )}
            </View>

            {isRegenerating ? (
              <EmailGeneratingState />
            ) : (
              <View style={styles.bodyCard}>
                <TextInput
                  value={emailBody}
                  onChangeText={onEmailBodyChange}
                  mode="flat"
                  style={styles.bodyInput}
                  multiline
                  numberOfLines={12}
                  underlineColor="transparent"
                  activeUnderlineColor="transparent"
                />
              </View>
            )}
          </View>

          {/* Photo attachment toggle */}
          {hasPhotos && (
            <View style={styles.sectionCard}>
              <View style={styles.toggleRow}>
                <View style={styles.toggleLeft}>
                  <View style={[styles.sectionIconCircle, { backgroundColor: colors.successBg }]}>
                    <MaterialCommunityIcons name="image-multiple-outline" size={18} color={colors.success} />
                  </View>
                  <View style={styles.toggleTextContainer}>
                    <Text style={styles.sectionTitle}>Attach Job Photos</Text>
                    <Text style={styles.toggleSubtext}>{photoCount} photo{photoCount > 1 ? 's' : ''} will be attached</Text>
                  </View>
                </View>
                <Switch
                  value={includePhotos}
                  onValueChange={setIncludePhotos}
                  color={colors.primary}
                />
              </View>
            </View>
          )}

          {/* Info note */}
          <View style={styles.infoNote}>
            <MaterialCommunityIcons name="information-outline" size={16} color={colors.textMuted} />
            <Text style={styles.infoText}>
              The email will include a pricing breakdown, payment details, and a PDF invoice attachment.{hasPhotos && includePhotos ? ' Job photos will be attached.' : ''}
            </Text>
          </View>
        </ScrollView>

        {/* Send buttons */}
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.footerButtons}>
            {ownerEmail ? (
              <Button
                mode="outlined"
                onPress={handleTestSend}
                loading={sendingTest}
                disabled={sendingTest || sending || !emailBody.trim() || isRegenerating}
                style={styles.testButton}
                contentStyle={styles.sendButtonContent}
                icon="email-check-outline"
                compact
              >
                {sendingTest ? 'Sending...' : 'Test Send'}
              </Button>
            ) : null}
            <Button
              mode="contained"
              onPress={handleSend}
              loading={sending}
              disabled={sending || sendingTest || !emailBody.trim() || !!validateEmail(recipientEmail) || isRegenerating}
              style={styles.sendButton}
              contentStyle={styles.sendButtonContent}
              icon="send"
            >
              {sending ? 'Sending...' : 'Send Invoice'}
            </Button>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Alert modals rendered outside KAV so they appear on top */}
      <AlertModal
        visible={sent}
        onDismiss={onDismiss}
        type="success"
        icon="email-check"
        title="Invoice Sent!"
        message={`Your invoice has been sent to ${recipientEmail}\n${formatCurrency(invoice.total)} due by ${format(new Date(invoice.dueDate), 'dd MMM yyyy')}`}
        primaryButtonText="Done"
        primaryButtonAction={onDismiss}
      />
      <AlertModal
        visible={alertVisible}
        onDismiss={() => setAlertVisible(false)}
        type={alertType}
        icon={alertType === 'success' ? 'check-circle' : 'alert-circle'}
        title={alertTitle}
        message={alertMessage}
        primaryButtonText="OK"
        primaryButtonAction={() => setAlertVisible(false)}
        showConfetti={alertType === 'success'}
      />
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
    paddingBottom: 14,
    backgroundColor: colors.primary,
  },
  headerButton: {
    minWidth: 60,
  },
  cancelText: {
    fontSize: 16,
    color: colors.white,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.white,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  sectionIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  recipientInput: {
    backgroundColor: 'transparent',
    marginBottom: 0,
    fontSize: 15,
    color: colors.text,
  },
  emailErrorText: {
    fontSize: 12,
    color: colors.error,
    marginTop: 4,
    marginLeft: 4,
  },
  subjectInput: {
    backgroundColor: 'transparent',
    fontSize: 15,
    marginBottom: 0,
  },
  regenerateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary + '15',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  regenerateText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
  },
  bodyCard: {
    backgroundColor: colors.background,
    borderRadius: 10,
    overflow: 'hidden',
  },
  bodyInput: {
    backgroundColor: 'transparent',
    fontSize: 15,
    lineHeight: 24,
    minHeight: 200,
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  generatingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
    backgroundColor: colors.background,
    borderRadius: 10,
    minHeight: 200,
  },
  generatingIconWrapper: {
    marginBottom: 16,
  },
  generatingTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 16,
    textAlign: 'center',
  },
  stepsWindow: {
    height: STEP_HEIGHT * VISIBLE_STEPS,
    overflow: 'hidden',
    alignItems: 'center',
  },
  stepsTrack: {
    alignItems: 'center',
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: STEP_HEIGHT,
    gap: 10,
  },
  stepText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  stepTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  stepTextDone: {
    color: colors.success,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  toggleTextContainer: {
    flex: 1,
  },
  toggleSubtext: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  infoNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: 14,
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
    backgroundColor: colors.surface,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.15,
        shadowRadius: 6,
      },
      android: { elevation: 8 },
    }),
  },
  footerButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  testButton: {
    borderRadius: 12,
    borderColor: colors.surfaceLight,
  },
  sendButton: {
    flex: 1,
    borderRadius: 12,
  },
  sendButtonContent: {
    paddingVertical: 8,
  },
});
