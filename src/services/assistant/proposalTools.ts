// Mate proposal-tool validators — the client-side source of truth (no
// server-side copy). These don't mutate state; they turn a tool-call payload
// into a typed Proposal that the chat surface renders as a confirmation card.
// The store's applyProposal() is the only path that touches data.

import {
  AddLineItemProposal,
  ConvertToInvoiceProposal,
  CreateContactProposal,
  DeleteLineItemProposal,
  UpdateLineItemProposal,
  DeleteQuoteProposal,
  DraftQuoteProposal,
  ImportSupplierListProposal,
  MarkPaidProposal,
  PickContactProposal,
  Proposal,
  RememberPreferenceProposal,
  RepriceQuoteProposal,
  SaveRateProposal,
  SendQuoteProposal,
  SetTotalProposal,
  UpdateCustomerProposal,
  UpdateQuoteRatesProposal,
  UpdateQuoteScopeProposal,
} from '../../types/assistant';
import type { Material, RateLine } from '../../types';
import { resolveQuoteId } from './quoteRefMap';
import { resolveKnownQuoteId } from './showQuoteGate';
import { isPricingInFlight } from './pricingInFlight';
import { canUpdateScope } from './scopeEditable';
import { sanitizeJobDescription } from '../../utils/sanitizeJobDescription';
import { MAX_LABEL_CHARS, RATE_CARD_UNITS, normalisePreference, normaliseRateUnit } from '../quotingProfile';
import { planSetTotal, setTotalGstMode, type SetTotalSource } from '../../utils/setTotal';
import { phoneForRecord } from '../../utils/auPhone';
import { formatCurrency, roundToTwoDecimals } from '../../utils/documentCalculator';
import { isWorkItem } from '../../../shared/document/lumpSum';
import { resolveCustomerDraftRef } from './readTools';

/** Whitespace-folded, trimmed, capped — for text that lands in the prompt on every turn. */
const shortText = (v: unknown): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_CHARS) : '';

/** Most rate lines a draft can carry — a job with more than this is not one rate card job. */
const MAX_RATE_LINES = 10;

/**
 * Validate the draft's rateLines. Returns the clean lines, or a message that
 * names the first problem so the model can fix its call rather than guess.
 */
function parseRateLines(raw: unknown): { lines?: RateLine[]; error?: string } {
  if (raw === undefined || raw === null) return { lines: undefined };
  if (!Array.isArray(raw)) return { error: 'rateLines must be an array of {label, quantity, unit, unitPrice, includesMaterials}.' };
  if (raw.length === 0) return { lines: undefined };
  if (raw.length > MAX_RATE_LINES) return { error: `rateLines: at most ${MAX_RATE_LINES} lines.` };
  const lines: RateLine[] = [];
  for (const [i, item] of (raw as Array<Record<string, unknown>>).entries()) {
    const label = shortText(item?.label);
    if (!label) return { error: `rateLines[${i}] needs a label — what the rate is for.` };
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { error: `rateLines[${i}] "${label}": quantity must be above zero — ask the tradie for it rather than guessing.` };
    }
    const unit = normaliseRateUnit(item.unit);
    if (!unit) return { error: `rateLines[${i}] "${label}": unit must be one of ${RATE_CARD_UNITS.join(', ')}.` };
    const unitPrice = Number(item.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return { error: `rateLines[${i}] "${label}": unitPrice must be above zero.` };
    if (typeof item.includesMaterials !== 'boolean') {
      return { error: `rateLines[${i}] "${label}": includesMaterials must be true (the rate is the whole price) or false (labour only).` };
    }
    lines.push({
      label,
      quantity,
      unit,
      unitPrice,
      includesMaterials: item.includesMaterials,
      ...(typeof item.pricesIncludeGst === 'boolean' ? { pricesIncludeGst: item.pricesIncludeGst } : {}),
    });
  }
  // All-in and labour-only rates cannot share a draft: the labour-only line
  // would send the pipeline off generating the very materials the all-in
  // line already covers, and the customer would pay for them twice.
  const inclusive = lines.filter((l) => l.includesMaterials).length;
  if (inclusive > 0 && inclusive < lines.length) {
    return {
      error:
        'rateLines must all include materials or all be labour only — a supply-and-fit rate and a labour rate on one draft would price the materials twice. Split the job or pick one.',
    };
  }
  return { lines };
}

export interface ProposalResult {
  proposal?: Proposal;
  error?: string;
  /** Rides back to the model with the ok — something it must tell the tradie or act on. */
  note?: string;
}

