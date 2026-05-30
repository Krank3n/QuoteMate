// Small id helpers. Kept separate so readTools/proposalTools don't both
// re-import a crypto utility from index.ts.

import * as crypto from 'crypto';

export function generateProposalId(): string {
  return `prop_${crypto.randomBytes(8).toString('hex')}`;
}

export function generateMessageId(): string {
  return `msg_${crypto.randomBytes(8).toString('hex')}`;
}
