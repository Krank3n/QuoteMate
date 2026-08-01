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
import { Quote, BusinessSettings, Invoice, BusinessCredential } from '../types';
import { Document } from '../types/document';
import { quoteToDocument, invoiceToDocument } from '../types/documentAdapter';
import { formatPaymentTerms, getAmountDue } from './invoiceCalculator';
import { formatCurrency } from './quoteCalculator';
import { Platform, Alert } from 'react-native';
import {
  buildQuotePdfHtml,
  buildInvoicePdfHtml,
  buildReportPdfHtml,
  QuotePdfData,
  InvoicePdfData,
  ReportPdfData,
  BusinessPdfData,
} from '../../shared/pdf';
import { ServiceReport } from '../../shared/report/types';
import { useStore } from '../store/useStore';
import { checkSquareConnection } from '../services/squareService';

// Module-level cache for the base64-encoded logo HTML keyed by source URI.
// Logos rarely change but reading + base64-encoding the file on every PDF
// export blocks the main thread — caching for the app session is a clean win.
const logoHtmlCache = new Map<string, string>();

const escapeHtmlAttribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function preparePdfImageHtml(
  uri: string,
  alt: string,
  className: string,
  inlineStyle = '',
): Promise<string> {
  const safeUri = escapeHtmlAttribute(uri);
  const safeAlt = escapeHtmlAttribute(alt);
  const styleAttr = inlineStyle ? ` style="${inlineStyle}"` : '';

  // Web: the browser fetches remote images natively, embed URL as-is.
  if (Platform.OS === 'web') {
    return `<img src="${safeUri}" alt="${safeAlt}" class="${className}"${styleAttr} />`;
  }

  const cacheKey = `${className}::${uri}::${alt}`;
  const cached = logoHtmlCache.get(cacheKey);
  if (cached) return cached;

  // Mobile print bridges are unreliable with remote images, so download and
  // inline both the company logo and accreditation badges before rendering.
  try {
    const isRemote = uri.startsWith('http://') || uri.startsWith('https://');
    let base64: string;
    if (isRemote) {
      const tmp = `${FileSystem.cacheDirectory}pdf-brand-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.img`;
      const downloaded = await FileSystem.downloadAsync(uri, tmp);
      base64 = await FileSystem.readAsStringAsync(downloaded.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } else {
      base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }
    const html = `<img src="data:image/png;base64,${base64}" alt="${safeAlt}" class="${className}"${styleAttr} />`;
    logoHtmlCache.set(cacheKey, html);
    return html;
  } catch {
    return '';
  }
}

/** Prepare the company logo HTML tag from business settings. */
export async function prepareLogoHtml(businessSettings: BusinessSettings | null, isPro?: boolean): Promise<string> {
  if (isPro === false || !businessSettings?.logoUri) return '';
  return preparePdfImageHtml(
    businessSettings.logoUri,
    businessSettings.businessName || '',
    'logo',
  );
}

async function prepareCredentialLogoHtml(credential: BusinessCredential): Promise<string> {
  if (!credential.logoUri) return '';
  return preparePdfImageHtml(
    credential.logoUri,
    credential.label || 'Accreditation',
    'credential-logo',
    'width:64px;height:38px;object-fit:contain;',
  );
}

/**
 * Map app BusinessSettings to shared BusinessPdfData
 */
function mapBusinessData(
  businessSettings: BusinessSettings | null,
  logoHtml: string,
  credentialLogos: Map<string, string> = new Map(),
  includeCredentials = true,
): BusinessPdfData {
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
    credentials: includeCredentials
      ? businessSettings?.credentials
          ?.filter((credential) => credential.label?.trim() || credential.number?.trim() || credential.logoUri)
          .map((credential) => ({
            label: credential.label || '',
            number: credential.number,
            logoHtml: credentialLogos.get(credential.id) || '',
          }))
      : undefined,
    brandColor: businessSettings?.brandColor,
    pdfTemplate: businessSettings?.pdfTemplate,
  };
}

