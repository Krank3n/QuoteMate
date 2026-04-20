/**
 * DocumentCard Component
 * Unified card replacing QuoteCard and InvoiceCard. Branches on doc.type
 * for type-specific bits (deposit chip vs payment terms, accept button vs
 * pay button, etc.). Preserves the exact visuals of the originals — same
 * SwipeableCard wrapper, same idle bob/tilt, same shimmer/grain overlays.
 */

import React, { useState, useRef, useEffect } from 'react';
import { View, StyleSheet, Alert, Animated } from 'react-native';
import {
  Text,
  Card,
  Divider,
  IconButton,
} from 'react-native-paper';
import { format, formatDistanceToNow, differenceInDays } from 'date-fns';

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Quote, Invoice, BusinessSettings, InvoiceStatus } from '../types';
import { Document } from '../types/document';
import { documentToQuote, documentToInvoice } from '../types/documentAdapter';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { isInvoiceOverdue, getOverdueText, getAmountDue } from '../utils/invoiceCalculator';
import { exportQuotePDF, exportInvoicePDF } from '../utils/pdfGenerator';
import { useStore } from '../store/useStore';
import { selectionTap } from '../utils/haptics';
import { SwipeableCard } from './SwipeableCard';
import { AnimatedChip } from './AnimatedChip';
import { AlertModal } from './AlertModal';
import { ShimmerOverlay } from './ShimmerOverlay';
import { TapRipple } from './TapRipple';
import { GrainOverlay } from './GrainOverlay';
import { ActionSheet } from './ActionSheet';
import { DocumentEmailPreviewModal } from './DocumentEmailPreviewModal';
import {
  generateQuoteEmail,
  getDefaultEmailBody,
  generateInvoiceEmail,
  getDefaultInvoiceEmailBody,
} from '../services/llmService';

interface DocumentCardProps {
  doc: Document;
  businessSettings: BusinessSettings | null;
  onView: (id: string) => void;
  onEdit: (doc: Document, section?: 'customer' | 'job' | 'materials' | 'labor') => void;
  onDelete: (id: string) => void;
  onDuplicate: (doc: Document) => void;
  onSave: (doc: Document) => void;
  /** Quote-only: status change handler. Ignored for invoices. */
  onStatusChange?: (doc: Document) => void;
  /** Quote-only: convert action handler. */
  onConvertToInvoice?: (doc: Document) => void;
  /** Invoice-only: record payment handler. */
  onRecordPayment?: (doc: Document) => void;
  swipeableRef?: React.RefObject<any>;
}

