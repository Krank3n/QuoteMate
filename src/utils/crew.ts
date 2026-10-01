/**
 * The crew list on the business settings, as pure functions. Removing a
 * member archives them rather than deleting — their past time still prints
 * under their name on a timesheet.
 */

import type { CrewMember } from '../../shared/time/types';
import { generateId } from './generateId';

export const MAX_CREW_NAME = 60;

/** The people you can pick when logging time, in the order they were added. */
export function activeCrew(crew: CrewMember[] | undefined): CrewMember[] {
  return (crew ?? []).filter((c) => !c.archived);
}

/** A cost rate as the tradie typed it: blank is none, anything else must be a real positive figure. */
export function parseCostRate(raw: string): { rate?: number; error?: string } {
  const text = String(raw ?? '').trim().replace(/^\$/, '');
  if (!text) return {};
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) return { error: 'Enter what they cost you an hour, like 45.' };
  return { rate: Math.round(n * 100) / 100 };
}

/** Clean a typed name, or explain what's wrong with it. */
export function cleanCrewName(raw: string, crew: CrewMember[] | undefined, exceptId?: string): { name?: string; error?: string } {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CREW_NAME);
  if (!name) return { error: 'Give them a name.' };
  const taken = activeCrew(crew).some((c) => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase());
  if (taken) return { error: `${name} is already on your crew.` };
  return { name };
}

export function addCrewMember(crew: CrewMember[] | undefined, name: string, costRate?: number): CrewMember[] {
  const member: CrewMember = {
    id: generateId(),
    name,
    ...(costRate ? { costRate } : {}),
    createdAt: Date.now(),
  };
  return [...(crew ?? []), member];
}

export function updateCrewMember(crew: CrewMember[] | undefined, id: string, patch: Partial<CrewMember>): CrewMember[] {
  return (crew ?? []).map((c) => (c.id === id ? { ...c, ...patch, id: c.id } : c));
}

/** Off the list for good (their link goes too); past time keeps the name. */
export function archiveCrewMember(crew: CrewMember[] | undefined, id: string): CrewMember[] {
  return updateCrewMember(crew, id, { archived: true, linkToken: undefined, linkIssuedAt: undefined });
}

/** The page a crew member logs their hours on. */
export const CREW_LINK_BASE = 'https://quotemateapp.au/t';

export function crewLinkUrl(token: string): string {
  return `${CREW_LINK_BASE}?token=${encodeURIComponent(token)}`;
}

/** The text the owner sends with the link — the business name, never the app's. */
export function crewLinkMessage(memberName: string, businessName: string | undefined, token: string): string {
  const first = memberName.split(' ')[0];
  const from = businessName ? ` for ${businessName}` : '';
  return `G'day ${first}, here's your link to put your hours in${from}: ${crewLinkUrl(token)}`;
}
