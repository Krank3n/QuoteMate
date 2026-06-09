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
import { Quote, BusinessSettings, Invoice, SalesPitch } from '../types';
import { resolveAndRenderPitch } from './salesPitch';
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
import { checkSquareConnection } from '../services/squareService';

/**
 * Resolve the customer-facing sales-pitch HTML for a doc:
 *   1. Prefer doc.pitchRenderedBody (snapshot at send time).
 *   2. Else look up doc.pitchId on businessSettings.salesPitches and
 *      render against doc.pitchVariableValues + variable defaults.
 *   3. HTML-escape + paragraph-wrap so the renderer can drop it into the
 *      PDF as-is. Newlines map to <br/>; blank lines split paragraphs.
 */
export function resolvePitchHtml(
  doc: { pitchId?: string; pitchVariableValues?: Record<string, string>; pitchRenderedBody?: string },
  businessSettings: BusinessSettings | null,
): string | undefined {
  let raw: string | undefined;
  if (doc.pitchRenderedBody && doc.pitchRenderedBody.trim().length > 0) {
    raw = doc.pitchRenderedBody;
  } else if (doc.pitchId && businessSettings?.salesPitches) {
    const pitch = businessSettings.salesPitches.find((p: SalesPitch) => p.id === doc.pitchId);
    if (pitch) {
      raw = resolveAndRenderPitch(pitch, doc.pitchVariableValues || {});
    }
  }
  if (!raw || raw.trim().length === 0) return undefined;
  return rawTextToHtml(raw);
}

