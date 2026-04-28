// Core data models for QuoteMate

// PDF Template types (imported from shared module for local use, re-exported for consumers)
import type { PdfTemplateId, PdfTemplateInfo } from '../../shared/pdf/types';
export type { PdfTemplateId, PdfTemplateInfo };

// Record of a customer accepting the business's T&Cs at payment time.
// Stamped on the quote/invoice doc so the version they paid under is auditable.
export interface TcAcceptance {
  versionHash: string;          // hash of the T&Cs text snapshot at send time
  at: Date;                     // when the acceptance was recorded
  source: 'pay_link' | 'tap_to_pay' | 'manual';
}

export interface Material {
  id: string;
  name: string;
  quantity: number;
  unit: 'each' | 'm' | 'm²' | 'm³' | 'L' | 'kg' | 'box' | 'pack';
  bunningsItemNumber?: string;
  price: number; // per unit
  totalPrice: number;
  manualPriceOverride: boolean;
  searchTerm?: string;
  productUrl?: string; // Link to the actual product page
  favoriteProduct?: FavoriteProductMapping; // User's preferred product for this material
  // Pricing and product metadata
  pricingSource?: 'scraper' | 'api' | 'ai' | 'manual'; // Where the price came from
  priceConfidence?: 'high' | 'medium' | 'low'; // AI price confidence level
  imageUrl?: string; // Product image URL
  description?: string; // Product description
  brand?: string; // Product brand
  stockLevel?: string; // Stock availability (deprecated, use stockCheckedAt)
  stockCheckedAt?: string; // ISO timestamp of when stock was last checked
  // Material categorization
  category?: string; // Trade category ID (e.g., 'carpentry', 'electrical', 'plumbing')
  section?: string; // Work section within a job (e.g., 'Concreting', 'Timber Framing')
  templateBaseQuantity?: number; // Per-unit qty from template/AI (e.g. 2 posts per bay). quantity = templateBaseQuantity * section.multiplier
}

export interface FavoriteProductMapping {
  productName: string;
  store: string;
  productUrl?: string;
  itemNumber?: string;
  dimensions?: string;
  unit?: Material['unit'];
  price?: number; // Last known price
  imageUrl?: string; // Product image
  // Personal supplier rate fields
  isPersonalRate?: boolean;       // true → prefer over retail in auto-generate
  coveragePerUnit?: number;       // 1 unit covers N of coverageUnit (e.g. 13 m² per sheet)
  coverageUnit?: 'm²' | 'm³' | 'm';
  keywords?: string[];            // ["concrete","slab","footing"] for LLM matching
  notes?: string;
  // Provenance — PR1: 'manual', PR2: 'imported', PR3: 'subscribed'
  source?: 'manual' | 'imported' | 'subscribed';
  sourceRef?: string;             // PR2: importBatchId | PR3: supplierListId
  lastUpdatedAt?: string;         // ISO timestamp
}

export interface QuotePhoto {
  id: string;
  storageUrl: string;    // Firebase Storage download URL
  thumbnailUrl?: string;  // Optional smaller version
  annotated?: boolean;    // Whether photo has been annotated
}

// Labor unit type for hours/days billing
export type LaborUnit = 'hours' | 'days';

// Section within a quote/invoice with its own labor
export interface QuoteSection {
  id: string;
  name: string;               // e.g. "Colorbond Fence Bay", "Pedestrian Gate"
  multiplier: number;          // How many units (e.g. 8 bays) — default 1
  sourceTemplateId?: string;   // Which template this came from (if any)
  laborHours: number;          // Per-unit labor hours/days
  laborRate: number;           // $/hour or $/day
  laborUnit: LaborUnit;        // 'hours' | 'days'
  laborTotal: number;          // calculated: laborHours * laborRate * multiplier
  sortOrder: number;
}

// Reusable section template (assembly)
export interface SectionTemplate {
  id: string;
  name: string;                // e.g. "Standard Fence Bay"
  description?: string;
  keywords?: string[];         // e.g. ["fence bay", "colorbond fence"] — for matching to job descriptions
  materials: Omit<Material, 'id'>[];  // Template materials (IDs generated on use)
  laborHours: number;
  laborRate: number;
  laborUnit: LaborUnit;
  createdAt: string;
  updatedAt: string;
}