/**
 * The document a quote-targeting proposal is about, as the screen can see it
 * right now. Registered by the chat screen (same pattern as the renderable-
 * quote probe) so a validator can plan against the real figures inside the
 * turn: a set-total below the materials is refused before a card goes up, and
 * the card shows what will move rather than just the target. No probe (tests,
 * screen unmounted) → the card carries the target alone and Apply plans.
 */
export type ProposalDocumentSnapshot = SetTotalSource & { materials?: Material[] };
let documentProbe: ((quoteId: string) => ProposalDocumentSnapshot | null) | null = null;

export function setProposalDocumentProbe(probe: ((quoteId: string) => ProposalDocumentSnapshot | null) | null): void {
  documentProbe = probe;
}

/**
 * Whether this device can open a contact picker at all. The web app can't,
 * and a card whose only button can fail is worse than no card — refused here
 * so Mate asks for the name instead. No probe registered = available.
 */
let contactPickerProbe: (() => boolean) | null = null;

export function setContactPickerProbe(probe: (() => boolean) | null): void {
  contactPickerProbe = probe;
}

/**
 * One job, one quote. The drafts this conversation has already applied, and
 * whether a scope-update card is still waiting on one of them. Registered by
 * the screen (it holds the messages and the proposal → quote map). One
 * smoke-alarm job became THREE applied drafts (3 Sep 2026): the model
 * re-drafted for a brand and again for a phone number, despite
 * propose_update_quote_scope — its one scope card sat pending, untapped.
 * The validator refuses the repeat inside the turn and says which tool to use.
 */
export interface AppliedDraft {
  quoteId: string;
  jobName: string;
  customerId?: string;
  customerName?: string;
  /**
   * The minted quote's status. Once it leaves 'draft' the scope tool refuses
   * it, so this guard must let a fresh draft through or there is no way
   * forward at all — see scopeEditable.
   */
  status?: string;
}
let appliedDraftsProbe: (() => AppliedDraft[]) | null = null;
let pendingScopeUpdateProbe: ((quoteId: string) => boolean) | null = null;

export function setAppliedDraftsProbe(probe: (() => AppliedDraft[]) | null): void {
  appliedDraftsProbe = probe;
}

export function setPendingScopeUpdateProbe(probe: ((quoteId: string) => boolean) | null): void {
  pendingScopeUpdateProbe = probe;
}

const nameKey = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

// Words that name what a quote IS rather than what it is FOR. "Air con
// install" and "Smoke alarm install" share "install"; they are two jobs.
const GENERIC_JOB_WORDS = new Set([
  'install', 'installation', 'installing', 'fit', 'fitting', 'fitout', 'replace', 'replacement', 'replacing', 'repair', 'repairs',
  'supply', 'new', 'job', 'quote', 'invoice', 'work', 'works', 'the', 'and', 'for', 'with', 'from', 'off', 'out', 'rear', 'front',
]);

/** The words a job name is about — lower-cased, three letters or more, not generic. */
function jobWords(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !GENERIC_JOB_WORDS.has(w));
}

const sameWord = (a: string, b: string): boolean =>
  a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

/**
 * Whether two job names describe one job. Half or more of the shorter name's
 * meaningful words have to appear in the other (a plural or a stem counts);
 * a single shared common word never does. "Fire detectors - Red Dot" and
 * "Smoke detector install" are both the one "Install fire detectors" job;
 * "Air con install" is not.
 */
export function jobNamesLookAlike(a: string, b: string): boolean {
  const wa = jobWords(a);
  const wb = jobWords(b);
  if (!wa.length || !wb.length) return false;
  const [shorter, longer] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  const shared = shorter.filter((w) => longer.some((o) => sameWord(w, o))).length;
  return shared >= Math.ceil(shorter.length / 2);
}

/**
 * The applied draft a new propose_draft_quote is really a correction of:
 * the same customer — by contact id or by name, whichever both sides have —
 * and a job name that describes the same job. A second, different job for
 * the same customer ("and her fence") does not match.
 */
