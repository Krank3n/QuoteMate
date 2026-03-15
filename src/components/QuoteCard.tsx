/**
 * QuoteCard Component
 * Consolidated quote card used in both DashboardScreen and QuotesListScreen
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

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Quote, BusinessSettings } from '../types';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { exportQuotePDF } from '../utils/pdfGenerator';
import { useStore } from '../store/useStore';
import { selectionTap, successTap } from '../utils/haptics';
import { SwipeableCard } from './SwipeableCard';
import { AnimatedChip } from './AnimatedChip';
import { AlertModal } from './AlertModal';
import { ShimmerOverlay } from './ShimmerOverlay';
import { TapRipple } from './TapRipple';
import { GrainOverlay } from './GrainOverlay';
import { ActionSheet, ActionSheetOption } from './ActionSheet';
import { EmailPreviewModal } from './EmailPreviewModal';
import { generateQuoteEmail, getDefaultEmailBody } from '../services/llmService';

interface QuoteCardProps {
  quote: Quote;
  businessSettings: BusinessSettings | null;
  onView: (quoteId: string) => void;
  onEdit: (quote: Quote, section?: 'customer' | 'job' | 'materials' | 'labor') => void;
  onDelete: (quoteId: string) => void;
  onDuplicate: (quote: Quote) => void;
  onSave: (quote: Quote) => void;
  onStatusChange?: (quote: Quote) => void;
  onConvertToInvoice?: (quote: Quote) => void;
}

export const QuoteCard = React.memo(function QuoteCard({
  quote,
  businessSettings,
  onView,
  onEdit,
  onDelete,
  onDuplicate,
  onSave,
  onStatusChange,
  onConvertToInvoice,
}: QuoteCardProps) {
  const [menuVisible, setMenuVisible] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [emailPreviewVisible, setEmailPreviewVisible] = useState(false);
  const [emailBody, setEmailBody] = useState('');
  const [isGeneratingEmail, setIsGeneratingEmail] = useState(false);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const idleAnim = useRef(new Animated.Value(0)).current;
  const idleTilt = useRef(new Animated.Value(0)).current;
  const { subscriptionStatus } = useStore();

  // Subtle idle bob + tilt — randomized so cards are never in sync
  // Uses Animated.loop + delay for proper cleanup
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

  const handleSendQuote = async () => {
    setIsGeneratingEmail(true);
    setEmailPreviewVisible(true);

    try {
      if (isPro) {
        const body = await generateQuoteEmail({
          jobName: quote.job.name,
          jobDescription: quote.job.description || '',
          materials: quote.materials.map(m => ({
            name: m.name,
            quantity: m.quantity,
            unit: m.unit,
          })),
          laborHours: quote.laborHours,
          total: quote.total,
          businessName: businessSettings?.businessName || '',
          customerName: quote.customerName,
        });
        setEmailBody(body);
      } else {
        setEmailBody(getDefaultEmailBody(
          quote.customerName,
          quote.job.name,
          quote.total,
          businessSettings?.businessName || 'Your Business'
        ));
      }
    } catch (error) {
      console.error('Email generation failed:', error);
      setEmailBody(getDefaultEmailBody(
        quote.customerName,
        quote.job.name,
        quote.total,
        businessSettings?.businessName || 'Your Business'
      ));
    } finally {
      setIsGeneratingEmail(false);
    }
  };

  const handleRegenerateEmail = async () => {
    setIsGeneratingEmail(true);
    try {
      const body = await generateQuoteEmail({
        jobName: quote.job.name,
        jobDescription: quote.job.description || '',
        materials: quote.materials.map(m => ({
          name: m.name,
          quantity: m.quantity,
          unit: m.unit,
        })),
        laborHours: quote.laborHours,
        total: quote.total,
        businessName: businessSettings?.businessName || '',
        customerName: quote.customerName,
      });
      setEmailBody(body);
    } catch (error) {
      console.error('Email regeneration failed:', error);
      Alert.alert('Error', 'Could not regenerate email. Please try again.');
    } finally {
      setIsGeneratingEmail(false);
    }
  };

  const handleShareQuote = async () => {
    try {
      await exportQuotePDF(quote, businessSettings, 'share', { isPro });
    } catch (error) {
      console.error('Share error:', error);
      Alert.alert('Error', 'Failed to share quote. Please try again.');
    }
  };

  const handleExportQuote = async () => {
    try {
      await exportQuotePDF(quote, businessSettings, 'export', { isPro });
    } catch (error) {
      console.error('Export error:', error);
      Alert.alert('Error', 'Failed to export quote. Please try again.');
    }
  };

  const handleDeleteQuote = () => {
    setDeleteModalVisible(true);
  };

  const confirmDeleteQuote = () => {
    setDeleteModalVisible(false);
    onDelete(quote.id);
  };


  return (
    <>
    <SwipeableCard
      rightActions={[
        { icon: 'send', label: 'Send', color: colors.primary, bgColor: colors.primaryBg, onPress: handleSendQuote },
        { icon: 'content-copy', label: 'Duplicate', color: colors.info, bgColor: colors.infoBg, onPress: () => onDuplicate(quote) },
      ]}
      leftActions={[
        { icon: 'delete-outline', label: 'Delete', color: colors.error, bgColor: colors.errorBg, onPress: handleDeleteQuote },
      ]}
    >
      <Animated.View style={{ transform: [{ scale: scaleAnim }, { translateY: idleAnim }, { rotate: idleTilt.interpolate({ inputRange: [-1, 1], outputRange: ['-1deg', '1deg'] }) }] }}>
      <Card style={styles.quoteCard}>
        <TapRipple
          onPress={() => onView(quote.id)}
          accessibilityRole="button"
          accessibilityLabel={`View quote for ${quote.customerName}, ${quote.job.name}, ${formatCurrency(quote.total)}, status ${quote.status}`}
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
            <View style={styles.quoteHeader}>
              <View style={styles.quoteInfo}>
                {quote.quoteNumber && (
                  <Text style={styles.quoteNumber}>{quote.quoteNumber}</Text>
                )}
                <Text style={styles.quoteName}>{quote.customerName}</Text>
                <Text style={styles.quoteJob}>{quote.job.name}</Text>
              </View>
              <View style={styles.quoteRight}>
                <View style={styles.quotePrice}>
                  <Text style={styles.quoteTotal}>{formatCurrency(quote.total)}</Text>
                  <AnimatedChip
                    status={quote.status}
                    style={[styles.statusChip, getStatusChipStyle(quote.status)]}
                    textStyle={styles.statusText}
                    onPress={(e) => {
                      e.stopPropagation();
                      selectionTap();
                      onStatusChange?.(quote);
                    }}
                  >
                    {quote.status}
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
              <Text style={styles.quoteDate}>
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
        { icon: 'pencil', label: 'Edit', onPress: () => onEdit(quote) },
        { icon: 'email-outline', label: 'Send via Email', onPress: handleSendQuote },
        { icon: 'content-copy', label: 'Duplicate', onPress: () => onDuplicate(quote) },
        { icon: 'share-variant', label: 'Share', onPress: handleShareQuote },
        { icon: 'file-pdf-box', label: 'Export PDF', onPress: handleExportQuote },
        ...(onConvertToInvoice
          ? [{ icon: 'file-replace', label: 'Convert to Invoice', onPress: () => onConvertToInvoice(quote) }]
          : []),
        { icon: 'delete-outline', label: 'Delete', onPress: handleDeleteQuote, color: colors.error, divider: true },
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
      primaryButtonAction={confirmDeleteQuote}
      secondaryButtonText="Cancel"
      secondaryButtonAction={() => setDeleteModalVisible(false)}
      showConfetti={false}
    />

    <EmailPreviewModal
      visible={emailPreviewVisible}
      onDismiss={() => setEmailPreviewVisible(false)}
      quote={quote}
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

function getStatusChipStyle(status: string) {
  switch (status) {
    case 'accepted':
      return { backgroundColor: colors.successBg };
    case 'completed':
      return { backgroundColor: colors.primaryBg };
    case 'sent':
      return { backgroundColor: colors.warningBg };
    case 'rejected':
      return { backgroundColor: colors.errorBg };
    default:
      return { backgroundColor: colors.infoBg };
  }
}

const styles = StyleSheet.create({
  quoteCard: {
    marginBottom: 12,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  cardContent: {
    paddingTop: 16,
    paddingBottom: 16,
  },
  quoteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  quoteInfo: {
    flex: 1,
  },
  quoteRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  quoteNumber: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: 2,
  },
  quoteName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  quoteJob: {
    fontSize: 14,
    color: colors.onSurface,
  },
  quotePrice: {
    alignItems: 'flex-end',
    marginRight: -8,
  },
  quoteTotal: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primary,
    marginBottom: 8,
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
  quoteDate: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