// AI-generated template suggestion for a quote
export interface TemplateSuggestion {
  templateId: string;
  templateName: string;
  suggestedQuantity: number;
  suggestedSectionName?: string; // AI-generated contextual name (e.g. "Colorbond Fence Bay")
  reasoning: string;
}

// User-defined supplier group for materials search
export interface SupplierGroup {
  id: string;
  name: string;              // e.g. "Local Timber Yard", "Fencing Supplies Co"
  searchUrl?: string;        // Optional base URL for web scraping
  isDefault?: boolean;       // Built-in groups (Bunnings, Reece) can't be deleted
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  // Optional contact details — surfaced in the supplier book card
  contactPerson?: string;    // Account manager / rep name
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}

export interface SupplierPartner {
  id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  website?: string;
  logoUrl?: string;
  location?: { lat: number; lng: number };
  status: 'pending' | 'active' | 'suspended';
  itemCount: number;
  subscriberCount: number;
}

// Embedded job descriptor that lives inside a Quote/Invoice/Document. Pre-dates
// the top-level Job entity introduced in Phase 8 — renamed to JobSpec to free
// the name for the new top-level Job re-exported below.
export interface JobSpec {
  id: string;
  name: string;
  description: string;
  template?: 'stairs' | 'deck' | 'fence' | 'pergola' | 'custom';
  estimatedHours?: number;
  customParams?: Record<string, number>; // e.g., { steps: 15, length: 10 }
}

// Top-level Job entity. Re-exported from the shared module so the app and
// the backend agree on the shape.
export type { Job, JobStage, JobPhoto } from '../../shared/job/types';

export interface Quote {
  id: string;
  quoteNumber?: string; // Human-readable reference number (e.g., "Q-001")
  createdAt: Date;
  updatedAt: Date;
  contactId?: string; // Link to Contact for live updates
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  jobAddress?: string;
  job: JobSpec;
  materials: Material[];
  laborRate: number; // $/hour or $/day (depending on laborUnit)
  laborHours: number; // quantity of hours or days
  laborUnit?: LaborUnit; // 'hours' | 'days' — default 'hours' for backwards compat
  laborTotal: number;
  // Extra labour hours added on top of (or subtracted from) the section sums.
  // Lets the user nudge total labour without rebalancing per-section values.
  // Can be negative. Falls back to 0 for legacy quotes.
  laborExtraHours?: number;
  materialsSubtotal: number;
  markup: number; // material markup percentage
  laborMarkup?: number; // labor markup percentage (independent from material markup). Falls back to material markup for legacy quotes.
  markupAmount: number; // combined material + labor markup amount
  subtotal: number;
  gst: number;
  total: number;
  // Sections — optional, for quotes with multiple work sections
  sections?: QuoteSection[];
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'completed' | 'cancelled';
  draftStep?: string; // Screen name where user left off during quote flow (e.g., 'CustomerDetails')
  notes?: string;
  aiSkipped?: boolean; // Flag to indicate AI analysis was intentionally skipped
  // AI template suggestions (generated during description cleanup or on materials screen load)
  templateSuggestions?: TemplateSuggestion[];
  // Markup visibility
  showMarkup?: boolean;        // Show markup line on customer-facing documents. Default: false (hidden)
  // Labour breakdown visibility on PDFs. When false, the per-section labour
  // rows are hidden and only the Labour Total is shown. Default: true.
  showLaborBreakdown?: boolean;
  // Travel adjustment
  travelAdjustment?: number;   // percentage bump (e.g., 3 = +3%)
  estimatedDistance?: number;   // km (straight-line)
  estimatedFuelCost?: number;  // AUD (round trip)
  travelGeocodeFailed?: boolean; // true when address geocoding couldn't resolve
  // Quote acceptance via email link fields
  acceptanceToken?: string; // 64-char secure token for email acceptance link
  acceptanceTokenCreatedAt?: Date; // When the token was generated (for 30-day expiration)
  respondedAt?: Date; // When client accepted/rejected via email link
  respondedBy?: string; // Client identifier (email or name from form)
  clientNotes?: string; // Optional feedback from client when responding
  // Job photos
  photos?: QuotePhoto[];
  // AI email content (stored at send time for acceptance page)
  aiEmailBody?: string;
  // In-progress email body shown in the email preview modal. Generated (or
  // typed) on first open and persisted so reopening the modal doesn't trigger
  // a fresh AI generation. The Regenerate button overwrites this. Distinct
  // from aiEmailBody, which is the canonical record of what was sent.
  draftEmailBody?: string;

