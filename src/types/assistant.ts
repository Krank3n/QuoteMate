// Shared types for the Mate assistant chat surface. The Proposal union here is
// the source of truth — the validators in services/assistant/proposalTools.ts
// and the declarations in services/assistant/toolSchemas.ts must stay in step
// with it.

export type ProposalType =
  | 'propose_draft_quote'
  | 'propose_add_line_item'
  | 'propose_delete_line_item'
  | 'propose_delete_quote'
  | 'propose_create_contact'
  | 'propose_update_customer'
  | 'propose_send_quote'
  | 'propose_convert_to_invoice'
  | 'propose_reprice'
  | 'propose_update_quote_rates'
  | 'propose_mark_paid';

export interface BaseProposal {
  id: string;
  toolUseId: string;
  createdAt: string;
  type: ProposalType;
}

export interface DraftQuoteProposal extends BaseProposal {
  type: 'propose_draft_quote';
  customerId?: string;
  customerDraft?: { name: string; phone?: string; email?: string; address?: string };
  jobName: string;
  jobDescription: string;
  estimatedDurationHours?: number;
  // When 'invoice', the draft is auto-converted into an invoice once the
  // materials + pricing pipeline finishes. Defaults to 'quote'.
  documentType?: 'quote' | 'invoice';
}

export interface AddLineItemProposal extends BaseProposal {
  type: 'propose_add_line_item';
  quoteId: string;
  searchTerm: string;
  qty: number;
  unit: string;
  section?: string;
}

export interface DeleteLineItemProposal extends BaseProposal {
  type: 'propose_delete_line_item';
  quoteId: string;
  materialId: string;
  displayName?: string;
  displayQty?: number;
  displayUnit?: string;
  displayTotal?: number;
}

// Delete the whole quote/invoice (the document itself), as opposed to removing
// a single line. Carries display fields so the confirmation card can name the
// doc being removed ("Gigar — Raised deck with stairs · $14,360.77") without a
// re-fetch.
export interface DeleteQuoteProposal extends BaseProposal {
  type: 'propose_delete_quote';
  quoteId: string;
  displayName?: string;
  displayCustomerName?: string;
  displayTotal?: number;
  displayDocType?: 'quote' | 'invoice';
}

export interface CreateContactProposal extends BaseProposal {
  type: 'propose_create_contact';
  name: string;
  phone?: string;
  email?: string;
  address?: string;
}

export interface UpdateCustomerProposal extends BaseProposal {
  type: 'propose_update_customer';
  // The existing quote/invoice whose customer is being re-pointed.
  quoteId: string;
  // Either an existing contact (preferred when find_customer matched) or a
  // fresh draft to create + link. Mirrors propose_draft_quote's customer shape.
  customerId?: string;
  customerDraft?: { name: string; phone?: string; email?: string; address?: string };
  // Display-only — the new customer's name so the card names it without a
  // round-trip (Mate already has it from find_customer / the draft).
  customerName?: string;
}

export interface SendQuoteProposal extends BaseProposal {
  type: 'propose_send_quote';
  quoteId: string;
  recipientEmail?: string;
  // Mate-written email copy. When set, Apply persists it onto the document so
  // the send preview opens pre-filled with it (the modal reads draftEmailBody
  // / draftEmailSubject) instead of auto-generating a body.
  draftEmailBody?: string;
  draftEmailSubject?: string;
}

export interface ConvertToInvoiceProposal extends BaseProposal {
  type: 'propose_convert_to_invoice';
  quoteId: string;
}

export interface RepriceQuoteProposal extends BaseProposal {
  type: 'propose_reprice';
  quoteId: string;
  // Display-only — lets the card name the quote being re-priced without a
  // round-trip. The pipeline re-prices the flagged rows on Apply regardless.
  displayName?: string;
  displayTotal?: number;
}

// Mark an invoice paid in full — the voice / chat equivalent of opening
// the doc and tapping "Mark paid". Apply records a payment for the
// remaining balance with the chosen method so the books stay accurate
// (status flips to 'paid' as a side effect of recordPayment when the
// balance hits zero).
export interface MarkPaidProposal extends BaseProposal {
  type: 'propose_mark_paid';
  // Document id of the invoice to mark paid.
  quoteId: string;
  // How the money landed. Defaults to 'other' if the tradie didn't say.
  method?: 'cash' | 'bank_transfer' | 'card' | 'cheque' | 'other';
  // Optional note recorded against the payment (e.g. "paid in cash on site").
  notes?: string;
  // Display-only — lets the card name the doc without a re-fetch.
  displayName?: string;
  displayCustomerName?: string;
  displayTotal?: number;
  displayBalance?: number;
}

