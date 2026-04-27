export type {
  DocumentStage,
  DocumentType,
  DocumentPayment,
  DocumentPaymentKind,
  DocumentPaymentMethod,
  DocumentPaymentLink,
  DocumentPaymentLinkKind,
  DocumentRecord,
  LegacyDocumentRecord,
} from './types';

export {
  LEGAL_TRANSITIONS,
  canTransition,
  allowedNextStages,
  isTerminal,
} from './stage';

export {
  toMs,
  toMsRequired,
  fromMs,
  fromMsRequired,
  sumPayments,
  deriveStage,
  quoteRecordToDocumentRecord,
  invoiceRecordToDocumentRecord,
  documentRecordToQuoteRecord,
  documentRecordToInvoiceRecord,
  stageToQuoteStatus,
  stageToInvoiceStatus,
} from './adapter';
