/**
 * Shared PDF types used by both client and server PDF generators
 */

export type PdfTemplateId = 'professional' | 'clean' | 'bold' | 'tradesman' | 'accredited';

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
  // 'work' = a lump-sum scope line: a title, a scope paragraph and one price.
  // quantity is 1 and unit is 'each', so every total still reconciles, but the
  // customer is shown neither. Absent/'material' = a priced product.
  kind?: 'material' | 'work';
  // Customer-facing scope paragraph for a work item. Newline-separated;
  // rendered under the title in the Project Scope table.
  scope?: string;
}

export interface LaborSection {
  name: string;
  // Per-unit labour HOURS for this section (matches QuoteSection.laborHours).
  laborHours: number;
  // Multiplier applied to laborHours to get the section total. Optional for
  // legacy data; treat missing as 1.
  multiplier?: number;
  // Total labour hours for the section (laborHours × multiplier). Prefer
  // this when displaying section duration in the PDF.
  laborHoursTotal?: number;
  // Dollars per HOUR.
  laborRate: number;
  // Legacy unit marker. Day-shaped legacy data is converted to hours before
  // rendering; see normaliseLabourToHours in shared/document/labourUnits.ts.
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
  // Canonical HOURS and dollars per HOUR.
  laborHours?: number;
  laborRate?: number;
  // Legacy unit marker — see LaborSection.laborUnit.
  laborUnit?: 'hours' | 'days';
  // How to present labour to the customer: 'days' renders quantities ÷ 8 and
  // rates × 8. Display only — it never changes a stored figure.
  labourDisplayUnit?: 'hours' | 'days';
  laborTotal: number;
  // Extra labour hours added on top of (or subtracted from) the sections sum.
  // Rendered as a "General Labour" row in the PDF when non-zero.
  laborExtraHours?: number;
  sections?: LaborSection[];
  subtotal: number;
  markup: number;
  markupAmount: number;
  // Labor markup percentage (independent from material markup). When showMarkup
  // is false and this is non-zero, labor totals are inflated to include it so
  // the customer sees a single rolled-in price.
  laborMarkup?: number;
  showMarkup?: boolean;
  // Materials cost visibility. When false, the renderer hides the materials
  // table AND the Materials Subtotal row in the summary. Subtotal/GST/Total
  // are still computed and shown.
  showMaterialCosts?: boolean;
  // Labour cost visibility. When false, the renderer hides the labour table
  // AND the Labour row in the summary. Subtotal/GST/Total are still computed
  // and shown.
  showLaborCosts?: boolean;
  travelAdjustment?: number;
  gst: number;
  total: number;
  // GST mode. When true, line prices are GST-inclusive and the GST line shows
  // the extracted 1/11 component. When false (default), prices are ex-GST and
  // 10% is added on top. Determines totals labelling and arithmetic.
  pricesIncludeGst?: boolean;
  // undefined/true = GST-registered. false = not registered: no GST row is
  // rendered and the summary carries a "No GST has been charged" note.
  gstRegistered?: boolean;
  notes?: string;
  showLaborHours?: boolean;
  // When false, hide per-section labour rows on the PDF and show only the
  // single Labour Total. Default: true (show breakdown).
  showLaborBreakdown?: boolean;
  groupMaterialsBySection?: boolean;
  paymentMethods?: any;
  // Subscription plan. When 'free', `generatePaymentMethodsHTML` shows only
  // the Square Pay Now button and hides bank/PayID/BPAY/PayPal/other —
  // every paid quote on the free tier funnels through Square so the
  // platform fee can be collected.
  plan?: 'trial' | 'free' | 'pro';
  // Square hosted-checkout URL. Rendered as a large "Pay Now" button when
  // present. Threaded all the way from the doc → pdfGenerator → here.
  squarePaymentLinkUrl?: string;
  // When true the customer-facing Square checkout amount has been bumped by
  // PASSTHROUGH_SURCHARGE_PCT to cover the card cost. Renders a subtle
  // disclosure line under the Pay button so the customer isn't surprised on
  // checkout (ACCC pre-commit surcharge disclosure).
  surchargePaymentFees?: boolean;
  // Terms & Conditions text. Rendered as its own section at the end of the
  // document. The business's current T&Cs are snapshotted to the quote/invoice
  // at send time and passed through here so later edits don't rewrite history.
  terms?: string;
}

export interface InvoicePdfData extends QuotePdfData {
  invoiceNumber?: string;
  issueDate: string; // Pre-formatted date string
  dueDate: string; // Pre-formatted date string
  paymentTerms?: string; // Pre-formatted payment terms string
  paidAmount?: number;
  // Deposit credit carried over from the source quote. Rendered as a
  // "Deposit already paid" row so the customer sees why the total differs.
  depositCredit?: number;
}

export interface ReportPdfData {
  reportNumber: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  jobAddress?: string;
  visitDate: string; // preformatted e.g. "22 July 2026"
  serviceType: string;
  riskAssessment?: string;
  equipment: string[];
  itemsChecked: { text: string; checked: boolean }[];
  natureOfProblem?: string;
  workCarriedOut?: string;
  recommendedWork?: string;
  photos?: { dataUri?: string; url?: string }[];
  customerSignature?: { svgPath: string; name: string; width?: number; height?: number };
  technicianSignature?: { svgPath: string; name: string; width?: number; height?: number };
}

export interface PdfBusinessCredential {
  label: string;
  number?: string;
  /** Prepared <img> tag. Client PDFs inline local/remote files; server PDFs use URLs. */
  logoHtml?: string;
}

export interface BusinessPdfData {
  businessName: string;
  email?: string;
  phone?: string;
  website?: string;
  abn?: string;
  address?: string;
  logoHtml?: string; // Pre-built <img> tag or empty string
  credentials?: PdfBusinessCredential[];
  brandColor?: string;
  pdfTemplate?: PdfTemplateId;
}
