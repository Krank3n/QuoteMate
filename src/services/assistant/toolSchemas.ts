// Gemini Live function declarations for Mate's tool ecosystem.
//
// Translated from functions/src/assistant/toolSchemas.ts (Anthropic-shape).
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
  'propose_send_quote',
  'propose_convert_to_invoice',
  'propose_reprice',
] as const;

export type ReadToolName = (typeof READ_TOOL_NAMES)[number];
export type ProposalToolName = (typeof PROPOSAL_TOOL_NAMES)[number];

export function isReadTool(name: string): name is ReadToolName {
  return (READ_TOOL_NAMES as readonly string[]).includes(name);
}

export function isProposalTool(name: string): name is ProposalToolName {
  return (PROPOSAL_TOOL_NAMES as readonly string[]).includes(name);
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
    description: "Propose creating a new contact in the tradie's address book.",
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
    name: 'propose_send_quote',
    description:
      'Propose sending an existing quote to the customer. Apply opens the existing send preview (the tradie still confirms recipient + email body). NEVER use this without first calling get_quote — you must show the recipient and total on the card.',
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'string' },
        recipientEmail: { type: 'string', description: 'Pre-fill in the send modal.' },
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
