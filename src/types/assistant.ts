// Shared types for the Mate assistant chat surface. The Proposal union here is
// the source of truth — the validators in services/assistant/proposalTools.ts
// and the declarations in services/assistant/toolSchemas.ts must stay in step
// with it.

import type { RateCardUnit, RateLine } from './index';
import type { ChatReviewBlock } from '../utils/reviewChatFormat';

export type ProposalType =
  | 'propose_draft_quote'
  | 'propose_add_line_item'
  | 'propose_delete_line_item'
  | 'propose_update_line_item'
  | 'propose_delete_quote'
  | 'propose_create_contact'
  | 'propose_update_customer'
  | 'propose_send_quote'
  | 'propose_convert_to_invoice'
  | 'propose_reprice'
  | 'propose_update_quote_rates'
  | 'propose_update_quote_scope'
  | 'propose_mark_paid'
  | 'propose_import_supplier_list'
  | 'propose_remember_preference'
  | 'propose_save_rate'
  | 'propose_set_total'
  | 'propose_pick_contact';

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
  /**
   * 'labour_only': the draft gets hours and sections from the analysis but no
   * materials list and no pricing run — for trades that don't quote gear.
   */
  materialsMode?: 'priced' | 'labour_only';
  /**
   * The job charged off the tradie's rate card. Each becomes a lump-sum work
   * item at rate × quantity. When every line includes materials, nothing is
   * generated or priced on top and no labour is added.
   */
  rateLines?: RateLine[];
}

/** A standing rule about how the tradie quotes, saved to their settings on Apply. */
export interface RememberPreferenceProposal extends BaseProposal {
  type: 'propose_remember_preference';
  text: string;
}

/** A charge-out rate for the tradie's rate card. */
export interface SaveRateProposal extends BaseProposal {
  type: 'propose_save_rate';
  label: string;
  unit: RateCardUnit;
  rate: number;
  /** Undefined = the tradie didn't say; the business default applies on Apply. */
  pricesIncludeGst?: boolean;
  includesMaterials: boolean;
  notes?: string;
}

export interface AddLineItemProposal extends BaseProposal {
  type: 'propose_add_line_item';
  quoteId: string;
  /** For a priced material: what the pipeline searches for. For a lump sum: the line's name. */
  searchTerm: string;
  qty: number;
  unit: string;
  section?: string;
  /**
   * 'work': a lump-sum scope line at a price the TRADIE said — "add a $180
   * callout". Minted exactly as the inline editor's Work item chip mints one
   * (quantity 1, unit 'each', price = line total, no markup, no pipeline).
   * Absent = a material the pricing pipeline prices on Apply.
   */
  kind?: 'work';
  /** The lump sum, in dollars, in the basis `pricesIncludeGst` says (or the document's). */
  price?: number;
  /** Customer-facing scope text under the line, when the tradie gave one. */
  scope?: string;
  /** Only when the tradie said inc/ex GST; otherwise the document's own basis. */
  pricesIncludeGst?: boolean;
}

/**
 * Change a line that is already on the quote — its price, its quantity, or
 * its name.
 *
 * Added because Mate could add a line and delete a line but not correct one,
 * and the gap surfaced badly in a real conversation: the tradie said "let's
 * just add it for $100" about an unpriced row and was told twice to go and
 * type it in himself. He asked again — "no, you do it" — and got refused
 * again. Adding and deleting without editing is a strange place to stop.
 */
export interface UpdateLineItemProposal extends BaseProposal {
  type: 'propose_update_line_item';
  quoteId: string;
  materialId: string;
  /** New per-unit price. Setting this marks the row as manually priced. */
  price?: number;
  quantity?: number;
  name?: string;
  /** For the card, so the tradie sees what is changing and from what. */
  displayName?: string;
  displayCurrentPrice?: number;
  displayCurrentQty?: number;
  displayUnit?: string;
  /**
   * The row is a lump-sum work item, so `price` is the line total and the
   * quantity means nothing. Stamped by the validator when the document is
   * visible to it; the card drops "per unit" and the apply path keeps the
   * lump-sum shape.
   */
  lumpSum?: boolean;
}

/**
 * Set the document's customer-facing total to a figure the tradie said.
 *
 * "Make the total one thousand two hundred and thirty-two" is how tradies
 * price a job; before this Mate could only get there through markup and
 * rates, and read out two different wrong totals on the way (3 Sep 2026).
 * The mechanism (labour absorbs it, or a lump-sum "Price adjustment" line)
 * lives in utils/setTotal.ts; `preview` is that plan as the validator saw the
 * document, for the card — the apply path re-plans against the live one.
 */
export interface SetTotalProposal extends BaseProposal {
  type: 'propose_set_total';
  quoteId: string;
  /** What the customer will read at the bottom of the document. */
  targetTotal: number;
  displayName?: string;
  preview?: {
    currentTotal: number;
    mechanism: 'labour' | 'adjustment' | 'none';
    labourBefore?: number;
    labourAfter?: number;
    /** The adjustment line's price after the move. */
    adjustment?: number;
  };
}

