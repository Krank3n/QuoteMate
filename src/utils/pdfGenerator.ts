/**
 * PDF Generator Utility
 * Shared utility for generating consistent PDF quotes across the app
 */

import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as MailComposer from 'expo-mail-composer';
import { format } from 'date-fns';
import { Quote, BusinessSettings, Invoice, Material } from '../types';
import { formatPaymentTerms, getAmountDue } from './invoiceCalculator';
import { formatCurrency } from './quoteCalculator';
import { printMediaCSS, getTemplateCSS } from './pdfTemplates';
import { PdfTemplateId } from '../types';
import { Platform, Alert } from 'react-native';

/**
 * Generate materials table HTML, optionally grouped by work section
 */
function generateMaterialsHTML(materials: Material[], groupBySection: boolean, materialsSubtotal: number): string {
  if (materials.length === 0) {
    return `<p style="color: #666666; font-style: italic; margin: 10px 0;">No materials required - Labor only</p>`;
  }

  const tableHeader = `
    <thead>
      <tr>
        <th>Item</th>
        <th>Quantity</th>
        <th>Unit Price</th>
        <th>Total</th>
      </tr>
    </thead>`;

  const materialRow = (m: Material) => `
    <tr>
      <td>${m.name}</td>
      <td>${m.quantity} ${m.unit}</td>
      <td>${formatCurrency(m.price)}</td>
      <td>${formatCurrency(m.totalPrice)}</td>
    </tr>`;

  const hasSections = groupBySection && materials.some(m => m.section);

  if (!hasSections) {
    return `
      <table>
        ${tableHeader}
        <tbody>
          ${materials.map(materialRow).join('')}
          <tr class="total-row">
            <td colspan="3">Materials Subtotal</td>
            <td>${formatCurrency(materialsSubtotal)}</td>
          </tr>
        </tbody>
      </table>`;
  }

  // Group materials by section
  const grouped = new Map<string, Material[]>();
  materials.forEach(m => {
    const key = m.section || '';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(m);
  });

  // Sort: named sections first (alphabetically), then ungrouped
  const sortedKeys = Array.from(grouped.keys()).sort((a, b) => {
    if (a === '' && b !== '') return 1;
    if (a !== '' && b === '') return -1;
    return a.localeCompare(b);
  });

  let html = '';
  sortedKeys.forEach(key => {
    const sectionMaterials = grouped.get(key)!;
    const sectionTotal = sectionMaterials.reduce((sum, m) => sum + m.totalPrice, 0);
    const sectionName = key || 'Other';

    html += `
      <table>
        <thead>
          <tr>
            <th colspan="4" class="section-label">${sectionName}</th>
          </tr>
          <tr>
            <th>Item</th>
            <th>Quantity</th>
            <th>Unit Price</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${sectionMaterials.map(materialRow).join('')}
          <tr class="total-row">
            <td colspan="3">${sectionName} Subtotal</td>
            <td>${formatCurrency(sectionTotal)}</td>
          </tr>
        </tbody>
      </table>`;
  });

  html += `
    <table>
      <tbody>
        <tr class="total-row">
          <td colspan="3"><strong>All Materials Subtotal</strong></td>
          <td><strong>${formatCurrency(materialsSubtotal)}</strong></td>
        </tr>
      </tbody>
    </table>`;

  return html;
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

/**
 * Generate HTML for payment methods section
 */
function generatePaymentMethodsHTML(businessSettings: BusinessSettings | null): string {
  const pm = businessSettings?.paymentMethods;
  if (!pm?.showOnDocuments) return '';

  const sections: string[] = [];

  // Bank Transfer - check enabled and has at least one field with data
  const bankHasData = pm.bankAccount?.accountName || pm.bankAccount?.bsb || pm.bankAccount?.accountNumber;
  if (pm.bankAccount?.enabled && bankHasData) {
    sections.push(`
      <div class="payment-method">
        <strong>Bank Transfer</strong><br>
        ${pm.bankAccount.accountName ? `Account Name: ${pm.bankAccount.accountName}<br>` : ''}
        ${pm.bankAccount.bsb ? `BSB: ${pm.bankAccount.bsb}<br>` : ''}
        ${pm.bankAccount.accountNumber ? `Account: ${pm.bankAccount.accountNumber}` : ''}
      </div>
    `);
  }

  // PayID - check enabled and has value
  if (pm.payId?.enabled && pm.payId?.payIdValue) {
    const payIdLabel = pm.payId.payIdType === 'phone' ? 'Phone' :
                       pm.payId.payIdType === 'email' ? 'Email' : 'ABN';
    sections.push(`
      <div class="payment-method">
        <strong>PayID</strong><br>
        ${payIdLabel}: ${pm.payId.payIdValue}
      </div>
    `);
  }

  // BPAY - check enabled and has at least one field with data
  const bpayHasData = pm.bpay?.billerCode || pm.bpay?.referenceNumber;
  if (pm.bpay?.enabled && bpayHasData) {
    sections.push(`
      <div class="payment-method">
        <strong>BPAY</strong><br>
        ${pm.bpay.billerCode ? `Biller Code: ${pm.bpay.billerCode}<br>` : ''}
        ${pm.bpay.referenceNumber ? `Reference: ${pm.bpay.referenceNumber}` : ''}
      </div>
    `);
  }

  // PayPal - check enabled and has email
  if (pm.paypal?.enabled && pm.paypal?.email) {
    sections.push(`
      <div class="payment-method">
        <strong>PayPal</strong><br>
        ${pm.paypal.email}
      </div>
    `);
  }

  // Other Instructions - check enabled and has instructions
  if (pm.other?.enabled && pm.other?.instructions) {
    sections.push(`
      <div class="payment-method">
        <strong>Other Payment Options</strong><br>
        ${pm.other.instructions.replace(/\n/g, '<br>')}
      </div>
    `);
  }

  if (sections.length === 0) return '';

  return `
    <div class="payment-methods-section">
      <h3>Payment Methods</h3>
      <div class="payment-methods-grid">
        ${sections.join('')}
      </div>
    </div>
  `;
}

export async function generateQuotePDF(quote: Quote, businessSettings: BusinessSettings | null, options?: { isPro?: boolean }): Promise<string> {
  const business = businessSettings || {
    businessName: 'Your Business',
    email: '',
    phone: '',
    abn: '',
  };

  const templateId: PdfTemplateId = businessSettings?.pdfTemplate || 'professional';

  // Convert logo to base64 if it exists
  let logoBase64 = '';
  const showLogo = options?.isPro !== false; // Show logo unless explicitly not Pro
  if (showLogo && businessSettings?.logoUri && Platform.OS !== 'web') {
    try {
      const base64 = await FileSystem.readAsStringAsync(businessSettings.logoUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      logoBase64 = `data:image/png;base64,${base64}`;
    } catch (error) {
      console.error('Failed to load logo:', error);
    }
  } else if (showLogo && businessSettings?.logoUri && Platform.OS === 'web') {
    // On web, the logoUri is already a URL that can be used directly
    logoBase64 = businessSettings.logoUri;
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
      <style>
        ${printMediaCSS}
        ${getTemplateCSS(templateId, businessSettings?.brandColor)}
      </style>
    </head>
    <body>
      <div class="header">
        <div class="header-content">
          ${logoBase64 ? `<img src="${logoBase64}" alt="${business.businessName}" class="logo" />` : ''}
          <div class="header-text">
            <h1>${business.businessName}</h1>
            <p>
              ${business.abn ? `ABN: ${business.abn}<br>` : ''}
              ${business.email ? `Email: ${business.email}<br>` : ''}
              ${business.phone ? `Phone: ${business.phone}` : ''}
            </p>
          </div>
        </div>
      </div>

      <div class="info-section">
        <h2>QUOTATION</h2>
        ${quote.quoteNumber ? `<p><strong>Quote #:</strong> ${quote.quoteNumber}</p>` : ''}
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

      <div class="section-wrapper">
        <h3>Materials</h3>
        ${generateMaterialsHTML(quote.materials, businessSettings?.groupMaterialsBySection === true, quote.materialsSubtotal)}
      </div>

      <div class="section-wrapper">
        <h3>Labor</h3>
        <table>
          <tbody>
            <tr>
              <td>${businessSettings?.showLaborHours ? `Labor (${quote.laborHours} hours @ ${formatCurrency(quote.laborRate)}/hr)` : 'Labor'}</td>
              <td style="text-align: right;">${formatCurrency(quote.laborTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>

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
        ${quote.travelAdjustment && quote.travelAdjustment > 0 ? `
        <div class="summary-row">
          <span>Travel Adjustment (${quote.travelAdjustment}%)</span>
          <span>${formatCurrency(quote.subtotal * (quote.travelAdjustment / 100))}</span>
        </div>
        ` : ''}
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

      ${generatePaymentMethodsHTML(businessSettings)}

      <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #666666;">
        <p>This quote is valid for 30 days from the date of issue.</p>
        <p>Powered by QuoteMate | quotemateapp.au</p>
      </div>
    </body>
    </html>
    `;
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
                  console.error('Email error:', error);
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
    console.error('PDF export error:', error);
    Alert.alert('Error', 'Failed to export PDF. Please try again.');
  }
}

/**
 * Generate Invoice PDF HTML
 */
export async function generateInvoicePDF(invoice: Invoice, businessSettings: BusinessSettings | null, options?: { isPro?: boolean }): Promise<string> {
  const business = businessSettings || {
    businessName: 'Your Business',
    email: '',
    phone: '',
    abn: '',
  };

  const templateId: PdfTemplateId = businessSettings?.pdfTemplate || 'professional';

  // Convert logo to base64 if it exists
  let logoBase64 = '';
  const showLogo = options?.isPro !== false; // Show logo unless explicitly not Pro
  if (showLogo && businessSettings?.logoUri && Platform.OS !== 'web') {
    try {
      const base64 = await FileSystem.readAsStringAsync(businessSettings.logoUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      logoBase64 = `data:image/png;base64,${base64}`;
    } catch (error) {
      console.error('Failed to load logo:', error);
    }
  } else if (showLogo && businessSettings?.logoUri && Platform.OS === 'web') {
    logoBase64 = businessSettings.logoUri;
  }

  const amountDue = getAmountDue(invoice);
  const paidAmount = invoice.paidAmount || 0;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
      <style>
        ${printMediaCSS}
        ${getTemplateCSS(templateId, businessSettings?.brandColor)}
      </style>
    </head>
    <body>
      <div class="header">
        <div class="header-content">
          ${logoBase64 ? `<img src="${logoBase64}" alt="${business.businessName}" class="logo" />` : ''}
          <div class="header-text">
            <h1>${business.businessName}</h1>
            <p>
              ${business.abn ? `ABN: ${business.abn}<br>` : ''}
              ${business.email ? `Email: ${business.email}<br>` : ''}
              ${business.phone ? `Phone: ${business.phone}` : ''}
            </p>
          </div>
        </div>
      </div>

      <div class="info-section">
        <h2>INVOICE</h2>
        <div class="invoice-details">
          <div class="invoice-details-left">
            ${invoice.invoiceNumber ? `<p><strong>Invoice #:</strong> ${invoice.invoiceNumber}</p>` : ''}
            <p><strong>Issue Date:</strong> ${format(new Date(invoice.issueDate), 'dd MMMM yyyy')}</p>
            <p><strong>Due Date:</strong> ${format(new Date(invoice.dueDate), 'dd MMMM yyyy')}</p>
            <p><strong>Payment Terms:</strong> ${formatPaymentTerms(invoice.paymentTerms, invoice.customPaymentDays)}</p>
          </div>
        </div>
        <p><strong>Customer:</strong> ${invoice.customerName}</p>
        ${invoice.customerEmail ? `<p><strong>Email:</strong> ${invoice.customerEmail}</p>` : ''}
        ${invoice.customerPhone ? `<p><strong>Phone:</strong> ${invoice.customerPhone}</p>` : ''}
        ${invoice.jobAddress ? `<p><strong>Job Address:</strong> ${invoice.jobAddress}</p>` : ''}
      </div>

      <div class="info-section">
        <h3>Job Details</h3>
        <p><strong>${invoice.job.name}</strong></p>
        <p>${invoice.job.description}</p>
      </div>

      <div class="section-wrapper">
        <h3>Materials</h3>
        ${generateMaterialsHTML(invoice.materials, businessSettings?.groupMaterialsBySection === true, invoice.materialsSubtotal)}
      </div>

      <div class="section-wrapper">
        <h3>Labor</h3>
        <table>
          <tbody>
            <tr>
              <td>${businessSettings?.showLaborHours ? `Labor (${invoice.laborHours} hours @ ${formatCurrency(invoice.laborRate)}/hr)` : 'Labor'}</td>
              <td style="text-align: right;">${formatCurrency(invoice.laborTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="summary">
        <div class="summary-row">
          <span>Materials Subtotal</span>
          <span>${formatCurrency(invoice.materialsSubtotal)}</span>
        </div>
        <div class="summary-row">
          <span>Labor</span>
          <span>${formatCurrency(invoice.laborTotal)}</span>
        </div>
        <div class="summary-row">
          <span>Subtotal</span>
          <span>${formatCurrency(invoice.subtotal)}</span>
        </div>
        <div class="summary-row">
          <span>Markup (${invoice.markup}%)</span>
          <span>${formatCurrency(invoice.markupAmount)}</span>
        </div>
        ${invoice.travelAdjustment && invoice.travelAdjustment > 0 ? `
        <div class="summary-row">
          <span>Travel Adjustment (${invoice.travelAdjustment}%)</span>
          <span>${formatCurrency(invoice.subtotal * (invoice.travelAdjustment / 100))}</span>
        </div>
        ` : ''}
        <div class="summary-row">
          <span>GST (10%)</span>
          <span>${formatCurrency(invoice.gst)}</span>
        </div>
        <hr>
        <div class="summary-row grand-total">
          <span>TOTAL</span>
          <span>${formatCurrency(invoice.total)}</span>
        </div>
        ${paidAmount > 0 ? `
        <div class="summary-row" style="color: #28a745;">
          <span>Amount Paid</span>
          <span>-${formatCurrency(paidAmount)}</span>
        </div>
        <div class="summary-row balance-due">
          <span>BALANCE DUE</span>
          <span>${formatCurrency(amountDue)}</span>
        </div>
        ` : ''}
      </div>

      ${invoice.notes ? `<div class="info-section"><h3>Notes</h3><p>${invoice.notes}</p></div>` : ''}

      <div class="payment-box">
        <h3>Payment Information</h3>
        <p><strong>Amount Due:</strong> ${formatCurrency(amountDue)}</p>
        <p><strong>Due Date:</strong> ${format(new Date(invoice.dueDate), 'dd MMMM yyyy')}</p>
        <p>Please reference invoice number ${invoice.invoiceNumber || 'N/A'} with your payment.</p>
      </div>

      ${generatePaymentMethodsHTML(businessSettings)}

      <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #666666;">
        <p>Payment is due by ${format(new Date(invoice.dueDate), 'dd MMMM yyyy')}.</p>
        <p>Thank you for your business!</p>
        <p>Powered by QuoteMate | quotemateapp.au</p>
      </div>
    </body>
    </html>
    `;
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
                  console.error('Email error:', error);
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
    console.error('PDF export error:', error);
    Alert.alert('Error', 'Failed to export PDF. Please try again.');
  }
}
