/**
 * Reece API Types
 * Complete TypeScript definitions for Reece Group API
 * API Docs: https://docs.api.reecegroup.com.au/latest/index.html
 */

export type ReeceRegion = 'au' | 'nz';

// ==================== Authentication Types ====================

export interface OAuth2TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface OAuth2TokenRequest {
  grant_type: 'client_credentials';
  scope: string;
}

// ==================== Customer Onboarding Types ====================

export interface OnboardingRequestTokenResponse {
  requestToken: string;
}

export interface CustomerTokenRequest {
  requestToken: string;
}

export interface HomeBranch {
  branchNumber: number;
  branchName: string;
}

export interface CustomerTokenResponse {
  customerToken: string;
  customerNumber: number;
  displayName: string | null;
  homeBranch: HomeBranch;
}

// ==================== Product Search Types ====================

export interface ProductImage {
  url: string;
  type?: string;
}

export interface UnitOfMeasure {
  code: string;
  description: string;
  conversionFactor?: number;
}

export interface Product {
  productId: number;
  productTitle: string;
  productImages: ProductImage[];
  unitOfMeasures: UnitOfMeasure[];
  brand?: string;
  category?: string;
  description?: string;
}

export interface ProductSearchResponse {
  totalResults: number;
  pageNumber: number;
  pageSize: number;
  gstRate: number;
  products: Product[];
}

export interface ProductSearchParams {
  searchPhrase: string;
  pageNumber?: number;
  pageSize?: number;
}

// ==================== Quote Types ====================

export type QuoteStage = 'Hold' | 'Entered' | 'Won' | 'Lost';

export interface QuoteHeader {
  quoteNumber: number;
  quoteDate: string;
  branchNumber: number;
  salesPersonName: string;
  orderNumber: string;
  jobName: string;
  status: string;
  contact: string;
  expiryDate: string;
  stage: QuoteStage;
}

export interface QuoteHeadersParams {
  fromDate: string;
  toDate: string;
  quoteStages?: QuoteStage[];
}

export interface MoneyAmount {
  amount: number;
  currency: string;
}

export interface QuoteTotals {
  deliveryFee: MoneyAmount;
  documentTotal: MoneyAmount;
}

export interface QuoteLine {
  lineNumber: number;
  productId: number;
  productDescription: string;
  quantity: number;
  unitOfMeasure: string;
  unitPriceExcludingGst: number;
  unitPriceIncludingGst: number;
  lineTotalExcludingGst: number;
  lineTotalIncludingGst: number;
}

export interface QuoteDetails {
  quoteNumber: number;
  quoteDate: string;
  expiryDate: string;
  customerNumber: number;
  orderNumber: string;
  jobName: string;
  project: string;
  branchName: string;
  branchNumber: number;
  salesPersonName: string;
  salesPersonNumber: number;
  totals: QuoteTotals;
  quoteLines: QuoteLine[];
}

export interface QuoteDetailsResponse {
  documents: QuoteDetails[];
}

// ==================== Pricing Types ====================

export type PriceFileFormat = 'MAX_CSV' | 'MAX_JSON';
export type PriceFileAdditionalField = 'CATEGORY' | 'SECTION' | 'PRODUCT_IMAGES';

export interface PriceFileParams {
  format: PriceFileFormat;
  additionalFields?: PriceFileAdditionalField[];
}

export interface PriceFileSetting {
  format: PriceFileFormat;
  additionalFields?: PriceFileAdditionalField[];
  lastGenerated?: string;
}

// ==================== Punchout Types ====================

export interface PunchoutParams {
  clientId: string;
  hookUrl: string;
  customerToken?: string;
  customerNumber?: string;
}

export interface CartProduct {
  productId: number;
  productDescription: string;
  quantity: number;
  unitOfMeasure: string;
  unitPriceExcludingGst: number;
  unitPriceIncludingGst: number;
  unitMarketPriceExcludingGst: number;
  unitMarketPriceIncludingGst: number;
  gstRate: number;
  quoteNumber?: number;
  quoteLineNumber?: number;
}

export interface CartResponse {
  products: CartProduct[];
}

// ==================== Order Types ====================

export interface OrderNotification {
  email?: string;
  sms?: string;
}

export interface DeliveryAddress {
  addressLine1: string;
  addressLine2?: string;
  suburb: string;
  state: string;
  postcode: string;
}

export interface DeliveryDetails {
  deliveryInstructions?: string;
  contactName: string;
  contactNumber: string;
  deliveryAddress: DeliveryAddress;
}

export interface OrderFulfillment {
  type: 'PICKUP' | 'DELIVERY';
  pickupBranch?: number;
  deliveryDetails?: DeliveryDetails;
}

