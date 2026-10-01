/**
 * Crew time links — a private link per crew member to send their hours in
 * without an account. The server (functions/src/crewTime.ts) keeps only a
 * hash of each token; the owner's crew list keeps the token itself so the
 * link can be shared again.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';

/**
 * Mint a fresh link for a crew member. Any link they had stops working.
 * With `email`, the server also emails it to the address saved on the crew
 * member — `emailed` says whether that went.
 */
export async function createCrewLink(
  crewId: string,
  opts: { email?: boolean } = {},
): Promise<{ token: string; emailed?: boolean }> {
  const callable = httpsCallable<{ crewId: string; email?: boolean }, { token: string; emailed?: boolean }>(
    getFunctions(),
    'createCrewLink',
  );
  const { data } = await callable({ crewId, ...(opts.email ? { email: true } : {}) });
  if (!data?.token) throw new Error("Couldn't make the link. Try again in a moment.");
  return data;
}

/** Turn a crew member's link off. */
export async function revokeCrewLink(crewId: string): Promise<void> {
  const callable = httpsCallable<{ crewId: string }, { ok: boolean }>(getFunctions(), 'revokeCrewLink');
  await callable({ crewId });
}
