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

  const generateHTML = async () => {
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
        <p><strong>Quote Date:</strong> ${format(new Date(), 'dd MMMM yyyy')}</p>
        <p><strong>Customer:</strong> ${currentQuote.customerName}</p>
        ${currentQuote.customerEmail ? `<p><strong>Email:</strong> ${currentQuote.customerEmail}</p>` : ''}
        ${currentQuote.customerPhone ? `<p><strong>Phone:</strong> ${currentQuote.customerPhone}</p>` : ''}
        ${currentQuote.jobAddress ? `<p><strong>Job Address:</strong> ${currentQuote.jobAddress}</p>` : ''}
      </div>

      <div class="info-section">
        <h3>Job Details</h3>
        <p><strong>${currentQuote.job.name}</strong></p>
        <p>${currentQuote.job.description}</p>
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
          ${currentQuote.materials
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
            <td>${formatCurrency(currentQuote.materialsSubtotal)}</td>
          </tr>
        </tbody>
      </table>

      <h3>Labor</h3>
      <table>
        <tbody>
          <tr>
            <td>Labor (${currentQuote.laborHours} hours @ ${formatCurrency(currentQuote.laborRate)}/hr)</td>
            <td>${formatCurrency(currentQuote.laborTotal)}</td>
          </tr>
        </tbody>
      </table>

      <div class="summary">
        <div class="summary-row">
          <span>Materials Subtotal</span>
          <span>${formatCurrency(currentQuote.materialsSubtotal)}</span>
        </div>
        <div class="summary-row">
          <span>Labor</span>
          <span>${formatCurrency(currentQuote.laborTotal)}</span>
        </div>
        <div class="summary-row">
          <span>Subtotal</span>
          <span>${formatCurrency(currentQuote.subtotal)}</span>
        </div>
        <div class="summary-row">
          <span>Markup (${currentQuote.markup}%)</span>
          <span>${formatCurrency(currentQuote.markupAmount)}</span>
        </div>
        <div class="summary-row">
          <span>GST (10%)</span>
          <span>${formatCurrency(currentQuote.gst)}</span>
        </div>
        <hr>
        <div class="summary-row grand-total">
          <span>TOTAL</span>
          <span>${formatCurrency(currentQuote.total)}</span>
        </div>
      </div>

      ${notes ? `<div class="info-section"><h3>Notes</h3><p>${notes}</p></div>` : ''}

      <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666;">
        <p>This quote is valid for 30 days from the date of issue.</p>
        <p>Generated with QuoteMate - quoting tool for Australian tradies</p>
      </div>
    </body>
    </html>
    `;
  };

  const handleExportPDF = async () => {
    try {
      setIsExporting(true);

      const html = await generateHTML();
      const filename = `Quote_${currentQuote.customerName.replace(/\s+/g, '_')}_${currentQuote.job.name.replace(/\s+/g, '_')}_${format(new Date(), 'dd-MMM-yyyy')}.pdf`;
      const { uri } = await Print.printToFileAsync({ html });

      if (Platform.OS === 'ios') {
        await Sharing.shareAsync(uri, { dialogTitle: filename });
      } else {
        // On Android, we can share or save
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(uri, { dialogTitle: filename });
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
    <ScrollView style={styles.container}>
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
  section: {
    margin: 16,
    padding: 16,
    borderRadius: 8,
    elevation: 2,
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
    backgroundColor: '#F5F5F5',
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
    paddingBottom: 40,
  },
  actionButton: {
    marginBottom: 12,
    paddingVertical: 8,
  },
});