export interface OrderProduct {
  productId: number;
  quantity: number;
  unitOfMeasure: string;
  unitPriceExcludingGst: number;
  unitPriceIncludingGst: number;
  quoteNumber?: number;
  quoteLineNumber?: number;
  status?: string;
}

export interface OrderAttachment {
  type: 'URL_LINK' | 'BASE64_CONTENT';
  name: string;
  content: string;
}

export interface OrderRequest {
  jobName?: string;
  orderNumber?: string;
  orderByName: string;
  orderFromQuote?: number;
  orderByPhone: string;
  orderByEmail?: string;
  comment?: string;
  requiredByDateTime: string;
  notification?: OrderNotification;
  fulfillment: OrderFulfillment;
  products: OrderProduct[];
  attachments?: OrderAttachment[];
}

export interface OrderResponse extends OrderRequest {
  id: number;
  status: string;
  cartageFee?: number;
}

export interface OrderCheckResponse {
  jobName?: string;
  orderNumber?: string;
  orderByName: string;
  orderFromQuote?: number;
  orderByPhone: string;
  orderByEmail?: string;
  comment?: string;
  requiredByDateTime: string;
  notification?: OrderNotification;
  fulfillment: OrderFulfillment;
  products: OrderProduct[];
}

// ==================== Invoice Types ====================

export type DocumentType = 'CASH_SALE_INVOICE' | 'TAX_INVOICE' | 'CREDIT_NOTE' | 'CASH_REFUND';

export interface DocumentHeader {
  documentNumber: number;
  documentType: DocumentType;
  documentDate: string;
  customerNumber: number;
  jobNumber: string;
  orderNumber: string;
}

export interface InvoiceHeadersResponse {
  documentHeaders: DocumentHeader[];
}

export interface InvoiceHeadersParams {
  documentTypes: DocumentType[];
  fromDate: string;
  toDate: string;
}

export interface InvoiceCustomer {
  customerNumber: number;
  name: string;
  phone?: string;
}

export interface InvoiceContact {
  name?: string;
  phone?: string;
  email?: string;
}

export interface InvoiceSupplier {
  name: string;
  address?: string;
  phone?: string;
  abn?: string;
}

export interface InvoiceTotals {
  subtotal: MoneyAmount;
  gst: MoneyAmount;
  total: MoneyAmount;
}

export interface InvoiceBranch {
  branchNumber: number;
  branchName: string;
  address?: string;
  phone?: string;
}

export interface InvoiceDeliveryDetails {
  address?: DeliveryAddress;
  deliveryDate?: string;
  deliveryInstructions?: string;
}

export interface InvoiceLine {
  lineNumber: number;
  productId: number;
  productDescription: string;
  quantity: number;
  unitOfMeasure: string;
  unitPriceExcludingGst: number;
  unitPriceIncludingGst: number;
  lineTotalExcludingGst: number;
  lineTotalIncludingGst: number;
  gstRate: number;
}

export interface Invoice {
  documentType: DocumentType;
  documentNumber: number;
  documentDate: string;
  documentDueDate: string;
  invoiceUrl: string;
  customer: InvoiceCustomer;
  orderContact: InvoiceContact;
  supplier: InvoiceSupplier;
  jobNumber: string;
  orderNumber: string;
  totals: InvoiceTotals;
  sellingBranch: InvoiceBranch;
  deliveryDetails: InvoiceDeliveryDetails;
  invoiceLines: InvoiceLine[];
}

export interface InvoicesResponse {
  documents: Invoice[];
}

export interface InvoiceSyncSettings {
  format: 'CSV';
}

// ==================== Branch Types ====================

export interface BranchAddress {
  addressLine1: string;
  addressLine2?: string;
  suburb: string;
  state: string;
  postcode: string;
}

export interface GeographicalCoordinates {
  latitude: number;
  longitude: number;
}

export interface Branch {
  name: string;
  address: BranchAddress;
  shortName: string;
  emailAddress: string;
  geographicalCoordinates: GeographicalCoordinates;
  managerName: string;
  timeZone: string;
  branchNumber: string;
  telephone: string;
}

export interface BranchesResponse {
  branches: Branch[];
}

// ==================== Error Types ====================

export interface ApiViolation {
  fieldName: string | null;
  message: string | null;
}

export interface ApiErrorResponse {
  violations: ApiViolation[];
}

// ==================== Configuration ====================

export interface ReeceConfig {
  clientId: string;
  clientSecret: string;
  customerNumber?: string;
  customerToken?: string;
  region: ReeceRegion;
  authBaseUrl: string;
  apiBaseUrl: string;
}
