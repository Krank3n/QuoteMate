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
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { format } from 'date-fns';

import { useStore } from '../../store/useStore';
import { colors } from '../../theme';
import { formatCurrency } from '../../utils/quoteCalculator';
import { generateQuotePDF } from '../../utils/pdfGenerator';

export function QuotePreviewScreen() {
  const navigation = useNavigation<any>();
  const { currentQuote, saveQuote, businessSettings } = useStore();

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
      Alert.alert('Success', 'Quote saved successfully!', [
        {
          text: 'OK',
          onPress: () => {
            // Navigate back to main app (closes the modal)
            navigation.getParent()?.goBack();
          },
        },
      ]);
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
      const html = await generateQuotePDF(quoteWithNotes, businessSettings);

      // Format filename: Quote_CustomerName_JobName_09-Jan-2025.pdf
      const sanitizedCustomer = currentQuote.customerName
        .replace(/[^a-zA-Z0-9\s]/g, '') // Remove special characters
        .replace(/\s+/g, '_')             // Replace spaces with underscores
        .substring(0, 30);                // Limit length

      const sanitizedJob = currentQuote.job.name
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/\s+/g, '_')
        .substring(0, 30);

      const dateStr = format(new Date(), 'dd-MMM-yyyy');
      const filename = `Quote_${sanitizedCustomer}_${sanitizedJob}_${dateStr}.pdf`;

      const { uri } = await Print.printToFileAsync({ html });

      // Copy to proper filename for sharing
      const newUri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.copyAsync({
        from: uri,
        to: newUri,
      });

      if (Platform.OS === 'ios') {
        await Sharing.shareAsync(newUri, {
          UTI: 'com.adobe.pdf',
          mimeType: 'application/pdf',
        });
      } else {
        // On Android, copy to Downloads folder with proper name
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(newUri, {
            mimeType: 'application/pdf',
            dialogTitle: 'Share Quote',
          });
        } else {
          Alert.alert('PDF Created', `${filename} saved successfully`);
        }
      }
    } catch (error) {
      console.error('Export error:', error);
      Alert.alert('Error', 'Failed to export PDF. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
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
        {currentQuote.materials.map((material) => (
          <View key={material.id} style={styles.itemRow}>
            <View style={styles.itemInfo}>
              <Text style={styles.itemName}>{material.name}</Text>
              <Text style={styles.itemDetails}>
                {material.quantity} {material.unit} × {formatCurrency(material.price)}
              </Text>
            </View>
            <Text style={styles.itemTotal}>{formatCurrency(material.totalPrice)}</Text>
          </View>
        ))}
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

      <View style={styles.actions}>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingBottom: 220,
    flexGrow: 1,
  },
  section: {
    margin: 16,
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
    margin: 16,
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
  actions: {
    padding: 16,
    paddingBottom: 80,
  },
  actionButton: {
    marginBottom: 12,
    paddingVertical: 8,
  },
});
