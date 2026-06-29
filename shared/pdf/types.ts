/**
 * Shared PDF types used by both client and server PDF generators
 */

export type PdfTemplateId = 'professional' | 'clean' | 'bold' | 'tradesman';

/**
 * Tri-state visibility for the materials / labour sections on a quote or
 * invoice:
 * - 'full'     — render the section with per-line prices and subtotals.
 * - 'itemsOnly'— render the item/section names and quantities but strip
 *                every price (unit price, line total, subtotals).
 * - 'hidden'   — drop the section (and its summary row) entirely.
 *
 * Back-compat: the legacy `showMaterialCosts` / `showLaborCosts` booleans map
 * to 'hidden' (false) vs 'full' (true/undefined) via `resolveDisplay`.
 */
export type SectionDisplay = 'full' | 'itemsOnly' | 'hidden';

/**
 * Resolve the effective tri-state display from the new enum field, falling
 * back to the legacy boolean. `false` → 'hidden', everything else → 'full'.
 */
export const resolveDisplay = (
  enumVal: SectionDisplay | undefined,
  legacyBool: boolean | undefined,
): SectionDisplay => enumVal ?? (legacyBool === false ? 'hidden' : 'full');

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
  // Per-unit labour hours/days for this section (matches QuoteSection.laborHours).
  laborHours: number;
  // Multiplier applied to laborHours to get the section total. Optional for
  // legacy data; treat missing as 1.
  multiplier?: number;
  // Total labour hours/days for the section (laborHours × multiplier). Prefer
  // this when displaying section duration in the PDF.
  laborHoursTotal?: number;
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
  // Tri-state materials display. Takes precedence over showMaterialCosts when
  // present. 'itemsOnly' shows item names + quantities but no prices; 'hidden'
  // drops the section. Subtotal/GST/Total always render regardless.
  materialsDisplay?: SectionDisplay;
  // Tri-state labour display. Same semantics as materialsDisplay.
  laborDisplay?: SectionDisplay;
  travelAdjustment?: number;
  gst: number;
  total: number;
  // GST mode. When true, line prices are GST-inclusive and the GST line shows
  // the extracted 1/11 component. When false (default), prices are ex-GST and
  // 10% is added on top. Determines totals labelling and arithmetic.
  pricesIncludeGst?: boolean;
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

export interface BusinessPdfData {
  businessName: string;
  email?: string;
  phone?: string;
  website?: string;
  abn?: string;
  address?: string;
  logoHtml?: string; // Pre-built <img> tag or empty string
  brandColor?: string;
  pdfTemplate?: PdfTemplateId;
}
