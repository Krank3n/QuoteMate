// Gemini Live function declarations for Mate's tool ecosystem.
//
// These run entirely client-side — there is no server-side copy. Mate's
// tool-calling loop lives inside the Live WS session (see readTools.ts).
// Gemini's setup.tools format is `[{ functionDeclarations: FunctionDeclaration[] }]`
// where each declaration has `{ name, description, parameters }` and
// `parameters` is OpenAPI/JSON-Schema-ish — lowercase types, properties,
// required[].
//
// IMPORTANT: keep these names in lockstep with readTools.ts (executor) and
// proposalTools.ts (validator). Adding a name here without wiring it on
// either side leaves Mate emitting tool calls the dispatcher can't service.

import { NICHE_TEMPLATES } from '../../data/nicheTemplates';

// Every job type Mate knows, listed for the model so it can pick one by name
// instead of leaving a keyword matcher to guess. Built from the templates so
// a niche added tomorrow is offered without anyone remembering to list it.
const KNOWN_JOB_TYPE_LIST = NICHE_TEMPLATES.map((t) => t.name).join(', ');

export const READ_TOOL_NAMES = [
  'find_customer',
  'list_recent_quotes',
  'get_quote',
  'get_business_defaults',
  'review_quote',
  'get_job_requirements',
  'list_service_reports',
  'search_supplier_book',
] as const;

export const PROPOSAL_TOOL_NAMES = [
  'propose_draft_quote',
  'propose_add_line_item',
  'propose_delete_line_item',
  'propose_update_line_item',
  'propose_delete_quote',
  'propose_create_contact',
  'propose_update_customer',
  'propose_send_quote',
  'propose_convert_to_invoice',
  'propose_reprice',
  'propose_update_quote_rates',
  'propose_update_quote_scope',
  'propose_mark_paid',
  'propose_import_supplier_list',
  'propose_remember_preference',
  'propose_save_rate',
  'propose_set_total',
  'propose_pick_contact',
] as const;

// Voice-only control tools. Unlike read/proposal tools these never reach
// dispatchToolCall — the voice session intercepts them and hands the decision
// to the chat screen, which runs the same Apply / dismiss the card buttons do.
export const CONTROL_TOOL_NAMES = [
  'apply_pending_proposal',
  'cancel_pending_proposal',
] as const;

export type ReadToolName = (typeof READ_TOOL_NAMES)[number];
export type ProposalToolName = (typeof PROPOSAL_TOOL_NAMES)[number];
export type ControlToolName = (typeof CONTROL_TOOL_NAMES)[number];

export function isReadTool(name: string): name is ReadToolName {
  return (READ_TOOL_NAMES as readonly string[]).includes(name);
}

export function isProposalTool(name: string): name is ProposalToolName {
  return (PROPOSAL_TOOL_NAMES as readonly string[]).includes(name);
}

export function isControlTool(name: string): name is ControlToolName {
  return (CONTROL_TOOL_NAMES as readonly string[]).includes(name);
}

interface GeminiSchema {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  enum?: string[];
  items?: GeminiSchema;
}

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: GeminiSchema;
}

