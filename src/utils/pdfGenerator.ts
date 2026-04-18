/**
 * PDF Generator Utility
 * Client-side PDF export using shared HTML templates and Expo Print
 */

import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as MailComposer from 'expo-mail-composer';
import { format } from 'date-fns';
import { Quote, BusinessSettings, Invoice } from '../types';
import { formatPaymentTerms, getAmountDue } from './invoiceCalculator';
import { formatCurrency } from './quoteCalculator';
import { Platform, Alert } from 'react-native';
import {
  buildQuotePdfHtml,
  buildInvoicePdfHtml,
  QuotePdfData,
  InvoicePdfData,
  BusinessPdfData,
} from '../../shared/pdf';

/**
 * Prepare the logo HTML tag from business settings (platform-specific)
 */
export async function prepareLogoHtml(businessSettings: BusinessSettings | null, isPro?: boolean): Promise<string> {
  const showLogo = isPro !== false;
  if (!showLogo || !businessSettings?.logoUri) return '';

  const uri = businessSettings.logoUri;
  const alt = businessSettings.businessName || '';

  // Remote URLs (Firebase Storage) can be used directly as src
  if (uri.startsWith('https://') || uri.startsWith('http://') || Platform.OS === 'web') {
    return `<img src="${uri}" alt="${alt}" class="logo" />`;
  }

  // Local file URIs need to be converted to base64 for the PDF renderer
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return `<img src="data:image/png;base64,${base64}" alt="${alt}" class="logo" />`;
  } catch (error) {
    return '';
  }
}

/**
 * Map app BusinessSettings to shared BusinessPdfData
 */
function mapBusinessData(businessSettings: BusinessSettings | null, logoHtml: string): BusinessPdfData {
  const business = businessSettings || {
    businessName: 'Your Business',
    email: '',
    phone: '',
    abn: '',
  };
  return {
    businessName: business.businessName,
    email: business.email,
    phone: business.phone,
    website: businessSettings?.website,
    abn: business.abn,
    address: businessSettings?.address,
    logoHtml,
    brandColor: businessSettings?.brandColor,
    pdfTemplate: businessSettings?.pdfTemplate,
  };
}

/**
 * Sanitize a string for use in a filename
 * Removes special characters, replaces spaces with underscores, limits length
 */
function sanitizeForFilename(str: string, maxLength: number = 30): string {
  return str
    .replace(/[^a-zA-Z0-9\s]/g, '') // Remove special characters
    .replace(/\s+/g, '_')            // Replace spaces with underscores
    .substring(0, maxLength);        // Limit length
}

/**
 * Generate a clean PDF filename
 * Format: Type_CustomerName_JobName_Date.pdf
 */
export function generatePdfFilename(
  type: 'Quote' | 'Invoice',
  customerName: string,
  jobName: string,
  date: Date
): string {
  const sanitizedCustomer = sanitizeForFilename(customerName);
  const sanitizedJob = sanitizeForFilename(jobName);
  const dateStr = format(date, 'dd-MMM-yyyy');
  return `${type}_${sanitizedCustomer}_${sanitizedJob}_${dateStr}.pdf`;
}

export async function generateQuotePDF(quote: Quote, businessSettings: BusinessSettings | null, options?: { isPro?: boolean }): Promise<string> {
  const logoHtml = await prepareLogoHtml(businessSettings, options?.isPro);

  const pdfData: QuotePdfData = {
    customerName: quote.customerName,
    customerEmail: quote.customerEmail,
    customerPhone: quote.customerPhone,
    jobAddress: quote.jobAddress,
    quoteNumber: quote.quoteNumber,
    quoteDate: format(new Date(quote.updatedAt), 'dd MMMM yyyy'),
    job: quote.job,
    materials: quote.materials.map(m => ({
      name: m.name,
      quantity: m.quantity,
      unit: m.unit,
      price: m.price,
      totalPrice: m.totalPrice,
      section: m.section,
    })),
    materialsSubtotal: quote.materialsSubtotal,
    laborHours: quote.laborHours,
    laborRate: quote.laborRate,
    laborUnit: quote.laborUnit,
    laborTotal: quote.laborTotal,
    laborExtraHours: quote.laborExtraHours,
    sections: quote.sections?.map(s => ({
      name: s.name,
      laborHours: s.laborHours,
      laborRate: s.laborRate,
      laborUnit: s.laborUnit,
      laborTotal: s.laborTotal,
    })),
    subtotal: quote.subtotal,
    markup: quote.markup,
    markupAmount: quote.markupAmount,
    laborMarkup: quote.laborMarkup ?? quote.markup,
    showMarkup: quote.showMarkup === true && businessSettings?.showMarkup !== false,
    travelAdjustment: quote.travelAdjustment,
    gst: quote.gst,
    total: quote.total,
    notes: quote.notes,
    showLaborHours: businessSettings?.showLaborHours,
    showLaborBreakdown: quote.showLaborBreakdown !== false,
    groupMaterialsBySection: businessSettings?.groupMaterialsBySection,
    paymentMethods: businessSettings?.paymentMethods,
    terms: quote.termsSnapshot || businessSettings?.termsAndConditions,
  };

  return buildQuotePdfHtml(pdfData, mapBusinessData(businessSettings, logoHtml));
}