export const DocumentCard = React.memo(function DocumentCard({
  doc,
  businessSettings,
  onView,
  onEdit,
  onDelete,
  onDuplicate,
  onSave,
  onStatusChange,
  onConvertToInvoice,
  onRecordPayment,
  swipeableRef,
}: DocumentCardProps) {
  const isInvoice = doc.type === 'invoice';
  // Project to legacy shapes for the existing children (PDF export, send button,
  // email preview) so we don't have to rewrite every dependent service today.
  const quote: Quote = documentToQuote(doc);
  const invoice: Invoice = documentToInvoice(doc);

  const [menuVisible, setMenuVisible] = useState(false);
  const [statusMenuVisible, setStatusMenuVisible] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [emailPreviewVisible, setEmailPreviewVisible] = useState(false);
  const [emailBody, setEmailBody] = useState('');
  const [isGeneratingEmail, setIsGeneratingEmail] = useState(false);
  const [xeroResultModal, setXeroResultModal] = useState<{ visible: boolean; success: boolean; message: string }>({ visible: false, success: false, message: '' });
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const idleAnim = useRef(new Animated.Value(0)).current;
  const idleTilt = useRef(new Animated.Value(0)).current;
  const { subscriptionStatus, saveDraft, saveInvoice, xeroConnection, pushInvoiceToXero } = useStore();

  const bobDurationRef = useRef(2400 + Math.random() * 1200);
  const tiltDurationRef = useRef(3200 + Math.random() * 1600);
  const tiltDirRef = useRef(Math.random() > 0.5 ? 1 : -1);
  const delayRef = useRef(Math.random() * 1500);

  useEffect(() => {
    const bobD = bobDurationRef.current;
    const tiltD = tiltDurationRef.current;
    const tiltDir = tiltDirRef.current;

    const bobAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(idleAnim, { toValue: -2, duration: bobD / 2, useNativeDriver: true }),
        Animated.timing(idleAnim, { toValue: 0, duration: bobD / 2, useNativeDriver: true }),
      ])
    );
    const tiltAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(idleTilt, { toValue: 0.4 * tiltDir, duration: tiltD / 2, useNativeDriver: true }),
        Animated.timing(idleTilt, { toValue: -0.4 * tiltDir, duration: tiltD, useNativeDriver: true }),
        Animated.timing(idleTilt, { toValue: 0, duration: tiltD / 2, useNativeDriver: true }),
      ])
    );
    const timer = setTimeout(() => {
      bobAnim.start();
      tiltAnim.start();
    }, delayRef.current);
    return () => {
      clearTimeout(timer);
      bobAnim.stop();
      tiltAnim.stop();
    };
  }, []);

  const isTrialActive = !!(subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired);
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  const handleSendQuoteFlavour = async () => {
    if (quote.draftEmailBody) {
      setEmailBody(quote.draftEmailBody);
      setEmailPreviewVisible(true);
      return;
    }
    setIsGeneratingEmail(true);
    setEmailPreviewVisible(true);
    try {
      let body: string;
      if (isPro) {
        body = await generateQuoteEmail({
          jobName: quote.job.name,
          jobDescription: quote.job.description || '',
          materials: quote.materials.map((m) => ({ name: m.name, quantity: m.quantity, unit: m.unit })),
          laborHours: quote.laborHours,
          total: quote.total,
          businessName: businessSettings?.businessName || '',
          customerName: quote.customerName,
        });
      } else {
        body = getDefaultEmailBody(
          quote.customerName,
          quote.job.name,
          quote.total,
          businessSettings?.businessName || 'Your Business',
        );
      }
      setEmailBody(body);
      saveDraft({ ...quote, draftEmailBody: body });
    } catch {
      const fallback = getDefaultEmailBody(
        quote.customerName,
        quote.job.name,
        quote.total,
        businessSettings?.businessName || 'Your Business',
      );
      setEmailBody(fallback);
      saveDraft({ ...quote, draftEmailBody: fallback });
    } finally {
      setIsGeneratingEmail(false);
    }
  };

  const handleSendInvoiceFlavour = async () => {
    if (invoice.draftEmailBody) {
      setEmailBody(invoice.draftEmailBody);
      setEmailPreviewVisible(true);
      return;
    }
    setIsGeneratingEmail(true);
    setEmailPreviewVisible(true);
    try {
      let body: string;
      if (isPro) {
        body = await generateInvoiceEmail({
          jobName: invoice.job.name,
          jobDescription: invoice.job.description || '',
          materials: invoice.materials.map((m) => ({ name: m.name, quantity: m.quantity, unit: m.unit })),
          laborHours: invoice.laborHours,
          total: invoice.total,
          businessName: businessSettings?.businessName || '',
          customerName: invoice.customerName,
          dueDate: new Date(invoice.dueDate).toISOString(),
          invoiceNumber: invoice.invoiceNumber,
        });
      } else {
        body = getDefaultInvoiceEmailBody(
          invoice.customerName,
          invoice.job.name,
          invoice.total,
          businessSettings?.businessName || 'Your Business',
          new Date(invoice.dueDate).toISOString(),
        );
      }
      setEmailBody(body);
      saveInvoice({ ...invoice, draftEmailBody: body });
    } catch {
      const fallback = getDefaultInvoiceEmailBody(
        invoice.customerName,
        invoice.job.name,
        invoice.total,
        businessSettings?.businessName || 'Your Business',
        new Date(invoice.dueDate).toISOString(),
      );
      setEmailBody(fallback);
      saveInvoice({ ...invoice, draftEmailBody: fallback });
    } finally {
      setIsGeneratingEmail(false);
    }
  };

  const handleSend = isInvoice ? handleSendInvoiceFlavour : handleSendQuoteFlavour;

  const handleRegenerateEmail = async () => {
    setIsGeneratingEmail(true);
    try {
      if (isInvoice) {
        const body = await generateInvoiceEmail({
          jobName: invoice.job.name,
          jobDescription: invoice.job.description || '',
          materials: invoice.materials.map((m) => ({ name: m.name, quantity: m.quantity, unit: m.unit })),
          laborHours: invoice.laborHours,
          total: invoice.total,
          businessName: businessSettings?.businessName || '',
          customerName: invoice.customerName,
          dueDate: new Date(invoice.dueDate).toISOString(),
          invoiceNumber: invoice.invoiceNumber,
        });
        setEmailBody(body);
        saveInvoice({ ...invoice, draftEmailBody: body });
      } else {
        const body = await generateQuoteEmail({
          jobName: quote.job.name,
          jobDescription: quote.job.description || '',
          materials: quote.materials.map((m) => ({ name: m.name, quantity: m.quantity, unit: m.unit })),
          laborHours: quote.laborHours,
          total: quote.total,
          businessName: businessSettings?.businessName || '',
          customerName: quote.customerName,
        });
        setEmailBody(body);
        saveDraft({ ...quote, draftEmailBody: body });
      }
    } catch {
      Alert.alert('Error', 'Could not regenerate email. Please try again.');
    } finally {
      setIsGeneratingEmail(false);
    }
  };

  const handleEmailPreviewDismiss = () => {
    setEmailPreviewVisible(false);
    if (isInvoice) {
      if (emailBody && emailBody !== (invoice.draftEmailBody || '')) {
        saveInvoice({ ...invoice, draftEmailBody: emailBody });
      }
    } else {
      if (emailBody && emailBody !== (quote.draftEmailBody || '')) {
        saveDraft({ ...quote, draftEmailBody: emailBody });
      }
    }
  };

  const handleShare = async () => {
    try {
      if (isInvoice) {
        await exportInvoicePDF(invoice, businessSettings, 'share', { isPro });
      } else {
        await exportQuotePDF(quote, businessSettings, 'share', { isPro });
      }
    } catch {
      Alert.alert('Error', `Failed to share ${isInvoice ? 'invoice' : 'quote'}. Please try again.`);
    }
  };

  const handleExport = async () => {
    try {
      if (isInvoice) {
        await exportInvoicePDF(invoice, businessSettings, 'export', { isPro });
      } else {
        await exportQuotePDF(quote, businessSettings, 'export', { isPro });
      }
    } catch {
      Alert.alert('Error', `Failed to export ${isInvoice ? 'invoice' : 'quote'}. Please try again.`);
    }
  };

  const handleDelete = () => setDeleteModalVisible(true);
  const confirmDelete = () => {
    setDeleteModalVisible(false);
    onDelete(doc.id);
  };

  const handlePushToXero = async () => {
    setMenuVisible(false);
    try {
      await pushInvoiceToXero(invoice);
      setXeroResultModal({ visible: true, success: true, message: 'Invoice pushed to Xero successfully.' });
    } catch (error: any) {
      setXeroResultModal({ visible: true, success: false, message: error.message || 'Failed to sync invoice to Xero.' });
    }
  };

  const handleStatusChangeInvoice = async (newStatus: InvoiceStatus) => {
    selectionTap();
    setStatusMenuVisible(false);
    const updatedInvoice: Invoice = { ...invoice, status: newStatus, updatedAt: new Date() };
    await saveInvoice(updatedInvoice);
  };

  if (isInvoice) {
    const overdueText = getOverdueText(invoice);
    const amountDue = getAmountDue(invoice);
    const showRecordPayment = invoice.status !== 'paid' && invoice.status !== 'cancelled';

    return (
      <>
        <SwipeableCard
          rightActions={[
            { icon: 'send', label: 'Send', color: colors.primary, bgColor: colors.primaryBg, onPress: handleSend },
            { icon: 'content-copy', label: 'Duplicate', color: colors.info, bgColor: colors.infoBg, onPress: () => onDuplicate(doc) },
          ]}
          leftActions={[
            { icon: 'delete-outline', label: 'Delete', color: colors.error, bgColor: colors.errorBg, onPress: handleDelete },
          ]}
          swipeableRef={swipeableRef}
        >
          <Animated.View style={{ transform: [{ scale: scaleAnim }, { translateY: idleAnim }, { rotate: idleTilt.interpolate({ inputRange: [-1, 1], outputRange: ['-1deg', '1deg'] }) }] }}>
            <Card style={styles.card}>
              <TapRipple
                onPress={() => onView(doc.id)}
                accessibilityRole="button"
                accessibilityLabel={`View invoice for ${invoice.customerName}, ${invoice.job.name}, ${formatCurrency(invoice.total)}, status ${invoice.status}`}
                rippleColor="rgba(0,152,104,0.2)"
                onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50, bounciness: 4 }).start()}
                onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50, bounciness: 4 }).start()}
              >
                <Card.Content style={styles.cardContent}>
                  <View style={styles.header}>
                    <View style={styles.info}>
                      {invoice.invoiceNumber && (
                        <Text style={styles.number}>{invoice.invoiceNumber}</Text>
                      )}
                      <Text style={styles.customerName}>{invoice.customerName}</Text>
                      <Text style={styles.jobName}>{invoice.job.name}</Text>
                      {overdueText && (
                        <Text style={styles.overdueText}>{overdueText}</Text>
                      )}
                    </View>
                    <View style={styles.right}>
                      <View style={styles.price}>
                        <Text style={styles.total}>{formatCurrency(invoice.total)}</Text>
                        {invoice.status === 'partial' && (
                          <Text style={styles.amountDue}>Due: {formatCurrency(amountDue)}</Text>
                        )}
                        <AnimatedChip
                          status={invoice.status}
                          style={[styles.statusChip, getInvoiceStatusChipStyle(invoice.status)]}
                          textStyle={styles.statusText}
                          onPress={(e) => {
                            e.stopPropagation();
                            setStatusMenuVisible(true);
                          }}
                        >
                          {invoice.status}
                        </AnimatedChip>
                      </View>
                      <IconButton
                        icon="dots-vertical"
                        size={32}
                        accessibilityLabel="Invoice actions menu"
                        onPress={(e) => {
                          e.stopPropagation();
                          setMenuVisible(true);
                        }}
                      />
                    </View>
                  </View>
                  <Divider style={styles.divider} />
                  <View style={styles.footer}>
                    <View style={styles.footerStats}>
                      <View style={styles.statBadge}>
                        <MaterialCommunityIcons name="package-variant" size={13} color={colors.textMuted} />
                        <Text style={styles.statBadgeText}>{invoice.materials.length} item{invoice.materials.length !== 1 ? 's' : ''}</Text>
                      </View>
                      {invoice.laborHours > 0 && (
                        <View style={styles.statBadge}>
                          <MaterialCommunityIcons name="clock-outline" size={13} color={colors.textMuted} />
                          <Text style={styles.statBadgeText}>{invoice.laborHours}h</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.date}>
                      Due {differenceInDays(new Date(invoice.dueDate), new Date()) < 0
                        ? formatDistanceToNow(new Date(invoice.dueDate), { addSuffix: true })
                        : differenceInDays(new Date(invoice.dueDate), new Date()) < 7
                        ? formatDistanceToNow(new Date(invoice.dueDate), { addSuffix: true })
                        : format(new Date(invoice.dueDate), 'dd MMM yyyy')}
                    </Text>
                  </View>
                </Card.Content>
              </TapRipple>
              <GrainOverlay />
              <ShimmerOverlay />
            </Card>
          </Animated.View>
        </SwipeableCard>

        <ActionSheet
          visible={menuVisible}
          onDismiss={() => setMenuVisible(false)}
          title="Invoice Actions"
          options={[
            { icon: 'pencil', label: 'Edit', onPress: () => onEdit(doc) },
            { icon: 'email-outline', label: 'Send via Email', onPress: handleSend },
            { icon: 'content-copy', label: 'Duplicate', onPress: () => onDuplicate(doc) },
            ...(showRecordPayment && onRecordPayment
              ? [{ icon: 'cash', label: 'Record Payment', onPress: () => onRecordPayment(doc) }]
              : []),
            { icon: 'file-pdf-box', label: 'Export PDF', onPress: handleExport },
            ...(xeroConnection && invoice.status !== 'draft'
              ? [{
                  icon: invoice.xeroSyncStatus === 'synced' ? 'cloud-check' : 'cloud-sync',
                  label: invoice.xeroSyncStatus === 'synced' ? 'Re-sync to Xero' : 'Push to Xero',
                  onPress: handlePushToXero,
                }]
              : []),
            { icon: 'delete-outline', label: 'Delete', onPress: handleDelete, color: colors.error, divider: true },
          ]}
        />

        <ActionSheet
          visible={statusMenuVisible}
          onDismiss={() => setStatusMenuVisible(false)}
          title="Update Status"
          options={[
            ...(invoice.status !== 'draft'
              ? [{ icon: 'file-document-edit-outline', label: 'Mark as Draft', onPress: () => handleStatusChangeInvoice('draft') }]
              : []),
            ...(invoice.status !== 'sent' && invoice.status !== 'paid'
              ? [{ icon: 'send-outline', label: 'Mark as Sent', onPress: () => handleStatusChangeInvoice('sent') }]
              : []),
            ...(invoice.status !== 'paid'
              ? [{ icon: 'check-circle-outline', label: 'Mark as Paid', onPress: () => handleStatusChangeInvoice('paid') }]
              : []),
            ...(invoice.status !== 'cancelled'
              ? [{ icon: 'close-circle-outline', label: 'Cancel Invoice', onPress: () => handleStatusChangeInvoice('cancelled'), color: colors.error, divider: true }]
              : []),
          ]}
        />

        <AlertModal
          visible={deleteModalVisible}
          onDismiss={() => setDeleteModalVisible(false)}
          type="error"
          icon="delete"
          title="Delete Invoice"
          message="Are you sure you want to delete this invoice?"
          primaryButtonText="Delete"
          primaryButtonAction={confirmDelete}
          secondaryButtonText="Cancel"
          secondaryButtonAction={() => setDeleteModalVisible(false)}
          showConfetti={false}
        />

        <AlertModal
          visible={xeroResultModal.visible}
          onDismiss={() => setXeroResultModal({ ...xeroResultModal, visible: false })}
          type={xeroResultModal.success ? 'success' : 'error'}
          icon={xeroResultModal.success ? 'cloud-check' : 'cloud-alert'}
          title={xeroResultModal.success ? 'Synced to Xero' : 'Sync Failed'}
          message={xeroResultModal.message}
          primaryButtonText="OK"
          primaryButtonAction={() => setXeroResultModal({ ...xeroResultModal, visible: false })}
          showConfetti={false}
        />

        <DocumentEmailPreviewModal
          visible={emailPreviewVisible}
          onDismiss={handleEmailPreviewDismiss}
          doc={doc}
          businessSettings={businessSettings}
          emailBody={emailBody}
          onEmailBodyChange={setEmailBody}
          onRegenerate={handleRegenerateEmail}
          isPro={isPro}
          isRegenerating={isGeneratingEmail}
        />
      </>
    );
  }

  // Quote variant
  const awaitingDeposit =
    quote.status === 'accepted' &&
    (quote.depositAmount || 0) > 0 &&
    (quote.depositPaid || 0) < (quote.depositAmount || 0);

  return (
    <>
      <SwipeableCard
        rightActions={[
          { icon: 'send', label: 'Send', color: colors.primary, bgColor: colors.primaryBg, onPress: handleSend },
          { icon: 'content-copy', label: 'Duplicate', color: colors.info, bgColor: colors.infoBg, onPress: () => onDuplicate(doc) },
        ]}
        leftActions={[
          { icon: 'delete-outline', label: 'Delete', color: colors.error, bgColor: colors.errorBg, onPress: handleDelete },
        ]}
        swipeableRef={swipeableRef}
      >
        <Animated.View style={{ transform: [{ scale: scaleAnim }, { translateY: idleAnim }, { rotate: idleTilt.interpolate({ inputRange: [-1, 1], outputRange: ['-1deg', '1deg'] }) }] }}>
          <Card style={styles.card}>
            <TapRipple
              onPress={() => onView(doc.id)}
              accessibilityRole="button"
              accessibilityLabel={`View quote for ${quote.customerName}, ${quote.job.name}, ${formatCurrency(quote.total)}, status ${quote.status}`}
              rippleColor="rgba(0,152,104,0.2)"
              onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50, bounciness: 4 }).start()}
              onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50, bounciness: 4 }).start()}
            >
              <Card.Content style={styles.cardContent}>
                <View style={styles.header}>
                  <View style={styles.info}>
                    {quote.quoteNumber && (
                      <Text style={styles.number}>{quote.quoteNumber}</Text>
                    )}
                    <Text style={styles.customerName}>{quote.customerName}</Text>
                    <Text style={styles.jobName}>{quote.job.name}</Text>
                  </View>
                  <View style={styles.right}>
                    <View style={styles.price}>
                      <Text style={styles.totalQuote}>{formatCurrency(quote.total)}</Text>
                      <AnimatedChip
                        status={quote.status}
                        style={[styles.statusChip, getQuoteStatusChipStyle(quote.status)]}
                        textStyle={styles.statusText}
                        onPress={(e) => {
                          e.stopPropagation();
                          selectionTap();
                          onStatusChange?.(doc);
                        }}
                      >
                        {awaitingDeposit ? 'awaiting deposit' : quote.status}
                      </AnimatedChip>
                    </View>
                    <IconButton
                      icon="dots-vertical"
                      size={32}
                      accessibilityLabel="Quote actions menu"
                      onPress={(e) => {
                        e.stopPropagation();
                        setMenuVisible(true);
                      }}
                    />
                  </View>
                </View>
                <Divider style={styles.divider} />
                <View style={styles.footer}>
                  <View style={styles.footerStats}>
                    <View style={styles.statBadge}>
                      <MaterialCommunityIcons name="package-variant" size={13} color={colors.textMuted} />
                      <Text style={styles.statBadgeText}>{quote.materials.length} item{quote.materials.length !== 1 ? 's' : ''}</Text>
                    </View>
                    {quote.laborHours > 0 && (
                      <View style={styles.statBadge}>
                        <MaterialCommunityIcons name="clock-outline" size={13} color={colors.textMuted} />
                        <Text style={styles.statBadgeText}>{quote.laborHours}h</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.date}>
                    {(() => {
                      const date = new Date(quote.updatedAt ?? quote.createdAt);
                      if (isNaN(date.getTime())) return '';
                      return differenceInDays(new Date(), date) < 7
                        ? formatDistanceToNow(date, { addSuffix: true })
                        : format(date, 'dd MMM yyyy');
                    })()}
                  </Text>
                </View>
              </Card.Content>
            </TapRipple>
            <GrainOverlay />
            <ShimmerOverlay />
          </Card>
        </Animated.View>
      </SwipeableCard>

      <ActionSheet
        visible={menuVisible}
        onDismiss={() => setMenuVisible(false)}
        title="Quote Actions"
        options={[
          { icon: 'pencil', label: 'Edit', onPress: () => onEdit(doc) },
          { icon: 'email-outline', label: 'Send via Email', onPress: handleSend },
          { icon: 'content-copy', label: 'Duplicate', onPress: () => onDuplicate(doc) },
          { icon: 'share-variant', label: 'Share', onPress: handleShare },
          { icon: 'file-pdf-box', label: 'Export PDF', onPress: handleExport },
          ...(onConvertToInvoice
            ? [{ icon: 'file-replace', label: 'Convert to Invoice', onPress: () => onConvertToInvoice(doc) }]
            : []),
          { icon: 'delete-outline', label: 'Delete', onPress: handleDelete, color: colors.error, divider: true },
        ]}
      />

      <AlertModal
        visible={deleteModalVisible}
        onDismiss={() => setDeleteModalVisible(false)}
        type="error"
        icon="delete"
        title="Delete Quote"
        message="Are you sure you want to delete this quote?"
        primaryButtonText="Delete"
        primaryButtonAction={confirmDelete}
        secondaryButtonText="Cancel"
        secondaryButtonAction={() => setDeleteModalVisible(false)}
        showConfetti={false}
      />

      <DocumentEmailPreviewModal
        visible={emailPreviewVisible}
        onDismiss={handleEmailPreviewDismiss}
        doc={doc}
        businessSettings={businessSettings}
        emailBody={emailBody}
        onEmailBodyChange={setEmailBody}
        onRegenerate={handleRegenerateEmail}
        isPro={isPro}
        isRegenerating={isGeneratingEmail}
      />
    </>
  );
});

