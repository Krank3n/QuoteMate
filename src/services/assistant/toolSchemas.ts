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

export const READ_TOOL_NAMES = [
  'find_customer',
  'list_recent_quotes',
  'get_quote',
  'get_business_defaults',
  'review_quote',
] as const;

export const PROPOSAL_TOOL_NAMES = [
  'propose_draft_quote',
  'propose_add_line_item',
  'propose_delete_line_item',
  'propose_create_contact',
  'propose_update_customer',
  'propose_send_quote',
  'propose_convert_to_invoice',
  'propose_reprice',
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
      "Search the tradie's saved contacts by name or phone. Returns up to 5 matches with id, name, phone (last 4 only), email presence flag, and last job summary if available. Phone search uses the last 8 digits.",
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
      "List the tradie's recent quotes and invoices, newest first. Returns id, customerName, jobName, total, status, type (quote|invoice), createdAt. Use this to answer \"what's pending?\" or to find a quote by approximate name.",
    parameters: {
      type: 'object',
      properties: {
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
      'Fetch the full quote or invoice by id. Use this after find_customer or list_recent_quotes when you need line items, totals, recipient email, or status to answer a question or build a propose_* payload.',
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
      "Check a priced quote for rows the pricing pipeline flagged — items with no price, AI estimates that aren't real supplier prices, and low-confidence matches. Returns a compact summary plus the flagged rows (no full materials dump). Use this to answer \"anything look off / dodgy on QU-xxx?\" or before sending, and to decide whether to offer propose_reprice. Returns { summary, counts, issues[] } where each issue has kind ('unpriced' | 'estimated' | 'low_confidence'), name and a short detail.",
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'string', description: 'Document id from list_recent_quotes or find_customer.' },
      },
      required: ['quoteId'],
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
            'New customer details. Only use when find_customer returned zero matches and the tradie confirmed they want a new contact.',
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
            "The full scope the pipeline will analyse. Write it as the tradie would: rooms, surfaces, measurements, colours, finishes, any special conditions. The clearer this is, the better the materials list. Aim for 2-6 sentences — no preamble, just the work.",
        },
        estimatedDurationHours: {
          type: 'number',
          description:
            'Optional. If the tradie gave a duration ("2 days", "half a day"), convert to hours and pass it. The pipeline uses its own estimate otherwise.',
        },
      },
      required: ['jobName', 'jobDescription'],
    },
  },
  {
    name: 'propose_add_line_item',
    description:
      'Propose adding a single line item to an existing quote. Apply opens the Add Material flow with the search term pre-filled — the existing pricing pipeline finds the product and price. You do NOT compute or pass a price; provide what to add and let the pipeline price it.',
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'string' },
        searchTerm: { type: 'string', description: 'What to search for. Be specific: "90x45 treated pine 2.4m" not "timber".' },
        qty: { type: 'number' },
        unit: { type: 'string' },
        section: { type: 'string', description: 'Optional section to add the row under.' },
      },
      required: ['quoteId', 'searchTerm', 'qty', 'unit'],
    },
  },
  {
    name: 'propose_delete_line_item',
    description:
      'Propose deleting a single line item from an existing quote or invoice. Apply prompts the tradie to confirm. Use the material id from get_quote — never invent one. Always call get_quote first so the card can show the line name + total being removed.',
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
      'Propose sending an existing quote or invoice to the customer. Apply opens the send preview — the tradie still confirms the recipient and taps Send; you never send it yourself. You CAN pre-write the email: pass draftEmailBody (and optionally draftEmailSubject) and it lands in the preview ready to edit. NEVER use this without first calling get_quote — you must show the recipient and total on the card.',
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'string' },
        recipientEmail: { type: 'string', description: "Pre-fill the recipient. Defaults to the customer's email; the field stays editable in the preview." },
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
];

// Voice-only: added to the Live session's tool list (NOT the text path, which
// resolves a card with a tap). When a proposal card is waiting and the tradie
// can't tap, Mate calls one of these to accept or back out of it. The voice
// session intercepts the call and routes it to the same Apply / dismiss the
// card buttons run — these never reach dispatchToolCall.
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