/**
 * Export PDF with consistent filename and platform-specific handling
 * @param quote - The quote to export
 * @param businessSettings - Business settings for the PDF
 * @param action - 'export' (download/save) or 'share' (share sheet)
 */
export async function exportQuotePDF(
  quote: Quote,
  businessSettings: BusinessSettings | null,
  action: 'export' | 'share' = 'export',
  options?: { isPro?: boolean }
): Promise<void> {
  try {
    // Generate PDF HTML
    const html = await generateQuotePDF(quote, businessSettings, options);

    // Generate clean filename
    const filename = generatePdfFilename('Quote', quote.customerName, quote.job.name, new Date(quote.updatedAt));

    if (Platform.OS === 'web') {
      // On web, use browser's native print functionality
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();

        // Set the document title to the filename
        printWindow.document.title = filename;

        // Wait for content to load before triggering print
        printWindow.onload = () => {
          printWindow.focus();
          printWindow.print();
        };
      } else {
        Alert.alert('Error', 'Please allow popups to export PDF');
      }
    } else {
      // Mobile platforms - use expo-print
      const { uri } = await Print.printToFileAsync({ html });

      // Copy to proper filename for sharing
      const newUri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.copyAsync({
        from: uri,
        to: newUri,
      });

      if (action === 'share') {
        // Share the PDF
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(newUri, {
            UTI: Platform.OS === 'ios' ? 'com.adobe.pdf' : undefined,
            mimeType: 'application/pdf',
            dialogTitle: filename,
          });
        } else {
          Alert.alert('PDF Created', `${filename} saved successfully`);
        }
      } else {
        // Export - show options to share or email
        Alert.alert(
          'PDF Exported',
          `${filename} created successfully`,
          [
            {
              text: 'Email',
              onPress: async () => {
                try {
                  const isAvailable = await MailComposer.isAvailableAsync();
                  if (isAvailable) {
                    await MailComposer.composeAsync({
                      subject: `Quote for ${quote.customerName} - ${quote.job.name}`,
                      recipients: quote.customerEmail ? [quote.customerEmail] : [],
                      body: `Please find attached your quote for ${quote.job.name}.\n\nTotal: ${formatCurrency(quote.total)}\n\nThank you for your interest!`,
                      attachments: [newUri],
                    });
                  } else {
                    Alert.alert('Error', 'Email is not available on this device');
                  }
                } catch (error) {
                  Alert.alert('Error', 'Failed to compose email');
                }
              },
            },
            {
              text: 'Share',
              onPress: async () => {
                const isAvailable = await Sharing.isAvailableAsync();
                if (isAvailable) {
                  await Sharing.shareAsync(newUri, {
                    UTI: Platform.OS === 'ios' ? 'com.adobe.pdf' : undefined,
                    mimeType: 'application/pdf',
                    dialogTitle: filename,
                  });
                }
              },
            },
            { text: 'OK' },
          ]
        );
      }
    }
  } catch (error) {
    Alert.alert('Error', 'Failed to export PDF. Please try again.');
  }
}

/**
 * Generate Invoice PDF HTML
 */