function rawTextToHtml(s: string): string {
  const esc = s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  // Split on blank lines, paragraph-wrap, single newlines→<br/>.
  return esc
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

// Module-level cache for the base64-encoded logo HTML keyed by source URI.
// Logos rarely change but reading + base64-encoding the file on every PDF
// export blocks the main thread — caching for the app session is a clean win.
const logoHtmlCache = new Map<string, string>();

/**
 * Prepare the logo HTML tag from business settings (platform-specific)
 */
export async function prepareLogoHtml(businessSettings: BusinessSettings | null, isPro?: boolean): Promise<string> {
  const showLogo = isPro !== false;
  if (!showLogo || !businessSettings?.logoUri) return '';

  const uri = businessSettings.logoUri;
  const alt = businessSettings.businessName || '';

  // Web: the browser fetches remote images natively, embed URL as-is.
  if (Platform.OS === 'web') {
    return `<img src="${uri}" alt="${alt}" class="logo" />`;
  }

  const cacheKey = `${uri}::${alt}`;
  const cached = logoHtmlCache.get(cacheKey);
  if (cached) return cached;

  // Mobile (iOS + Android): embed the logo as a base64 data URI.
  //
  // Why we can't just embed a remote URL: Android's print/PDF bridge
  // tries to fetch <img src="https://…"> inside the native print
  // process. On real devices this stalls indefinitely — Preview PDF
  // hangs forever with no error. Local files are fast; remote logos
  // (Firebase Storage) must be downloaded + inlined here first.
  try {
    const isRemote = uri.startsWith('http://') || uri.startsWith('https://');
    let base64: string;
    if (isRemote) {
      const tmp = `${FileSystem.cacheDirectory}logo-${Date.now()}.img`;
      const downloaded = await FileSystem.downloadAsync(uri, tmp);
      base64 = await FileSystem.readAsStringAsync(downloaded.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } else {
      base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }
    // image/png decodes correctly for both PNG and JPEG payloads in
    // the renderers expo-print uses (WebKit on iOS, Android print's
    // WebView). No need to sniff the actual content type.
    const html = `<img src="data:image/png;base64,${base64}" alt="${alt}" class="logo" />`;
    logoHtmlCache.set(cacheKey, html);
    return html;
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

  // Gate watermark: a free-tier user whose trial has expired and who hasn't
  // connected Square can still locally preview / share a PDF, but it gets a
  // diagonal DRAFT overlay so they can't screenshot a clean copy to text to
  // their customer. Pro and in-trial users get a clean PDF. The Send path
  // never reaches here for gated users — quoteDeliveryGuard blocks first.
  //
  // Crucially: only watermark DRAFTS. If the doc has already been sent (any
  // stage past 'draft'), the customer already has a clean copy — a watermark
  // now would only scare the tradie into thinking the customer saw it. Sent
  // docs are records, not deliverables.
  let watermark: string | undefined;
  if (plan === 'free' && useStore.getState().isTrialExpired() && doc.stage === 'draft') {
    try {
      const sq = await checkSquareConnection();
      if (!sq.connected) watermark = 'UPGRADE TO SEND';
    } catch {
      watermark = 'UPGRADE TO SEND';
    }
  }
  const pdfOptions = watermark ? { watermark } : undefined;

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
        multiplier: s.multiplier,
        laborHoursTotal: s.laborHoursTotal,
        laborRate: s.laborRate,
        laborUnit: s.laborUnit,
        laborTotal: s.laborTotal,
      })),
      subtotal: doc.subtotal,
      markup: doc.markup,
      markupAmount: doc.markupAmount,
      laborMarkup: doc.laborMarkup ?? doc.markup,
      showMarkup: doc.showMarkup !== undefined
        ? doc.showMarkup === true
        : businessSettings?.showMarkup === true,
      showMaterialCosts: doc.showMaterialCosts !== undefined
        ? doc.showMaterialCosts
        : businessSettings?.showMaterialCostsByDefault !== false,
      showLaborCosts: doc.showLaborCosts !== undefined
        ? doc.showLaborCosts
        : businessSettings?.showLaborCostsByDefault !== false,
      presentationMode:
        doc.presentationMode || businessSettings?.defaultPresentationMode || 'itemised',
      flatRateInclusions: doc.flatRateInclusions,
      flatRateLineLabel: doc.flatRateLineLabel,
      pitchHtml: resolvePitchHtml(doc, businessSettings),
      travelAdjustment: doc.travelAdjustment,
      gst: doc.gst,
      total: doc.total,
      pricesIncludeGst: doc.pricesIncludeGst ?? businessSettings?.pricesIncludeGst === true,
      notes: doc.notes,
      showLaborHours: businessSettings?.showLaborHours,
      showLaborBreakdown: doc.showLaborBreakdown !== false,
      groupMaterialsBySection: businessSettings?.groupMaterialsBySection,
      paymentMethods: businessSettings?.paymentMethods,
      plan,
      squarePaymentLinkUrl,
      surchargePaymentFees: businessSettings?.surchargePaymentFees === true,
      terms: doc.termsSnapshot || businessSettings?.termsAndConditions,
    };
    return buildInvoicePdfHtml(pdfData, business, pdfOptions);
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
      multiplier: s.multiplier,
      laborHoursTotal: s.laborHoursTotal,
      laborRate: s.laborRate,
      laborUnit: s.laborUnit,
      laborTotal: s.laborTotal,
    })),
    subtotal: doc.subtotal,
    markup: doc.markup,
    markupAmount: doc.markupAmount,
    laborMarkup: doc.laborMarkup ?? doc.markup,
    showMarkup: doc.showMarkup !== undefined
      ? doc.showMarkup === true
      : businessSettings?.showMarkup === true,
    showMaterialCosts: doc.showMaterialCosts !== undefined
      ? doc.showMaterialCosts
      : businessSettings?.showMaterialCostsByDefault !== false,
    showLaborCosts: doc.showLaborCosts !== undefined
      ? doc.showLaborCosts
      : businessSettings?.showLaborCostsByDefault !== false,
    presentationMode:
      doc.presentationMode || businessSettings?.defaultPresentationMode || 'itemised',
    flatRateInclusions: doc.flatRateInclusions,
    flatRateLineLabel: doc.flatRateLineLabel,
    pitchHtml: resolvePitchHtml(doc, businessSettings),
    travelAdjustment: doc.travelAdjustment,
    gst: doc.gst,
    total: doc.total,
    pricesIncludeGst: doc.pricesIncludeGst ?? businessSettings?.pricesIncludeGst === true,
    notes: doc.notes,
    showLaborHours: businessSettings?.showLaborHours,
    showLaborBreakdown: doc.showLaborBreakdown !== false,
    groupMaterialsBySection: businessSettings?.groupMaterialsBySection,
    paymentMethods: businessSettings?.paymentMethods,
    plan,
    squarePaymentLinkUrl,
    surchargePaymentFees: businessSettings?.surchargePaymentFees === true,
    terms: doc.termsSnapshot || businessSettings?.termsAndConditions,
  };
  return buildQuotePdfHtml(pdfData, business, pdfOptions);
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