export const TOOL_DECLARATIONS: GeminiFunctionDeclaration[] = [
  {
    name: 'find_customer',
    description:
      "Search the tradie's saved contacts by name or phone. Fuzzy + phonetic: handles typos (Smyth/Smith), spelling variants (Catherine/Kathryn), and partial names (\"sar\" → Sarah Wilson). Phone search uses the last 8 digits. Returns up to 5 matches, each with contactId, name, phoneMasked (last 4), hasEmail, lastJob, matchType ('phone' | 'exact' | 'close' | 'fuzzy' | 'sounds_like'), and confidence (0–1). Top-level: confidence (best hit), ambiguous (top 2 are too close to call), needsConfirmation (true unless it's a clean phone/exact hit). When needsConfirmation is true you MUST read the match back to the tradie (name + ...last4 + last job) and wait for a yes before using its contactId — a wrong contact on a quote is worse than asking.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name fragment or phone number to search for.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_recent_quotes',
    description:
      "List the tradie's recent quotes and invoices, newest first. Returns id, customerName, jobName, total, status, type (quote|invoice), createdAt. Use this to answer \"what's pending?\" or to find a quote by approximate name. Pass `query` with whatever name the tradie used (job name, customer name, or both) — the tool fuzzy-matches against jobName + customerName (handles typos and STT slop like \"raise debt\" ↔ \"raised deck\"), so you rarely need to eyeball the full list yourself.",
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Optional fuzzy search over jobName + customerName. Pass whatever the tradie said ("raised deck", "Gigar", "raise debt"). Tolerates typos / STT noise within ~2 chars per token. Omit to just list recent.',
        },
        limit: { type: 'integer', description: 'Max rows to return (default 10, max 25).' },
        status: {
          type: 'string',
          enum: ['draft', 'sent', 'accepted', 'declined', 'paid', 'overdue'],
          description: 'Optional status filter.',
        },
        daysBack: { type: 'integer', description: 'Only include docs created within this many days.' },
      },
    },
  },
  {
    name: 'get_quote',
    description:
      'Fetch the full quote or invoice by id. Use this after find_customer or list_recent_quotes when you need line items, totals, recipient email, or status to answer a question or build a propose_* payload. Also your source when the tradie asks you to list the materials (read back the biggest lines by value), or names a line to remove/change — their wording may be speech-to-text slop, so match the closest line and read it back to confirm.',
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'string', description: 'Document id from list_recent_quotes or find_customer.' },
      },
      required: ['quoteId'],
    },
  },
  {
    name: 'show_quote',
    description:
      "Put a quote or invoice ON THE TRADIE'S SCREEN — renders it inline in the chat (job header, scope, materials, totals) so they can actually see it. This is the ONLY way to show a quote; get_quote just hands YOU the data, it shows the tradie nothing. Use this whenever the tradie wants to see, view, open, pull up, or 'show me' a quote. Pass the document id from list_recent_quotes / find_customer / get_quote — NOT a QU- number. After calling it, say one short line ('here it is') — don't recite the whole quote.",
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'string', description: 'Document id of the quote/invoice to display (from list_recent_quotes, find_customer, or get_quote).' },
      },
      required: ['quoteId'],
    },
  },
  {
    name: 'get_business_defaults',
    description:
      "Return the tradie's business defaults: trade category, default labour rate, default markup, GST inclusive flag, business name. Useful when drafting a quote and you need a sensible default.",
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'review_quote',
    description:
      "Check a priced quote for rows the pricing pipeline flagged — items with no price, rows priced off a product that barely matches the request, AI estimates that aren't real supplier prices, and low-confidence matches. Returns a compact summary plus the flagged rows (no full materials dump). Use this to answer \"anything look off / dodgy on QU-xxx?\" or before sending, and to decide whether to offer propose_reprice. Returns { summary, counts, issues[] } where each issue has kind ('unpriced' | 'weak_match' | 'estimated' | 'low_confidence'), name and a short detail. 'weak_match' is the most serious: a real supplier price for what may be the wrong product — always call those out by name.",
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'string', description: 'Document id from list_recent_quotes or find_customer.' },
      },
      required: ['quoteId'],
    },
  },
  {
    name: 'get_job_requirements',
    description:
      "Call this first when a job type is mentioned. Returns the must-ask questions for this niche, pricing method, and flags for measurement-driven and specialist-supply jobs. Use the returned mustAskQuestions — do not invent questions. mustAskQuestions is NEVER empty: when no niche matches, it returns general scope questions and genericScope is true, so there is never a case where you should draft without asking anything. Pass documentType 'invoice' when the tradie is invoicing — the work is already done, so the questions collapse to what was done and who for (invoiceFastPath true) and the supplier-list flags are off. Also returns supplierBookPopulated (true when this phone can see the tradie's own imported/saved supplier rates), supplierBookSuppliers (up to 3 of those supplier names) and supplierBookCoversTrade (true when those rates would actually price this niche's core gear). specialistSupply true + supplierBookPopulated false is the one combination worth mentioning — the core materials for this job don't come off a Bunnings or Reece shelf and there's no price list on the phone to fall back on. KNOWN JOB TYPES (pass one of these verbatim as jobType, or \"none\"): " + KNOWN_JOB_TYPE_LIST + ".",
    parameters: {
      type: 'object',
      properties: {
        jobType: {
          type: 'string',
          description:
            'PREFERRED. The exact job-type name from the list in this tool\'s description when one genuinely fits, or "none" when you have read the list and none does. You can judge this far better than the keyword matcher behind freeText — "hang a hammock" is not Door Hanging, however many words they share. Never force a near-miss; "none" still returns general scope questions to ask.',
        },
        category: { type: 'string', description: 'Trade category ID (optional; loaded from business settings if omitted)' },
        niche: { type: 'string', description: 'Niche ID (optional; inferred from freeText if omitted). NOT unique — several job types share one category/niche pair, so prefer jobType.' },
        freeText: { type: 'string', description: 'The job description or blurb, always worth passing. Used to match a job type when jobType is omitted, and to pick between job types that share a niche.' },
        documentType: {
          type: 'string',
          enum: ['quote', 'invoice'],
          description: "'invoice' when the tradie asked for an invoice — the work is done, so only what was done and who for are asked. Defaults to 'quote'.",
        },
      },
      required: [],
    },
  },
  {
    name: 'list_service_reports',
    description:
      "List the tradie's service reports — the customer-facing leave-behind written up after a service visit (what was found, what was done, what's recommended next). A service report is NOT a quote or an invoice: it carries no prices or line items, and it lives on the Job, not in the quotes list. Call this ANY time the tradie says \"service report\", \"report\", \"job sheet\", \"leave-behind\", or asks to see/find/edit one — never answer with an invoice instead. Returns id, number (RP-001), jobId, jobName, customerName, serviceType, visitDate, status ('draft' | 'sent'), and hasRecommendedWork. Pass `query` to fuzzy-match over customer name, job name and service type.",
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional fuzzy search over customerName + jobName + serviceType. Omit to list the most recent.',
        },
        limit: { type: 'integer', description: 'Max rows to return (default 10, max 25).' },
      },
    },
  },
  {
    name: 'search_supplier_book',
    description:
      "Look up the tradie's OWN saved prices — their supplier book: rates imported off a supplier's price list, prices they typed in, and prices they corrected on earlier quotes. Pass `query` to find entries for a material; omit it for the book's most recent entries. Prices are GST-inclusive, as the supplier quotes them. populated:false means THIS PHONE can't see a book — never that they haven't got one.",
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Material to look for, as the tradie said it ("batts", "colorbond sheet", "R2.5"). Omit for a summary of the book.',
        },
        limit: { type: 'integer', description: 'Max entries to return (default 10, max 25).' },
      },
    },
  },
  {
    name: 'propose_draft_quote',
    description:
      'Propose a new draft quote. You do NOT compute materials, quantities, or prices — the existing materials + pricing pipeline handles that on Apply. Your job is to lock down the customer and the scope (a clean job description) and hand off. The Apply path mints the quote, runs analyzeJobDescription with the scope, populates materials, and opens the materials list for the tradie to review.',
    parameters: {
      type: 'object',
      properties: {
        customerId: {
          type: 'string',
          description: 'Existing contact id from find_customer. Strongly preferred when a match exists.',
        },
        customerDraft: {
          type: 'object',
          description:
            'New customer details. Use when find_customer returned zero matches — announce the new contact in the same turn rather than waiting for a go-ahead.',
          properties: {
            name: { type: 'string' },
            phone: { type: 'string' },
            email: { type: 'string' },
            address: { type: 'string' },
          },
          required: ['name'],
        },
        jobName: { type: 'string', description: 'Short title — appears on the proposal card and the quote header.' },
        jobDescription: {
          type: 'string',
          description:
            "The full scope the pipeline will analyse. Write it as the tradie would: rooms, surfaces, measurements, colours, finishes, any special conditions. The clearer this is, the better the materials list. Aim for 2-6 sentences — no preamble, just the work. This text PRINTS ON THE CUSTOMER'S QUOTE: never include any of your conversation with the tradie — no questions ('what's their phone number'), no contact chatter ('customer name is…'), no notes about what you're about to do. Scope only.",
        },
        estimatedDurationHours: {
          type: 'number',
          description:
            'Optional. If the tradie gave a duration ("2 days", "half a day"), convert to hours and pass it. The pipeline uses its own estimate otherwise.',
        },
        documentType: {
          type: 'string',
          enum: ['quote', 'invoice'],
          description:
            "Optional. Pass 'invoice' when the tradie has clearly asked for an invoice up front (\"draft an invoice\", \"invoice Tom for the bathroom\"). Apply runs the same materials + pricing pipeline, then auto-converts the result to an invoice so the tradie never has to do a second tap. Defaults to 'quote'.",
        },
        materialsMode: {
          type: 'string',
          enum: ['priced', 'labour_only'],
          description:
            "Optional. 'labour_only' when their saved preferences say they don't quote materials, or they say \"just labour\" for this job: the draft gets hours and sections but no materials list and no pricing run. Defaults to 'priced'.",
        },
        rateLines: {
          type: 'array',
          description:
            "Optional. Charge the job off their rate card: one line per rate that fits, quantity taken from the job (m², rooms, hours, days — never guessed; ask if you don't know it). Each becomes a lump-sum line on the quote at rate × quantity. When EVERY line has includesMaterials true the rate IS the price: no materials are generated and no labour is added. When a line is labour-only, materials are still worked out and priced on top.",
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: "What the rate is for, as the tradie names it (\"Patio roof supply and fit\")." },
              quantity: { type: 'number', description: 'How many units this job has.' },
              unit: { type: 'string', enum: ['m²', 'm', 'm³', 'hour', 'day', 'each', 'room', 'point', 'job'] },
              unitPrice: { type: 'number', description: 'The rate per unit, in dollars.' },
              pricesIncludeGst: { type: 'boolean', description: 'True only if the rate was given inc GST. Omit when unsure — the business default applies.' },
              includesMaterials: { type: 'boolean', description: 'True when the rate is the whole price; false when it is labour only.' },
            },
            required: ['label', 'quantity', 'unit', 'unitPrice', 'includesMaterials'],
          },
        },
      },
      required: ['jobName', 'jobDescription'],
    },
  },
  {
    name: 'propose_remember_preference',
    description:
      "Remember a STANDING rule about how this tradie quotes, in their words, as one plain sentence: \"labour separate from materials\", \"customers supply their own materials\", \"we only quote labour\", \"round every quote to the nearest $50\". Apply saves it to their settings and it applies to every quote from then on — on this phone and every other. Only for rules that outlast this job, never for this job's details. Propose it once when they state one; if they knock the card back, drop it.",
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The rule as one sentence in the tradie\'s words. Under 160 characters.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'propose_save_rate',
    description:
      "Save a charge-out rate to the tradie's rate card: \"220 a square ex GST, supply and fit\", \"$90 a room\", \"day rate's 650\". Apply stores it on their settings; you then use it on drafts as a rateLine. Saving a label that already exists replaces that rate. Only ever save a number the tradie said — never one you worked out.",
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: "What the rate is for, short and in their words (\"Patio roof supply and fit\", \"End of lease clean\")." },
        unit: { type: 'string', enum: ['m²', 'm', 'm³', 'hour', 'day', 'each', 'room', 'point', 'job'], description: "Per what. 'job' for a fixed price." },
        rate: { type: 'number', description: 'Dollars per unit.' },
        pricesIncludeGst: { type: 'boolean', description: 'True only if they said inc/including GST; false if they said ex/plus GST. Omit when they said neither — the business default applies.' },
        includesMaterials: { type: 'boolean', description: 'True when the rate is the whole price (supply and fit, all-in). False when it is labour only and materials are charged on top.' },
        notes: { type: 'string', description: 'Optional qualifier ("minimum 20 m²", "single storey only").' },
      },
      required: ['label', 'unit', 'rate', 'includesMaterials'],
    },
  },
  {
    name: 'propose_add_line_item',
    description:
      "Add ONE line to an existing quote or invoice. Two forms. (1) A material: pass searchTerm + qty + unit and the pricing engine finds the product and price on Apply — you never pass a price for a material. (2) A lump sum at a price the TRADIE said (\"add a $180 callout\", \"$450 for the disposal\", \"put $300 on for the skip\"): pass label + price (and scope if they described the work) — it lands as a lump-sum work line at exactly that figure: no product search, no markup, no quantity. Never turn a price the tradie stated into a material search, and never invent a price to make a lump sum. Say 'inc GST' / 'ex GST' only via pricesIncludeGst when they said it; otherwise the figure goes on in the document's own basis.",
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'string' },
        searchTerm: { type: 'string', description: 'Material form: what to search for. Be specific: "90x45 treated pine 2.4m" not "timber".' },
        qty: { type: 'number', description: 'Material form: how many.' },
        unit: { type: 'string', description: 'Material form: each, m, m², L, kg, box, pack.' },
        label: { type: 'string', description: 'Lump-sum form: the line as the tradie names it ("Callout", "Skip bin and disposal").' },
        price: { type: 'number', description: 'Lump-sum form: the whole line in dollars, exactly as the tradie said it. Never for a material.' },
        scope: { type: 'string', description: 'Lump-sum form, optional: a sentence of customer-facing scope under the line.' },
        pricesIncludeGst: { type: 'boolean', description: 'Lump-sum form: true only if they said inc GST, false only if they said ex/plus GST. Omit otherwise.' },
        section: { type: 'string', description: 'Optional section to add the row under.' },
      },
      required: ['quoteId'],
    },
  },
  {
    name: 'propose_update_line_item',
    description:
      "Change a line that's ALREADY on a quote or invoice — its price, its quantity, or its name. Use this whenever the tradie wants a row corrected: \"make the plywood a hundred bucks\", \"that should be 12 not 6\", \"the decking's $8.50 a metre\". NEVER tell them to go and type a price in themselves — that was the old answer and it's wrong, you can do it from here. Always call get_quote first so you have the real material id and can show what's changing (pass displayName, displayCurrentPrice, displayCurrentQty, displayUnit). Setting a price marks the row as manually priced, which also clears any 'estimated' flag review_quote raised against it, and saves that price to the tradie's supplier book so the next quote starts from their number. A row with kind 'work' is a lump sum: its price IS the line total, it has no real quantity, and it is never saved to the book — pass price only. Pass only the fields that change. For a row that isn't on the quote at all, use propose_add_line_item; to take one off, propose_delete_line_item.",
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'string', description: 'Document id of the quote or invoice.' },
        materialId: { type: 'string', description: 'Material id from get_quote — not the name.' },
        price: { type: 'number', description: 'New PER-UNIT price in dollars; the line total is recalculated from price x quantity. On a lump-sum (kind work) row this is the whole line.' },
        quantity: { type: 'number', description: 'New quantity.' },
        name: { type: 'string', description: 'Corrected line name, when the tradie is renaming rather than repricing.' },
        displayName: { type: 'string', description: "The row's current name, for the card." },
        displayCurrentPrice: { type: 'number', description: 'Current per-unit price, so the card can show the change.' },
        displayCurrentQty: { type: 'number', description: 'Current quantity, so the card can show the change.' },
        displayUnit: { type: 'string', description: "The row's unit (each, m, m2...)." },
      },
      required: ['quoteId', 'materialId'],
    },
  },
  {
    name: 'propose_delete_line_item',
    description:
      'Propose deleting a SINGLE LINE from an existing quote or invoice (one material row, not the whole document). Apply prompts the tradie to confirm. Use the material id from get_quote — never invent one. Always call get_quote first so the card can show the line name + total being removed. The line name the tradie says may be speech-to-text slop ("weight belt" for "weed mat") — match the closest line yourself and read it back; never ask them to open the quote to find it for you. For deleting the entire quote/invoice itself, use propose_delete_quote instead.',
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'string', description: 'Document id (from list_recent_quotes or find_customer).' },
        materialId: { type: 'string', description: 'Material id from get_quote materials[].id.' },
        displayName: { type: 'string', description: 'Line name to show on the card (for display only).' },
        displayQty: { type: 'number', description: 'Qty to show on the card (for display only).' },
        displayUnit: { type: 'string', description: 'Unit to show on the card (for display only).' },
        displayTotal: { type: 'number', description: 'Total to show on the card in AUD (for display only).' },
      },
      required: ['quoteId', 'materialId'],
    },
  },
  {
    name: 'propose_delete_quote',
    description:
      'Propose deleting an ENTIRE quote or invoice (the whole document, all its lines). Use this whenever the tradie says "delete that quote", "scrap it", "bin it", "get rid of it", "chuck it out" referring to the document itself — NOT propose_delete_line_item, which only removes one row. Apply removes it from the tradie\'s quotes/invoices list. Paid or partially paid records are refused (the tradie should archive instead) so the books stay intact. Always call list_recent_quotes (or get_quote) first so you can populate the display fields — the destructive confirmation card MUST name the doc by customer + job name + total.',
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'string', description: 'Document id from list_recent_quotes / find_customer / get_quote.' },
        displayName: { type: 'string', description: 'Job name to show on the card (for display only).' },
        displayCustomerName: { type: 'string', description: 'Customer name to show on the card (for display only).' },
        displayTotal: { type: 'number', description: 'Total in AUD to show on the card (for display only).' },
        displayDocType: {
          type: 'string',
          enum: ['quote', 'invoice'],
          description: 'Whether the doc is a quote or invoice (for display only — controls card copy).',
        },
      },
      required: ['quoteId'],
    },
  },
  {
    name: 'propose_create_contact',
    description:
      "Propose creating a new contact in the tradie's address book — standalone, NOT tied to a quote. Use this only when the tradie wants a contact saved on its own (\"add Bob to my contacts\"). To change WHO an existing quote is for, use propose_update_customer instead — this tool does not touch any quote.",
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        address: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'propose_update_customer',
    description:
      "Change the customer on an EXISTING quote or invoice — re-point it at a different contact while staying in the chat. Use this whenever the tradie wants to swap, change, update, or fix who a quote is for (\"put this on Jane instead\", \"update the contact\", \"wrong customer, it's Bob\"). Resolve the customer first: call find_customer and pass customerId when there's a match; only pass customerDraft (with confirmation) when there's no match and they want a brand-new contact. Apply updates the quote's customer + the linked job and re-shows the quote in chat — it does NOT navigate away. Always pass customerName so the card can name who it's switching to.",
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'string', description: 'Document id of the quote/invoice to update (from list_recent_quotes, find_customer, get_quote, or the [context] line after a draft).' },
        customerId: {
          type: 'string',
          description: 'Existing contact id from find_customer. Strongly preferred when a match exists.',
        },
        customerDraft: {
          type: 'object',
          description:
            'New customer details. Only use when find_customer returned zero matches and the tradie confirmed they want a new contact.',
          properties: {
            name: { type: 'string' },
            phone: { type: 'string' },
            email: { type: 'string' },
            address: { type: 'string' },
          },
          required: ['name'],
        },
        customerName: { type: 'string', description: 'The new customer name to show on the card (for display).' },
      },
      required: ['quoteId'],
    },
  },
  {
    name: 'propose_send_quote',
    description:
      'Propose sending an existing quote or invoice to the customer. Apply opens the send preview — the tradie still confirms the recipient and taps Send; you never send it yourself. You CAN pre-write the email: pass draftEmailBody (and optionally draftEmailSubject) and it lands in the preview ready to edit. NEVER use this without first calling get_quote — pass recipientEmail and displayTotal so the card shows both.',
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'string' },
        recipientEmail: { type: 'string', description: "Pre-fill the recipient. Defaults to the customer's email; the field stays editable in the preview." },
        displayTotal: { type: 'number', description: 'Total in AUD to show on the card (from get_quote, for display only).' },
        draftEmailBody: {
          type: 'string',
          description:
            "Optional. The email body to drop into the send preview. Customer-facing: a greeting, a line that the quote/invoice is attached, an invite to ask questions, signed off with the business name. No job specifics you weren't told, no mention of the app, gender-neutral, AU English.",
        },
        draftEmailSubject: { type: 'string', description: 'Optional subject line to pre-fill. Leave unset to use the default ("Quotation from <business> - <job>").' },
      },
      required: ['quoteId'],
    },
  },
  {
    name: 'propose_convert_to_invoice',
    description:
      'Propose converting a quote (any stage — draft, sent, accepted) into an invoice. The tradie decides when to invoice; do NOT gate this on the quote being "accepted". Apply opens the new invoice.',
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'string' },
      },
      required: ['quoteId'],
    },
  },
  {
    name: 'propose_reprice',
    description:
      "Propose re-running the pricing pipeline on an existing quote to fix flagged rows. On Apply, the pipeline re-fetches prices for every row review_quote flagged (no price, estimated, low-confidence) and re-runs reconciliation — confident rows and manual price overrides are left untouched. You do NOT compute prices. Use this when the tradie wants prices re-checked or wants to fix the dodgy rows. Pass displayName/displayTotal (from get_quote) so the card names the quote. Always know there's something to fix first — call review_quote (or get_quote) before offering this.",
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'string', description: 'Document id of the quote to re-price.' },
        displayName: { type: 'string', description: 'Job name to show on the card (for display only).' },
        displayTotal: { type: 'number', description: 'Current total in AUD to show on the card (for display only).' },
      },
      required: ['quoteId'],
    },
  },
  {
    name: 'propose_update_quote_scope',
    description:
      "Change the scope of a quote that ALREADY EXISTS — its job name, job description and/or labour hours — and re-run the materials + pricing pipeline on it. This is how a correction lands after the draft was applied (\"make it Hager gear\", \"the deck's 13.6 m not 9.4\", a second photo with the specs): NEVER call propose_draft_quote again for a job that already has a quote id — that mints a second quote for the same job. Pass the FULL corrected jobDescription (the pipeline regenerates the materials from it), not just the changed sentence. Nothing changes until the tradie taps 'Update it' on the card — say the card is up, not that it is done. Needs the real quote id from a \"[context]\" line, list_recent_quotes or get_quote. Not for price or rate tweaks — use propose_update_line_item / propose_update_quote_rates for those.",
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'string', description: 'Document id of the existing quote.' },
        jobName: { type: 'string', description: 'New short title, if it changed.' },
        jobDescription: {
          type: 'string',
          description:
            "The full corrected scope, written as the tradie would (rooms, surfaces, measurements, colours, finishes, special conditions). Same rules as propose_draft_quote: this PRINTS ON THE CUSTOMER'S QUOTE — scope only, none of your conversation with the tradie.",
        },
        estimatedDurationHours: { type: 'number', description: 'Corrected labour hours, if the tradie gave a new duration.' },
        displayName: { type: 'string', description: "The quote's current job name, from the \"[context]\" line or get_quote — ALWAYS pass it so the card names the quote (display only)." },
      },
      required: ['quoteId'],
    },
  },
  {
    name: 'propose_update_quote_rates',
    description:
      "Change the labour or markup numbers on an existing quote or invoice without re-running the pricing pipeline. Use this whenever the tradie wants to bump the markup percentage, change the labour rate, adjust labour hours, or tweak the labour markup on a specific doc (\"bump markup to 30%\", \"change hours to 14\", \"labour rate to $130/h\"). Pass only the fields that are changing \u2014 omitted fields stay as-is. Markup values are percentages (30 means 30%). laborRate is $/hour, laborHours is hours. Always know the quote id first (from list_recent_quotes / get_quote / the [context] line after a draft).",
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'string', description: 'Document id of the quote/invoice to update.' },
        markup: { type: 'number', description: 'New material markup percentage (e.g. 30 for 30%).' },
        laborMarkup: { type: 'number', description: 'New labour markup percentage (e.g. 20 for 20%). Independent from material markup.' },
        laborRate: { type: 'number', description: 'New labour rate in $/hour.' },
        laborHours: { type: 'number', description: 'New labour hours total.' },
        displayName: { type: 'string', description: 'Job name to show on the card (display only).' },
      },
      required: ['quoteId'],
    },
  },
  {
    name: 'propose_mark_paid',
    description:
      'Propose marking an invoice as paid in full — the voice/chat equivalent of opening the invoice and tapping Mark paid. Use this whenever the tradie says "mark it paid", "that\'s been paid", "close it off", "settle that invoice", etc. ONLY works on invoices, NOT quotes (a quote has to be converted to an invoice first — if they\'re trying to mark a quote paid, offer propose_convert_to_invoice first). Apply records a payment for the remaining balance using the chosen method so the books stay accurate. Always call get_quote first so the card can name the doc + balance being settled. Pass displayCustomerName + displayName + displayBalance from get_quote.',
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'string', description: 'Document id of the invoice to mark paid (must be an invoice, not a quote).' },
        method: {
          type: 'string',
          enum: ['cash', 'bank_transfer', 'card', 'cheque', 'other'],
          description: 'How the money landed. Defaults to "other" if the tradie didn\'t say. Map "bank" / "transfer" → bank_transfer, "eftpos" / "tap" → card.',
        },
        notes: { type: 'string', description: 'Optional payment note (e.g. "paid in cash on site").' },
        displayName: { type: 'string', description: 'Job name to show on the card (display only).' },
        displayCustomerName: { type: 'string', description: 'Customer name to show on the card (display only).' },
        displayTotal: { type: 'number', description: 'Invoice total in AUD (display only).' },
        displayBalance: { type: 'number', description: 'Remaining balance in AUD that\'s about to be settled (display only).' },
      },
      required: ['quoteId'],
    },
  },
  {
    name: 'propose_import_supplier_list',
    description:
      "Propose reading a supplier's price list into the tradie's own supplier book, from a photo, a PDF or a spreadsheet. Use it when they say yes to the offer, hand you a price list, or ask to add their supplier's prices. Apply opens the reader right there in the chat and the tradie checks every row before anything saves — YOU never read prices off the image and you never type a price into their book. Every argument is optional: leave source off (or use 'ask') and the app offers the choices. Use source 'attachment' only when they've just sent you a photo of a price list in this chat — the app finds it, you never name it.",
    parameters: {
      type: 'object',
      properties: {
        supplierName: {
          type: 'string',
          description: "The supplier's name if the tradie said it (e.g. \"Metro Fencing\"). Leave it off and the reader picks it up off the list itself.",
        },
        source: {
          type: 'string',
          enum: ['attachment', 'camera', 'gallery', 'pdf', 'spreadsheet', 'ask'],
          description:
            "Where the list is coming from. 'attachment' = a photo already sent in this chat. 'ask' (the default) lets the app offer camera / photos / PDF / spreadsheet.",
        },
        reason: {
          type: 'string',
          enum: ['no_retail_coverage', 'pricing_fell_back', 'tradie_asked'],
          description:
            "Why it's being offered: the trade's gear isn't on a retail shelf, the pipeline had to fall back to Bunnings, or they asked for it.",
        },
        missedItems: {
          type: 'array',
          items: { type: 'string' },
          description: 'Up to 5 rows the pipeline could not price off their book — shown on the card so they can see what it would fix.',
        },
      },
      required: [],
    },
  },
  {
    name: 'propose_set_total',
    description:
      "Set the customer-facing TOTAL of an existing quote or invoice to the figure the tradie said: \"make the total $1,232\", \"call it twelve hundred\", \"bring it down to fifteen hundred all up\", \"round it to $2,000\". This is the tool for a total — never steer them to markup or a labour rate instead, and never say you can't set the final price. Apply moves the labour to land on that figure when the document has labour (what a tradie does themselves), otherwise it puts a lump-sum 'Price adjustment' line on; materials and their prices are never touched. The target is what the customer reads at the bottom, GST included where it applies. A total under the materials alone is refused. Needs the real quote id (a \"[context]\" line, list_recent_quotes or get_quote). Pass displayName so the card names the document. After it applies, the new total arrives in a \"[context]\" line — read totals from there or from get_quote, never from memory.",
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'string', description: 'Document id of the quote or invoice.' },
        targetTotal: { type: 'number', description: 'The total the tradie wants the customer to see, in dollars.' },
        displayName: { type: 'string', description: 'Job name to show on the card (display only).' },
      },
      required: ['quoteId', 'targetTotal'],
    },
  },
  {
    name: 'propose_pick_contact',
    description:
      "Open the phone's own contact picker so the tradie can choose the customer from their address book. Use it whenever they say the customer is in their phone — \"access my contacts\", \"open contacts\", \"it's in my phone\", \"pick them from my contacts\" — or when find_customer found nobody and they say the person is on their phone. Apply opens the picker; the pick is saved as a contact and goes on the quote you pass in quoteId, or, with no quoteId, comes back to you in a \"[context]\" line with a contact id to put on the draft. Never ask them to read a number out instead when they have offered their contacts.",
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'string', description: 'Optional. The existing quote or invoice the pick becomes the customer of. Leave off while you are still drafting.' },
        displayName: { type: 'string', description: 'Job name to show on the card when quoteId is set (display only).' },
      },
      required: [],
    },
  },
];

