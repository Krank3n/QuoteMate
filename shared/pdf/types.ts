/**
 * Shared PDF types used by both client and server PDF generators
 */

export type PdfTemplateId = 'professional' | 'clean' | 'bold' | 'tradesman';

export interface PdfTemplateInfo {
  id: PdfTemplateId;
  name: string;
  description: string;
  accentColor: string;
}

export interface PdfMaterial {
  name: string;
  quantity: number;
  unit: string;
  price: number;
  totalPrice: number;
  section?: string;
}

export interface LaborSection {
  name: string;
  laborHours: number;
  laborRate: number;
  laborUnit?: 'hours' | 'days';
  laborTotal: number;
}

export interface QuotePdfData {
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  jobAddress?: string;
  quoteNumber?: string;
  quoteDate: string; // Pre-formatted date string (e.g. "05 April 2026")
  job: { name: string; description: string };
  materials: PdfMaterial[];
  materialsSubtotal: number;
  laborHours?: number;
  laborRate?: number;
  laborUnit?: 'hours' | 'days';
  laborTotal: number;
  sections?: LaborSection[];
  subtotal: number;
  markup: number;
  markupAmount: number;
  showMarkup?: boolean;
  travelAdjustment?: number;
  gst: number;
  total: number;
  notes?: string;
  showLaborHours?: boolean;
  groupMaterialsBySection?: boolean;
  paymentMethods?: any;
}

export interface InvoicePdfData extends QuotePdfData {
  invoiceNumber?: string;
  issueDate: string; // Pre-formatted date string
  dueDate: string; // Pre-formatted date string
  paymentTerms?: string; // Pre-formatted payment terms string
  paidAmount?: number;
}

export interface BusinessPdfData {
  businessName: string;
  email?: string;
  phone?: string;
  abn?: string;
  logoHtml?: string; // Pre-built <img> tag or empty string
  brandColor?: string;
  pdfTemplate?: PdfTemplateId;
}