  // Deposit / pre-payment (paid against the quote before work starts).
  // requireDeposit is the authoritative toggle — when false, no deposit is
  // asked for regardless of depositPercentage (which we preserve so toggling
  // back on restores the previous value).
  // depositAmount is the dollar amount snapshotted at quote-send time so it
  // doesn't drift if totals are edited after sending.
  requireDeposit?: boolean;
  depositPercentage?: number;
  depositAmount?: number;
  depositPaid?: number;            // Dollars actually received (set by Square webhook).
  depositPaidAt?: Date;
  depositPaymentLinkId?: string;   // Square payment link id minted on quote send.
  depositPaymentLinkUrl?: string;  // Hosted checkout URL surfaced on the acceptance page.
  depositPaymentLinkCreatedAt?: number | Date; // When the link was minted (ms epoch). Used to detect >23h stale and re-mint.
  depositSquarePaymentId?: string; // Set by webhook on COMPLETED (idempotency key).

  // T&Cs snapshot taken at send-time so later edits to the BusinessProfile
  // T&Cs don't rewrite history. The hash identifies the exact version the
  // customer saw when they paid.
  termsSnapshot?: string;
  termsVersionHash?: string;
  // Stamped by the Square webhook when the deposit/full payment completes.
  // Legally: the customer received the PDF containing the terms (hash match)
  // and completing payment = accepting those terms.
  depositTcAccepted?: TcAcceptance;
  fullTcAccepted?: TcAcceptance;

  // Forward-compat: once we introduce a Jobs collection, accepted quotes with
  // a paid deposit auto-create a Job linked here. Pre-wiring now so existing
  // quotes gain the field without a migration later.
  jobId?: string;
  // Computed server-side by the webhook: total money received against this
  // quote (deposit + any extra payments) and the outstanding balance.
  // Redundant with depositPaid for now, but collapses to a single "how much
  // has this customer paid" field once multi-payment lands.
  paidTotal?: number;
  balanceDue?: number;

  // Non-null when the last Square webhook attempt against this quote failed
  // to reconcile — surfaced as a red banner so the tradie can investigate
  // instead of silently losing the payment event. Cleared on next success.
  paymentSyncError?: PaymentSyncError;

  // Chargeback / dispute state as reported by Square. Null unless a dispute
  // has been opened against a payment linked to this quote.
  disputeStatus?: SquareDisputeStatus;
  disputeId?: string;

  // Set when this quote has been converted to an invoice. Used for idempotency
  // — re-tapping Convert returns the existing invoice instead of duplicating.
  invoiceId?: string;
  invoicedAt?: Date;
}

export type SquareDisputeStatus =
  | 'INQUIRY_EVIDENCE_REQUIRED'
  | 'INQUIRY_PROCESSING'
  | 'INQUIRY_CLOSED'
  | 'EVIDENCE_REQUIRED'
  | 'PROCESSING'
  | 'WON'
  | 'LOST'
  | 'ACCEPTED';

// Recorded when the Square webhook fails mid-reconcile. Surfaces in-app so
// the tradie knows something needs manual attention (instead of us swallowing
// the error silently, which is the default for webhook handlers).
export interface PaymentSyncError {
  at: Date;
  // Short machine-readable identifier — e.g. 'index_lookup_failed',
  // 'firestore_write_failed', 'xero_sync_failed'. Used for conditional UI.
  code: string;
  message: string;        // One-line human explanation for the banner.
  paymentId?: string;     // Square payment id if known.
}

export interface JobTemplate {
  id: string;
  name: string;
  description: string;
  icon?: string;
  defaultMaterials: TemplateMaterial[];
  estimatedHoursFormula: string; // e.g., "steps * 0.5"
  requiredParams: TemplateParam[]; // e.g., [{ key: 'steps', label: 'Number of steps', unit: '' }]
  // Trade-specific copy that shapes the job description input.
  // questionsLine: short prompt of the variables that matter for this job type.
  // exampleLines: a filled-in example using this trade's vocabulary.
  // voicePromptHint: short sub-label under the record button.
  questionsLine?: string;
  exampleLines?: string;
  voicePromptHint?: string;
}

