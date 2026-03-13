/**
 * InvoiceCard Component
 * Card component for displaying invoice information in lists
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, StyleSheet, Alert, Platform, Pressable, Animated } from 'react-native';
import {
  Text,
  Card,
  Divider,
  IconButton,
} from 'react-native-paper';
import { format, formatDistanceToNow, differenceInDays } from 'date-fns';
import * as Print from 'expo-print';
import * as MailComposer from 'expo-mail-composer';

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Invoice, BusinessSettings, InvoiceStatus } from '../types';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { isInvoiceOverdue, getOverdueText, getAmountDue } from '../utils/invoiceCalculator';
import { generateInvoicePDF, exportInvoicePDF, generatePdfFilename } from '../utils/pdfGenerator';
import { useStore } from '../store/useStore';
import { selectionTap } from '../utils/haptics';
import { SwipeableCard } from './SwipeableCard';
import { AnimatedChip } from './AnimatedChip';
import { AlertModal } from './AlertModal';
import { ShimmerOverlay } from './ShimmerOverlay';
import { TapRipple } from './TapRipple';
import { GrainOverlay } from './GrainOverlay';
import { ActionSheet } from './ActionSheet';

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
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const idleAnim = useRef(new Animated.Value(0)).current;
  const idleTilt = useRef(new Animated.Value(0)).current;
  const { subscriptionStatus } = useStore();

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
    try {
      if (Platform.OS === 'web') {
        // Generate PDF HTML
        const html = await generateInvoicePDF(invoice, businessSettings, { isPro });
        const filename = generatePdfFilename('Invoice', invoice.customerName, invoice.job.name, new Date(invoice.updatedAt));

        // Create a hidden iframe to print the PDF
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        document.body.appendChild(iframe);

        const iframeDoc = iframe.contentWindow?.document;
        if (iframeDoc) {
          iframeDoc.open();
          iframeDoc.write(html);
          iframeDoc.close();

          iframe.onload = () => {
            setTimeout(() => {
              iframe.contentWindow?.print();
              setTimeout(() => {
                document.body.removeChild(iframe);
              }, 1000);
            }, 250);
          };
        }
      } else {
        const isAvailable = await MailComposer.isAvailableAsync();
        if (!isAvailable) {
          Alert.alert('Email Not Available', 'Email is not configured on this device. Please set up an email account first.');
          return;
        }

        const html = await generateInvoicePDF(invoice, businessSettings, { isPro });
        const { uri } = await Print.printToFileAsync({ html, base64: false });

        const result = await MailComposer.composeAsync({
          recipients: invoice.customerEmail ? [invoice.customerEmail] : [],
          subject: `Invoice from ${businessSettings?.businessName || 'Your Business'} - ${invoice.job.name}`,
          body: `Hi ${invoice.customerName},\n\nPlease find attached your invoice for ${invoice.job.name}.\n\nTotal: ${formatCurrency(invoice.total)}\n\nPayment is due by ${format(new Date(invoice.dueDate), 'dd MMMM yyyy')}.\n\nThank you for your business!\n\nBest regards,\n${businessSettings?.businessName || 'Your Business'}`,
          attachments: [uri],
        });

        if (result.status === 'sent' && invoice.status === 'draft') {
          const updatedInvoice = { ...invoice, status: 'sent' as const };
          await onSave(updatedInvoice);
          Alert.alert('Success', 'Invoice sent successfully!');
        }
      }
    } catch (error) {
      console.error('Send error:', error);
      Alert.alert('Error', 'Failed to send invoice. Please try again.');
    }
  };

  const handleExportInvoice = async () => {
    try {
      await exportInvoicePDF(invoice, businessSettings, 'export', { isPro });
    } catch (error) {
      console.error('Export error:', error);
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
                size={24}
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