export interface UpdateQuoteRatesProposal extends BaseProposal {
  type: 'propose_update_quote_rates';
  quoteId: string;
  // Any of these can be omitted — only provided fields are applied. Markup
  // values are percentages (e.g. 30 = 30%). laborRate is $/hour. laborHours
  // is hours.
  markup?: number;
  laborMarkup?: number;
  laborRate?: number;
  laborHours?: number;
  // Display-only — name the doc on the card without a re-fetch.
  displayName?: string;
}

export type Proposal =
  | DraftQuoteProposal
  | AddLineItemProposal
  | DeleteLineItemProposal
  | DeleteQuoteProposal
  | CreateContactProposal
  | UpdateCustomerProposal
  | SendQuoteProposal
  | ConvertToInvoiceProposal
  | RepriceQuoteProposal
  | UpdateQuoteRatesProposal
  | MarkPaidProposal;

export type ProposalStatus = 'pending' | 'applied' | 'dismissed' | 'failed';

export interface WorkingStatus {
  /** Pipeline phase identifier — drives icon + style. */
  phase: 'preflight' | 'analyzing' | 'building' | 'pricing' | 'done' | 'failed';
  /** Single short line — what's happening right now. */
  status: string;
  /** Optional secondary line — e.g. names of items being processed. */
  detail?: string;
  /** Optional rolling list of items being searched — shown under the status
   *  line so the user can see WHAT Mate is currently looking up, not just
   *  a generic "batch X of Y" progress headline. Populated during the
   *  Bunnings batch phase. */
  items?: Array<{ name: string; status: 'pending' | 'searching' | 'done' | 'failed' }>;
  /** When true, the spinner stops and the card renders the final state. */
  done: boolean;
  /** Final summary text shown when done. */
  summary?: string;
}

export type ChatAttachmentStatus = 'uploading' | 'ready' | 'failed';

/**
 * A photo the tradie attached to a chat message.
 *
 * NEVER put base64 on this shape. Every appendMessage/updateMessage schedules
 * a conversation sync that writes `messages` verbatim to Firestore — inline
 * bytes would blow the 1MB document limit and re-bill on every flush. Bytes
 * are read on demand from `localUri` at send time (attachmentBytes.ts).
 */
export interface ChatAttachment {
  id: string;
  /** file:// (native) or blob: (web) — thumbnail + inline-bytes source. */
  localUri?: string;
  /** From uploadQuotePhoto; the durable copy that rides onto the quote. */
  storageUrl?: string;
  mimeType?: string;
  /** Captured at PLAN_MAX_WIDTH; becomes QuotePhoto.isPlan. */
  isPlan?: boolean;
  status: ChatAttachmentStatus;
  /** Set once carried onto a draft so a later draft can't inherit it. */
  consumedByQuoteId?: string;
  /** Claim marker — a photo spent on a supplier import is not a job photo. */
  consumedBy?: 'supplier_import' | 'job_photo';
}

export type ChatMessageCtaAction =
  | { type: 'open_quote'; quoteId: string };

export interface ChatMessageCta {
  label: string;
  action: ChatMessageCtaAction;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  // Proposals emitted by the assistant on this turn — rendered as inline cards
  // beneath the message bubble. Each proposal carries its own apply state so the
  // bubble doesn't have to swap when one card is applied.
  proposals?: Proposal[];
  proposalStatus?: Record<string, ProposalStatus>;
  // Set when the assistant call failed; UI renders the message in muted red.
  errorMessage?: string;
  // When present, the message renders as a live "working" card that the
  // chat updates as pipeline events arrive. Used for analyse + pricing
  // progress so the user sees what's happening without leaving chat.
  working?: WorkingStatus;
  // Optional CTA rendered below the text. Used after pipeline completion to
  // offer "View quote" — keeps the user in chat unless they tap.
  cta?: ChatMessageCta;
  // When set, the bubble renders an inline JobScopeCard for this quote so the
  // tradie can review the priced draft (and keep chatting to adjust) without
  // bouncing out to the wizard.
  inlineQuoteId?: string;
  // A "[context]" note for the model only — carried in the history sent to
  // Gemini but never rendered as a bubble. The voice path delivers the same
  // notes over the live socket via sendContextNote(); text chat has no socket,
  // so outcomes have to ride in the history instead. Without this, an apply
  // that failed was invisible to the model and it would cheerfully re-propose
  // the same broken action turn after turn.
  hidden?: boolean;
  // Photos attached to this bubble. Metadata only — the bytes are read from
  // localUri at send time, never stored here (see ChatAttachment).
  attachments?: ChatAttachment[];
}

export interface Conversation {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface AssistantChatResponse {
  messageId: string;
  text: string;
  proposals: Proposal[];
  // Document ids the model asked to display inline (via show_quote). The chat
  // screen renders each as an inline quote card once the turn resolves.
  showQuoteIds?: string[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    model: string;
    escalated: boolean;
  };
}