export function findRepeatedDraft(
  applied: AppliedDraft[],
  next: { customerId?: string; customerName?: string; jobName: string },
): AppliedDraft | undefined {
  const nextName = nameKey(next.customerName);
  return applied.find((prior) => {
    // A sent quote cannot take a scope change, so a second document is the
    // only way to quote the revised job. Blocking the draft here left the
    // tradie with nothing but the manual wizard.
    if (!canUpdateScope(prior.status)) return false;
    const sameCustomer =
      (!!next.customerId && !!prior.customerId && next.customerId === prior.customerId) ||
      (!!nextName && nameKey(prior.customerName) === nextName);
    if (!sameCustomer) return false;
    return jobNamesLookAlike(next.jobName, prior.jobName);
  });
}

type CustomerDraft = { name: string; phone?: string; email?: string; address?: string };

/**
 * A customer draft the model built, with the phone kept only when it is a
 * whole Australian number. Voice hands numbers over in chunks and the model
 * pads what is missing; a padded number on the contact is worse than none.
 * A draft resolved from a find_customer draftRef is the phone book's own
 * record — its number is a fact, not something the model heard, so it is
 * kept as-is (an international number or an extension is fine there).
 */
function cleanCustomerDraft(raw: any, opts: { trustPhone?: boolean } = {}): { draft?: CustomerDraft; note?: string } {
  const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
  if (!name) return {};
  const rawPhone = typeof raw.phone === 'string' ? raw.phone.trim() : '';
  const { phone, dropped } = opts.trustPhone ? { phone: rawPhone || undefined, dropped: undefined } : phoneForRecord(rawPhone);
  const email = typeof raw.email === 'string' && raw.email.trim() ? raw.email.trim() : undefined;
  const address = typeof raw.address === 'string' && raw.address.trim() ? raw.address.trim() : undefined;
  return {
    draft: { name, ...(phone ? { phone } : {}), ...(email ? { email } : {}), ...(address ? { address } : {}) },
    note: dropped
      ? `The phone "${dropped}" was left off — it isn't a whole Australian number. Tell the tradie in one line that you couldn't get a whole number and left it off; do NOT ask for the rest again.`
      : undefined,
  };
}

/**
 * The customer for a draft or a re-point: a saved contact id, a draftRef from
 * find_customer (details held on the device), or a draft the model wrote.
 */
function resolveCustomer(input: any): { customerId?: string; draft?: CustomerDraft; note?: string; error?: string } {
  if (input?.customerId) return { customerId: String(input.customerId) };
  if (input?.customerDraftRef) {
    const held = resolveCustomerDraftRef(input.customerDraftRef);
    if (!held) {
      return { error: `customerDraftRef "${input.customerDraftRef}" is not one find_customer returned in this session — call find_customer again and use the draftRef it gives you, or pass customerDraft.` };
    }
    const address = typeof input.customerDraft?.address === 'string' ? input.customerDraft.address : undefined;
    return cleanCustomerDraft({ ...held, ...(address ? { address } : {}) }, { trustPhone: true });
  }
  const cleaned = cleanCustomerDraft(input?.customerDraft);
  if (!cleaned.draft) return { error: 'Provide customerId (from find_customer), customerDraftRef (from a phone or recent hit), or customerDraft.name.' };
  return cleaned;
}

// Customer details are not scope: the jobDescription prints on the customer's
// document. A real scope update carried "New customer details. Full Name: …
// Phone number: …" (3 Sep 2026); this sends it to the right tool instead.
const CONTACT_DETAILS_IN_SCOPE = /\b(?:new customer details|customer details|full name|phone number|email address)\s*:/i;

// Placeholders the model leaves in a customer email when it never fetched the
// real figure or business name. One went out reading "Total materials: $X".
const EMAIL_PLACEHOLDER = /\$[XYZ]\b|\[(?:business name|name|customer name|total)\]|<(?:business|name)>|\{(?:business|name)\}/i;

