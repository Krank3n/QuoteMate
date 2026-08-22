/**
 * A proposal tool has SIX wiring sites: the name list, the Gemini declaration,
 * the ProposalType union, the validator, the store's apply switch, and the
 * card's title/icon/apply-label. Miss one and Mate emits a tool call that
 * either the dispatcher can't service or the card renders blank — both of
 * which only show up in a live conversation. This is the cheap guard.
 *
 * The apply switch is the one site TypeScript already covers (the union makes
 * a missing case a compile error), so it isn't re-checked here.
 */
import { describe, it, expect } from 'vitest';
import { PROPOSAL_TOOL_NAMES, TOOL_DECLARATIONS } from '../toolSchemas';
import { buildProposal } from '../proposalTools';
import { applyLabelFor, iconFor, proposalStub, titleFor } from '../../../components/assistant/proposalCardCopy';
import type { ProposalToolName } from '../toolSchemas';
import type { ProposalType } from '../../../types/assistant';

// Minimal arguments that must produce a proposal for each tool.
const VALID_ARGS: Record<ProposalToolName, Record<string, unknown>> = {
  propose_draft_quote: {
    jobName: 'Back fence',
    jobDescription: 'Replace 22 m of paling fence along the back boundary.',
    customerDraft: { name: 'Gigar' },
  },
  propose_add_line_item: { quoteId: 'q1', searchTerm: '90x45 treated pine', qty: 4, unit: 'each' },
  propose_delete_line_item: { quoteId: 'q1', materialId: 'm1' },
  propose_delete_quote: { quoteId: 'q1' },
  propose_create_contact: { name: 'Gigar' },
  propose_update_customer: { quoteId: 'q1', customerId: 'c1' },
  propose_send_quote: { quoteId: 'q1' },
  propose_convert_to_invoice: { quoteId: 'q1' },
  propose_reprice: { quoteId: 'q1' },
  propose_update_quote_rates: { quoteId: 'q1', markup: 30 },
  propose_mark_paid: { quoteId: 'q1' },
  propose_import_supplier_list: {},
};

describe('proposal tool wiring', () => {
  it('every PROPOSAL_TOOL_NAMES entry has a TOOL_DECLARATIONS entry', () => {
    const declared = new Set(TOOL_DECLARATIONS.map((t) => t.name));
    for (const name of PROPOSAL_TOOL_NAMES) {
      expect(declared.has(name), `${name} has no Gemini declaration`).toBe(true);
    }
  });

  it('every declaration carries a description and an object schema', () => {
    for (const name of PROPOSAL_TOOL_NAMES) {
      const declaration = TOOL_DECLARATIONS.find((t) => t.name === name)!;
      expect(declaration.description.length).toBeGreaterThan(40);
      expect(declaration.parameters.type).toBe('object');
    }
  });

  it('every entry is buildable by buildProposal', () => {
    for (const name of PROPOSAL_TOOL_NAMES) {
      const { proposal, error } = buildProposal(name, `tool_${name}`, VALID_ARGS[name]);
      expect(error, `${name}: ${error}`).toBeUndefined();
      expect(proposal?.type).toBe(name);
    }
  });

  it('every ProposalType has a ProposalCard title, icon and apply label', () => {
    for (const name of PROPOSAL_TOOL_NAMES) {
      const stub = proposalStub(name as ProposalType);
      expect(titleFor(stub), `${name} title`).toBeTruthy();
      expect(iconFor(stub), `${name} icon`).toBeTruthy();
      expect(applyLabelFor(stub), `${name} apply label`).toBeTruthy();
    }
  });
});
