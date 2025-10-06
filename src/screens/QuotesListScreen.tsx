/**
 * Quotes List Screen
 * Display all quotes with search and filter
 */

import React, { useState } from 'react';
import { View, StyleSheet, FlatList, Alert, Platform, Pressable } from 'react-native';
import {
  Text,
  Card,
  Searchbar,
  Chip,
  FAB,
  Menu,
  IconButton,
  Dialog,
  Portal,
  Button,
  RadioButton,
} from 'react-native-paper';
import { format } from 'date-fns';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import * as MailComposer from 'expo-mail-composer';

import { useStore } from '../store/useStore';
import { Quote } from '../types';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';

type FilterStatus = 'all' | 'draft' | 'sent' | 'accepted' | 'rejected';

export function QuotesListScreen() {
  const navigation = useNavigation<any>();
  const { quotes, deleteQuote, duplicateQuote, setCurrentQuote, createNewQuote, saveQuote, businessSettings } = useStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [menuVisible, setMenuVisible] = useState<string | null>(null);
  const [statusDialogVisible, setStatusDialogVisible] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<'draft' | 'sent' | 'accepted' | 'rejected'>('draft');

  // Filter and search quotes
  const filteredQuotes = quotes.filter((quote) => {
    // Status filter
    if (filterStatus !== 'all' && quote.status !== filterStatus) {
      return false;
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        quote.customerName.toLowerCase().includes(query) ||
        quote.job.name.toLowerCase().includes(query) ||
        quote.job.description.toLowerCase().includes(query)
      );
    }

    return true;
  });

  const handleNewQuote = () => {
    createNewQuote();
    navigation.navigate('NewQuote' as never);
  };

  const handleEditQuote = (quote: Quote) => {
    setCurrentQuote(quote);
    navigation.navigate('NewQuote' as never);
  };

  const handleDeleteQuote = async (quoteId: string) => {
    // Could add confirmation dialog
    await deleteQuote(quoteId);
  };

  const handleOpenStatusDialog = (quote: Quote) => {
    setSelectedQuote(quote);
    setSelectedStatus(quote.status);
    setStatusDialogVisible(true);
  };

  const handleUpdateStatus = async () => {
    if (!selectedQuote) return;

    try {
      const updatedQuote = {
        ...selectedQuote,
        status: selectedStatus,
        updatedAt: new Date(),
      };
      await saveQuote(updatedQuote);
      setStatusDialogVisible(false);
      setSelectedQuote(null);
    } catch (error) {
      Alert.alert('Error', 'Failed to update quote status. Please try again.');
    }
  };

  const handleDuplicateQuote = async (quote: Quote) => {
    try {
      await duplicateQuote(quote);
      Alert.alert('Success', 'Quote duplicated successfully!');
    } catch (error) {
      Alert.alert('Error', 'Failed to duplicate quote. Please try again.');
    }
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

  const renderQuoteCard = ({ item: quote }: { item: Quote }) => (
    <Card style={styles.card}>
      <Card.Content>
        <View style={styles.cardHeader}>
          <View style={styles.cardInfo}>
            <Text style={styles.customerName}>{quote.customerName}</Text>
            <Text style={styles.jobName}>{quote.job.name}</Text>
            <View style={styles.metaRow}>
              <MaterialCommunityIcons name="calendar" size={14} color={colors.onSurface} />
              <Text style={styles.date}>
                {format(new Date(quote.updatedAt), 'dd MMM yyyy')}
              </Text>
            </View>
          </View>

          <View style={styles.cardActions}>
            <Text style={styles.total}>{formatCurrency(quote.total)}</Text>
            <Chip
              style={[styles.statusChip, getStatusChipStyle(quote.status)]}
              textStyle={styles.statusText}
              onPress={() => handleOpenStatusDialog(quote)}
            >
              {quote.status}
            </Chip>

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
      </Card.Content>
    </Card>
  );

  return (
    <View style={styles.container}>
      {/* Search Bar */}
      <Searchbar
        placeholder="Search quotes..."
        onChangeText={setSearchQuery}
        value={searchQuery}
        style={styles.searchBar}
      />

      {/* Filter Chips */}
      <View style={styles.filterRow}>
        <Chip
          selected={filterStatus === 'all'}
          onPress={() => setFilterStatus('all')}
          style={styles.filterChip}
        >
          All
        </Chip>
        <Chip
          selected={filterStatus === 'draft'}
          onPress={() => setFilterStatus('draft')}
          style={styles.filterChip}
        >
          Draft
        </Chip>
        <Chip
          selected={filterStatus === 'sent'}
          onPress={() => setFilterStatus('sent')}
          style={styles.filterChip}
        >
          Sent
        </Chip>
        <Chip
          selected={filterStatus === 'accepted'}
          onPress={() => setFilterStatus('accepted')}
          style={styles.filterChip}
        >
          Accepted
        </Chip>
      </View>

      {/* Quotes List */}
      <FlatList
        data={filteredQuotes}
        renderItem={renderQuoteCard}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons
              name="file-document-outline"
              size={64}
              color={colors.disabled}
            />
            <Text style={styles.emptyText}>No quotes found</Text>
          </View>
        }
      />

      {/* New Quote FAB */}
      <FAB
        icon="plus"
        style={styles.fab}
        onPress={handleNewQuote}
        color="#fff"
      />

      {/* Status Change Dialog */}
      <Portal>
        <Dialog visible={statusDialogVisible} onDismiss={() => setStatusDialogVisible(false)}>
          <Dialog.Title>Change Quote Status</Dialog.Title>
          <Dialog.Content>
            <View style={styles.statusOptions}>
              <Pressable
                style={[
                  styles.statusOption,
                  selectedStatus === 'draft' && styles.statusOptionSelected,
                ]}
                onPress={() => setSelectedStatus('draft')}
              >
                <View style={styles.statusOptionContent}>
                  <View style={[styles.statusDot, { backgroundColor: '#9E9E9E' }]} />
                  <Text style={[
                    styles.statusOptionText,
                    selectedStatus === 'draft' && styles.statusOptionTextSelected,
                  ]}>
                    Draft
                  </Text>
                </View>
                {selectedStatus === 'draft' && (
                  <MaterialCommunityIcons name="check-circle" size={24} color={colors.primary} />
                )}
              </Pressable>

              <Pressable
                style={[
                  styles.statusOption,
                  selectedStatus === 'sent' && styles.statusOptionSelected,
                ]}
                onPress={() => setSelectedStatus('sent')}
              >
                <View style={styles.statusOptionContent}>
                  <View style={[styles.statusDot, { backgroundColor: '#FF9800' }]} />
                  <Text style={[
                    styles.statusOptionText,
                    selectedStatus === 'sent' && styles.statusOptionTextSelected,
                  ]}>
                    Sent
                  </Text>
                </View>
                {selectedStatus === 'sent' && (
                  <MaterialCommunityIcons name="check-circle" size={24} color={colors.primary} />
                )}
              </Pressable>

              <Pressable
                style={[
                  styles.statusOption,
                  selectedStatus === 'accepted' && styles.statusOptionSelected,
                ]}
                onPress={() => setSelectedStatus('accepted')}
              >
                <View style={styles.statusOptionContent}>
                  <View style={[styles.statusDot, { backgroundColor: '#4CAF50' }]} />
                  <Text style={[
                    styles.statusOptionText,
                    selectedStatus === 'accepted' && styles.statusOptionTextSelected,
                  ]}>
                    Accepted
                  </Text>
                </View>
                {selectedStatus === 'accepted' && (
                  <MaterialCommunityIcons name="check-circle" size={24} color={colors.primary} />
                )}
              </Pressable>

              <Pressable
                style={[
                  styles.statusOption,
                  selectedStatus === 'rejected' && styles.statusOptionSelected,
                ]}
                onPress={() => setSelectedStatus('rejected')}
              >
                <View style={styles.statusOptionContent}>
                  <View style={[styles.statusDot, { backgroundColor: '#F44336' }]} />
                  <Text style={[
                    styles.statusOptionText,
                    selectedStatus === 'rejected' && styles.statusOptionTextSelected,
                  ]}>
                    Rejected
                  </Text>
                </View>
                {selectedStatus === 'rejected' && (
                  <MaterialCommunityIcons name="check-circle" size={24} color={colors.primary} />
                )}
              </Pressable>
            </View>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setStatusDialogVisible(false)}>Cancel</Button>
            <Button onPress={handleUpdateStatus}>Update</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