export interface TemplateMaterial {
  name: string;
  searchTerm: string; // what to search in Bunnings
  quantityFormula: string; // e.g., "steps * 2"
  unit: 'each' | 'm' | 'm²' | 'm³' | 'L' | 'kg' | 'box' | 'pack';
}

export interface TemplateParam {
  key: string;
  label: string;
  unit?: string;
  defaultValue?: number;
}

export type TradeType = 'all' | 'carpenter' | 'plumber' | 'electrician' | 'cleaner';

export interface HardwareStore {
  name: string;
  url: string;
  description: string;
}

// Payment method types for business settings
export type PaymentMethodType = 'bank_transfer' | 'paypal' | 'bpay' | 'payid' | 'other';

export interface BankAccountDetails {
  enabled?: boolean;
  accountName?: string;
  bsb?: string;
  accountNumber?: string;
}

export interface BPayDetails {
  enabled?: boolean;
  billerCode?: string;
  referenceNumber?: string;
}

export interface PayIDDetails {
  enabled?: boolean;
  payIdType?: 'phone' | 'email' | 'abn';
  payIdValue?: string;
}

export interface PayPalDetails {
  enabled?: boolean;
  email?: string;
}

export interface OtherPaymentDetails {
  enabled?: boolean;
  instructions?: string;
}

export interface PaymentMethodSettings {
  // Master toggle - show payment section on PDFs
  showOnDocuments: boolean;
  // Individual payment methods
  bankAccount?: BankAccountDetails;
  paypal?: PayPalDetails;
  bpay?: BPayDetails;
  payId?: PayIDDetails;
  other?: OtherPaymentDetails;
}

export interface BusinessSettings {
  businessName: string;
  abn?: string;
  email?: string;
  phone?: string;
  address?: string;
  website?: string; // Shown on PDFs/emails alongside other contact details
  logoUri?: string; // Local file URI for company logo
  defaultLaborRate: number;
  defaultMarkup: number;
  defaultLaborMarkup?: number; // Default labor markup percentage. Falls back to defaultMarkup if undefined.
  transportMarkupEnabled?: boolean; // Whether to include transport/logistics markup on quotes (default: true)
  // Trade type
  tradeType?: TradeType; // Default: 'all'
  // New: Trade category and niche for improved targeting (multi-select)
  tradeCategories?: string[]; // e.g., ['plumbing', 'carpentry']
  tradeNiches?: string[]; // e.g., ['drain_services', 'outdoor']
  // Legacy single-select fields (kept for backwards compatibility)
  tradeCategory?: string;
  tradeNiche?: string;
  // Price fetching settings
  useReeceApi?: boolean; // If true and tradeType is plumber, use Reece API for plumbing supplies
  selectedStore?: string; // Single selected hardware store (e.g., 'bunnings', 'mitre10')
  // Quote display settings
  showLaborHours?: boolean; // If true, show labor hours breakdown on quotes. Default: false (show only total)
  showMarkup?: boolean; // If true, show markup line on documents. Default: true (show markup)
  // Payment method settings
  paymentMethods?: PaymentMethodSettings;
  // Branding
  brandColor?: string; // Custom accent color for PDF documents (overrides template default)
  // Quote/invoice display settings
  groupMaterialsBySection?: boolean; // Group materials by work section on PDFs (default: false)
  // PDF template
  pdfTemplate?: PdfTemplateId;
  // Whether new quotes should require a deposit by default. Separate from the
  // amount so disabling doesn't wipe the percentage. Per-quote override on
  // Quote.requireDeposit.
  requireDepositByDefault?: boolean;
  // Default deposit percentage applied to new quotes when requireDeposit is on.
  // Per-quote override lives on Quote.depositPercentage.
  defaultDepositPercentage?: number;
  // Terms & Conditions shown on the quote/invoice PDF and recorded as
  // accepted when the customer pays. Editable in Settings → Business Profile.
  // When blank, the PDF falls back to the built-in AU tradie default so new
  // users have something sensible out of the box.
  termsAndConditions?: string;
  // ISO timestamp of the last edit; used to prompt re-review if the business
  // hasn't touched their terms in >12 months.
  termsUpdatedAt?: string;
  // When true, bump the Square pay-link amount by the standard passthrough
  // percentage (see shared/pdf/squareFees.ts → PASSTHROUGH_SURCHARGE_PCT) so
  // the customer covers both Square's processing fee and QuoteMate's platform
  // fee rather than the tradie eating them. Legal in AU with disclosure; the
  // email + hosted checkout surface the surcharge line. Default false.
  // The percentage is NOT tradie-editable — ACCC rules require surcharges to
  // stay at or under the actual cost of acceptance.
  surchargePaymentFees?: boolean;
  // Legacy fields (kept for backwards compatibility)
  hardwareStores?: string[]; // DEPRECATED - use selectedStore instead
  customStores?: string[]; // DEPRECATED - Custom store URLs added by user
}