/**
 * Open the phone's contact picker and put the pick on a quote, or hand it to
 * Mate for the draft in hand. "Access contacts" said to voice Mate used to go
 * nowhere — find_customer reads the phone book only when access is already
 * on, and a phone-book hit could not be applied.
 */
export interface PickContactProposal extends BaseProposal {
  type: 'propose_pick_contact';
  /** The quote or invoice whose customer the pick becomes. Absent = for the draft Mate is building. */
  quoteId?: string;
  displayName?: string;
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
  // Display-only. The prompt and the tool schema both promise the card shows
  // "recipient + total"; without this it only ever showed the recipient, so
  // the tradie was approving a send with no figure in front of them.
  displayTotal?: number;
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

/**
 * Change the scope of a quote that already exists — name, description, hours
 * — and re-run materials + pricing on it. Before this tool, the only way to
 * change a scope after Apply was propose_draft_quote again, which minted a
 * second quote for the same job (Overton x2, Lee-Anne x2, Aug/Sep 2026).
 * At least one of the three fields must be present; the validator enforces it.
 */
export interface UpdateQuoteScopeProposal extends BaseProposal {
  type: 'propose_update_quote_scope';
  quoteId: string;
  jobName?: string;
  jobDescription?: string;
  estimatedDurationHours?: number;
  /** Display-only — names the quote on the card without a round-trip. */
  displayName?: string;
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

// Read a supplier's price list into the tradie's own book. Every field is
// optional on the wire so the card can never dead-end on a missing argument —
// the validator fills the gaps and the screen asks for whatever's left.
export interface ImportSupplierListProposal extends BaseProposal {
  type: 'propose_import_supplier_list';
  supplierName?: string;
  /** Where the list is coming from. 'ask' lets the screen offer the choices. */
  source: 'attachment' | 'camera' | 'gallery' | 'pdf' | 'spreadsheet' | 'ask';
  /** Why it came up — display + telemetry only. */
  reason?: 'no_retail_coverage' | 'pricing_fell_back' | 'tradie_asked';
  /** Up to 5 rows the pipeline couldn't price off the book, for the card body. */
  missedItems?: string[];
}

export type Proposal =
  | DraftQuoteProposal
  | AddLineItemProposal
  | DeleteLineItemProposal
  | UpdateLineItemProposal
  | DeleteQuoteProposal
  | CreateContactProposal
  | UpdateCustomerProposal
  | SendQuoteProposal
  | ConvertToInvoiceProposal
  | RepriceQuoteProposal
  | UpdateQuoteRatesProposal
  | UpdateQuoteScopeProposal
  | MarkPaidProposal
  | ImportSupplierListProposal
  | RememberPreferenceProposal
  | SaveRateProposal
  | SetTotalProposal
  | PickContactProposal;

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

/**
 * The in-chat state of one supplier-list import.
 *
 * Kept tiny on purpose — counts and at most three sample names. It's mirrored
 * to Firestore with the rest of the conversation, and a 400-row extraction
 * would be a 400-row write on every flush. The full ExtractResult lives in a
 * ref on the chat screen, which has the same lifetime as the (in-memory)
 * history, so a resurrected card reads 'expired' rather than lying.
 */
export interface SupplierImportCard {
  importId: string;
  phase: 'extracting' | 'ready' | 'saved' | 'failed' | 'expired';
  supplierName?: string;
  itemCount?: number;
  sampleNames?: string[];
  savedCount?: number;
  /** Rows on the quote in hand that now price off the tradie's own list. */
  coveredRows?: number;
  error?: string;
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
  | { type: 'open_quote'; quoteId: string }
  | { type: 'open_supplier_review'; importId: string }
  /** Re-drive a failed turn into the same bubble. The user's message never
   *  left the conversation, so no payload is needed — dropped signal must
   *  not eat what the tradie typed. */
  | { type: 'retry_send' };

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
  // Flagged rows from the pricing pass, rendered as a list under the text —
  // one line per row with the money, the name and a plain reason. The
  // one-sentence QuoteReview.summary stays for voice and "[context]" notes.
  review?: ChatReviewBlock;
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
  /**
   * Set on the streaming assistant bubble while a turn is in flight, and
   * cleared the moment real text arrives. Carries a short line describing what
   * Mate is actually doing right now (built from its tool calls — never from
   * model reasoning). Without this the placeholder rendered as an empty grey
   * blob for the whole wait, alongside a second "thinking" row underneath.
   */
  thinking?: string;
  // Photos attached to this bubble. Metadata only — the bytes are read from
  // localUri at send time, never stored here (see ChatAttachment).
  attachments?: ChatAttachment[];
  // When present, the bubble renders the supplier-list import card.
  supplierImport?: SupplierImportCard;
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
  // Cards the model confirmed/cancelled in words via the control tools
  // (typed "yes"/"nah"). The screen resolves each exactly as its button tap
  // would, once the turn resolves.
  controlActions?: Array<{ decision: 'apply' | 'cancel'; messageId: string; proposalId: string }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    model: string;
    escalated: boolean;
  };
}