function newProposalId(): string {
  return `prop_${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// A quote-targeting proposal must name a quote that actually exists on this
// device, or the card it renders can only fail on Apply — after the model has
// already promised the change out loud. The birdhouse convo (25 Aug 2026) had
// the model INVENT "quote_pending_<ts>" for a draft nobody had applied, then
// spend six turns telling the tradie to fix it manually. Failing the tool
// call in-turn hands the model its recovery path instead. Uses the same
// screen-registered lookup as show_quote; no probe registered (tests, screen
// unmounted) keeps the old pass-through.
function requireKnownQuote(toolName: string, input: any): { quoteId?: string; error?: string } {
  if (!input?.quoteId) return { error: `${toolName} requires quoteId.` };
  const resolved = resolveQuoteId(String(input.quoteId));
  const known = resolveKnownQuoteId(resolved);
  if (known) return { quoteId: known };
  return {
    error:
      `No quote with id "${resolved}" exists on this phone — never invent a quoteId. ` +
      'If the draft card has not been applied yet there is no quote to change: call propose_draft_quote again with the corrected details and the fresh card replaces the old one. ' +
      'For a saved quote, call list_recent_quotes and use the id it returns.',
  };
}

// Whether the chat still holds a photo nobody has spent. Registered by the
// screen rather than imported, same pattern as quoteRefMap — the validator
// must stay free of the store graph, and Mate never names an attachment id.
let unconsumedAttachmentProbe: () => boolean = () => false;

export function setUnconsumedAttachmentProbe(probe: () => boolean): void {
  unconsumedAttachmentProbe = probe;
}

const IMPORT_SOURCES = ['attachment', 'camera', 'gallery', 'pdf', 'spreadsheet', 'ask'] as const;
const IMPORT_REASONS = ['no_retail_coverage', 'pricing_fell_back', 'tradie_asked'] as const;
const MAX_MISSED_ITEMS = 5;

export function buildProposal(toolName: string, toolUseId: string, input: any): ProposalResult {
  const now = new Date().toISOString();
  const id = newProposalId();

  switch (toolName) {
    case 'propose_draft_quote': {
      if (!input?.jobName) return { error: 'propose_draft_quote requires jobName.' };
      if (!input?.jobDescription || String(input.jobDescription).trim().length < 10) {
        return {
          error:
            'propose_draft_quote requires a real jobDescription — the pipeline needs the scope to generate materials.',
        };
      }
      const customer = resolveCustomer(input);
      if (customer.error) return { error: customer.error };
      if (CONTACT_DETAILS_IN_SCOPE.test(String(input.jobDescription))) {
        return { error: "jobDescription is the work, and it prints on the customer's document — customer details go in customerDraft, never in the scope." };
      }
      const repeated = findRepeatedDraft(appliedDraftsProbe?.() ?? [], {
        customerId: customer.customerId,
        customerName: customer.draft?.name,
        jobName: String(input.jobName),
      });
      if (repeated) {
        if (pendingScopeUpdateProbe?.(repeated.quoteId)) {
          return {
            error:
              `Quote ${repeated.quoteId} ("${repeated.jobName}") already exists for this job and an "Update scope" card for it is still waiting. ` +
              `Don't draft again: tell the tradie to tap "Update it" on that card (or call apply_pending_proposal on a yes), then fold any further change into it with propose_update_quote_scope.`,
          };
        }
        return {
          error:
            `Quote ${repeated.quoteId} ("${repeated.jobName}") already exists for this customer in this conversation — drafting again mints a second quote for the same job. ` +
            `Put the change on it with propose_update_quote_scope (the full corrected description) or propose_update_customer. ` +
            `Only if this is genuinely a different job, give it a different jobName and call propose_draft_quote again.`,
        };
      }
      const rateLines = parseRateLines(input.rateLines);
      if (rateLines.error) return { error: rateLines.error };
      const proposal: DraftQuoteProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_draft_quote',
        customerId: customer.customerId,
        customerDraft: customer.draft,
        jobName: String(input.jobName),
        // The description prints on the customer's quote — strip any Mate
        // conversation the model concatenated onto the scope ("what's their
        // name and phone number… customer name is tarik", QU-178342).
        jobDescription: sanitizeJobDescription(String(input.jobDescription)).text,
        estimatedDurationHours:
          Number.isFinite(Number(input.estimatedDurationHours)) && Number(input.estimatedDurationHours) > 0
            ? Number(input.estimatedDurationHours)
            : undefined,
        documentType: input.documentType === 'invoice' ? 'invoice' : 'quote',
        ...(input.materialsMode === 'labour_only' ? { materialsMode: 'labour_only' as const } : {}),
        ...(rateLines.lines ? { rateLines: rateLines.lines } : {}),
      };
      return { proposal, note: customer.note };
    }

    case 'propose_remember_preference': {
      const text = normalisePreference(input?.text);
      if (!text) {
        return { error: 'propose_remember_preference needs text: one plain sentence in the tradie\'s words, under 160 characters.' };
      }
      const proposal: RememberPreferenceProposal = { id, toolUseId, createdAt: now, type: 'propose_remember_preference', text };
      return { proposal };
    }

    case 'propose_save_rate': {
      const label = shortText(input?.label);
      if (!label) return { error: 'propose_save_rate needs a label — what the rate is for.' };
      const unit = normaliseRateUnit(input?.unit);
      if (!unit) return { error: `propose_save_rate needs unit as one of ${RATE_CARD_UNITS.join(', ')}.` };
      const rate = Number(input?.rate);
      if (!Number.isFinite(rate) || rate <= 0) return { error: 'propose_save_rate needs rate above zero.' };
      if (typeof input?.includesMaterials !== 'boolean') {
        return { error: 'propose_save_rate needs includesMaterials: true when the rate is the whole price, false when materials are charged on top.' };
      }
      const proposal: SaveRateProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_save_rate',
        label,
        unit,
        rate: Math.round(rate * 100) / 100,
        includesMaterials: input.includesMaterials,
        ...(typeof input.pricesIncludeGst === 'boolean' ? { pricesIncludeGst: input.pricesIncludeGst } : {}),
        ...(shortText(input.notes) ? { notes: shortText(input.notes) } : {}),
      };
      return { proposal };
    }

    case 'propose_update_quote_scope': {
      const known = requireKnownQuote('propose_update_quote_scope', input);
      if (known.error) return { error: known.error };
      const jobName = typeof input.jobName === 'string' && input.jobName.trim() ? String(input.jobName).trim() : undefined;
      const rawDescription = typeof input.jobDescription === 'string' ? String(input.jobDescription) : '';
      if (CONTACT_DETAILS_IN_SCOPE.test(rawDescription)) {
        return {
          error:
            "That's customer details, not scope — the jobDescription prints on the customer's document. To change who the quote is for, or their phone, email or address, use propose_update_customer.",
        };
      }
      const jobDescription = rawDescription.trim() ? sanitizeJobDescription(rawDescription).text : undefined;
      if (rawDescription.trim() && (!jobDescription || jobDescription.trim().length < 10)) {
        return {
          error:
            'propose_update_quote_scope needs the FULL corrected jobDescription — the pipeline regenerates the materials from it.',
        };
      }
      const hours =
        Number.isFinite(Number(input.estimatedDurationHours)) && Number(input.estimatedDurationHours) > 0
          ? Number(input.estimatedDurationHours)
          : undefined;
      if (jobName === undefined && jobDescription === undefined && hours === undefined) {
        return { error: 'propose_update_quote_scope needs at least one of jobName, jobDescription or estimatedDurationHours.' };
      }
      // Two pipelines on one quote would race each other's saves. Refuse
      // in-turn so Mate tells the tradie it'll fold the change in once pricing
      // lands, then proposes it after the "[context]" line says it finished.
      if (isPricingInFlight(known.quoteId!)) {
        return {
          error:
            `Quote ${known.quoteId} is still being priced. Tell the tradie you'll fold the change in once pricing lands (one short line), and call propose_update_quote_scope only after the "[context]" line says pricing finished.`,
        };
      }
      const proposal: UpdateQuoteScopeProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_update_quote_scope',
        quoteId: known.quoteId!,
        jobName,
        jobDescription,
        estimatedDurationHours: hours,
        displayName: input.displayName ? String(input.displayName) : undefined,
      };
      return { proposal };
    }

    case 'propose_update_quote_rates': {
      const known = requireKnownQuote('propose_update_quote_rates', input);
      if (known.error) return { error: known.error };
      const num = (v: unknown): number | undefined =>
        Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined;
      const markup = num(input.markup);
      const laborMarkup = num(input.laborMarkup);
      const laborRate = num(input.laborRate);
      const laborHours = num(input.laborHours);
      if (
        markup === undefined &&
        laborMarkup === undefined &&
        laborRate === undefined &&
        laborHours === undefined
      ) {
        return { error: 'Provide at least one of markup, laborMarkup, laborRate, or laborHours.' };
      }
      const proposal: UpdateQuoteRatesProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_update_quote_rates',
        quoteId: known.quoteId!,
        markup,
        laborMarkup,
        laborRate,
        laborHours,
        displayName: input.displayName ? String(input.displayName) : undefined,
      };
      return { proposal };
    }

    case 'propose_add_line_item': {
      const known = requireKnownQuote('propose_add_line_item', input);
      if (known.error) return { error: known.error };
      const hasPrice = input?.price !== undefined && input?.price !== null && input?.price !== '';
      if (hasPrice) {
        // Lump-sum form: a price the tradie said, minted as a work item — the
        // same shape the inline editor's Work item chip mints. No pipeline,
        // no markup, no quantity.
        const price = Number(input.price);
        if (!Number.isFinite(price)) return { error: 'price must be the line in dollars, as a number.' };
        if (price < 0) return { error: 'A lump sum can\'t be negative — to bring the total down, use propose_set_total.' };
        // No falling back to searchTerm: a price beside a material search is
        // the model mixing the two forms, and a $0 lump sum minted from a
        // material would be a $0 row on the customer's document.
        const label = shortText(input.label);
        if (!label) {
          return { error: 'A lump-sum line needs label + price. A material takes searchTerm + qty + unit and no price — the pricing engine prices it.' };
        }
        const scope = shortText(input.scope);
        const proposal: AddLineItemProposal = {
          id,
          toolUseId,
          createdAt: now,
          type: 'propose_add_line_item',
          quoteId: known.quoteId!,
          searchTerm: label,
          qty: 1,
          unit: 'each',
          kind: 'work',
          price: roundToTwoDecimals(price),
          ...(scope ? { scope } : {}),
          ...(typeof input.pricesIncludeGst === 'boolean' ? { pricesIncludeGst: input.pricesIncludeGst } : {}),
          section: input.section ? String(input.section) : undefined,
        };
        return { proposal };
      }
      if (!input?.searchTerm) {
        return { error: 'propose_add_line_item needs searchTerm + qty + unit for a material the pipeline prices, or label + price for a lump sum at a price the tradie said.' };
      }
      const proposal: AddLineItemProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_add_line_item',
        quoteId: known.quoteId!,
        searchTerm: String(input.searchTerm),
        qty: Number(input.qty) || 1,
        unit: String(input.unit || 'each'),
        section: input.section ? String(input.section) : undefined,
      };
      return { proposal };
    }

    case 'propose_set_total': {
      const known = requireKnownQuote('propose_set_total', input);
      if (known.error) return { error: known.error };
      const target = Number(input.targetTotal);
      if (!Number.isFinite(target) || target <= 0) {
        return { error: 'propose_set_total needs targetTotal — the dollar figure the tradie said, above zero.' };
      }
      if (isPricingInFlight(known.quoteId!)) {
        return {
          error: `Quote ${known.quoteId} is still being priced — its total isn't real yet. Tell the tradie you'll set it once pricing lands, and call propose_set_total after the "[context]" line that says pricing finished.`,
        };
      }
      const snapshot = documentProbe?.(known.quoteId!) ?? null;
      let preview: SetTotalProposal['preview'];
      if (snapshot) {
        const planned = planSetTotal(snapshot, target);
        if (!planned.ok) {
          return {
            error:
              planned.reason === 'below_materials'
                ? `${planned.message} Tell the tradie that in one line and ask what they'd like the total to be instead — don't put a card up.`
                : planned.message,
          };
        }
        const plan = planned.plan;
        if (plan.mechanism === 'none') {
          return { error: `The total is already ${formatCurrency(plan.currentTotal)} — say so in one line, there's nothing to change.` };
        }
        const gstMode = setTotalGstMode(snapshot);
        preview =
          plan.mechanism === 'labour'
            ? { currentTotal: plan.currentTotal, mechanism: 'labour', gstMode }
            : { currentTotal: plan.currentTotal, mechanism: 'adjustment', adjustment: plan.amount, gstMode };
      }
      const proposal: SetTotalProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_set_total',
        quoteId: known.quoteId!,
        targetTotal: roundToTwoDecimals(target),
        displayName: input.displayName ? String(input.displayName) : undefined,
        ...(preview ? { preview } : {}),
      };
      return { proposal };
    }

    case 'propose_pick_contact': {
      if (contactPickerProbe && !contactPickerProbe()) {
        return {
          error: "There's no contact picker in the web app. Ask the tradie for the customer's name and use find_customer — don't put a card up.",
        };
      }
      let quoteId: string | undefined;
      if (input?.quoteId) {
        const known = requireKnownQuote('propose_pick_contact', input);
        if (known.error) return { error: known.error };
        quoteId = known.quoteId;
      }
      const proposal: PickContactProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_pick_contact',
        ...(quoteId ? { quoteId } : {}),
        displayName: input?.displayName ? String(input.displayName) : undefined,
      };
      return { proposal };
    }

    case 'propose_delete_quote': {
      const known = requireKnownQuote('propose_delete_quote', input);
      if (known.error) return { error: known.error };
      const docType = input.displayDocType === 'invoice' ? 'invoice' : input.displayDocType === 'quote' ? 'quote' : undefined;
      const proposal: DeleteQuoteProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_delete_quote',
        quoteId: known.quoteId!,
        displayName: input.displayName ? String(input.displayName) : undefined,
        displayCustomerName: input.displayCustomerName ? String(input.displayCustomerName) : undefined,
        displayTotal: Number.isFinite(Number(input.displayTotal)) ? Number(input.displayTotal) : undefined,
        displayDocType: docType,
      };
      return { proposal };
    }

    case 'propose_update_line_item': {
      const known = requireKnownQuote('propose_update_line_item', input);
      if (known.error) return { error: known.error };
      if (!input?.materialId) {
        return { error: 'propose_update_line_item requires materialId — call get_quote first to get it.' };
      }
      const price = Number(input.price);
      const quantity = Number(input.quantity);
      const hasPrice = input.price !== undefined && Number.isFinite(price);
      const hasQty = input.quantity !== undefined && Number.isFinite(quantity);
      const hasName = typeof input.name === 'string' && input.name.trim().length > 0;
      if (!hasPrice && !hasQty && !hasName) {
        return { error: 'propose_update_line_item needs at least one of price, quantity or name to change.' };
      }
      // A negative price or quantity is never what the tradie meant, and both
      // flow straight into the customer-facing total.
      if (hasPrice && price < 0) return { error: 'Price cannot be negative.' };
      if (hasQty && quantity <= 0) {
        return { error: 'Quantity must be above zero — to take the line off, use propose_delete_line_item.' };
      }
      // A lump-sum row has no quantity to change: its price is the line.
      const row = documentProbe?.(known.quoteId!)?.materials?.find((m) => m.id === String(input.materialId));
      const lumpSum = row ? isWorkItem(row) : false;
      if (lumpSum && hasQty && !hasPrice && !hasName) {
        return { error: `"${row!.name}" is a lump sum — it has no quantity. Set its price (the whole line) instead.` };
      }
      const proposal: UpdateLineItemProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_update_line_item',
        quoteId: known.quoteId!,
        materialId: String(input.materialId),
        ...(hasPrice ? { price } : {}),
        ...(hasQty && !lumpSum ? { quantity } : {}),
        ...(hasName ? { name: String(input.name).trim() } : {}),
        displayName: input.displayName ? String(input.displayName) : lumpSum ? row!.name : undefined,
        displayCurrentPrice: Number.isFinite(Number(input.displayCurrentPrice)) ? Number(input.displayCurrentPrice) : lumpSum ? row!.price : undefined,
        displayCurrentQty: Number.isFinite(Number(input.displayCurrentQty)) && !lumpSum ? Number(input.displayCurrentQty) : undefined,
        displayUnit: input.displayUnit && !lumpSum ? String(input.displayUnit) : undefined,
        ...(lumpSum ? { lumpSum: true } : {}),
      };
      return { proposal };
    }

    case 'propose_delete_line_item': {
      const known = requireKnownQuote('propose_delete_line_item', input);
      if (known.error) return { error: known.error };
      if (!input?.materialId) {
        return { error: 'propose_delete_line_item requires materialId — fetch the quote first to get it.' };
      }
      const proposal: DeleteLineItemProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_delete_line_item',
        quoteId: known.quoteId!,
        materialId: String(input.materialId),
        displayName: input.displayName ? String(input.displayName) : undefined,
        displayQty: Number.isFinite(Number(input.displayQty)) ? Number(input.displayQty) : undefined,
        displayUnit: input.displayUnit ? String(input.displayUnit) : undefined,
        displayTotal: Number.isFinite(Number(input.displayTotal)) ? Number(input.displayTotal) : undefined,
      };
      return { proposal };
    }

    case 'propose_create_contact': {
      const cleaned = cleanCustomerDraft(input);
      if (!cleaned.draft) return { error: 'propose_create_contact requires name.' };
      const proposal: CreateContactProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_create_contact',
        name: cleaned.draft!.name,
        phone: cleaned.draft!.phone,
        email: cleaned.draft!.email,
        address: cleaned.draft!.address,
      };
      return { proposal, note: cleaned.note };
    }

    case 'propose_update_customer': {
      const known = requireKnownQuote('propose_update_customer', input);
      if (known.error) return { error: known.error };
      const customer = resolveCustomer(input);
      if (customer.error) return { error: customer.error };
      const customerName = typeof input.customerName === 'string' && input.customerName.trim() ? input.customerName.trim() : customer.draft?.name;
      const proposal: UpdateCustomerProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_update_customer',
        quoteId: known.quoteId!,
        customerId: customer.customerId,
        customerDraft: customer.draft,
        customerName,
      };
      return { proposal, note: customer.note };
    }

    case 'propose_send_quote': {
      const known = requireKnownQuote('propose_send_quote', input);
      if (known.error) return { error: known.error };
      const emailText = `${input.draftEmailSubject ?? ''}\n${input.draftEmailBody ?? ''}`;
      const placeholder = EMAIL_PLACEHOLDER.exec(emailText);
      if (placeholder) {
        return {
          error: `The email has a placeholder in it ("${placeholder[0]}") and it goes to the customer. Put the real figure from get_quote or the business name from get_business_defaults in its place, or leave that line out, then call propose_send_quote again.`,
        };
      }
      const proposal: SendQuoteProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_send_quote',
        quoteId: known.quoteId!,
        recipientEmail: input.recipientEmail ? String(input.recipientEmail) : undefined,
        displayTotal: Number.isFinite(Number(input.displayTotal)) ? Number(input.displayTotal) : undefined,
        draftEmailBody: input.draftEmailBody ? String(input.draftEmailBody) : undefined,
        draftEmailSubject: input.draftEmailSubject ? String(input.draftEmailSubject) : undefined,
      };
      return { proposal };
    }

    case 'propose_convert_to_invoice': {
      const known = requireKnownQuote('propose_convert_to_invoice', input);
      if (known.error) return { error: known.error };
      const proposal: ConvertToInvoiceProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_convert_to_invoice',
        quoteId: known.quoteId!,
      };
      return { proposal };
    }

    case 'propose_reprice': {
      const known = requireKnownQuote('propose_reprice', input);
      if (known.error) return { error: known.error };
      const proposal: RepriceQuoteProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_reprice',
        quoteId: known.quoteId!,
        displayName: input.displayName ? String(input.displayName) : undefined,
        displayTotal: Number.isFinite(Number(input.displayTotal)) ? Number(input.displayTotal) : undefined,
      };
      return { proposal };
    }

    case 'propose_mark_paid': {
      const known = requireKnownQuote('propose_mark_paid', input);
      if (known.error) return { error: known.error };
      const allowed = ['cash', 'bank_transfer', 'card', 'cheque', 'other'] as const;
      const method = allowed.includes(input.method) ? input.method : undefined;
      const proposal: MarkPaidProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_mark_paid',
        quoteId: known.quoteId!,
        method,
        notes: input.notes ? String(input.notes) : undefined,
        displayName: input.displayName ? String(input.displayName) : undefined,
        displayCustomerName: input.displayCustomerName ? String(input.displayCustomerName) : undefined,
        displayTotal: Number.isFinite(Number(input.displayTotal)) ? Number(input.displayTotal) : undefined,
        displayBalance: Number.isFinite(Number(input.displayBalance)) ? Number(input.displayBalance) : undefined,
      };
      return { proposal };
    }

    case 'propose_import_supplier_list': {
      // Never errors. This card exists to unblock a tradie whose prices are
      // wrong; refusing it over a bad enum would be the worst possible moment
      // to be pedantic, so every field falls back to something usable.
      let source = (IMPORT_SOURCES as readonly string[]).includes(input?.source)
        ? (input.source as ImportSupplierListProposal['source'])
        : 'ask';
      // Mate can't see whether the photo it's thinking of is still going
      // spare — downgrade rather than open a picker that finds nothing.
      if (source === 'attachment' && !unconsumedAttachmentProbe()) source = 'ask';
      const missedItems = Array.isArray(input?.missedItems)
        ? input.missedItems
            .map((i: unknown) => String(i ?? '').trim())
            .filter(Boolean)
            .slice(0, MAX_MISSED_ITEMS)
        : undefined;
      const proposal: ImportSupplierListProposal = {
        id,
        toolUseId,
        createdAt: now,
        type: 'propose_import_supplier_list',
        supplierName: input?.supplierName ? String(input.supplierName).trim() || undefined : undefined,
        source,
        reason: (IMPORT_REASONS as readonly string[]).includes(input?.reason)
          ? (input.reason as ImportSupplierListProposal['reason'])
          : undefined,
        missedItems: missedItems?.length ? missedItems : undefined,
      };
      return { proposal };
    }

    default:
      return { error: `Unknown proposal tool: ${toolName}` };
  }
}
