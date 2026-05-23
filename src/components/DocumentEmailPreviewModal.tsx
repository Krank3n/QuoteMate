/**
 * Document Email Preview Modal
 *
 * Unified modal for previewing/sending the client-facing email for either a
 * quote or an invoice. Branches on `doc.type` for type-specific copy
 * (subject default, header title, AI generating step labels, send-button
 * label, sent-confirmation message) and the underlying Brevo endpoint.
 *
 * Replaces the per-type `EmailPreviewModal` (quotes) and
 * `InvoiceEmailPreviewModal` (invoices).
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  Platform,
  KeyboardAvoidingView,
  Keyboard,
  Animated,
} from 'react-native';
import {
  Text,
  TextInput,
  Button,
  Portal,
  Switch,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets, initialWindowMetrics } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme';
import { BusinessSettings } from '../types';
import { Document } from '../types/document';
import { documentToQuote, documentToInvoice } from '../types/documentAdapter';
import { formatCurrency } from '../utils/quoteCalculator';
import { auth } from '../config/firebase';
import { AlertModal } from './AlertModal';
import { useStore } from '../store/useStore';

const STEP_HEIGHT = 32;
const VISIBLE_STEPS = 3;
const STEP_INTERVAL = 1800;

const QUOTE_EMAIL_STEPS = [
  { icon: 'file-document-outline', text: 'Reading quote details...' },
  { icon: 'head-cog-outline', text: 'Crafting email tone...' },
  { icon: 'text-box-outline', text: 'Writing email body...' },
  { icon: 'check-circle-outline', text: 'Finalizing...' },
];

const INVOICE_EMAIL_STEPS = [
  { icon: 'file-document-outline', text: 'Reading invoice details...' },
  { icon: 'head-cog-outline', text: 'Crafting email tone...' },
  { icon: 'text-box-outline', text: 'Writing email body...' },
  { icon: 'check-circle-outline', text: 'Finalizing...' },
];

function EmailGeneratingState({ steps }: { steps: typeof QUOTE_EMAIL_STEPS }) {
  const [currentStep, setCurrentStep] = useState(0);
  const scrollAnim = useRef(new Animated.Value(0)).current;
  const stepOpacities = useRef(steps.map((_, i) => new Animated.Value(i === 0 ? 1 : 0))).current;
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

    steps.forEach((_, index) => {
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
          {steps.map((step, index) => (
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

interface Props {
  visible: boolean;
  onDismiss: () => void;
  doc: Document;
  businessSettings: BusinessSettings | null;
  emailBody: string;
  onEmailBodyChange: (body: string) => void;
  onRegenerate: () => void;
  isPro: boolean;
  isRegenerating: boolean;
}

export function DocumentEmailPreviewModal({
  visible,
  onDismiss,
  doc,
  businessSettings,
  emailBody,
  onEmailBodyChange,
  onRegenerate,
  isPro,
  isRegenerating,
}: Props) {
  const insets = useSafeAreaInsets();
  // RN's <Modal> renders in its own native view hierarchy, so the root
  // SafeAreaProvider doesn't reach inside — useSafeAreaInsets().bottom
  // returns 0 on iOS and the footer ends up sitting on top of the home
  // indicator. initialWindowMetrics is captured at app startup from native,
  // giving the real bottom inset regardless of tree position. On Android
  // the system already pushes the modal above the nav bar, so adding the
  // inset there would double-pad the footer.
  const fallbackBottom = initialWindowMetrics?.insets.bottom ?? 0;
  const bottomInset = Platform.OS === 'ios'
    ? Math.max(insets.bottom, fallbackBottom, 16)
    : 16;

  const isInvoice = doc.type === 'invoice';
  const { quotes } = useStore();

  // Photos: a quote carries them inline; an invoice borrows them from its
  // source quote when set. Both modals show the same attachment toggle UI.
  const photos = isInvoice
    ? (() => {
        const inv = documentToInvoice(doc);
        return inv.sourceQuoteId
          ? quotes.find((q) => q.id === inv.sourceQuoteId)?.photos || []
          : [];
      })()
    : (documentToQuote(doc).photos || []);

  const subjectPrefix = isInvoice ? 'Invoice from' : 'Quotation from';
  const headerTitle = isInvoice ? 'Invoice Email' : 'Email Preview';
  const sendButtonLabel = isInvoice ? 'Send Invoice' : 'Send Email';
  const sentTitle = isInvoice ? 'Invoice Sent!' : 'Quote Sent!';
  const generatingSteps = isInvoice ? INVOICE_EMAIL_STEPS : QUOTE_EMAIL_STEPS;
  const sendEndpoint = isInvoice
    ? `${FIREBASE_FUNCTIONS_URL}/sendInvoiceEmail`
    : `${FIREBASE_FUNCTIONS_URL}/sendQuoteEmail`;
  const infoNote = isInvoice
    ? `The email will include a pricing breakdown, payment details, and a PDF invoice attachment.${photos.length > 0 ? ' Job photos will be attached.' : ''}`
    : `The email will include a pricing table, ${photos.length > 0 ? 'job photos, ' : ''}accept/decline buttons, and your business details.`;

  const [recipientEmail, setRecipientEmail] = useState(doc.customerEmail || '');
  const [subject, setSubject] = useState(
    `${subjectPrefix} ${businessSettings?.businessName || 'Your Business'} - ${doc.job.name}`
  );
  const [sending, setSending] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [sent, setSent] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [emailError, setEmailError] = useState('');
  const ownerEmail = auth.currentUser?.email || '';
  const hasPhotos = photos.length > 0;
  const [includePhotos, setIncludePhotos] = useState(true);

  // Keyboard UX state
  const scrollViewRef = useRef<ScrollView>(null);
  const [isBodyFocused, setIsBodyFocused] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const isEditingBody = isBodyFocused && isKeyboardVisible;

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        setIsKeyboardVisible(true);
        setKeyboardHeight(e.endCoordinates.height);
      },
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setIsKeyboardVisible(false);
        setKeyboardHeight(0);
      },
    );
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const handleBodyFocus = () => {
    setIsBodyFocused(true);
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    }, 150);
  };

  const handleBodyBlur = () => {
    setIsBodyFocused(false);
  };

  const handleCollapsedBarPress = () => {
    Keyboard.dismiss();
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    }, 100);
  };

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
      setRecipientEmail(doc.customerEmail || '');
      setSubject(`${subjectPrefix} ${businessSettings?.businessName || 'Your Business'} - ${doc.job.name}`);
      setSent(false);
      setEmailTouched(false);
      setEmailError('');
    }
  }, [visible, doc.customerEmail, doc.job.name, businessSettings?.businessName, subjectPrefix]);

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

  // Build the request body for the cloud function. Server-side handlers
  // accept the legacy `quote` / `invoice` shape (plus `quoteId` /
  // `invoiceId`); we adapt the unified Document back via the legacy adapter
  // so the user's latest in-memory edits are sent rather than waiting for a
  // Firestore round-trip.
  const buildRequestBody = (recipient: string, isTestSend: boolean) => {
    const trimmedSubject = subject.trim();
    if (isInvoice) {
      const invoice = documentToInvoice(doc);
      return {
        invoiceId: doc.id,
        invoice,
        emailBody,
        recipientEmail: recipient,
        ...(isTestSend ? { isTestSend: true } : {}),
        includePhotos: hasPhotos && includePhotos,
        ...(trimmedSubject ? { subject: trimmedSubject } : {}),
      };
    }
    const quote = documentToQuote(doc);
    return {
      quoteId: doc.id,
      quote,
      emailBody,
      recipientEmail: recipient,
      ...(isTestSend ? { isTestSend: true } : {}),
      includePhotos: hasPhotos && includePhotos,
      ...(trimmedSubject ? { subject: trimmedSubject } : {}),
    };
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
      const response = await fetch(sendEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify(buildRequestBody(recipientEmail.trim(), false)),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to send email');
      }

      setSent(true);
    } catch (error: any) {
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
      const response = await fetch(sendEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify(buildRequestBody(ownerEmail, true)),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to send test email');
      }

      showAlert('success', 'Test Sent', `A test email has been sent to ${ownerEmail}`);
    } catch (error: any) {
      showAlert('error', 'Test Failed', error.message || 'Could not send test email.');
    } finally {
      setSendingTest(false);
    }
  };

  const sentMessage = isInvoice && doc.dueDate
    ? `Your invoice has been sent to ${recipientEmail}\n${formatCurrency(doc.total)} due by ${format(new Date(doc.dueDate), 'dd MMM yyyy')}`
    : `Your ${isInvoice ? 'invoice' : 'quote'} has been sent to ${recipientEmail}`;

  const innerKav = (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <LinearGradient
        colors={['#00785a', colors.primary, '#00b07a']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.header, { paddingTop: insets.top + 12 }]}
      >
        <TouchableOpacity onPress={onDismiss} style={styles.headerButton}>
          <MaterialCommunityIcons name="chevron-left" size={26} color={colors.white} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{headerTitle}</Text>
        <View style={styles.headerButton} />
      </LinearGradient>

      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          isEditingBody && styles.scrollContentEditing,
          keyboardHeight > 0 && { paddingBottom: keyboardHeight },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {isEditingBody ? (
          /* Collapsed Recipient + Subject bar */
          <TouchableOpacity
            style={styles.collapsedBar}
            onPress={handleCollapsedBarPress}
            activeOpacity={0.7}
          >
            <View style={styles.collapsedBarContent}>
              <MaterialCommunityIcons name="account-outline" size={14} color={colors.textMuted} />
              <Text style={styles.collapsedBarText} numberOfLines={1}>
                {recipientEmail || 'No recipient'}
              </Text>
              <Text style={styles.collapsedBarDivider}>|</Text>
              <MaterialCommunityIcons name="tag-outline" size={14} color={colors.textMuted} />
              <Text style={styles.collapsedBarText} numberOfLines={1}>
                {subject || 'No subject'}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-down" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        ) : (
          <>
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
          </>
        )}

        {/* Email Body Card */}
        <View style={[styles.sectionCard, isEditingBody && styles.sectionCardEditing]}>
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
            <EmailGeneratingState steps={generatingSteps} />
          ) : (
            <View style={[styles.bodyCard, isEditingBody && styles.bodyCardEditing]}>
              <TextInput
                value={emailBody}
                onChangeText={onEmailBodyChange}
                onFocus={handleBodyFocus}
                onBlur={handleBodyBlur}
                mode="flat"
                style={[styles.bodyInput, isEditingBody && styles.bodyInputEditing]}
                multiline
                numberOfLines={12}
                underlineColor="transparent"
                activeUnderlineColor="transparent"
              />
            </View>
          )}
        </View>

        {/* Photo attachment toggle - hidden when editing body */}
        {!isEditingBody && hasPhotos && (
          <View style={styles.sectionCard}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleLeft}>
                <View style={[styles.sectionIconCircle, { backgroundColor: colors.successBg }]}>
                  <MaterialCommunityIcons name="image-multiple-outline" size={18} color={colors.success} />
                </View>
                <View style={styles.toggleTextContainer}>
                  <Text style={styles.sectionTitle}>Attach Job Photos</Text>
                  <Text style={styles.toggleSubtext}>{photos.length} photo{photos.length > 1 ? 's' : ''} will be attached</Text>
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

        {/* Info note - hidden when editing body */}
        {!isEditingBody && (
          <View style={styles.infoNote}>
            <MaterialCommunityIcons name="information-outline" size={16} color={colors.textMuted} />
            <Text style={styles.infoText}>{infoNote}</Text>
          </View>
        )}
      </ScrollView>

      {/* Footer: Done bar when editing body, send buttons otherwise */}
      {isEditingBody ? (
        <View style={styles.doneBar}>
          <TouchableOpacity onPress={() => Keyboard.dismiss()} style={styles.doneButton}>
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      ) : !isKeyboardVisible ? (
        <View style={[styles.footer, { paddingBottom: bottomInset }]}>
          <View style={styles.footerButtons}>
            {ownerEmail ? (
              <View style={styles.footerButtonHalfWrapper}>
                <Button
                  mode="outlined"
                  onPress={handleTestSend}
                  loading={sendingTest}
                  disabled={sendingTest || sending || !emailBody.trim() || isRegenerating}
                  style={styles.footerButtonFlex}
                  contentStyle={styles.sendButtonContent}
                  icon="email-check-outline"
                >
                  {sendingTest ? 'Sending...' : 'Test Send'}
                </Button>
              </View>
            ) : null}
            <View style={styles.footerButtonHalfWrapper}>
              <Button
                mode="contained"
                onPress={handleSend}
                loading={sending}
                disabled={sending || sendingTest || !emailBody.trim() || !!validateEmail(recipientEmail) || isRegenerating}
                style={styles.footerButtonFlex}
                contentStyle={styles.sendButtonContent}
                icon="send"
              >
                {sending ? 'Sending...' : sendButtonLabel}
              </Button>
            </View>
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" statusBarTranslucent>
      {/* Quote modal historically wraps in Portal.Host so menus rendered
          inside the modal anchor correctly; invoice modal didn't need it.
          Wrap everything in Portal.Host now to keep menu/popup positioning
          consistent across both flows. */}
      <Portal.Host>
        {innerKav}

        {/* Alert modals rendered outside KAV so they appear on top */}
        <AlertModal
          visible={sent}
          onDismiss={onDismiss}
          type="success"
          icon="email-check"
          title={sentTitle}
          message={sentMessage}
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
      </Portal.Host>
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
    flexDirection: 'row',
    alignItems: 'center',
  },
  backText: {
    fontSize: 16,
    color: colors.white,
    fontWeight: '600',
    marginLeft: -2,
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
  scrollContentEditing: {
    flexGrow: 1,
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
  sectionCardEditing: {
    flex: 1,
  },
  bodyCard: {
    backgroundColor: colors.background,
    borderRadius: 10,
    overflow: 'hidden',
  },
  bodyCardEditing: {
    flex: 1,
  },
  bodyInput: {
    backgroundColor: 'transparent',
    fontSize: 15,
    lineHeight: 24,
    minHeight: 200,
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  bodyInputEditing: {
    flex: 1,
    minHeight: undefined,
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
    // Match the quote flow's bottomBar (QuotePreviewScreen.tsx) so the
    // footer button area looks identical across the app. The dynamic
    // paddingBottom is applied inline at the call site via insets.bottom.
    paddingHorizontal: 16,
    paddingTop: 14,
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
    alignItems: 'center',
    width: '100%',
    gap: 12,
  },
  footerButtonHalfWrapper: {
    flex: 1,
  },
  footerButtonFlex: {
    width: '100%',
    margin: 0,
  },
  sendButtonContent: {
    paddingVertical: 8,
  },
  collapsedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
    gap: 8,
  },
  collapsedBarContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  collapsedBarText: {
    fontSize: 13,
    color: colors.textMuted,
    flexShrink: 1,
  },
  collapsedBarDivider: {
    fontSize: 13,
    color: colors.border,
    marginHorizontal: 2,
  },
  doneBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  doneButton: {
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  doneButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
});
