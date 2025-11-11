/**
 * Quote Preview Screen
 * Final review and export/share quote
 */

import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import {
  Text,
  Button,
  Surface,
  Title,
  Divider,
  TextInput,
  SegmentedButtons,
} from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useStore } from '../../store/useStore';
import { colors } from '../../theme';
import { formatCurrency } from '../../utils/quoteCalculator';
import { exportQuotePDF } from '../../utils/pdfGenerator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function QuotePreviewScreen() {
  const navigation = useNavigation<any>();
  const { currentQuote, saveQuote, businessSettings } = useStore();
  const insets = useSafeAreaInsets();

  const [notes, setNotes] = useState(currentQuote?.notes || '');
  const [status, setStatus] = useState(currentQuote?.status || 'draft');
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  if (!currentQuote) {
    return null;
  }

  const handleSave = async () => {
    try {
      setIsSaving(true);

      const updatedQuote = {
        ...currentQuote,
        notes,
        status,
        updatedAt: new Date(),
      };

      await saveQuote(updatedQuote);

      // Close the modal first, THEN navigate to dashboard
      // The parent is the NewQuoteStack, we need to go back from that to close the modal
      const root = navigation.getParent();

      if (Platform.OS === 'web') {
        // On web, just go back to close the modal
        root?.goBack();
      } else {
        // On mobile, show success alert then close modal
        Alert.alert('Success', 'Quote saved successfully!', [
          {
            text: 'OK',
            onPress: () => {
              // Go back closes the NewQuote modal stack
              root?.goBack();
            },
          },
        ]);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to save quote. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportPDF = async () => {
    try {
      setIsExporting(true);

      // Update quote with current notes before generating PDF
      const quoteWithNotes = { ...currentQuote, notes };

      // Use unified PDF export function
      await exportQuotePDF(quoteWithNotes, businessSettings, 'export');
    } catch (error) {
      console.error('Export error:', error);
      Alert.alert('Error', 'Failed to export PDF. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <View style={styles.outerContainer}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
      >
      {/* Quote Details Preview */}
      <Surface style={styles.section}>
        <Title style={styles.sectionTitle}>Customer</Title>
        <Text style={styles.text}>{currentQuote.customerName}</Text>
        {currentQuote.customerEmail && <Text style={styles.subtext}>{currentQuote.customerEmail}</Text>}
        {currentQuote.customerPhone && <Text style={styles.subtext}>{currentQuote.customerPhone}</Text>}
        {currentQuote.jobAddress && <Text style={styles.subtext}>{currentQuote.jobAddress}</Text>}
      </Surface>

      <Surface style={styles.section}>
        <Title style={styles.sectionTitle}>Job</Title>
        <Text style={styles.text}>{currentQuote.job.name}</Text>
        <Text style={styles.subtext}>{currentQuote.job.description}</Text>
      </Surface>

      <Surface style={styles.section}>
        <Title style={styles.sectionTitle}>Materials ({currentQuote.materials.length})</Title>
        {currentQuote.materials.length === 0 ? (
          <Text style={styles.subtext}>No materials required - Labor only</Text>
        ) : (
          currentQuote.materials.map((material) => (
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
          <Text style={styles.summaryValue}>{formatCurrency(currentQuote.materialsSubtotal)}</Text>
        </View>
      </Surface>

      <Surface style={styles.section}>
        <Title style={styles.sectionTitle}>Labor</Title>
        <View style={styles.summaryRow}>
          <Text style={styles.text}>
            {currentQuote.laborHours} hours @ {formatCurrency(currentQuote.laborRate)}/hr
          </Text>
          <Text style={styles.summaryValue}>{formatCurrency(currentQuote.laborTotal)}</Text>
        </View>
      </Surface>

      <Surface style={styles.totalSection}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Subtotal</Text>
          <Text style={styles.summaryValue}>{formatCurrency(currentQuote.subtotal)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Markup ({currentQuote.markup}%)</Text>
          <Text style={styles.summaryValue}>{formatCurrency(currentQuote.markupAmount)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>GST (10%)</Text>
          <Text style={styles.summaryValue}>{formatCurrency(currentQuote.gst)}</Text>
        </View>
        <Divider style={styles.divider} />
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>TOTAL</Text>
          <Text style={styles.totalValue}>{formatCurrency(currentQuote.total)}</Text>
        </View>
      </Surface>

      <Surface style={styles.section}>
        <Title style={styles.sectionTitle}>Status</Title>
        <SegmentedButtons
          value={status}
          onValueChange={setStatus}
          buttons={[
            { value: 'draft', label: 'Draft' },
            { value: 'sent', label: 'Sent' },
            { value: 'accepted', label: 'Accepted' },
            { value: 'rejected', label: 'Rejected' },
          ]}
        />
      </Surface>

      <Surface style={styles.section}>
        <Title style={styles.sectionTitle}>Notes (Optional)</Title>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          mode="outlined"
          multiline
          numberOfLines={4}
          placeholder="Add any additional notes for this quote..."
        />
      </Surface>
      </ScrollView>

      <View style={[styles.bottomActions, Platform.OS !== 'web' && { paddingBottom: insets.bottom + 20 }]}>
        <Button
          mode="outlined"
          onPress={handleExportPDF}
          style={styles.actionButton}
          loading={isExporting}
          disabled={isExporting}
          icon="file-pdf-box"
        >
          Export PDF
        </Button>

        <Button
          mode="contained"
          onPress={handleSave}
          style={styles.actionButton}
          loading={isSaving}
          disabled={isSaving}
        >
          Save Quote
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: colors.background,
    ...(Platform.OS === 'web' && {
      maxHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
    }),
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 16,
    ...(Platform.OS === 'web' && {
      maxWidth: 800,
      marginHorizontal: 'auto' as any,
      width: '100%',
    }),
  },
  section: {
    marginBottom: 16,
    padding: 16,
    borderRadius: 8,
    elevation: 2,
    backgroundColor: colors.surface,
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
  bottomActions: {
    padding: 16,
    paddingTop: 12,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.border,
    ...(Platform.OS === 'web' && {
      flexShrink: 0,
      boxShadow: '0 -2px 10px rgba(0,0,0,0.1)' as any,
      position: 'relative' as any,
      top: '-3.2rem' as any,
    }),
  },
  actionButton: {
    marginBottom: 8,
    paddingVertical: 6,
  },
});
