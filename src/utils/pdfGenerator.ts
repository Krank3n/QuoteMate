/**
 * PDF Generator Utility
 * Client-side PDF export using shared HTML templates and Expo Print.
 *
 * The unified entry points are `generateDocumentPDF` and `exportDocumentPDF`,
 * which branch on `Document.type`. The legacy `generateQuotePDF` /
 * `exportQuotePDF` / `generateInvoicePDF` / `exportInvoicePDF` exports are
 * thin adapters kept for callers that still hold a `Quote` or `Invoice`
 * (e.g. the in-progress NewQuote flow and the View screens).
 */

import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as MailComposer from 'expo-mail-composer';
import { format } from 'date-fns';
import { Quote, BusinessSettings, Invoice } from '../types';
import { Document } from '../types/document';
import { quoteToDocument, invoiceToDocument } from '../types/documentAdapter';
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
import { useStore } from '../store/useStore';

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

// ============================================================
// UNIFIED DOCUMENT PDF
// ============================================================

/**
 * Build the PDF HTML for a unified Document. Branches on `doc.type` to call
 * the matching shared HTML builder.
 */
export async function generateDocumentPDF(
  doc: Document,
  businessSettings: BusinessSettings | null,
  options?: { isPro?: boolean },
): Promise<string> {
  const logoHtml = await prepareLogoHtml(businessSettings, options?.isPro);
  const business = mapBusinessData(businessSettings, logoHtml);

  // Plan is read from the store at render time so the PDF reflects the
  // current tier (a free user's PDF must show only Square; Pro shows all
  // payment methods). The Square pay-link URL travels on the doc itself —
  // it's minted by the delivery guard before send and persisted there.
  const plan = useStore.getState().getEffectivePlan();
  const squarePaymentLinkUrl = doc.squarePaymentLinkUrl;

  if (doc.type === 'invoice') {
    const pdfData: InvoicePdfData = {
      customerName: doc.customerName,
      customerEmail: doc.customerEmail,
      customerPhone: doc.customerPhone,
      jobAddress: doc.jobAddress,
      quoteDate: format(new Date(doc.updatedAt), 'dd MMMM yyyy'),
      invoiceNumber: doc.number,
      issueDate: format(new Date(doc.issueDate ?? doc.createdAt), 'dd MMMM yyyy'),
      dueDate: format(new Date(doc.dueDate ?? doc.createdAt), 'dd MMMM yyyy'),
      paymentTerms: formatPaymentTerms(doc.paymentTerms ?? 'net_14', doc.customPaymentDays),
      paidAmount: doc.paidTotal,
      job: doc.job,
      materials: doc.materials.map(m => ({
        name: m.name,
        quantity: m.quantity,
        unit: m.unit,
        price: m.price,
        totalPrice: m.totalPrice,
        section: m.section,
      })),
      materialsSubtotal: doc.materialsSubtotal,
      laborHours: doc.laborHours,
      laborRate: doc.laborRate,
      laborUnit: doc.laborUnit,
      laborTotal: doc.laborTotal,
      laborExtraHours: doc.laborExtraHours,
      sections: doc.sections?.map(s => ({
        name: s.name,
        laborHours: s.laborHours,
        laborRate: s.laborRate,
        laborUnit: s.laborUnit,
        laborTotal: s.laborTotal,
      })),
      subtotal: doc.subtotal,
      markup: doc.markup,
      markupAmount: doc.markupAmount,
      laborMarkup: doc.laborMarkup ?? doc.markup,
      showMarkup: doc.showMarkup === true && businessSettings?.showMarkup !== false,
      travelAdjustment: doc.travelAdjustment,
      gst: doc.gst,
      total: doc.total,
      notes: doc.notes,
      showLaborHours: businessSettings?.showLaborHours,
      showLaborBreakdown: doc.showLaborBreakdown !== false,
      groupMaterialsBySection: businessSettings?.groupMaterialsBySection,
      paymentMethods: businessSettings?.paymentMethods,
      plan,
      squarePaymentLinkUrl,
      terms: doc.termsSnapshot || businessSettings?.termsAndConditions,
    };
    return buildInvoicePdfHtml(pdfData, business);
  }

  const pdfData: QuotePdfData = {
    customerName: doc.customerName,
    customerEmail: doc.customerEmail,
    customerPhone: doc.customerPhone,
    jobAddress: doc.jobAddress,
    quoteNumber: doc.number,
    quoteDate: format(new Date(doc.updatedAt), 'dd MMMM yyyy'),
    job: doc.job,
    materials: doc.materials.map(m => ({
      name: m.name,
      quantity: m.quantity,
      unit: m.unit,
      price: m.price,
      totalPrice: m.totalPrice,
      section: m.section,
    })),
    materialsSubtotal: doc.materialsSubtotal,
    laborHours: doc.laborHours,
    laborRate: doc.laborRate,
    laborUnit: doc.laborUnit,
    laborTotal: doc.laborTotal,
    laborExtraHours: doc.laborExtraHours,
    sections: doc.sections?.map(s => ({
      name: s.name,
      laborHours: s.laborHours,
      laborRate: s.laborRate,
      laborUnit: s.laborUnit,
      laborTotal: s.laborTotal,
    })),
    subtotal: doc.subtotal,
    markup: doc.markup,
    markupAmount: doc.markupAmount,
    laborMarkup: doc.laborMarkup ?? doc.markup,
    showMarkup: doc.showMarkup === true && businessSettings?.showMarkup !== false,
    travelAdjustment: doc.travelAdjustment,
    gst: doc.gst,
    total: doc.total,
    notes: doc.notes,
    showLaborHours: businessSettings?.showLaborHours,
    showLaborBreakdown: doc.showLaborBreakdown !== false,
    groupMaterialsBySection: businessSettings?.groupMaterialsBySection,
    paymentMethods: businessSettings?.paymentMethods,
    plan,
    squarePaymentLinkUrl,
    terms: doc.termsSnapshot || businessSettings?.termsAndConditions,
  };
  return buildQuotePdfHtml(pdfData, business);
}