async function prepareBusinessPdfData(
  businessSettings: BusinessSettings | null,
  isPro?: boolean,
): Promise<BusinessPdfData> {
  const includeCredentials = isPro !== false;
  const credentials = includeCredentials ? businessSettings?.credentials || [] : [];
  const [logoHtml, preparedCredentialLogos] = await Promise.all([
    prepareLogoHtml(businessSettings, isPro),
    Promise.all(
      credentials.map(async (credential) => [
        credential.id,
        await prepareCredentialLogoHtml(credential),
      ] as const),
    ),
  ]);
  return mapBusinessData(
    businessSettings,
    logoHtml,
    new Map(preparedCredentialLogos),
    includeCredentials,
  );
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
  const business = await prepareBusinessPdfData(businessSettings, options?.isPro);

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
      travelAdjustment: doc.travelAdjustment,
      gst: doc.gst,
      total: doc.total,
      pricesIncludeGst: doc.pricesIncludeGst ?? businessSettings?.pricesIncludeGst === true,
      gstRegistered: doc.gstRegistered,
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
    travelAdjustment: doc.travelAdjustment,
    gst: doc.gst,
    total: doc.total,
    pricesIncludeGst: doc.pricesIncludeGst ?? businessSettings?.pricesIncludeGst === true,
    gstRegistered: doc.gstRegistered,
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
// SERVICE REPORT PDF
// ============================================================

/**
 * Context the report itself doesn't carry. A ServiceReport links to a Job by
 * id and holds no customer fields, so the caller passes the resolved customer
 * / address details (read off the linked Job) through options.
 */
export interface ReportPdfOptions {
  isPro?: boolean;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  jobAddress?: string;
}

/**
 * Build the ReportPdfData payload from a ServiceReport plus the customer
 * context supplied by the caller, resolve the business chrome the same way
 * quotes/invoices do, and render via the shared report HTML builder.
 */
// Session cache for base64-inlined report photos, keyed by source URI —
// same rationale as logoHtmlCache above: re-encoding on every export blocks
// the main thread for no reason.
const photoDataUriCache = new Map<string, string>();

/**
 * Resolve a report photo to something the PDF renderer can safely embed.
 *
 * Web: the browser fetches remote images natively — pass the URL through.
 * Mobile: remote <img src="https://…"> stalls Android's print bridge
 * indefinitely (same failure documented on prepareLogoHtml above) and races
 * expo-print's snapshot on iOS, silently dropping photos on slow signal. So
 * photos are downloaded and inlined as base64 data URIs, exactly like the
 * logo. A photo that can't be fetched (offline) is skipped rather than
 * hanging the export.
 */
async function prepareReportPhoto(uri: string): Promise<{ dataUri?: string; url?: string } | null> {
  if (Platform.OS === 'web') return { url: uri };

  const cached = photoDataUriCache.get(uri);
  if (cached) return { dataUri: cached };

  try {
    const isRemote = uri.startsWith('http://') || uri.startsWith('https://');
    let base64: string;
    if (isRemote) {
      const tmp = `${FileSystem.cacheDirectory}report-photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.img`;
      const downloaded = await FileSystem.downloadAsync(uri, tmp);
      base64 = await FileSystem.readAsStringAsync(downloaded.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } else {
      base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }
    // image/jpeg decodes fine for both JPEG and PNG payloads in the print
    // renderers (WebKit / Android print WebView) — same as the logo path.
    const dataUri = `data:image/jpeg;base64,${base64}`;
    photoDataUriCache.set(uri, dataUri);
    return { dataUri };
  } catch {
    return null;
  }
}

export async function generateReportPDF(
  report: ServiceReport,
  businessSettings: BusinessSettings | null,
  options?: ReportPdfOptions,
): Promise<string> {
  const business = await prepareBusinessPdfData(businessSettings, options?.isPro);

  // Inline photos before building the HTML — remote URLs hang the Android
  // print bridge and race the iOS snapshot (see prepareReportPhoto).
  const preparedPhotos = report.photos?.length
    ? (await Promise.all(report.photos.map((p) => prepareReportPhoto(p.storageUrl)))).filter(
        (p): p is { dataUri?: string; url?: string } => p !== null,
      )
    : undefined;

  const pdfData: ReportPdfData = {
    reportNumber: report.number,
    customerName: options?.customerName || '',
    customerEmail: options?.customerEmail,
    customerPhone: options?.customerPhone,
    jobAddress: options?.jobAddress,
    visitDate: format(new Date(report.visitDate), 'dd MMMM yyyy'),
    serviceType: report.serviceType,
    riskAssessment: report.riskAssessment,
    equipment: report.equipment,
    itemsChecked: report.itemsChecked.map(it => ({ text: it.text, checked: it.checked })),
    natureOfProblem: report.natureOfProblem,
    workCarriedOut: report.workCarriedOut,
    recommendedWork: report.recommendedWork,
    photos: preparedPhotos,
    customerSignature: report.customerSignature
      ? {
          svgPath: report.customerSignature.svgPath,
          name: report.customerSignature.name,
          width: report.customerSignature.width,
          height: report.customerSignature.height,
        }
      : undefined,
    technicianSignature: report.technicianSignature
      ? {
          svgPath: report.technicianSignature.svgPath,
          name: report.technicianSignature.name,
          width: report.technicianSignature.width,
          height: report.technicianSignature.height,
        }
      : undefined,
  };

  return buildReportPdfHtml(pdfData, business);
}

/**
 * Export a service report PDF. Mirrors `exportDocumentPDF`'s platform
 * handling (web print window / mobile expo-print + share-or-email sheet)
 * with report-appropriate filename and copy.
 */
export async function exportReportPDF(
  report: ServiceReport,
  businessSettings: BusinessSettings | null,
  action: 'export' | 'share' = 'export',
  options?: ReportPdfOptions,
): Promise<void> {
  try {
    const html = await generateReportPDF(report, businessSettings, options);

    const customerName = options?.customerName || 'Customer';
    const filename = `Service_Report_${sanitizeForFilename(customerName)}_${format(new Date(report.visitDate), 'dd-MMM-yyyy')}.pdf`;
    const emailSubject = `Service report for ${customerName}`;
    const emailBody = `Please find attached your service report from ${format(new Date(report.visitDate), 'dd MMMM yyyy')}.\n\nThank you.`;

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
      return;
    }

    const { uri } = await Print.printToFileAsync({ html });
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
                  recipients: options?.customerEmail ? [options.customerEmail] : [],
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
  if (Platform.OS === 'ios') {
    await Print.printAsync({ html });
    return;
  }
  // Android: the print bridge renders the HTML in a WebView and can stall
  // indefinitely (a slow remote resource historically froze Preview PDF).
  // Race it against a timeout and fall back to generating the file and
  // opening it in the device's PDF viewer instead.
  try {
    await Promise.race([
      Print.printAsync({ html }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('PDF preview timed out')), 25000),
      ),
    ]);
  } catch (error) {
    try {
      const { uri } = await Print.printToFileAsync({ html });
      const namedUri = `${FileSystem.cacheDirectory}QuoteMate-Preview.pdf`;
      await FileSystem.copyAsync({ from: uri, to: namedUri });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(namedUri, {
          mimeType: 'application/pdf',
          dialogTitle: 'PDF Preview',
        });
        return;
      }
    } catch {
      // Fall through to the original error below.
    }
    throw error;
  }
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