// Both surfaces: when a proposal card is waiting, a clear spoken OR typed yes
// resolves it without a tap. The voice session intercepts these calls itself
// (onControlAction — they never reach dispatchToolCall there); the text path
// routes them through dispatchToolCall, where the screen-registered pending-
// card probe pins the exact card and the screen runs the same Apply / dismiss
// the card's buttons run.
export const CONTROL_TOOL_DECLARATIONS: GeminiFunctionDeclaration[] = [
  {
    name: 'apply_pending_proposal',
    description:
      'Apply the proposal card the tradie is being shown — identical to them tapping Apply. Call this ONLY when a card is on screen waiting and the tradie clearly says yes to it ("yeah", "send it", "go on", "do it", "apply that", "yep do it"). If no card is waiting, or they\'re asking a question or changing the scope, do NOT call it — answer them instead.',
    parameters: {
      type: 'object',
      properties: {
        proposalId: {
          type: 'string',
          description: 'Optional. The specific card to apply if you know its id; omit to apply the one currently waiting.',
        },
      },
    },
  },
  {
    name: 'cancel_pending_proposal',
    description:
      'Dismiss the proposal card the tradie is being shown — identical to them tapping Cancel. Call this ONLY when a card is waiting and the tradie clearly backs out ("nah", "cancel", "scrap it", "leave it", "don\'t", "forget it"). If no card is waiting, do NOT call it.',
    parameters: {
      type: 'object',
      properties: {
        proposalId: {
          type: 'string',
          description: 'Optional. The specific card to dismiss if you know its id; omit to dismiss the one currently waiting.',
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Per-tool runtime settings for the ElevenLabs agent.
//
// These are agent-side config (pushed by scripts/syncMateAgent.ts), but the
// values live here so the repo stays the source of truth and a new tool can't
// be added without deciding its budget.
//
// `expects_response` is deliberately absent: it is true for EVERY tool and the
// converter hard-codes it. The ElevenLabs API defaults it to FALSE, which means
// the agent fires the call and carries on without waiting — for find_customer
// or get_quote that is Mate confidently inventing a customer. There is no tool
// here whose answer Mate doesn't need.
//
// Timeouts are a ceiling, not a delay, so they err generous. Anything reading
// Firestore over patchy site coverage gets the long budget — find_customer
// pulls up to 500 contact docs, so it belongs in that group despite feeling
// instant on a desk connection.
export const TOOL_RUNTIME: Record<string, { timeoutSecs: number }> = {
  // Firestore reads.
  find_customer: { timeoutSecs: 20 },
  list_recent_quotes: { timeoutSecs: 20 },
  get_quote: { timeoutSecs: 20 },
  get_business_defaults: { timeoutSecs: 20 },
  review_quote: { timeoutSecs: 20 },
  list_service_reports: { timeoutSecs: 20 },
  // Niche inference + supplier-book checks — the slowest read by some way.
  get_job_requirements: { timeoutSecs: 30 },
  // First call in a session may pull the whole book collection from Firestore.
  search_supplier_book: { timeoutSecs: 30 },
  // Pure validation + a screen-registered probe. No network.
  show_quote: { timeoutSecs: 10 },
  propose_draft_quote: { timeoutSecs: 10 },
  propose_add_line_item: { timeoutSecs: 10 },
  propose_delete_line_item: { timeoutSecs: 10 },
  propose_update_line_item: { timeoutSecs: 10 },
  propose_delete_quote: { timeoutSecs: 10 },
  propose_create_contact: { timeoutSecs: 10 },
  propose_update_customer: { timeoutSecs: 10 },
  propose_send_quote: { timeoutSecs: 10 },
  propose_convert_to_invoice: { timeoutSecs: 10 },
  propose_reprice: { timeoutSecs: 10 },
  propose_update_quote_rates: { timeoutSecs: 10 },
  propose_update_quote_scope: { timeoutSecs: 10 },
  propose_mark_paid: { timeoutSecs: 10 },
  propose_import_supplier_list: { timeoutSecs: 10 },
  propose_remember_preference: { timeoutSecs: 10 },
  propose_save_rate: { timeoutSecs: 10 },
  propose_set_total: { timeoutSecs: 10 },
  propose_pick_contact: { timeoutSecs: 10 },
  apply_pending_proposal: { timeoutSecs: 10 },
  cancel_pending_proposal: { timeoutSecs: 10 },
};

/** Every declaration the agent is told about — read, view, proposal and control. */
export const ALL_TOOL_DECLARATIONS: GeminiFunctionDeclaration[] = [
  ...TOOL_DECLARATIONS,
  ...CONTROL_TOOL_DECLARATIONS,
];
