/**
 * Document Email Preview Modal
 *
 * Unified modal for previewing/sending the client-facing email for either a
 * quote or an invoice. Branches on `doc.type` for type-specific copy
 * (subject default, header title, send-button label, sent-confirmation
 * message) and the underlying Brevo endpoint.
 *
 * Jul 2026 send audit: this screen used to open as a writing task — a
 * scripted "generating" checklist, an editable body with a markdown toolbar,
 * and a Test Send button with the same weight as Send. The default posture
 * is now READ-ONLY: a short preview of the email and one prominent Send.
 * Editing is a deliberate step behind "Edit email", and Test Send is a link.
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
  Keyboard,
} from 'react-native';
import {
  Text,
  TextInput,
  Button,
  Portal,
  Switch,
  ActivityIndicator,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useModalInsets } from '../hooks/useModalInsets';
import { format } from 'date-fns';
import { LinearGradient } from 'expo-linear-gradient';
import { makeStyles, useThemeColors } from '../theme';
import { BusinessSettings } from '../types';
import { Document } from '../types/document';
import { documentToQuote, documentToInvoice } from '../types/documentAdapter';
import { formatCurrency } from '../utils/quoteCalculator';
import { reviewQuoteMaterials, buildPresendWarning, type PresendWarning } from '../utils/quoteReview';
import { auth } from '../config/firebase';
import { AlertModal } from './AlertModal';
import { useStore } from '../store/useStore';
import { trackEvent } from '../services/analyticsService';
import { isEmailAddress, isSelfSend } from '../utils/sendFlow';
import { maybePromptForPushPermission } from '../services/pushPermissionPrompt';
import { resolvePriceDetail, showsPerLineMoney } from '../../shared/document/priceDetail';

/**
 * Honest indeterminate wait. The old version ran a four-step checklist on a
 * fixed 1.8s-per-step timer — ~5.4s of scripted progress unrelated to the
 * actual request, which then parked on "Finalizing...". With the body warmed
 * on JobPreview this state usually never renders at all.
 */