/**
 * Export PDF with consistent filename and platform-specific handling.
 *
 * `action` semantics (carried over from the legacy `exportQuotePDF`):
 *   - 'share'  → mobile: directly open the share sheet; web: open print dialog
 *   - 'export' → mobile: show an alert offering Email / Share / OK; web: print
 *
 * The unified entry point is plumbing-only — the `Document.type` branch
 * decides the filename and email subject/body copy.
 */
export async function exportDocumentPDF(
  doc: Document,
  businessSettings: BusinessSettings | null,
  action: 'export' | 'share' = 'export',
  options?: { isPro?: boolean },
): Promise<void> {
  try {
    const html = await generateDocumentPDF(doc, businessSettings, options);

    const isInvoice = doc.type === 'invoice';
    const typeLabel: 'Quote' | 'Invoice' = isInvoice ? 'Invoice' : 'Quote';
    const filename = generatePdfFilename(
      typeLabel,
      doc.customerName,
      doc.job.name,
      new Date(doc.updatedAt),
    );
    const emailSubject = `${typeLabel} for ${doc.customerName} - ${doc.job.name}`;
    const dueDate = isInvoice && doc.dueDate ? new Date(doc.dueDate) : null;
    const emailBody = isInvoice
      ? `Please find attached your invoice for ${doc.job.name}.\n\nTotal: ${formatCurrency(doc.total)}${dueDate ? `\nDue: ${format(dueDate, 'dd MMMM yyyy')}` : ''}\n\nThank you for your business!`
      : `Please find attached your quote for ${doc.job.name}.\n\nTotal: ${formatCurrency(doc.total)}\n\nThank you for your interest!`;

    if (Platform.OS === 'web') {
      // On web, use browser's native print functionality
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
      return;
    }

    // Mobile platforms - use expo-print
    const { uri } = await Print.printToFileAsync({ html });

    // Copy to proper filename for sharing
    const newUri = `${FileSystem.cacheDirectory}${filename}`;
    await FileSystem.copyAsync({ from: uri, to: newUri });

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
      return;
    }

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
                  subject: emailSubject,
                  recipients: doc.customerEmail ? [doc.customerEmail] : [],
                  body: emailBody,
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
      ],
    );
  } catch (error) {
    Alert.alert('Error', 'Failed to export PDF. Please try again.');
  }
}

// ============================================================
// LEGACY WRAPPERS — kept for callers still holding Quote/Invoice values
// ============================================================

/**
 * Open the doc in the OS native PDF preview (iOS print sheet / Android
 * print preview / web browser print dialog). No "export" or "share"
 * step — this is pure look-at-it. Use when the tradie wants to see
 * what the customer will see before committing to send.
 */
export async function previewDocumentPDF(
  doc: Document,
  businessSettings: BusinessSettings | null,
  options?: { isPro?: boolean },
): Promise<void> {
  const html = await generateDocumentPDF(doc, businessSettings, options);
  if (Platform.OS === 'web') {
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
      win.focus();
      return;
    }
    Alert.alert('Error', 'Please allow popups to preview the PDF.');
    return;
  }
  // iOS: shows the AirPrint-style preview with zoom + share.
  // Android: same — opens the system print preview UI.
  await Print.printAsync({ html });
}

export async function generateQuotePDF(quote: Quote, businessSettings: BusinessSettings | null, options?: { isPro?: boolean }): Promise<string> {
  return generateDocumentPDF(quoteToDocument(quote), businessSettings, options);
}

export async function exportQuotePDF(
  quote: Quote,
  businessSettings: BusinessSettings | null,
  action: 'export' | 'share' = 'export',
  options?: { isPro?: boolean },
): Promise<void> {
  return exportDocumentPDF(quoteToDocument(quote), businessSettings, action, options);
}

export async function generateInvoicePDF(invoice: Invoice, businessSettings: BusinessSettings | null, options?: { isPro?: boolean }): Promise<string> {
  return generateDocumentPDF(invoiceToDocument(invoice), businessSettings, options);
}

export async function exportInvoicePDF(
  invoice: Invoice,
  businessSettings: BusinessSettings | null,
  action: 'export' | 'share' = 'export',
  options?: { isPro?: boolean },
): Promise<void> {
  return exportDocumentPDF(invoiceToDocument(invoice), businessSettings, action, options);
}
