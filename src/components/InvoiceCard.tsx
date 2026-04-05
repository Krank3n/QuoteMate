/**
 * InvoiceCard Component
 * Card component for displaying invoice information in lists
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, StyleSheet, Alert, Pressable, Animated } from 'react-native';
import {
  Text,
  Card,
  Divider,
  IconButton,
} from 'react-native-paper';
import { format, formatDistanceToNow, differenceInDays } from 'date-fns';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Invoice, BusinessSettings, InvoiceStatus } from '../types';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { isInvoiceOverdue, getOverdueText, getAmountDue } from '../utils/invoiceCalculator';
import { exportInvoicePDF } from '../utils/pdfGenerator';
import { useStore } from '../store/useStore';
import { selectionTap } from '../utils/haptics';
import { SwipeableCard } from './SwipeableCard';
import { AnimatedChip } from './AnimatedChip';
import { AlertModal } from './AlertModal';
import { ShimmerOverlay } from './ShimmerOverlay';
import { TapRipple } from './TapRipple';
import { GrainOverlay } from './GrainOverlay';
import { ActionSheet } from './ActionSheet';
import { InvoiceEmailPreviewModal } from './InvoiceEmailPreviewModal';
import { generateInvoiceEmail, getDefaultInvoiceEmailBody } from '../services/llmService';

interface InvoiceCardProps {
  invoice: Invoice;
  businessSettings: BusinessSettings | null;
  onView: (invoiceId: string) => void;
  onEdit: (invoice: Invoice) => void;
  onDelete: (invoiceId: string) => void;
  onRecordPayment: (invoice: Invoice) => void;
  onSave: (invoice: Invoice) => void;
  onDuplicate: (invoice: Invoice) => void;
  onStatusChange?: (invoice: Invoice) => void;
}

export const InvoiceCard = React.memo(function InvoiceCard({
  invoice,
  businessSettings,
  onView,
  onEdit,
  onDelete,
  onRecordPayment,
  onSave,
  onDuplicate,
  onStatusChange,
}: InvoiceCardProps) {
  const [menuVisible, setMenuVisible] = useState(false);
  const [statusMenuVisible, setStatusMenuVisible] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [emailPreviewVisible, setEmailPreviewVisible] = useState(false);
  const [xeroResultModal, setXeroResultModal] = useState<{ visible: boolean; success: boolean; message: string }>({ visible: false, success: false, message: '' });
  const [emailBody, setEmailBody] = useState('');
  const [isGeneratingEmail, setIsGeneratingEmail] = useState(false);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const idleAnim = useRef(new Animated.Value(0)).current;
  const idleTilt = useRef(new Animated.Value(0)).current;
  const { subscriptionStatus, quotes, xeroConnection, pushInvoiceToXero } = useStore();
  const sourceQuotePhotos = invoice.sourceQuoteId
    ? quotes.find(q => q.id === invoice.sourceQuoteId)?.photos || []
    : [];

  // Subtle idle bob + tilt — randomized so cards are never in sync
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

  const handleSendInvoice = async () => {
    setIsGeneratingEmail(true);
    setEmailPreviewVisible(true);

    try {
      if (isPro) {
        const body = await generateInvoiceEmail({
          jobName: invoice.job.name,
          jobDescription: invoice.job.description || '',
          materials: invoice.materials.map(m => ({
            name: m.name,
            quantity: m.quantity,
            unit: m.unit,
          })),
          laborHours: invoice.laborHours,
          total: invoice.total,
          businessName: businessSettings?.businessName || '',
          customerName: invoice.customerName,
          dueDate: new Date(invoice.dueDate).toISOString(),
          invoiceNumber: invoice.invoiceNumber,
        });
        setEmailBody(body);
      } else {
        setEmailBody(getDefaultInvoiceEmailBody(
          invoice.customerName,
          invoice.job.name,
          invoice.total,
          businessSettings?.businessName || 'Your Business',
          new Date(invoice.dueDate).toISOString()
        ));
      }
    } catch (error) {
      setEmailBody(getDefaultInvoiceEmailBody(
        invoice.customerName,
        invoice.job.name,
        invoice.total,
        businessSettings?.businessName || 'Your Business',
        new Date(invoice.dueDate).toISOString()
      ));
    } finally {
      setIsGeneratingEmail(false);
    }
  };

  const handleRegenerateEmail = async () => {
    setIsGeneratingEmail(true);
    try {
      const body = await generateInvoiceEmail({
        jobName: invoice.job.name,
        jobDescription: invoice.job.description || '',
        materials: invoice.materials.map(m => ({
          name: m.name,
          quantity: m.quantity,
          unit: m.unit,
        })),
        laborHours: invoice.laborHours,
        total: invoice.total,
        businessName: businessSettings?.businessName || '',
        customerName: invoice.customerName,
        dueDate: new Date(invoice.dueDate).toISOString(),
        invoiceNumber: invoice.invoiceNumber,
      });
      setEmailBody(body);
    } catch (error) {
      Alert.alert('Error', 'Could not regenerate email. Please try again.');
    } finally {
      setIsGeneratingEmail(false);
    }
  };

  const handleExportInvoice = async () => {
    try {
      await exportInvoicePDF(invoice, businessSettings, 'export', { isPro });
    } catch (error) {
      Alert.alert('Error', 'Failed to export invoice. Please try again.');
    }
  };

  const handleDeleteInvoice = () => {
    setDeleteModalVisible(true);
  };

  const confirmDeleteInvoice = () => {
    setDeleteModalVisible(false);
    onDelete(invoice.id);
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

  const handleStatusChange = async (newStatus: InvoiceStatus) => {
    selectionTap();
    setStatusMenuVisible(false);
    const updatedInvoice = { ...invoice, status: newStatus, updatedAt: new Date() };
    await onSave(updatedInvoice);
  };

  const handleDuplicate = () => {
    setMenuVisible(false);
    onDuplicate(invoice);
  };

  const overdueText = getOverdueText(invoice);
  const amountDue = getAmountDue(invoice);
  const showRecordPayment = invoice.status !== 'paid' && invoice.status !== 'cancelled';

  return (
    <>
    <SwipeableCard
      rightActions={[
        { icon: 'send', label: 'Send', color: colors.primary, bgColor: colors.primaryBg, onPress: handleSendInvoice },
        { icon: 'content-copy', label: 'Duplicate', color: colors.info, bgColor: colors.infoBg, onPress: () => { onDuplicate(invoice); } },
      ]}
      leftActions={[
        { icon: 'delete-outline', label: 'Delete', color: colors.error, bgColor: colors.errorBg, onPress: handleDeleteInvoice },
      ]}
    >
    <Animated.View style={{ transform: [{ scale: scaleAnim }, { translateY: idleAnim }, { rotate: idleTilt.interpolate({ inputRange: [-1, 1], outputRange: ['-1deg', '1deg'] }) }] }}>
    <Card style={styles.invoiceCard}>
      <TapRipple
        onPress={() => onView(invoice.id)}
        accessibilityRole="button"
        accessibilityLabel={`View invoice for ${invoice.customerName}, ${invoice.job.name}, ${formatCurrency(invoice.total)}, status ${invoice.status}`}
        rippleColor="rgba(0,152,104,0.2)"
        onPressIn={() => {
          Animated.spring(scaleAnim, {
            toValue: 0.97,
            useNativeDriver: true,
            speed: 50,
            bounciness: 4,
          }).start();
        }}
        onPressOut={() => {
          Animated.spring(scaleAnim, {
            toValue: 1,
            useNativeDriver: true,
            speed: 50,
            bounciness: 4,
          }).start();
        }}
      >
        <Card.Content style={styles.cardContent}>
          <View style={styles.invoiceHeader}>
            <View style={styles.invoiceInfo}>
              {invoice.invoiceNumber && (
                <Text style={styles.invoiceNumber}>{invoice.invoiceNumber}</Text>
              )}
              <Text style={styles.customerName}>{invoice.customerName}</Text>
              <Text style={styles.jobName}>{invoice.job.name}</Text>
              {overdueText && (
                <Text style={styles.overdueText}>{overdueText}</Text>
              )}
            </View>
            <View style={styles.invoiceRight}>
              <View style={styles.invoicePrice}>
                <Text style={styles.invoiceTotal}>{formatCurrency(invoice.total)}</Text>
                {invoice.status === 'partial' && (
                  <Text style={styles.amountDue}>Due: {formatCurrency(amountDue)}</Text>
                )}
                <AnimatedChip
                  status={invoice.status}
                  style={[styles.statusChip, getStatusChipStyle(invoice.status)]}
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
            <Text style={styles.invoiceDate}>
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
        { icon: 'pencil', label: 'Edit', onPress: () => onEdit(invoice) },
        { icon: 'email-outline', label: 'Send via Email', onPress: handleSendInvoice },
        { icon: 'content-copy', label: 'Duplicate', onPress: () => onDuplicate(invoice) },
        ...(showRecordPayment
          ? [{ icon: 'cash', label: 'Record Payment', onPress: () => onRecordPayment(invoice) }]
          : []),
        { icon: 'file-pdf-box', label: 'Export PDF', onPress: handleExportInvoice },
        ...(xeroConnection && invoice.status !== 'draft'
          ? [{
              icon: invoice.xeroSyncStatus === 'synced' ? 'cloud-check' : 'cloud-sync',
              label: invoice.xeroSyncStatus === 'synced' ? 'Re-sync to Xero' : 'Push to Xero',
              onPress: handlePushToXero,
            }]
          : []),
        { icon: 'delete-outline', label: 'Delete', onPress: handleDeleteInvoice, color: colors.error, divider: true },
      ]}
    />

    <ActionSheet
      visible={statusMenuVisible}
      onDismiss={() => setStatusMenuVisible(false)}
      title="Update Status"
      options={[
        ...(invoice.status !== 'draft'
          ? [{ icon: 'file-document-edit-outline', label: 'Mark as Draft', onPress: () => handleStatusChange('draft') }]
          : []),
        ...(invoice.status !== 'sent' && invoice.status !== 'paid'
          ? [{ icon: 'send-outline', label: 'Mark as Sent', onPress: () => handleStatusChange('sent') }]
          : []),
        ...(invoice.status !== 'paid'
          ? [{ icon: 'check-circle-outline', label: 'Mark as Paid', onPress: () => handleStatusChange('paid') }]
          : []),
        ...(invoice.status !== 'cancelled'
          ? [{ icon: 'close-circle-outline', label: 'Cancel Invoice', onPress: () => handleStatusChange('cancelled'), color: colors.error, divider: true }]
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
      primaryButtonAction={confirmDeleteInvoice}
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

    <InvoiceEmailPreviewModal
      visible={emailPreviewVisible}
      onDismiss={() => setEmailPreviewVisible(false)}
      invoice={invoice}
      businessSettings={businessSettings}
      emailBody={emailBody}
      onEmailBodyChange={setEmailBody}
      onRegenerate={handleRegenerateEmail}
      isPro={isPro}
      isRegenerating={isGeneratingEmail}
      photoCount={sourceQuotePhotos.length}
    />
    </>
  );
});

function getStatusChipStyle(status: Invoice['status']) {
  switch (status) {
    case 'paid':
      return { backgroundColor: colors.successBg };
    case 'sent':
      return { backgroundColor: colors.warningBg };
    case 'partial':
      return { backgroundColor: colors.infoBg };
    case 'overdue':
      return { backgroundColor: colors.errorBg };
    case 'cancelled':
      return { backgroundColor: colors.errorBg };
    default:
      return { backgroundColor: colors.infoBg };
  }
}

const styles = StyleSheet.create({
  invoiceCard: {
    marginBottom: 12,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  cardContent: {
    paddingTop: 16,
    paddingBottom: 16,
  },
  invoiceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  invoiceInfo: {
    flex: 1,
  },
  invoiceRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  invoiceNumber: {
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
  invoicePrice: {
    alignItems: 'flex-end',
    marginRight: -8,
  },
  invoiceTotal: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primary,
    marginBottom: 4,
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
  invoiceDate: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
