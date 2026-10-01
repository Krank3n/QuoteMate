/**
 * Crew time links — a private link per crew member to send their hours in
 * without an account. The server (functions/src/crewTime.ts) keeps only a
 * hash of each token; the owner's crew list keeps the token itself so the
 * link can be shared again.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';

/** Mint a fresh link for a crew member. Any link they had stops working. */
export async function createCrewLink(crewId: string): Promise<string> {
  const callable = httpsCallable<{ crewId: string }, { token: string }>(getFunctions(), 'createCrewLink');
  const { data } = await callable({ crewId });
  if (!data?.token) throw new Error("Couldn't make the link. Try again in a moment.");
  return data.token;
}

/** Turn a crew member's link off. */
export async function revokeCrewLink(crewId: string): Promise<void> {
  const callable = httpsCallable<{ crewId: string }, { ok: boolean }>(getFunctions(), 'revokeCrewLink');
  await callable({ crewId });
}