export async function generateInvoicePDF(invoice: Invoice, businessSettings: BusinessSettings | null, options?: { isPro?: boolean }): Promise<string> {
  const logoHtml = await prepareLogoHtml(businessSettings, options?.isPro);
  const amountDue = getAmountDue(invoice);

  const pdfData: InvoicePdfData = {
    customerName: invoice.customerName,
    customerEmail: invoice.customerEmail,
    customerPhone: invoice.customerPhone,
    jobAddress: invoice.jobAddress,
    quoteDate: format(new Date(invoice.updatedAt), 'dd MMMM yyyy'),
    invoiceNumber: invoice.invoiceNumber,
    issueDate: format(new Date(invoice.issueDate), 'dd MMMM yyyy'),
    dueDate: format(new Date(invoice.dueDate), 'dd MMMM yyyy'),
    paymentTerms: formatPaymentTerms(invoice.paymentTerms, invoice.customPaymentDays),
    paidAmount: invoice.paidAmount,
    job: invoice.job,
    materials: invoice.materials.map(m => ({
      name: m.name,
      quantity: m.quantity,
      unit: m.unit,
      price: m.price,
      totalPrice: m.totalPrice,
      section: m.section,
    })),
    materialsSubtotal: invoice.materialsSubtotal,
    laborHours: invoice.laborHours,
    laborRate: invoice.laborRate,
    laborUnit: invoice.laborUnit,
    laborTotal: invoice.laborTotal,
    laborExtraHours: invoice.laborExtraHours,
    sections: invoice.sections?.map(s => ({
      name: s.name,
      laborHours: s.laborHours,
      laborRate: s.laborRate,
      laborUnit: s.laborUnit,
      laborTotal: s.laborTotal,
    })),
    subtotal: invoice.subtotal,
    markup: invoice.markup,
    markupAmount: invoice.markupAmount,
    laborMarkup: invoice.laborMarkup ?? invoice.markup,
    showMarkup: invoice.showMarkup === true && businessSettings?.showMarkup !== false,
    travelAdjustment: invoice.travelAdjustment,
    gst: invoice.gst,
    total: invoice.total,
    notes: invoice.notes,
    showLaborHours: businessSettings?.showLaborHours,
    showLaborBreakdown: invoice.showLaborBreakdown !== false,
    groupMaterialsBySection: businessSettings?.groupMaterialsBySection,
    paymentMethods: businessSettings?.paymentMethods,
    terms: invoice.termsSnapshot || businessSettings?.termsAndConditions,
  };

  return buildInvoicePdfHtml(pdfData, mapBusinessData(businessSettings, logoHtml));
}

/**
 * Export Invoice PDF with consistent filename and platform-specific handling
 * @param invoice - The invoice to export
 * @param businessSettings - Business settings for the PDF
 * @param action - 'export' (download/save) or 'share' (share sheet)
 */
export async function exportInvoicePDF(
  invoice: Invoice,
  businessSettings: BusinessSettings | null,
  action: 'export' | 'share' = 'export',
  options?: { isPro?: boolean }
): Promise<void> {
  try {
    const html = await generateInvoicePDF(invoice, businessSettings, options);

    // Generate clean filename
    const filename = generatePdfFilename('Invoice', invoice.customerName, invoice.job.name, new Date(invoice.updatedAt));

    if (Platform.OS === 'web') {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.document.title = filename;

        printWindow.onload = () => {
          printWindow.focus();
          printWindow.print();
        };
      } else {
        Alert.alert('Error', 'Please allow popups to export PDF');
      }
    } else {
      const { uri } = await Print.printToFileAsync({ html });

      const newUri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.copyAsync({
        from: uri,
        to: newUri,
      });

      if (action === 'share') {
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(newUri, {
            UTI: Platform.OS === 'ios' ? 'com.adobe.pdf' : undefined,
            mimeType: 'application/pdf',
            dialogTitle: filename,
          });
        } else {
          Alert.alert('PDF Created', `${filename} saved successfully`);
        }
      } else {
        Alert.alert(
          'PDF Exported',
          `${filename} created successfully`,
          [
            {
              text: 'Email',
              onPress: async () => {
                try {
                  const isAvailable = await MailComposer.isAvailableAsync();
                  if (isAvailable) {
                    await MailComposer.composeAsync({
                      subject: `Invoice for ${invoice.customerName} - ${invoice.job.name}`,
                      recipients: invoice.customerEmail ? [invoice.customerEmail] : [],
                      body: `Please find attached your invoice for ${invoice.job.name}.\n\nTotal: ${formatCurrency(invoice.total)}\nDue: ${format(new Date(invoice.dueDate), 'dd MMMM yyyy')}\n\nThank you for your business!`,
                      attachments: [newUri],
                    });
                  } else {
                    Alert.alert('Error', 'Email is not available on this device');
                  }
                } catch (error) {
                  Alert.alert('Error', 'Failed to compose email');
                }
              },
            },
            {
              text: 'Share',
              onPress: async () => {
                const isAvailable = await Sharing.isAvailableAsync();
                if (isAvailable) {
                  await Sharing.shareAsync(newUri, {
                    UTI: Platform.OS === 'ios' ? 'com.adobe.pdf' : undefined,
                    mimeType: 'application/pdf',
                    dialogTitle: filename,
                  });
                }
              },
            },
            { text: 'OK' },
          ]
        );
      }
    }
  } catch (error) {
    Alert.alert('Error', 'Failed to export PDF. Please try again.');
  }
}
