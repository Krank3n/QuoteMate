/**
 * InvoiceCard Component
 * Card component for displaying invoice information in lists
 */

import React, { useState, useRef, useCallback } from 'react';
import { View, StyleSheet, Alert, Platform, Pressable, Animated } from 'react-native';
import {
  Text,
  Card,
  Divider,
  Menu,
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
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const { subscriptionStatus } = useStore();
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
    Alert.alert(
      'Delete Invoice',
      'Are you sure you want to delete this invoice?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => onDelete(invoice.id),
        },
      ]
    );
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
    <SwipeableCard
      rightActions={[
        { icon: 'send', label: 'Send', color: colors.primary, bgColor: colors.primaryBg, onPress: handleSendInvoice },
        { icon: 'content-copy', label: 'Duplicate', color: colors.info, bgColor: colors.infoBg, onPress: () => { onDuplicate(invoice); } },
      ]}
      leftActions={[
        { icon: 'delete-outline', label: 'Delete', color: colors.error, bgColor: colors.errorBg, onPress: handleDeleteInvoice },
      ]}
    >
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
    <Card style={styles.invoiceCard}>
      <Pressable
        onPress={() => onView(invoice.id)}
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
                <Menu
                  visible={statusMenuVisible}
                  onDismiss={() => setStatusMenuVisible(false)}
                  anchor={
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
                  }
                >
                  {/* Draft status options */}
                  {invoice.status !== 'draft' && (
                    <Menu.Item
                      leadingIcon="file-document-edit"
                      onPress={() => handleStatusChange('draft')}
                      title="Mark as Draft"
                    />
                  )}
                  {/* Sent status options */}
                  {invoice.status !== 'sent' && invoice.status !== 'paid' && (
                    <Menu.Item
                      leadingIcon="send"
                      onPress={() => handleStatusChange('sent')}
                      title="Mark as Sent"
                    />
                  )}
                  {/* Paid status options */}
                  {invoice.status !== 'paid' && (
                    <Menu.Item
                      leadingIcon="check-circle"
                      onPress={() => handleStatusChange('paid')}
                      title="Mark as Paid"
                    />
                  )}
                  {/* Cancel option */}
                  {invoice.status !== 'cancelled' && (
                    <Menu.Item
                      leadingIcon="close-circle"
                      onPress={() => handleStatusChange('cancelled')}
                      title="Cancel Invoice"
                      titleStyle={{ color: colors.error }}
                    />
                  )}
                </Menu>
              </View>
              <Menu
                visible={menuVisible}
                onDismiss={() => setMenuVisible(false)}
                anchor={
                  <IconButton
                    icon="dots-vertical"
                    size={20}
                    onPress={(e) => {
                      e.stopPropagation();
                      setMenuVisible(true);
                    }}
                  />
                }
              >
                <Menu.Item
                  leadingIcon="pencil"
                  onPress={() => {
                    setMenuVisible(false);
                    onEdit(invoice);
                  }}
                  title="Edit"
                />
                <Menu.Item
                  leadingIcon="email"
                  onPress={() => {
                    setMenuVisible(false);
                    handleSendInvoice();
                  }}
                  title="Send via Email"
                />
                <Menu.Item
                  leadingIcon="content-copy"
                  onPress={handleDuplicate}
                  title="Duplicate"
                />
                {showRecordPayment && (
                  <Menu.Item
                    leadingIcon="cash"
                    onPress={() => {
                      setMenuVisible(false);
                      onRecordPayment(invoice);
                    }}
                    title="Record Payment"
                  />
                )}
                <Menu.Item
                  leadingIcon="file-pdf-box"
                  onPress={() => {
                    setMenuVisible(false);
                    handleExportInvoice();
                  }}
                  title="Export PDF"
                />
                <Menu.Item
                  leadingIcon="delete"
                  onPress={() => {
                    setMenuVisible(false);
                    handleDeleteInvoice();
                  }}
                  title="Delete"
                  titleStyle={{ color: colors.error }}
                />
              </Menu>
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
      </Pressable>
    </Card>
    </Animated.View>
    </SwipeableCard>
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