function getStatusChipStyle(status: string) {
  switch (status) {
    case 'accepted':
      return { backgroundColor: '#E8F5E9' };
    case 'sent':
      return { backgroundColor: '#FFF3E0' };
    case 'rejected':
      return { backgroundColor: '#FFEBEE' };
    default:
      return { backgroundColor: '#F5F5F5' };
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  searchBar: {
    margin: 16,
    elevation: 2,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  filterChip: {
    marginRight: 8,
  },
  listContent: {
    padding: 16,
  },
  card: {
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardInfo: {
    flex: 1,
  },
  customerName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  jobName: {
    fontSize: 14,
    color: colors.onSurface,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  date: {
    fontSize: 12,
    color: colors.onSurface,
    marginLeft: 4,
  },
  cardActions: {
    alignItems: 'flex-end',
  },
  total: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primary,
    marginBottom: 8,
  },
  statusChip: {
    marginBottom: 8,
  },
  statusText: {
    fontSize: 12,
    textTransform: 'capitalize',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    color: colors.onSurface,
    marginTop: 16,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    backgroundColor: colors.primary,
  },
  statusOptions: {
    gap: 12,
  },
  statusOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#E0E0E0',
    backgroundColor: '#FAFAFA',
  },
  statusOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: '#E8F5E9',
  },
  statusOptionContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 12,
  },
  statusOptionText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
    textTransform: 'capitalize',
  },
  statusOptionTextSelected: {
    color: colors.primary,
    fontWeight: '600',
  },
});
