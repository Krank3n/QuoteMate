/**
 * Dashboard Screen
 * Home screen with quick stats and new quote button
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform, RefreshControl, Pressable } from 'react-native';
import {
  Text,
  Surface,
  Title,
  Button,
  Paragraph,
  Dialog,
  Portal,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useScrollToTop } from '@react-navigation/native';
import { format } from 'date-fns';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import * as MailComposer from 'expo-mail-composer';

import { useStore } from '../store/useStore';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { Quote } from '../types';
import { generateQuotePDF } from '../utils/pdfGenerator';
import { WebContainer } from '../components/WebContainer';
import { QuoteCard } from '../components/QuoteCard';
import { AlertModal } from '../components/AlertModal';
import { updateActivityTimestamp } from '../services/emailService';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { AnimatedListItem } from '../components/AnimatedListItem';
import { StatusSheet, QUOTE_STATUS_OPTIONS } from '../components/StatusSheet';
import { lightTap, successTap } from '../utils/haptics';
import { openWebEmailClient, copyQuoteEmailText } from '../utils/emailUtils';

export function DashboardScreen() {
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);

  // Track user activity for re-engagement emails (once per app session)
  const activityTracked = useRef(false);
  useEffect(() => {
    if (!activityTracked.current) {
      activityTracked.current = true;
      updateActivityTimestamp();
    }
  }, []);
  const navigation = useNavigation<any>();
  const { quotes, businessSettings, createNewQuote, setCurrentQuote, duplicateQuote, deleteQuote, saveQuote, canCreateQuote, subscriptionStatus, createInvoiceFromQuote, saveInvoice, loadQuotes } = useStore();

  const [emailDialogVisible, setEmailDialogVisible] = useState(false);
  const [emailQuote, setEmailQuote] = useState<Quote | null>(null);
  const [statusSheetVisible, setStatusSheetVisible] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [convertModalVisible, setConvertModalVisible] = useState(false);
  const [quoteToConvert, setQuoteToConvert] = useState<Quote | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const isTrialActive = !!(subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired);
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  // Calculate quick stats (memoized to avoid recalculation on every render)
  const { sentQuotes, acceptedQuotes, thisMonthRevenue, pipelineValue } = useMemo(() => {
    const now = new Date();
    let sent = 0;
    let accepted = 0;
    let monthRevenue = 0;
    let pipeline = 0;

    for (const q of quotes) {
      if (q.status === 'sent') {
        sent++;
        pipeline += q.total;
      }
      if (q.status === 'accepted' || q.status === 'completed') {
        accepted++;
        const d = new Date(q.updatedAt);
        if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
          monthRevenue += q.total;
        }
      }
    }

    return { sentQuotes: sent, acceptedQuotes: accepted, thisMonthRevenue: monthRevenue, pipelineValue: pipeline };
  }, [quotes]);

  // Recent quotes (last 3)
  const recentQuotes = [...quotes]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 3);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadQuotes();
    } finally {
      setRefreshing(false);
    }
  };

  const handleNewQuote = () => {
    // Check if user can create a new quote
    if (!canCreateQuote()) {
      navigation.navigate('Paywall' as never);
      return;
    }

    lightTap();
    createNewQuote();
    navigation.navigate('NewQuote' as never);
  };

  const handleViewQuote = (quoteId: string) => {
    navigation.navigate('ViewQuote' as never, { quoteId } as never);
  };

  const handleEditQuote = (quote: Quote, section?: 'customer' | 'job' | 'materials' | 'labor') => {
    setCurrentQuote(quote);

    // Navigate to specific section if provided
    if (section) {
      const screenMap = {
        customer: 'CustomerDetails',
        job: 'JobDetails',
        materials: 'MaterialsList',
        labor: 'LaborMarkup',
      };
      navigation.navigate('NewQuote' as never, { screen: screenMap[section] } as never);
    } else {
      navigation.navigate('NewQuote' as never);
    }
  };

  const handleDuplicateQuote = async (quote: Quote) => {
    // Check if user can create a new quote
    if (!canCreateQuote()) {
      navigation.navigate('Paywall' as never);
      return;
    }

    try {
      await duplicateQuote(quote);
      Alert.alert('Success', 'Quote duplicated successfully!');
    } catch (error) {
      Alert.alert('Error', 'Failed to duplicate quote. Please try again.');
    }
  };

  const handleConvertToInvoice = (quote: Quote) => {
    if (!isPro) {
      navigation.navigate('Paywall' as never);
      return;
    }
    setQuoteToConvert(quote);
    setConvertModalVisible(true);
  };

  const handleConfirmConvert = async () => {
    if (!quoteToConvert) return;
    setIsConverting(true);
    try {
      const invoice = createInvoiceFromQuote(quoteToConvert);
      await saveInvoice(invoice);
      setConvertModalVisible(false);
      setQuoteToConvert(null);
      navigation.navigate('ViewInvoice' as never, { invoiceId: invoice.id } as never);
    } catch (error) {
      console.error('Failed to convert to invoice:', error);
    } finally {
      setIsConverting(false);
    }
  };

  const handleDeleteQuote = async (quoteId: string) => {
    Alert.alert(
      'Delete Quote',
      'Are you sure you want to delete this quote?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteQuote(quoteId);
            } catch (error) {
              Alert.alert('Error', 'Failed to delete quote. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleSendQuote = async (quote: Quote) => {
    try {
      if (Platform.OS === 'web') {
        // Generate PDF HTML
        const html = await generateQuotePDF(quote, businessSettings, { isPro: subscriptionStatus?.isPro || !!(subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired) });
        const filename = `Quote_${quote.customerName.replace(/\s+/g, '_')}_${quote.job.name.replace(/\s+/g, '_')}_${format(quote.updatedAt, 'dd-MMM-yyyy')}.pdf`;

        // Create a hidden iframe to print the PDF
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        document.body.appendChild(iframe);

        const iframeDoc = iframe.contentWindow?.document;
        if (iframeDoc) {
          iframeDoc.open();
          iframeDoc.write(html);
          iframeDoc.close();

          // Wait for content to load then trigger print dialog
          iframe.onload = () => {
            setTimeout(() => {
              iframe.contentWindow?.print();
              // Clean up after a delay
              setTimeout(() => {
                document.body.removeChild(iframe);
              }, 1000);
            }, 250);
          };
        }

        // Show email client selector dialog immediately
        setEmailQuote(quote);
        setEmailDialogVisible(true);
      } else{
        // Mobile platforms
        // Check if email is available
        const isAvailable = await MailComposer.isAvailableAsync();
        if (!isAvailable) {
          Alert.alert('Email Not Available', 'Email is not configured on this device. Please set up an email account first.');
          return;
        }

        // Generate PDF with custom filename
        const html = await generateQuotePDF(quote, businessSettings, { isPro: subscriptionStatus?.isPro || !!(subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired) });
        const filename = `Quote_${quote.customerName.replace(/\s+/g, '_')}_${quote.job.name.replace(/\s+/g, '_')}_${format(quote.updatedAt, 'dd-MMM-yyyy')}.pdf`;
        const { uri } = await Print.printToFileAsync({ html, base64: false });

        // Compose email
        const result = await MailComposer.composeAsync({
          recipients: quote.customerEmail ? [quote.customerEmail] : [],
          subject: `Quotation from ${businessSettings?.businessName || 'Your Business'} - ${quote.job.name}`,
          body: `Hi ${quote.customerName},\n\nPlease find attached your quotation for ${quote.job.name}.\n\nTotal: ${formatCurrency(quote.total)}\n\nThis quote is valid for 30 days from the date of issue.\n\nIf you have any questions, please don't hesitate to contact us.\n\nBest regards,\n${businessSettings?.businessName || 'Your Business'}`,
          attachments: [uri],
        });

        // Update quote status to 'sent' if email was sent
        if (result.status === 'sent') {
          const updatedQuote = { ...quote, status: 'sent' as const };
          await saveQuote(updatedQuote);
          Alert.alert('Success', 'Quote sent successfully and marked as sent!');
        }
      }
    } catch (error) {
      console.error('Send error:', error);
      Alert.alert('Error', 'Failed to send quote. Please try again.');
    }
  };

  const handleEmailViaGmail = async (quote: Quote) => {
    await openWebEmailClient('gmail', quote, businessSettings, saveQuote);
    setEmailDialogVisible(false);
  };

  const handleEmailViaOutlook = async (quote: Quote) => {
    await openWebEmailClient('outlook', quote, businessSettings, saveQuote);
    setEmailDialogVisible(false);
  };

  const handleEmailViaYahoo = async (quote: Quote) => {
    await openWebEmailClient('yahoo', quote, businessSettings, saveQuote);
    setEmailDialogVisible(false);
  };

  const handleCopyEmailText = async (quote: Quote) => {
    try {
      await copyQuoteEmailText(quote, businessSettings, saveQuote);
      setEmailDialogVisible(false);
    } catch (error) {
      Alert.alert('Error', 'Failed to copy to clipboard');
    }
  };

  const handleOpenEmailDialog = (quote: Quote) => {
    setEmailQuote(quote);
    setEmailDialogVisible(true);
  };

  const handleOpenStatusSheet = (quote: Quote) => {
    setSelectedQuote(quote);
    setStatusSheetVisible(true);
  };

  const handleStatusSelect = async (newStatus: string) => {
    if (!selectedQuote) return;
    try {
      const updatedQuote = {
        ...selectedQuote,
        status: newStatus as Quote['status'],
        updatedAt: new Date(),
      };
      await saveQuote(updatedQuote);
    } catch (error) {
      Alert.alert('Error', 'Failed to update quote status. Please try again.');
    }
    setStatusSheetVisible(false);
    setSelectedQuote(null);
  };

  return (
    <>
      {/* Convert to Invoice Modal */}
      <AlertModal
        visible={convertModalVisible}
        onDismiss={() => {
          setConvertModalVisible(false);
          setQuoteToConvert(null);
        }}
        type="info"
        icon="file-replace"
        title="Convert to Invoice"
        message={quoteToConvert ? `Create an invoice from this quote for ${quoteToConvert.customerName}?` : ''}
        showConfetti={false}
        primaryButtonText="Convert"
        primaryButtonAction={handleConfirmConvert}
        secondaryButtonText="Cancel"
        secondaryButtonAction={() => {
          setConvertModalVisible(false);
          setQuoteToConvert(null);
        }}
        secondaryButtonLoading={isConverting}
      />

    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 100 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      <WebContainer>
        <View style={styles.header}>
          <Title style={styles.greeting}>
            G'day, {businessSettings?.businessName || 'Mate'}!
          </Title>
          <Paragraph>Ready to create some quotes?</Paragraph>
        </View>

      {/* Trial Status */}
      {subscriptionStatus && !subscriptionStatus.isPro && subscriptionStatus.trialStartedAt && (() => {
        const trialStart = new Date(subscriptionStatus.trialStartedAt);
        const now = new Date();
        const elapsed = now.getTime() - trialStart.getTime();
        const trialMs = 7 * 24 * 60 * 60 * 1000;
        const daysRemaining = Math.max(0, Math.ceil((trialMs - elapsed) / (24 * 60 * 60 * 1000)));
        const trialExpired = elapsed >= trialMs;
        const progress = Math.min(elapsed / trialMs, 1);

        return (
          <Surface style={styles.quotaCard}>
            <View style={styles.quotaContent}>
              <View style={styles.quotaTextContainer}>
                <Text style={styles.quotaTitle}>
                  {trialExpired
                    ? 'Free trial ended'
                    : `${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} left in trial`}
                </Text>
                <Text style={styles.quotaSubtext}>
                  {trialExpired
                    ? 'Subscribe for unlimited quotes with your logo'
                    : 'Unlimited quotes during your trial'}
                </Text>
              </View>
              <View style={styles.quotaBarContainer}>
                <View style={styles.quotaBarBackground}>
                  <View
                    style={[
                      styles.quotaBarFill,
                      {
                        width: `${progress * 100}%`,
                        backgroundColor: trialExpired
                          ? colors.error
                          : daysRemaining <= 1
                          ? colors.warning
                          : colors.primary,
                      },
                    ]}
                  />
                </View>
              </View>
            </View>
            {trialExpired && (
              <Button
                mode="contained"
                compact
                onPress={() => navigation.navigate('Paywall' as never)}
                style={styles.quotaUpgradeButton}
              >
                Upgrade to Pro
              </Button>
            )}
          </Surface>
        );
      })()}

      {/* New Quote Button */}
      <Button
        mode="contained"
        icon="plus-circle"
        onPress={handleNewQuote}
        style={styles.newQuoteButton}
        contentStyle={styles.newQuoteButtonContent}
        accessibilityLabel="Create a new quote"
      >
        New Quote
      </Button>

      {/* Quick Stats */}
      <View style={styles.statsContainer}>
        <AnimatedListItem index={0} style={styles.statCardWrapper}>
          <Pressable onPress={() => { lightTap(); navigation.navigate('Insights' as never); }} accessibilityRole="button" accessibilityLabel={`Earned this month: ${formatCurrency(thisMonthRevenue)}`}>
            <Surface style={styles.statCard}>
              <View style={[styles.statIconCircle, { backgroundColor: colors.primaryBg }]}>
                <MaterialCommunityIcons name="chart-areaspline" size={22} color={colors.primary} />
              </View>
              <AnimatedNumber value={thisMonthRevenue} format={formatCurrency} style={styles.statNumber} delay={0} />
              <Text style={styles.statLabel}>Earned this month</Text>
            </Surface>
          </Pressable>
        </AnimatedListItem>

        <AnimatedListItem index={1} style={styles.statCardWrapper}>
          <Pressable onPress={() => { lightTap(); navigation.navigate('Insights' as never); }} accessibilityRole="button" accessibilityLabel={`Awaiting response: ${formatCurrency(pipelineValue)}`}>
            <Surface style={styles.statCard}>
              <View style={[styles.statIconCircle, { backgroundColor: colors.infoBg }]}>
                <MaterialCommunityIcons name="timer-sand" size={22} color={colors.info} />
              </View>
              <AnimatedNumber value={pipelineValue} format={formatCurrency} style={styles.statNumber} delay={100} />
              <Text style={styles.statLabel}>Awaiting response</Text>
            </Surface>
          </Pressable>
        </AnimatedListItem>

        <AnimatedListItem index={2} style={styles.statCardWrapper}>
          <Pressable onPress={() => { lightTap(); navigation.navigate('Quotes', { filter: 'sent' }); }} accessibilityRole="button" accessibilityLabel={`${sentQuotes} quotes sent`}>
            <Surface style={styles.statCard}>
              <View style={[styles.statIconCircle, { backgroundColor: colors.warningBg }]}>
                <MaterialCommunityIcons name="send-check" size={22} color={colors.secondary} />
              </View>
              <AnimatedNumber value={sentQuotes} style={styles.statNumber} delay={200} />
              <Text style={styles.statLabel}>Quotes sent</Text>
            </Surface>
          </Pressable>
        </AnimatedListItem>

        <AnimatedListItem index={3} style={styles.statCardWrapper}>
          <Pressable onPress={() => { lightTap(); navigation.navigate('Quotes', { filter: 'accepted' }); }} accessibilityRole="button" accessibilityLabel={`${acceptedQuotes} jobs won`}>
            <Surface style={styles.statCard}>
              <View style={[styles.statIconCircle, { backgroundColor: colors.successBg }]}>
                <MaterialCommunityIcons name="handshake" size={22} color={colors.success} />
              </View>
              <AnimatedNumber value={acceptedQuotes} style={styles.statNumber} delay={300} />
              <Text style={styles.statLabel}>Jobs won</Text>
            </Surface>
          </Pressable>
        </AnimatedListItem>
      </View>

      {/* Recent Quotes */}
      {recentQuotes.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Quotes</Text>

          {recentQuotes.map((quote, index) => (
            <AnimatedListItem key={quote.id} index={index}>
              <QuoteCard
                quote={quote}
                businessSettings={businessSettings}
                onView={handleViewQuote}
                onEdit={handleEditQuote}
                onDelete={handleDeleteQuote}
                onDuplicate={handleDuplicateQuote}
                onSave={saveQuote}
                onStatusChange={handleOpenStatusSheet}
                onEmailDialogOpen={handleOpenEmailDialog}
                onConvertToInvoice={handleConvertToInvoice}
              />
            </AnimatedListItem>
          ))}

          <Button
            mode="text"
            onPress={() => navigation.navigate('Quotes')}
            style={styles.viewAllButton}
          >
            View All Quotes
          </Button>
        </View>
      )}

      {recentQuotes.length === 0 && (
        <View style={styles.emptyState}>
          <MaterialCommunityIcons
            name="file-document-outline"
            size={64}
            color={colors.disabled}
          />
          <Text style={styles.emptyText}>No quotes yet</Text>
          <Text style={styles.emptySubtext}>
            Tap "New Quote" to create your first quote
          </Text>
        </View>
      )}
      </WebContainer>
    </ScrollView>

    {/* Status Sheet */}
    <StatusSheet
      visible={statusSheetVisible}
      onDismiss={() => {
        setStatusSheetVisible(false);
        setSelectedQuote(null);
      }}
      currentStatus={selectedQuote?.status || 'draft'}
      onSelect={handleStatusSelect}
      options={QUOTE_STATUS_OPTIONS}
    />

    {/* Email Client Selector Dialog */}
    <Portal>
      <Dialog visible={emailDialogVisible} onDismiss={() => setEmailDialogVisible(false)}>
        <Dialog.Title>Send Quote</Dialog.Title>
        <Dialog.Content>
          <Text style={{ marginBottom: 16 }}>Choose how to send your quote:</Text>
          <View style={{ gap: 8 }}>
            <Button
              mode="contained"
              icon="google"
              onPress={() => emailQuote && handleEmailViaGmail(emailQuote)}
              style={{ marginBottom: 8 }}
            >
              Gmail
            </Button>
            <Button
              mode="contained"
              icon="microsoft-outlook"
              onPress={() => emailQuote && handleEmailViaOutlook(emailQuote)}
              style={{ marginBottom: 8 }}
            >
              Outlook
            </Button>
            <Button
              mode="contained"
              icon="yahoo"
              onPress={() => emailQuote && handleEmailViaYahoo(emailQuote)}
              style={{ marginBottom: 8 }}
            >
              Yahoo Mail
            </Button>
            <Button
              mode="outlined"
              icon="content-copy"
              onPress={() => emailQuote && handleCopyEmailText(emailQuote)}
            >
              Copy Email Text
            </Button>
          </View>
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={() => setEmailDialogVisible(false)}>Cancel</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    padding: 20,
    paddingTop: 24,
  },
  greeting: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  quotaCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    backgroundColor: colors.surface,
    elevation: 2,
  },
  quotaContent: {
    gap: 8,
  },
  quotaTextContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  quotaTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  quotaSubtext: {
    fontSize: 12,
    color: colors.onSurface,
  },
  quotaBarContainer: {
    marginTop: 4,
  },
  quotaBarBackground: {
    height: 6,
    backgroundColor: colors.surfaceLight,
    borderRadius: 3,
    overflow: 'hidden',
  },
  quotaBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  quotaUpgradeButton: {
    marginTop: 12,
  },
  newQuoteButton: {
    marginHorizontal: 20,
    marginBottom: 24,
  },
  newQuoteButtonContent: {
    paddingVertical: 8,
  },
  statsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    marginBottom: 24,
  },
  statCardWrapper: {
    width: '46%',
    margin: '2%',
  },
  statCard: {
    padding: 16,
    borderRadius: 14,
    alignItems: 'center',
    elevation: 2,
    backgroundColor: colors.surface,
  },
  statIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  statNumber: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 3,
  },
  statLabel: {
    fontSize: 11,
    color: colors.onSurface,
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  viewAllButton: {
    marginTop: 8,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    color: colors.text,
  },
  emptySubtext: {
    fontSize: 14,
    color: colors.onSurface,
    marginTop: 8,
    textAlign: 'center',
  },
});
