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

/** An email as typed: blank is none; otherwise it has to look like one address. */
export function parseCrewEmail(raw: string): { email?: string; error?: string } {
  const text = String(raw ?? '').trim();
  if (!text) return {};
  if (!/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}$/.test(text)) {
    return { error: "That email doesn't look right." };
  }
  return { email: text.toLowerCase() };
}

export function addCrewMember(crew: CrewMember[] | undefined, name: string, costRate?: number, email?: string): CrewMember[] {
  const member: CrewMember = {
    id: generateId(),
    name,
    ...(costRate ? { costRate } : {}),
    ...(email ? { email } : {}),
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

/**
 * Find the crew member a spoken or typed name means — "Jake", "jake smith",
 * "the apprentice Priya". Exact name first, then a unique first-name match,
 * then a unique name that starts with what was said. Anything ambiguous or
 * unknown comes back as an error naming who IS on the crew, so Mate asks
 * rather than guessing whose hours these are.
 */
export function matchCrewMember(
  crew: CrewMember[] | undefined,
  spoken: string,
): { member?: CrewMember; error?: string } {
  const people = activeCrew(crew);
  const said = String(spoken ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const roster = people.map((c) => c.name).join(', ');
  if (!people.length) {
    return { error: "There's no one on the crew list yet — add them under Settings → Crew, or log it as the tradie's own time." };
  }
  if (!said) return { error: `Who worked it? On the crew: ${roster}.` };
  const exact = people.filter((c) => c.name.toLowerCase() === said);
  if (exact.length === 1) return { member: exact[0] };
  const words = said.split(' ');
  const byFirst = people.filter((c) => words.includes(c.name.split(' ')[0].toLowerCase()));
  if (byFirst.length === 1) return { member: byFirst[0] };
  const byPrefix = people.filter((c) => c.name.toLowerCase().startsWith(said));
  if (byPrefix.length === 1) return { member: byPrefix[0] };
  if (byFirst.length > 1 || byPrefix.length > 1) {
    const which = (byFirst.length > 1 ? byFirst : byPrefix).map((c) => c.name).join(' or ');
    return { error: `More than one person matches "${spoken}" — ${which}? Ask which.` };
  }
  return { error: `"${spoken}" isn't on the crew list. On the crew: ${roster}. Ask who, or add them under Settings → Crew.` };
}