// Quote calculation result
export interface QuoteCalculation {
  materialsSubtotal: number;
  laborTotal: number;
  subtotal: number;
  markupAmount: number;
  travelAdjustmentAmount: number;
  gst: number;
  total: number;
}

// Subscription
export interface SubscriptionStatus {
  isPro: boolean;
  quotesThisMonth: number;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  freeQuotesLimit: number;
  trialStartedAt?: Date;
  trialExpired?: boolean;
}

export interface ReferralInfo {
  referralCode: string;
  referredBy: string | null;
  totalReferrals: number;
  convertedReferrals: number;
  // Affiliate fields
  isAffiliate: boolean;
  commissionRate: number; // e.g. 0.50 for 50%
  totalEarnings: number; // lifetime earnings in cents
  pendingEarnings: number; // awaiting payout in cents
  paidEarnings: number; // already paid out in cents
  lastPayoutAt: Date | null;
}

export interface AffiliateEarning {
  id: string;
  referredUserId: string;
  referredUserEmail: string; // masked, e.g. "j***@gmail.com"
  platform: 'web' | 'ios' | 'android';
  grossAmount: number; // cents
  platformFee: number; // cents
  netRevenue: number; // cents
  commissionRate: number;
  commissionAmount: number; // cents
  billingPeriod: string; // e.g. "2026-03"
  productId: string;
  status: 'pending' | 'confirmed' | 'paid' | 'cancelled';
  createdAt: Date;
}

export type SubscriptionPlan = 'free' | 'pro';

// Invoice types
export type PaymentTerms = 'due_on_receipt' | 'net_7' | 'net_14' | 'net_30' | 'custom';
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'partial' | 'overdue' | 'cancelled';
export type PaymentMethod = 'cash' | 'bank_transfer' | 'card' | 'cheque' | 'other';

export interface Invoice {
  id: string;
  invoiceNumber?: string;
  createdAt: Date;
  updatedAt: Date;
  issueDate: Date;
  dueDate: Date;

  // Customer (same as Quote)
  contactId?: string; // Link to Contact for live updates
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  jobAddress?: string;

  // Job & Materials (same as Quote)
  job: JobSpec;
  materials: Material[];

  // Pricing (same as Quote)
  laborRate: number;
  laborHours: number;
  laborUnit?: LaborUnit;
  laborTotal: number;
  // Extra labour hours added on top of (or subtracted from) the section sums.
  // Mirrors Quote.laborExtraHours. Falls back to 0 for legacy invoices.
  laborExtraHours?: number;
  materialsSubtotal: number;
  markup: number; // material markup percentage
  laborMarkup?: number; // labor markup percentage (independent from material markup). Falls back to material markup for legacy invoices.
  markupAmount: number; // combined material + labor markup amount
  subtotal: number;
  gst: number;
  total: number;

  // Sections — optional, for invoices with multiple work sections
  sections?: QuoteSection[];

  // Markup visibility
  showMarkup?: boolean;        // Show markup line on customer-facing documents. Default: false (hidden)
  // Labour breakdown visibility on PDFs. When false, the per-section labour
  // rows are hidden and only the Labour Total is shown. Default: true.
  showLaborBreakdown?: boolean;

  // Invoice-specific
  status: InvoiceStatus;
  paymentTerms: PaymentTerms;
  customPaymentDays?: number;

