/**
 * Dashboard Screen
 * Home screen with quick stats and new quote button
 */

import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform } from 'react-native';
import {
  Text,
  Surface,
  Title,
  Button,
  Card,
  Paragraph,
  Divider,
  Menu,
  IconButton,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { format } from 'date-fns';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import * as MailComposer from 'expo-mail-composer';

import { useStore } from '../store/useStore';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { Quote } from '../types';

export function DashboardScreen() {
  const navigation = useNavigation<any>();
  const { quotes, businessSettings, createNewQuote, setCurrentQuote, duplicateQuote, deleteQuote, saveQuote, canCreateQuote, subscriptionStatus } = useStore();

  const [menuVisible, setMenuVisible] = useState<string | null>(null);

  // Calculate quick stats
  const totalQuotes = quotes.length;
  const sentQuotes = quotes.filter((q) => q.status === 'sent').length;
  const acceptedQuotes = quotes.filter((q) => q.status === 'accepted').length;
  const totalRevenue = quotes
    .filter((q) => q.status === 'accepted')
    .reduce((sum, q) => sum + q.total, 0);

  // Recent quotes (last 3)
  const recentQuotes = [...quotes]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 3);

  const handleNewQuote = () => {
    // Check if user can create a new quote
    if (!canCreateQuote()) {
      navigation.navigate('Paywall' as never);
      return;
    }

    createNewQuote();
    navigation.navigate('NewQuote' as never);
  };

  const handleEditQuote = (quote: Quote) => {
    setCurrentQuote(quote);
    navigation.navigate('NewQuote' as never);
  };

  const handleDuplicateQuote = async (quote: Quote) => {
    try {
      await duplicateQuote(quote);
      Alert.alert('Success', 'Quote duplicated successfully!');
    } catch (error) {
      Alert.alert('Error', 'Failed to duplicate quote. Please try again.');
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
      // Check if email is available
      const isAvailable = await MailComposer.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert('Email Not Available', 'Email is not configured on this device. Please set up an email account first.');
        return;
      }

      // Generate PDF with custom filename
      const html = await generateHTML(quote);
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
    } catch (error) {
      console.error('Send error:', error);
      Alert.alert('Error', 'Failed to send quote. Please try again.');
    }
  };

  const generateHTML = async (quote: Quote) => {
    const business = businessSettings || {
      businessName: 'Your Business',
      email: '',
      phone: '',
      abn: '',
    };

    // Convert logo to base64 if it exists
    let logoBase64 = '';
    if (businessSettings?.logoUri) {
      try {
        const base64 = await FileSystem.readAsStringAsync(businessSettings.logoUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        logoBase64 = `data:image/png;base64,${base64}`;
      } catch (error) {
        console.error('Failed to load logo:', error);
      }
    }

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
      <style>
        body {
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          padding: 40px;
          color: #333;
        }
        .header {
          border-bottom: 3px solid #008542;
          padding-bottom: 20px;
          margin-bottom: 30px;
        }
        .logo {
          max-width: 300px;
          max-height: 80px;
          margin-bottom: 15px;
        }
        .header h1 {
          color: #008542;
          margin: 0 0 10px 0;
        }
        .info-section {
          margin-bottom: 30px;
        }
        .info-section h3 {
          color: #008542;
          margin-bottom: 10px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
        }
        th {
          background-color: #008542;
          color: white;
          padding: 10px;
          text-align: left;
        }
        td {
          padding: 8px;
          border-bottom: 1px solid #ddd;
        }
        .total-row {
          font-weight: bold;
          background-color: #f5f5f5;
        }
        .grand-total {
          font-size: 18px;
          color: #008542;
          font-weight: bold;
        }
        .summary {
          margin-top: 30px;
          padding: 20px;
          background-color: #f9f9f9;
          border-radius: 8px;
        }
        .summary-row {
          display: flex;
          justify-content: space-between;
          padding: 8px 0;
        }
      </style>
    </head>
    <body>
      <div class="header">
        ${logoBase64 ? `<img src="${logoBase64}" alt="${business.businessName}" class="logo" />` : ''}
        <h1>${business.businessName}</h1>
        <p>
          ${business.abn ? `ABN: ${business.abn}<br>` : ''}
          ${business.email ? `Email: ${business.email}<br>` : ''}
          ${business.phone ? `Phone: ${business.phone}` : ''}
        </p>
      </div>

      <div class="info-section">
        <h2>QUOTATION</h2>
        <p><strong>Quote Date:</strong> ${format(new Date(quote.updatedAt), 'dd MMMM yyyy')}</p>
        <p><strong>Customer:</strong> ${quote.customerName}</p>
        ${quote.customerEmail ? `<p><strong>Email:</strong> ${quote.customerEmail}</p>` : ''}
        ${quote.customerPhone ? `<p><strong>Phone:</strong> ${quote.customerPhone}</p>` : ''}
        ${quote.jobAddress ? `<p><strong>Job Address:</strong> ${quote.jobAddress}</p>` : ''}
      </div>

      <div class="info-section">
        <h3>Job Details</h3>
        <p><strong>${quote.job.name}</strong></p>
        <p>${quote.job.description}</p>
      </div>

      <h3>Materials</h3>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Quantity</th>
            <th>Unit Price</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${quote.materials
            .map(
              (m) => `
            <tr>
              <td>${m.name}</td>
              <td>${m.quantity} ${m.unit}</td>
              <td>${formatCurrency(m.price)}</td>
              <td>${formatCurrency(m.totalPrice)}</td>
            </tr>
          `
            )
            .join('')}
          <tr class="total-row">
            <td colspan="3">Materials Subtotal</td>
            <td>${formatCurrency(quote.materialsSubtotal)}</td>
          </tr>
        </tbody>
      </table>

      <h3>Labor</h3>
      <table>
        <tbody>
          <tr>
            <td>Labor (${quote.laborHours} hours @ ${formatCurrency(quote.laborRate)}/hr)</td>
            <td>${formatCurrency(quote.laborTotal)}</td>
          </tr>
        </tbody>
      </table>

      <div class="summary">
        <div class="summary-row">
          <span>Materials Subtotal</span>
          <span>${formatCurrency(quote.materialsSubtotal)}</span>
        </div>
        <div class="summary-row">
          <span>Labor</span>
          <span>${formatCurrency(quote.laborTotal)}</span>
        </div>
        <div class="summary-row">
          <span>Subtotal</span>
          <span>${formatCurrency(quote.subtotal)}</span>
        </div>
        <div class="summary-row">
          <span>Markup (${quote.markup}%)</span>
          <span>${formatCurrency(quote.markupAmount)}</span>
        </div>
        <div class="summary-row">
          <span>GST (10%)</span>
          <span>${formatCurrency(quote.gst)}</span>
        </div>
        <hr>
        <div class="summary-row grand-total">
          <span>TOTAL</span>
          <span>${formatCurrency(quote.total)}</span>
        </div>
      </div>

      ${quote.notes ? `<div class="info-section"><h3>Notes</h3><p>${quote.notes}</p></div>` : ''}

      <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666;">
        <p>This quote is valid for 30 days from the date of issue.</p>
        <p>Generated with QuoteMate - quoting tool for Australian tradies</p>
      </div>
    </body>
    </html>
    `;
  };

  const handleShareQuote = async (quote: Quote) => {
    try {
      const html = await generateHTML(quote);
      const filename = `Quote_${quote.customerName.replace(/\s+/g, '_')}_${quote.job.name.replace(/\s+/g, '_')}_${format(quote.updatedAt, 'dd-MMM-yyyy')}.pdf`;
      const { uri } = await Print.printToFileAsync({ html });

      if (Platform.OS === 'ios') {
        await Sharing.shareAsync(uri, { dialogTitle: filename });
      } else {
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(uri, { dialogTitle: filename });
        } else {
          Alert.alert('PDF Created', `PDF saved to: ${uri}`);
        }
      }
    } catch (error) {
      console.error('Share error:', error);
      Alert.alert('Error', 'Failed to share quote. Please try again.');
    }
  };

  const handleExportQuote = async (quote: Quote) => {
    try {
      const html = await generateHTML(quote);
      const filename = `Quote_${quote.customerName.replace(/\s+/g, '_')}_${quote.job.name.replace(/\s+/g, '_')}_${format(quote.updatedAt, 'dd-MMM-yyyy')}.pdf`;
      const { uri } = await Print.printToFileAsync({ html });

      Alert.alert(
        'PDF Exported',
        `${filename} created successfully`,
        [
          {
            text: 'Share',
            onPress: async () => {
              const isAvailable = await Sharing.isAvailableAsync();
              if (isAvailable) {
                await Sharing.shareAsync(uri, { dialogTitle: filename });
              }
            },
          },
          { text: 'OK' },
        ]
      );
    } catch (error) {
      console.error('Export error:', error);
      Alert.alert('Error', 'Failed to export quote. Please try again.');
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Title style={styles.greeting}>
          G'day, {businessSettings?.businessName || 'Mate'}!
        </Title>
        <Paragraph>Ready to create some quotes?</Paragraph>
      </View>

      {/* New Quote Button */}
      <Button
        mode="contained"
        icon="plus-circle"
        onPress={handleNewQuote}
        style={styles.newQuoteButton}
        contentStyle={styles.newQuoteButtonContent}
      >
        New Quote
      </Button>

      {/* Quick Stats */}
      <View style={styles.statsContainer}>
        <Surface style={styles.statCard}>
          <MaterialCommunityIcons name="file-document" size={32} color={colors.primary} />
          <Text style={styles.statNumber}>{totalQuotes}</Text>
          <Text style={styles.statLabel}>Total Quotes</Text>
        </Surface>

        <Surface style={styles.statCard}>
          <MaterialCommunityIcons name="send" size={32} color={colors.secondary} />
          <Text style={styles.statNumber}>{sentQuotes}</Text>
          <Text style={styles.statLabel}>Sent</Text>
        </Surface>

        <Surface style={styles.statCard}>
          <MaterialCommunityIcons name="check-circle" size={32} color="#4CAF50" />
          <Text style={styles.statNumber}>{acceptedQuotes}</Text>
          <Text style={styles.statLabel}>Accepted</Text>
        </Surface>

        <Surface style={styles.statCard}>
          <MaterialCommunityIcons name="currency-usd" size={32} color="#FF9800" />
          <Text style={styles.statNumber}>{formatCurrency(totalRevenue)}</Text>
          <Text style={styles.statLabel}>Revenue</Text>
        </Surface>
      </View>

      {/* Recent Quotes */}
      {recentQuotes.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Quotes</Text>

          {recentQuotes.map((quote) => (
            <Card key={quote.id} style={styles.quoteCard}>
              <Card.Content>
                <View style={styles.quoteHeader}>
                  <View style={styles.quoteInfo}>
                    <Text style={styles.quoteName}>{quote.customerName}</Text>
                    <Text style={styles.quoteJob}>{quote.job.name}</Text>
                  </View>
                  <View style={styles.quoteRight}>
                    <View style={styles.quotePrice}>
                      <Text style={styles.quoteTotal}>{formatCurrency(quote.total)}</Text>
                      <Text style={[styles.quoteStatus, getStatusStyle(quote.status)]}>
                        {quote.status}
                      </Text>
                    </View>
                    <Menu
                      visible={menuVisible === quote.id}
                      onDismiss={() => setMenuVisible(null)}
                      anchor={
                        <IconButton
                          icon="dots-vertical"
                          size={20}
                          onPress={() => setMenuVisible(quote.id)}
                        />
                      }
                    >
                      <Menu.Item
                        leadingIcon="pencil"
                        onPress={() => {
                          setMenuVisible(null);
                          handleEditQuote(quote);
                        }}
                        title="Edit"
                      />
                      <Menu.Item
                        leadingIcon="email"
                        onPress={() => {
                          setMenuVisible(null);
                          handleSendQuote(quote);
                        }}
                        title="Send via Email"
                      />
                      <Menu.Item
                        leadingIcon="content-copy"
                        onPress={() => {
                          setMenuVisible(null);
                          handleDuplicateQuote(quote);
                        }}
                        title="Duplicate"
                      />
                      <Menu.Item
                        leadingIcon="share"
                        onPress={() => {
                          setMenuVisible(null);
                          handleShareQuote(quote);
                        }}
                        title="Share"
                      />
                      <Menu.Item
                        leadingIcon="file-pdf-box"
                        onPress={() => {
                          setMenuVisible(null);
                          handleExportQuote(quote);
                        }}
                        title="Export PDF"
                      />
                      <Menu.Item
                        leadingIcon="delete"
                        onPress={() => {
                          setMenuVisible(null);
                          handleDeleteQuote(quote.id);
                        }}
                        title="Delete"
                        titleStyle={{ color: colors.error }}
                      />
                    </Menu>
                  </View>
                </View>
                <Divider style={styles.divider} />
                <Text style={styles.quoteDate}>
                  {format(new Date(quote.updatedAt), 'dd MMM yyyy')}
                </Text>
              </Card.Content>
            </Card>
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
    </ScrollView>
  );
}

function getStatusStyle(status: string) {
  switch (status) {
    case 'accepted':
      return { color: '#4CAF50' };
    case 'sent':
      return { color: colors.secondary };
    case 'rejected':
      return { color: colors.error };
    default:
      return { color: colors.onSurface };
  }
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
  statCard: {
    width: '46%',
    margin: '2%',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    elevation: 2,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 8,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
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
  quoteCard: {
    marginBottom: 12,
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
    marginBottom: 4,
  },
  quoteStatus: {
    fontSize: 12,
    textTransform: 'capitalize',
  },
  divider: {
    marginVertical: 12,
  },
  quoteDate: {
    fontSize: 12,
    color: colors.onSurface,
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
