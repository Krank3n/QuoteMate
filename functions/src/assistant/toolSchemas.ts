// Anthropic tool definitions for the Mate assistant. Read tools execute on the
// server; propose_* tools return their input back to the client as a Proposal
// payload — the client renders a confirmation card and the tradie taps Apply.
//
// Keep these in lockstep with readTools.ts (executor) and proposalTools.ts
// (validator). Adding a tool here without wiring it on either side will result
// in the model emitting a tool the loop can't service.

export const READ_TOOL_NAMES = [
  'find_customer',
  'list_recent_quotes',
  'get_quote',
  'get_business_defaults',
] as const;

export const PROPOSAL_TOOL_NAMES = [
  'propose_draft_quote',
  'propose_add_line_item',
  'propose_delete_line_item',
  'propose_create_contact',
  'propose_send_quote',
  'propose_convert_to_invoice',
] as const;

export type ReadToolName = (typeof READ_TOOL_NAMES)[number];
export type ProposalToolName = (typeof PROPOSAL_TOOL_NAMES)[number];

export const TOOL_DEFINITIONS = [
  {
    name: 'find_customer',
    description:
      'Search the tradie\'s saved contacts by name or phone. Returns up to 5 matches with id, name, phone (last 4 only), email presence flag, and last job summary if available. Phone search uses the last 8 digits.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Name fragment or phone number to search for.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_recent_quotes',
    description:
      'List the tradie\'s recent quotes and invoices, newest first. Returns id, customerName, jobName, total, status, type (quote|invoice), createdAt. Use this to answer "what\'s pending?" or to find a quote by approximate name.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max rows to return (default 10, max 25).' },
        status: {
          type: 'string',
          enum: ['draft', 'sent', 'accepted', 'declined', 'paid', 'overdue'],
          description: 'Optional status filter.',
        },
        daysBack: { type: 'number', description: 'Only include docs created within this many days.' },
      },
      required: [],
    },
  },
  {
    name: 'get_quote',
    description:
      'Fetch the full quote or invoice by id. Use this after find_customer or list_recent_quotes when you need line items, totals, recipient email, or status to answer a question or build a propose_* payload.',
    input_schema: {
      type: 'object' as const,
      properties: {
        quoteId: { type: 'string', description: 'Document id from list_recent_quotes or find_customer.' },
      },
      required: ['quoteId'],
    },
  },
  {
    name: 'get_business_defaults',
    description:
      'Return the tradie\'s business defaults: trade category, default labour rate, default markup, GST inclusive flag, business name. Useful when drafting a quote and you need a sensible default.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'propose_draft_quote',
    description:
      'Propose a new draft quote. You do NOT compute materials, quantities, or prices — the existing materials + pricing pipeline handles that on Apply. Your job is to lock down the customer and the scope (a clean job description) and hand off. The Apply path mints the quote, runs analyzeJobDescription with the scope, populates materials, and opens the materials list for the tradie to review.',
    input_schema: {
      type: 'object' as const,
      properties: {
        customerId: { type: 'string', description: 'Existing contact id from find_customer. Strongly preferred when a match exists.' },
        customerDraft: {
          type: 'object',
          description: 'New customer details. Only use when find_customer returned zero matches and the tradie confirmed they want a new contact.',
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
          description: 'The full scope the pipeline will analyse. Write it as the tradie would: rooms, surfaces, measurements, colours, finishes, any special conditions. The clearer this is, the better the materials list. Aim for 2-6 sentences — no preamble, just the work.',
        },
        estimatedDurationHours: {
          type: 'number',
          description: 'Optional. If the tradie gave a duration ("2 days", "half a day"), convert to hours and pass it. The pipeline uses its own estimate otherwise.',
        },
      },
      required: ['jobName', 'jobDescription'],
    },
  },
  {
    name: 'propose_add_line_item',
    description:
      'Propose adding a single line item to an existing quote. Apply opens the Add Material flow with the search term pre-filled — the existing pricing pipeline finds the product and price. You do NOT compute or pass a price; provide what to add and let the pipeline price it.',
    input_schema: {
      type: 'object' as const,
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
    input_schema: {
      type: 'object' as const,
      properties: {
        quoteId: { type: 'string', description: 'Document id (from list_recent_quotes or find_customer).' },
        materialId: { type: 'string', description: 'Material id from get_quote materials[].id.' },
        // The model echoes these back so the confirmation card can render the
        // line being removed without a second round-trip. The server doesn't
        // trust these for the actual delete — applyProposal reads the row by id.
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
    description: 'Propose creating a new contact in the tradie\'s address book.',
    input_schema: {
      type: 'object' as const,
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
    input_schema: {
      type: 'object' as const,
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
    input_schema: {
      type: 'object' as const,
      properties: {
        quoteId: { type: 'string' },
      },
      required: ['quoteId'],
    },
  },
] as const;

export function isReadTool(name: string): name is ReadToolName {
  return (READ_TOOL_NAMES as readonly string[]).includes(name);
}

export function isProposalTool(name: string): name is ProposalToolName {
  return (PROPOSAL_TOOL_NAMES as readonly string[]).includes(name);
}
