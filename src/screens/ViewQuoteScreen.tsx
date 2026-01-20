/**
 * View Quote Screen
 * Full screen view for viewing and managing saved quotes
 */

import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Platform, TouchableOpacity } from 'react-native';
import {
  Text,
  Button,
  Surface,
  Title,
  Divider,
  IconButton,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useStore } from '../store/useStore';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { SendQuoteButton } from '../components/SendQuoteButton';
import { AlertModal } from '../components/AlertModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function ViewQuoteScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const quoteId = route.params?.quoteId;

  const { quotes, currentQuote, businessSettings, saveQuote, setCurrentQuote, createInvoiceFromQuote, saveInvoice } = useStore();
  const insets = useSafeAreaInsets();

  const [displayQuote, setDisplayQuote] = useState(null);
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [isConverting, setIsConverting] = useState(false);

  // Refresh quote data when screen comes into focus
  // Auto-save if there are pending changes in currentQuote
  useFocusEffect(
    React.useCallback(() => {
      const savedQuote = quotes.find(q => q.id === quoteId);

      // If currentQuote matches this quote ID, auto-save the changes
      if (currentQuote && currentQuote.id === quoteId) {
        const updatedQuote = {
          ...currentQuote,
          updatedAt: new Date(),
        };
        saveQuote(updatedQuote);
        setDisplayQuote(updatedQuote);
        // Clear currentQuote after saving
        setCurrentQuote(null);
      } else if (savedQuote) {
        setDisplayQuote(savedQuote);
      }
    }, [quotes, currentQuote, quoteId, saveQuote, setCurrentQuote])
  );

  if (!displayQuote) {
    return (
      <View style={styles.container}>
        <Text>Quote not found</Text>
      </View>
    );
  }

  const quote = displayQuote;

  const handleEditSection = (section: 'customer' | 'job' | 'materials' | 'labor') => {
    // Set the quote as current quote for editing
    setCurrentQuote(quote);

    // Navigate to the specific screen
    const screenMap = {
      customer: 'CustomerDetails',
      job: 'JobDetails',
      materials: 'MaterialsList',
      labor: 'LaborMarkup',
    };
    navigation.navigate('NewQuote', { screen: screenMap[section] });
  };

  const handleConvertToInvoice = () => {
    setShowConvertModal(true);
  };

  const handleConfirmConvert = async () => {
    setIsConverting(true);
    try {
      const invoice = createInvoiceFromQuote(quote);
      await saveInvoice(invoice);
      setShowConvertModal(false);
      navigation.navigate('ViewInvoice' as never, { invoiceId: invoice.id } as never);
    } catch (error) {
      console.error('Failed to convert to invoice:', error);
    } finally {
      setIsConverting(false);
    }
  };

  // Show convert button for accepted or sent quotes
  const canConvertToInvoice = quote.status === 'accepted' || quote.status === 'sent';

  return (
    <View style={styles.container}>
      {/* Convert to Invoice Modal */}
      <AlertModal
        visible={showConvertModal}
        onDismiss={() => setShowConvertModal(false)}
        type="info"
        icon="file-replace"
        title="Convert to Invoice"
        message={`Create an invoice from this quote for ${quote.customerName}?`}
        showConfetti={false}
        primaryButtonText="Convert"
        primaryButtonAction={handleConfirmConvert}
        secondaryButtonText="Cancel"
        secondaryButtonAction={() => setShowConvertModal(false)}
        secondaryButtonLoading={isConverting}
      />

      <View style={styles.header}>
        <IconButton
          icon="arrow-left"
          size={24}
          onPress={() => navigation.goBack()}
        />
        <View style={styles.headerTitleContainer}>
          <Title>Quote Preview</Title>
          {displayQuote?.quoteNumber && (
            <Text style={styles.headerQuoteNumber}>{displayQuote.quoteNumber}</Text>
          )}
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
      >
        <TouchableOpacity onPress={() => handleEditSection('customer')} activeOpacity={0.7}>
          <Surface style={styles.section}>
            <View style={styles.sectionHeader}>
              <Title style={styles.sectionTitle}>Customer</Title>
              <MaterialCommunityIcons name="pencil" size={20} color={colors.primary} />
            </View>
            <Text style={styles.text}>{quote.customerName}</Text>
            {quote.customerEmail && <Text style={styles.subtext}>{quote.customerEmail}</Text>}
            {quote.customerPhone && <Text style={styles.subtext}>{quote.customerPhone}</Text>}
            {quote.jobAddress && <Text style={styles.subtext}>{quote.jobAddress}</Text>}
          </Surface>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => handleEditSection('job')} activeOpacity={0.7}>
          <Surface style={styles.section}>
            <View style={styles.sectionHeader}>
              <Title style={styles.sectionTitle}>Job</Title>
              <MaterialCommunityIcons name="pencil" size={20} color={colors.primary} />
            </View>
            <Text style={styles.text}>{quote.job.name}</Text>
            <Text style={styles.subtext}>{quote.job.description}</Text>
          </Surface>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => handleEditSection('materials')} activeOpacity={0.7}>
          <Surface style={styles.section}>
            <View style={styles.sectionHeader}>
              <Title style={styles.sectionTitle}>Materials ({quote.materials.length})</Title>
              <MaterialCommunityIcons name="pencil" size={20} color={colors.primary} />
            </View>
          {quote.materials.length === 0 ? (
            <Text style={styles.subtext}>No materials required - Labor only</Text>
          ) : (
            quote.materials.map((material) => (
              <View key={material.id} style={styles.itemRow}>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemName}>{material.name}</Text>
                  <Text style={styles.itemDetails}>
                    {material.quantity} {material.unit} × {formatCurrency(material.price)}
                  </Text>
                </View>
                <Text style={styles.itemTotal}>{formatCurrency(material.totalPrice)}</Text>
              </View>
            ))
          )}
          <Divider style={styles.divider} />
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Materials Subtotal</Text>
            <Text style={styles.summaryValue}>{formatCurrency(quote.materialsSubtotal)}</Text>
          </View>
          </Surface>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => handleEditSection('labor')} activeOpacity={0.7}>
          <Surface style={styles.section}>
            <View style={styles.sectionHeader}>
              <Title style={styles.sectionTitle}>Labor</Title>
              <MaterialCommunityIcons name="pencil" size={20} color={colors.primary} />
            </View>
          <View style={styles.summaryRow}>
            <Text style={styles.text}>
              {businessSettings?.showLaborHours
                ? `${quote.laborHours} hours @ ${formatCurrency(quote.laborRate)}/hr`
                : 'Labor'}
            </Text>
            <Text style={styles.summaryValue}>{formatCurrency(quote.laborTotal)}</Text>
          </View>
          </Surface>
        </TouchableOpacity>

        <Surface style={styles.totalSection}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Subtotal</Text>
            <Text style={styles.summaryValue}>{formatCurrency(quote.subtotal)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Markup ({quote.markup}%)</Text>
            <Text style={styles.summaryValue}>{formatCurrency(quote.markupAmount)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>GST (10%)</Text>
            <Text style={styles.summaryValue}>{formatCurrency(quote.gst)}</Text>
          </View>
          <Divider style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>TOTAL</Text>
            <Text style={styles.totalValue}>{formatCurrency(quote.total)}</Text>
          </View>
        </Surface>

        {quote.notes && (
          <Surface style={styles.section}>
            <Title style={styles.sectionTitle}>Notes</Title>
            <Text style={styles.text}>{quote.notes}</Text>
          </Surface>
        )}
      </ScrollView>

      {/* Fixed bottom section with solid background */}
      {Platform.OS !== 'ios' && <View style={styles.solidBackground} />}

      <View
        style={[
          styles.actions,
          Platform.OS !== 'ios' && { marginBottom: Math.max(insets.bottom, 16) }
        ]}
      >
        {canConvertToInvoice ? (
          <>
            <Button
              mode="outlined"
              onPress={handleConvertToInvoice}
              style={styles.button}
              icon="file-replace"
            >
              Convert to Invoice
            </Button>
            <SendQuoteButton
              quote={quote}
              businessSettings={businessSettings}
              buttonStyle={styles.button}
            />
          </>
        ) : (
          <>
            <Button
              mode="outlined"
              onPress={() => navigation.goBack()}
              style={styles.button}
              labelStyle={styles.buttonLabel}
            >
              Close
            </Button>
            <SendQuoteButton
              quote={quote}
              businessSettings={businessSettings}
              buttonStyle={styles.button}
            />
          </>
        )}
      </View>
    </View>
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
    paddingHorizontal: 8,
    paddingTop: Platform.OS === 'ios' ? 60 : 20,
    paddingBottom: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitleContainer: {
    alignItems: 'center',
  },
  headerQuoteNumber: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  scrollContent: {
    paddingBottom: 140,
  },
  section: {
    marginBottom: 16,
    padding: 16,
    borderRadius: 8,
    elevation: 2,
    backgroundColor: colors.surface,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  text: {
    fontSize: 14,
    marginBottom: 4,
  },
  subtext: {
    fontSize: 13,
    color: colors.onSurface,
    marginBottom: 2,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 2,
  },
  itemDetails: {
    fontSize: 12,
    color: colors.onSurface,
  },
  itemTotal: {
    fontSize: 14,
    fontWeight: '600',
  },
  divider: {
    marginVertical: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 14,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  totalSection: {
    marginBottom: 16,
    padding: 16,
    borderRadius: 8,
    elevation: 3,
    backgroundColor: colors.surfaceGray,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  totalLabel: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  totalValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.primary,
  },
  solidBackground: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 60,
    backgroundColor: colors.surface,
    zIndex: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    position: 'absolute',
    bottom: 0,
    width: '100%',
    zIndex: 2,
    ...Platform.select({
      android: {
        elevation: 8,
      },
      web: {
        flexShrink: 0,
        position: 'sticky' as any,
        bottom: 0,
        boxShadow: '0 -2px 8px rgba(0,0,0,0.1)' as any,
      },
    }),
  },
  button: {
    flex: 1,
    margin: 0,
  },
  buttonLabel: {
    color: colors.white,
    marginVertical: 16,
    marginHorizontal: 10,
  },
  dialogText: {
    fontSize: 14,
    color: colors.onSurface,
    marginBottom: 16,
  },
  sendOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: colors.surfaceLight,
  },
  sendOptionText: {
    flex: 1,
    marginLeft: 16,
  },
  sendOptionTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
    marginBottom: 2,
  },
  sendOptionSubtitle: {
    fontSize: 13,
    color: colors.onSurface,
  },
});