  // Payment tracking
  paidDate?: Date;
  paidAmount?: number;
  paymentMethod?: PaymentMethod;
  paymentNotes?: string;

  // Link to source quote
  sourceQuoteId?: string;

  notes?: string;

  // Travel adjustment
  travelAdjustment?: number;   // percentage bump (e.g., 3 = +3%)
  estimatedDistance?: number;   // km (straight-line)
  estimatedFuelCost?: number;  // AUD (round trip)
  travelGeocodeFailed?: boolean; // true when address geocoding couldn't resolve

  // Xero integration
  xeroInvoiceId?: string;      // Xero invoice ID (for idempotent updates)
  xeroContactId?: string;      // Xero contact ID
  xeroSyncStatus?: XeroSyncStatus;
  xeroSyncedAt?: Date;         // Last successful sync timestamp
  xeroSyncError?: string;      // Last sync error message

  // Square online payment
  squarePaymentLinkId?: string;   // Square Checkout API payment link id
  squarePaymentLinkUrl?: string;  // Hosted checkout URL included in the invoice email
  squarePaymentId?: string;       // Set by webhook when a payment is COMPLETED (idempotency key)
  squarePaidAt?: Date;            // When the Square webhook reported payment completion

  // Deposit credit carried over from the source quote.
  // depositCredit reduces the amount owing; the line is rendered as
  // "Deposit of $X already paid" on the invoice/PDF/email.
  depositCredit?: number;
  depositCreditFromQuoteId?: string;

  // T&Cs snapshot taken at send-time — see Quote.termsSnapshot.
  termsSnapshot?: string;
  termsVersionHash?: string;
  // Stamped by the Square webhook when the invoice payment completes.
  tcAccepted?: TcAcceptance;

  // Forward-compat job linkage — mirrors Quote.jobId.
  jobId?: string;
  // Total dollars received against this invoice. paidAmount is the legacy
  // single-payment field we keep in sync.
  paidTotal?: number;
  balanceDue?: number;

  // Failed-webhook surface + dispute tracking, mirrors Quote.
  paymentSyncError?: PaymentSyncError;
  disputeStatus?: SquareDisputeStatus;
  disputeId?: string;

  // In-progress email body shown in the invoice email preview modal.
  // Generated (or typed) on first open and persisted so reopening doesn't
  // trigger a fresh AI generation. Regenerate overwrites it.
  draftEmailBody?: string;
}

// Xero integration types
export type XeroSyncStatus = 'not_synced' | 'syncing' | 'synced' | 'error';

export interface XeroConnection {
  tenantId: string;            // Xero organisation ID
  tenantName: string;          // Xero organisation name
  connectedAt: string;         // ISO date
  lastSyncAt?: string;         // ISO date
  syncEnabled: boolean;        // Auto-push on invoice send
}

// Square integration types
export type SquareEnv = 'sandbox' | 'production';

export interface SquareConnection {
  merchantId: string;
  merchantName?: string;       // Best-effort display name from Square merchant profile
  locationId?: string;         // Default location used for payment links
  locationName?: string;
  env: SquareEnv;
  connectedAt: string;         // ISO date
  // Access/refresh tokens live server-side only — this type is mirrored by
  // Firestore at users/{uid}/settings/squareConnection, but the mobile app
  // only ever reads the non-sensitive subset via checkSquareConnection().
  disconnectedReason?: string | null;
}

// Contact types
export type ContactSource = 'manual' | 'phone' | 'xero' | 'quote';

export interface Contact {
  id: string;
  name: string;
  businessName?: string;
  email?: string;
  phone?: string;
  address?: string;
  website?: string;
  source: ContactSource;
  xeroContactId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SearchableContact extends Contact {
  searchSource: 'saved' | 'phone' | 'recent' | 'xero';
}

// Notification preferences (stored at users/{userId}/settings/notificationPreferences)
export interface NotificationPreferences {
  quoteUpdates: boolean;       // Quote accepted/rejected/viewed/expiring
  invoiceUpdates: boolean;     // Invoice paid/overdue
  dailyMotivation: boolean;    // Morning Aussie motivation
  milestoneCelebrations: boolean; // Quote count milestones
  inactivityNudges: boolean;   // "We miss ya" nudges
}