function EmailGeneratingState() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  return (
    <View style={styles.generatingContainer}>
      <ActivityIndicator size="small" color={themeColors.accentText} />
      <Text style={styles.generatingTitle}>Writing your email…</Text>
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
  subject: string;
  onSubjectChange: (subject: string) => void;
  onRegenerate: () => void;
  /**
   * Fired once the email is actually away. The host uses it to decide what
   * happens after the preview closes (e.g. the post-send pay-link ask).
   */
  onSent?: () => void;
  /** Opens the full send sheet — SMS / Share / Export PDF. */
  onMoreWaysToSend?: () => void;
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
  subject,
  onSubjectChange,
  onRegenerate,
  onSent,
  onMoreWaysToSend,
  isPro,
  isRegenerating,
}: Props) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  // Android used to be excluded from this (a flat 16), on the reasoning that
  // the system pushed modals above the nav bar. Edge-to-edge ended that: the
  // send footer was sitting under the back/home/recents buttons. Both
  // platforms now take the real inset — see utils/modalInsets.
  const insets = useModalInsets();
  const bottomInset = insets.bottom;

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

  const docType = isInvoice ? 'invoice' : 'quote';
  const headerTitle = isInvoice ? 'Invoice Email' : 'Email Preview';
  const sendButtonLabel = isInvoice ? 'Send Invoice' : 'Send Quote';
  const sentTitle = isInvoice ? 'Invoice Sent!' : 'Quote Sent!';
  const sendEndpoint = isInvoice
    ? `${FIREBASE_FUNCTIONS_URL}/sendInvoiceEmail`
    : `${FIREBASE_FUNCTIONS_URL}/sendQuoteEmail`;
  const infoNote = isInvoice
    ? `The email will include a pricing breakdown, payment details, and a PDF invoice attachment.${photos.length > 0 ? ' Job photos will be attached.' : ''}`
    : `The email will include a pricing table, ${photos.length > 0 ? 'job photos, ' : ''}accept/decline buttons, and your business details.`;

  const [recipientEmail, setRecipientEmail] = useState(doc.customerEmail || '');
  const [sending, setSending] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [sent, setSent] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [emailError, setEmailError] = useState('');
  const ownerEmail = auth.currentUser?.email || '';
  const hasPhotos = photos.length > 0;
  const [includePhotos, setIncludePhotos] = useState(true);
  // "Email me a copy" — BCCs the tradie's account email on the real send so
  // they keep the exact email the customer received. Test sends already go
  // to the tradie, so the flag is only sent for real sends.
  const [sendCopyToSelf, setSendCopyToSelf] = useState(false);

  // Keyboard UX state
  const scrollViewRef = useRef<ScrollView>(null);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // Editing is an explicit mode, not the default posture. Off = read-only
  // preview + prominent Send; on = full-height editor with the formatting
  // toolbar, the recipient/subject cards collapsed to a single bar.
  const [isEditingBody, setIsEditingBody] = useState(false);
  // Did the tradie actually touch the body? Distinguishes an edited email
  // from one that merely arrived after the preview opened.
  const [bodyEdited, setBodyEdited] = useState(false);

  // Body formatting toolbar. We track the last known caret/selection in a
  // ref (cheap, no re-renders) and only set the controlled `selection`
  // prop briefly after a toolbar action so the caret lands inside the
  // inserted markup. The pending value clears on the next event loop so
  // the user can move the caret freely afterwards.
  const bodySelectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const [pendingBodySelection, setPendingBodySelection] = useState<{ start: number; end: number } | undefined>(undefined);

  useEffect(() => {
    if (!pendingBodySelection) return;
    const id = setTimeout(() => setPendingBodySelection(undefined), 50);
    return () => clearTimeout(id);
  }, [pendingBodySelection]);

  // Every user-driven body change funnels through here so `edited_body` on
  // the abandonment event stays honest.
  const handleBodyChange = (next: string) => {
    setBodyEdited(true);
    onEmailBodyChange(next);
  };

  const applyBold = () => {
    const { start, end } = bodySelectionRef.current;
    const safeStart = Math.min(start, emailBody.length);
    const safeEnd = Math.min(end, emailBody.length);
    const before = emailBody.slice(0, safeStart);
    const selected = emailBody.slice(safeStart, safeEnd);
    const after = emailBody.slice(safeEnd);
    if (selected.length > 0) {
      handleBodyChange(`${before}**${selected}**${after}`);
      setPendingBodySelection({ start: safeStart + 2, end: safeEnd + 2 });
    } else {
      const placeholder = 'bold text';
      handleBodyChange(`${before}**${placeholder}**${after}`);
      const cursor = safeStart + 2;
      setPendingBodySelection({ start: cursor, end: cursor + placeholder.length });
    }
  };

  const applyBullet = () => {
    const { start, end } = bodySelectionRef.current;
    const safeStart = Math.min(start, emailBody.length);
    const safeEnd = Math.min(end, emailBody.length);
    const lineStart = emailBody.lastIndexOf('\n', safeStart - 1) + 1;
    let lineEnd = emailBody.indexOf('\n', safeEnd);
    if (lineEnd === -1) lineEnd = emailBody.length;
    const block = emailBody.slice(lineStart, lineEnd);
    const lines = block.split('\n');
    const allBulleted = lines.every((l) => /^\s*[-*•]\s+/.test(l) || l.trim() === '');
    const transformed = lines
      .map((l) => {
        if (l.trim() === '') return l;
        if (allBulleted) return l.replace(/^(\s*)[-*•]\s+/, '$1');
        return `- ${l}`;
      })
      .join('\n');
    const next = `${emailBody.slice(0, lineStart)}${transformed}${emailBody.slice(lineEnd)}`;
    handleBodyChange(next);
    const cursor = lineStart + transformed.length;
    setPendingBodySelection({ start: cursor, end: cursor });
  };

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
        // Leaving the keyboard leaves edit mode. isEditingBody used to be
        // derived (isBodyFocused && isKeyboardVisible) and is now standalone
        // state, but the footer still renders the Done bar INSTEAD of the send
        // buttons while it's true. So on Android, dismissing the keyboard with
        // system Back stranded the tradie on the send screen with no Send
        // button at all — the one action this screen exists for — and the
        // obvious way out (the header's Back chevron) abandons the send.
        setIsEditingBody(false);
      },
    );
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const startEditingBody = () => {
    setIsEditingBody(true);
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    }, 150);
  };

  const stopEditingBody = () => {
    Keyboard.dismiss();
    setIsEditingBody(false);
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
    if (!isEmailAddress(trimmed)) return 'Please enter a valid email address';
    return '';
  };

  // Reset transient state when modal opens. Subject is owned by the parent
  // (SendDocumentDialog) and seeded from draftEmailSubject there, so it
  // intentionally isn't touched here — otherwise edits would be wiped on
  // close/reopen.
  React.useEffect(() => {
    if (visible) {
      setRecipientEmail(doc.customerEmail || '');
      setSent(false);
      setEmailTouched(false);
      setEmailError('');
      setSendCopyToSelf(false);
      setIsEditingBody(false);
      setBodyEdited(false);
    }
  }, [visible, doc.customerEmail]);

  /**
   * Close the preview. Anything other than a completed send is a drop-off —
   * the exact one the Jul 2026 audit couldn't see, since 40 tradies stalled
   * here holding a finished, priced quote.
   */
  const handleDismiss = () => {
    if (!sent) {
      trackEvent('email_preview_abandoned', {
        doc_type: docType,
        had_recipient: !!recipientEmail.trim(),
        edited_body: bodyEdited,
      });
    }
    onDismiss();
  };

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
        ...(!isTestSend && sendCopyToSelf ? { sendCopyToSelf: true } : {}),
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
      ...(!isTestSend && sendCopyToSelf ? { sendCopyToSelf: true } : {}),
    };
  };

  // Pre-send gate: a document with $0 rows shows $0 line items to the
  // customer. The pipeline leaves rows deliberately unpriced when only the
  // tradie knows the number (services, custom supply) — this is the moment
  // they either fix them or consciously send anyway. Test sends skip it.
  const [presendWarning, setPresendWarning] = useState<PresendWarning | null>(null);

  const handleSend = async () => {
    const error = validateEmail(recipientEmail);
    if (error) {
      setEmailTouched(true);
      setEmailError(error);
      return;
    }

    const warning = buildPresendWarning(
      reviewQuoteMaterials(doc.materials, doc.sections),
      doc.type === 'invoice' ? 'invoice' : 'quote',
      {
        materialsShownToCustomer: showsPerLineMoney(resolvePriceDetail(doc, businessSettings)),
        customerName: doc.customerName,
      },
    );
    if (warning) {
      setPresendWarning(warning);
      return;
    }

    await doSend();
  };

  const doSend = async () => {
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
      const selfSend = isSelfSend(recipientEmail, ownerEmail);
      trackEvent('quote_send_succeeded', {
        doc_type: docType,
        method: 'email',
        to_self: selfSend,
      });
      // Now that a real customer has the document, offer to tell them when it
      // gets opened, accepted or paid. No-ops if already asked or granted.
      void maybePromptForPushPermission({ isSelfSend: selfSend }).catch(() => {});
      onSent?.();
    } catch (error: any) {
      showAlert('error', 'Send Failed', error.message || 'Could not send the email. Please try again.');
    } finally {
      setSending(false);
    }
  };

  // Deliberately does NOT record a send: a test lands in the tradie's own
  // inbox and the doc stays a draft. Demoted to a link for the same reason —
  // two of the Jul 2026 audit's users test-sent and never sent for real.
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

      showAlert(
        'success',
        'Test Sent',
        `A test email has been sent to ${ownerEmail}. Have a look, then send it to your customer.`,
      );
    } catch (error: any) {
      showAlert('error', 'Test Failed', error.message || 'Could not send test email.');
    } finally {
      setSendingTest(false);
    }
  };

  const sentMessage = isInvoice && doc.dueDate
    ? `Your invoice has been sent to ${recipientEmail}\n${formatCurrency(doc.total)} due by ${format(new Date(doc.dueDate), 'dd MMM yyyy')}`
    : `Your ${isInvoice ? 'invoice' : 'quote'} has been sent to ${recipientEmail}`;

  // No keyboard-avoiding wrapper: this modal does its own, by padding the
  // scroll content with `keyboardHeight` (below) and swapping the footer for a
  // Done bar while the keyboard is up. See hooks/useKeyboardHeight for why a
  // KeyboardAvoidingView is the wrong tool inside a react-native <Modal>.
  const modalContent = (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient
        colors={[themeColors.accentText, themeColors.accent, themeColors.accentText]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.header, { paddingTop: insets.top + 12 }]}
      >
        <TouchableOpacity onPress={handleDismiss} style={styles.headerButton}>
          <MaterialCommunityIcons name="chevron-left" size={26} color={themeColors.onAccent} />
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
            onPress={stopEditingBody}
            activeOpacity={0.7}
          >
            <View style={styles.collapsedBarContent}>
              <MaterialCommunityIcons name="account-outline" size={14} color={themeColors.textMuted} />
              <Text style={styles.collapsedBarText} numberOfLines={1}>
                {recipientEmail || 'No recipient'}
              </Text>
              <Text style={styles.collapsedBarDivider}>|</Text>
              <MaterialCommunityIcons name="tag-outline" size={14} color={themeColors.textMuted} />
              <Text style={styles.collapsedBarText} numberOfLines={1}>
                {subject || 'No subject'}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-down" size={18} color={themeColors.textMuted} />
          </TouchableOpacity>
        ) : (
          <>
            {/* Recipient Card */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionIconCircle, { backgroundColor: themeColors.infoSubtle }]}>
                  <MaterialCommunityIcons name="account-outline" size={18} color={themeColors.info} />
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
                placeholderTextColor={themeColors.textMuted}
                error={emailTouched && !!emailError}
              />
              {emailTouched && !!emailError && (
                <Text style={styles.emailErrorText}>{emailError}</Text>
              )}
            </View>

            {/* Subject Card */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionIconCircle, { backgroundColor: themeColors.accentSubtle }]}>
                  <MaterialCommunityIcons name="tag-outline" size={18} color={themeColors.accentText} />
                </View>
                <Text style={styles.sectionTitle}>Subject</Text>
              </View>
              <TextInput
                value={subject}
                onChangeText={onSubjectChange}
                mode="outlined"
                style={styles.subjectInput}
              />
            </View>
          </>
        )}

        {/* Email Body Card */}
        <View style={[styles.sectionCard, isEditingBody && styles.sectionCardEditing]}>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionIconCircle, { backgroundColor: themeColors.accentSubtle }]}>
              <MaterialCommunityIcons name="email-edit-outline" size={18} color={themeColors.accentText} />
            </View>
            <Text style={[styles.sectionTitle, { flex: 1 }]}>Email Body</Text>
            {/* Regenerate belongs to authoring, so it lives inside edit mode
                — the default view offers one decision: send it. */}
            {isEditingBody && isPro && !isRegenerating && (
              <TouchableOpacity
                onPress={onRegenerate}
                style={styles.regenerateButton}
              >
                <MaterialCommunityIcons name="refresh" size={16} color={themeColors.accentText} />
                <Text style={styles.regenerateText}>Regenerate</Text>
              </TouchableOpacity>
            )}
            {!isEditingBody && !isRegenerating && (
              <TouchableOpacity onPress={startEditingBody} style={styles.regenerateButton}>
                <MaterialCommunityIcons name="pencil-outline" size={16} color={themeColors.accentText} />
                <Text style={styles.regenerateText}>Edit email</Text>
              </TouchableOpacity>
            )}
          </View>

          {isRegenerating ? (
            <EmailGeneratingState />
          ) : isEditingBody ? (
            <View style={[styles.bodyCard, styles.bodyCardEditing]}>
              <View style={styles.formatToolbar}>
                <TouchableOpacity onPress={applyBold} style={styles.formatButton} accessibilityLabel="Bold">
                  <Text style={styles.formatButtonBold}>B</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={applyBullet} style={styles.formatButton} accessibilityLabel="Bullet list">
                  <MaterialCommunityIcons name="format-list-bulleted" size={18} color={themeColors.text} />
                </TouchableOpacity>
                <Text style={styles.formatHint}>**bold**  •  - bullet</Text>
              </View>
              <TextInput
                value={emailBody}
                onChangeText={handleBodyChange}
                onSelectionChange={(e) => {
                  bodySelectionRef.current = e.nativeEvent.selection;
                }}
                selection={pendingBodySelection}
                mode="flat"
                style={[styles.bodyInput, styles.bodyInputEditing]}
                multiline
                numberOfLines={12}
                autoFocus
                underlineColor="transparent"
                activeUnderlineColor="transparent"
              />
            </View>
          ) : (
            /* Read-only preview — this is what the customer gets. Tapping it
               is the same door as the "Edit email" link above. */
            <TouchableOpacity
              style={styles.bodyPreview}
              onPress={startEditingBody}
              activeOpacity={0.7}
              accessibilityLabel="Edit email"
            >
              <Text style={styles.bodyPreviewText} numberOfLines={8}>
                {emailBody}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Photo attachment toggle - hidden when editing body */}
        {!isEditingBody && hasPhotos && (
          <View style={styles.sectionCard}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleLeft}>
                <View style={[styles.sectionIconCircle, { backgroundColor: themeColors.moneySubtle }]}>
                  <MaterialCommunityIcons name="image-multiple-outline" size={18} color={themeColors.money} />
                </View>
                <View style={styles.toggleTextContainer}>
                  <Text style={styles.sectionTitle}>Attach Job Photos</Text>
                  <Text style={styles.toggleSubtext}>{photos.length} photo{photos.length > 1 ? 's' : ''} will be attached</Text>
                </View>
              </View>
              <Switch
                value={includePhotos}
                onValueChange={setIncludePhotos}
                color={themeColors.accentText}
              />
            </View>
          </View>
        )}

        {/* Send-me-a-copy toggle - hidden when editing body */}
        {!isEditingBody && !!ownerEmail && (
          <View style={styles.sectionCard}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleLeft}>
                <View style={[styles.sectionIconCircle, { backgroundColor: themeColors.infoSubtle }]}>
                  <MaterialCommunityIcons name="email-sync-outline" size={18} color={themeColors.info} />
                </View>
                <View style={styles.toggleTextContainer}>
                  <Text style={styles.sectionTitle}>Email me a copy</Text>
                  <Text style={styles.toggleSubtext} numberOfLines={1}>
                    Keeps a copy at {ownerEmail} for your records
                  </Text>
                </View>
              </View>
              <Switch
                value={sendCopyToSelf}
                onValueChange={setSendCopyToSelf}
                color={themeColors.accentText}
              />
            </View>
          </View>
        )}

        {/* Info note - hidden when editing body */}
        {!isEditingBody && (
          <View style={styles.infoNote}>
            <MaterialCommunityIcons name="information-outline" size={16} color={themeColors.textMuted} />
            <Text style={styles.infoText}>{infoNote}</Text>
          </View>
        )}
      </ScrollView>

      {/* Footer: Done bar while editing, otherwise one prominent Send with
          the secondary paths as plain links beneath it. Test Send used to be
          a half-width button beside Send — same weight as the action that
          actually activates the account, and a dead end (it never records a
          send). */}
      {isEditingBody ? (
        <View style={styles.doneBar}>
          <TouchableOpacity onPress={stopEditingBody} style={styles.doneButton}>
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      ) : !isKeyboardVisible ? (
        <View style={[styles.footer, { paddingBottom: bottomInset }]}>
          <Button
            mode="contained" buttonColor={themeColors.accent} textColor={themeColors.onAccent}
            onPress={handleSend}
            loading={sending}
            disabled={sending || sendingTest || !emailBody.trim() || !!validateEmail(recipientEmail) || isRegenerating}
            style={styles.sendButton}
            contentStyle={styles.sendButtonContent}
            icon="send"
          >
            {sending ? 'Sending...' : sendButtonLabel}
          </Button>
          <View style={styles.footerLinks}>
            {ownerEmail ? (
              <TouchableOpacity
                onPress={handleTestSend}
                disabled={sendingTest || sending || !emailBody.trim() || isRegenerating}
              >
                <Text style={styles.footerLinkText}>
                  {sendingTest ? 'Sending test…' : 'Send a test to myself'}
                </Text>
              </TouchableOpacity>
            ) : null}
            {onMoreWaysToSend ? (
              <TouchableOpacity onPress={onMoreWaysToSend} disabled={sending || sendingTest}>
                <Text style={styles.footerLinkText}>More ways to send</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );

  // onRequestClose is required for Android's hardware/gesture Back to do
  // anything at all here — without it the tradie's most reflexive dismissal
  // was silently swallowed on what is now the send screen. Back closes the
  // keyboard first (which drops edit mode via the hide listener above), so a
  // second Back lands here and dismisses, matching platform behaviour.
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      statusBarTranslucent
      onRequestClose={handleDismiss}
    >
      {/* Quote modal historically wraps in Portal.Host so menus rendered
          inside the modal anchor correctly; invoice modal didn't need it.
          Wrap everything in Portal.Host now to keep menu/popup positioning
          consistent across both flows. */}
      <Portal.Host>
        {modalContent}

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
        {/* Transient alert — never celebrates. The only success it carries is
            a TEST send: a rehearsal into the tradie's own inbox that leaves
            the doc a draft. Two of the Jul 2026 audit's users test-sent, read
            the celebration as "done", and never sent for real. The confetti
            belongs to the real-send modal above. */}
        <AlertModal
          visible={alertVisible}
          onDismiss={() => setAlertVisible(false)}
          type={alertType}
          icon={alertType === 'success' ? 'check-circle' : 'alert-circle'}
          title={alertTitle}
          message={alertMessage}
          primaryButtonText="OK"
          primaryButtonAction={() => setAlertVisible(false)}
          showConfetti={false}
        />
        {/* $0-row guard. The warning stays — it catches real mistakes — but
            retreat is no longer the default button: these tradies do not
            come back, and an unpriced row is often deliberate. */}
        <AlertModal
          visible={presendWarning !== null}
          onDismiss={() => setPresendWarning(null)}
          type="warning"
          icon="currency-usd-off"
          title={presendWarning?.title || ''}
          message={presendWarning?.message || ''}
          primaryButtonText="Send anyway"
          primaryButtonAction={() => {
            setPresendWarning(null);
            doSend();
          }}
          secondaryButtonText="Go back and fix"
          secondaryButtonAction={() => {
            setPresendWarning(null);
            handleDismiss();
          }}
        />
      </Portal.Host>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: t.colors.accent,
  },
  headerButton: {
    minWidth: 60,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backText: {
    fontSize: 16,
    color: t.colors.onAccent,
    fontWeight: '600',
    marginLeft: -2,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: t.colors.onAccent,
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
    backgroundColor: t.colors.surfaceRaised,
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
    color: t.colors.text,
  },
  recipientInput: {
    backgroundColor: 'transparent',
    marginBottom: 0,
    fontSize: 15,
    color: t.colors.text,
  },
  emailErrorText: {
    fontSize: 12,
    color: t.colors.error,
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
    backgroundColor: t.colors.accentSubtle,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  regenerateText: {
    fontSize: 13,
    color: t.colors.accentText,
    fontWeight: '600',
  },
  sectionCardEditing: {
    flex: 1,
  },
  bodyCard: {
    backgroundColor: t.colors.bg,
    borderRadius: 10,
    overflow: 'hidden',
  },
  formatToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border,
  },
  formatButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.surfaceRaised,
  },
  formatButtonBold: {
    fontSize: 15,
    fontWeight: '800',
    color: t.colors.text,
  },
  formatHint: {
    fontSize: 11,
    color: t.colors.textMuted,
    marginLeft: 'auto',
    paddingRight: 6,
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
  bodyPreview: {
    backgroundColor: t.colors.bg,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  bodyPreviewText: {
    fontSize: 15,
    lineHeight: 24,
    color: t.colors.text,
  },
  generatingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 40,
    paddingHorizontal: 20,
    backgroundColor: t.colors.bg,
    borderRadius: 10,
    minHeight: 140,
  },
  generatingTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: t.colors.text,
    textAlign: 'center',
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
    color: t.colors.textMuted,
    marginTop: 2,
  },
  infoNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: t.colors.surfaceRaised,
    padding: 14,
    borderRadius: 14,
    marginBottom: 16,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: t.colors.textMuted,
    lineHeight: 18,
  },
  footer: {
    // Match the quote flow's bottomBar (QuotePreviewScreen.tsx) so the
    // footer button area looks identical across the app. The dynamic
    // paddingBottom is applied inline at the call site via insets.bottom.
    paddingHorizontal: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
    backgroundColor: t.colors.surfaceRaised,
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
  sendButton: {
    width: '100%',
    margin: 0,
  },
  sendButtonContent: {
    paddingVertical: 8,
  },
  footerLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 24,
    paddingTop: 12,
  },
  footerLinkText: {
    fontSize: 13,
    color: t.colors.textMuted,
    fontWeight: '600',
  },
  collapsedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.surfaceRaised,
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
    color: t.colors.textMuted,
    flexShrink: 1,
  },
  collapsedBarDivider: {
    fontSize: 13,
    color: t.colors.border,
    marginHorizontal: 2,
  },
  doneBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
    backgroundColor: t.colors.surfaceRaised,
  },
  doneButton: {
    // 44pt minimum. This is the only way back to the send buttons from edit
    // mode, so it can't be a 29pt target a tradie has to hit with gloves on.
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  doneButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: t.colors.accentText,
  },
}));
