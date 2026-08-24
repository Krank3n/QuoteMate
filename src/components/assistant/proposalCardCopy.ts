// Card chrome for every proposal type — title, icon and the apply button's
// verb. Pure and in its own module so the "every ProposalType has card copy"
// guard can run without rendering React.

import type { Proposal, ProposalType } from '../../types/assistant';

export function titleFor(p: Proposal): string {
  switch (p.type) {
    case 'propose_draft_quote':
      return p.documentType === 'invoice' ? 'Draft invoice' : 'Draft quote';
    case 'propose_add_line_item': return 'Add line item';
    case 'propose_delete_line_item': return 'Delete line item';
    case 'propose_delete_quote':
      return p.displayDocType === 'invoice' ? 'Delete invoice' : 'Delete quote';
    case 'propose_create_contact': return 'New contact';
    case 'propose_update_customer': return 'Change customer';
    case 'propose_send_quote': return 'Send quote';
    case 'propose_convert_to_invoice': return 'Convert to invoice';
    case 'propose_reprice': return 'Re-price quote';
    case 'propose_update_quote_rates': return 'Update rates';
    case 'propose_mark_paid': return 'Mark invoice paid';
    case 'propose_import_supplier_list': return 'Add supplier prices';
  }
}

export function iconFor(p: Proposal): string {
  switch (p.type) {
    case 'propose_draft_quote': return 'file-document-edit-outline';
    case 'propose_add_line_item': return 'plus-circle-outline';
    case 'propose_delete_line_item': return 'trash-can-outline';
    case 'propose_delete_quote': return 'file-remove-outline';
    case 'propose_create_contact': return 'account-plus-outline';
    case 'propose_update_customer': return 'account-switch-outline';
    case 'propose_send_quote': return 'send-outline';
    case 'propose_convert_to_invoice': return 'cash-multiple';
    case 'propose_reprice': return 'refresh';
    case 'propose_update_quote_rates': return 'tune-variant';
    case 'propose_mark_paid': return 'check-decagram-outline';
    case 'propose_import_supplier_list': return 'clipboard-list-outline';
  }
}

/**
 * The verb on the button that commits the action. Every type names what it
 * actually does — "Apply" is software language sitting on the biggest
 * decision in the app, on a screen whose front door says "Quote it for me".
 */
export function applyLabelFor(p: Proposal): string {
  switch (p.type) {
    case 'propose_draft_quote':
      return p.documentType === 'invoice' ? 'Draw it up' : 'Price it up';
    case 'propose_add_line_item': return 'Add it';
    case 'propose_create_contact': return 'Save contact';
    case 'propose_update_customer': return 'Change it';
    case 'propose_send_quote': return 'Send';
    case 'propose_delete_line_item': return 'Delete';
    case 'propose_delete_quote': return 'Delete';
    case 'propose_convert_to_invoice': return 'Convert';
    case 'propose_reprice': return 'Re-price';
    case 'propose_update_quote_rates': return 'Update';
    case 'propose_mark_paid': return 'Mark paid';
    case 'propose_import_supplier_list': return 'Read list';
  }
}

/** Minimal stand-in used by the wiring guard to exercise the copy switches. */
export function proposalStub(type: ProposalType): Proposal {
  return { id: 'p', toolUseId: 't', createdAt: '', type } as Proposal;
}