function getQuoteStatusChipStyle(status: string) {
  switch (status) {
    case 'accepted': return { backgroundColor: colors.successBg };
    case 'completed': return { backgroundColor: colors.primaryBg };
    case 'sent': return { backgroundColor: colors.warningBg };
    case 'rejected': return { backgroundColor: colors.errorBg };
    default: return { backgroundColor: colors.infoBg };
  }
}

function getInvoiceStatusChipStyle(status: Invoice['status']) {
  switch (status) {
    case 'paid': return { backgroundColor: colors.successBg };
    case 'sent': return { backgroundColor: colors.warningBg };
    case 'partial': return { backgroundColor: colors.infoBg };
    case 'overdue': return { backgroundColor: colors.errorBg };
    case 'cancelled': return { backgroundColor: colors.errorBg };
    default: return { backgroundColor: colors.infoBg };
  }
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 12,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  cardContent: {
    paddingTop: 16,
    paddingBottom: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  info: {
    flex: 1,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  number: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: 2,
  },
  customerName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  jobName: {
    fontSize: 14,
    color: colors.onSurface,
  },
  overdueText: {
    fontSize: 12,
    color: colors.error,
    fontWeight: '600',
    marginTop: 4,
  },
  price: {
    alignItems: 'flex-end',
    marginRight: -8,
  },
  total: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primary,
    marginBottom: 4,
  },
  // Quote-side override: original QuoteCard had a slightly larger gap below
  // the total (8 vs 4) — preserve that exactly so the card pixel-matches.
  totalQuote: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primary,
    marginBottom: 8,
  },
  amountDue: {
    fontSize: 12,
    color: colors.warning,
    marginBottom: 4,
  },
  statusChip: {
    height: 24,
    marginBottom: 4,
  },
  statusText: {
    fontSize: 12,
    textTransform: 'capitalize',
    marginTop: -1,
    marginBottom: 0,
    lineHeight: 24,
  },
  divider: {
    marginVertical: 12,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerStats: {
    flexDirection: 'row',
    gap: 12,
  },
  statBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statBadgeText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  date: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
