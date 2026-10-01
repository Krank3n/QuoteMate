import { describe, it, expect } from 'vitest';
import {
  activeCrew,
  addCrewMember,
  archiveCrewMember,
  cleanCrewName,
  crewLinkMessage,
  crewLinkUrl,
  parseCostRate,
  updateCrewMember,
} from './crew';

describe('the crew list', () => {
  it('adds, renames and takes people off, keeping them on record', () => {
    let crew = addCrewMember(undefined, 'Jake', 45);
    crew = addCrewMember(crew, 'Priya');
    expect(crew.map((c) => [c.name, c.costRate])).toEqual([['Jake', 45], ['Priya', undefined]]);
    const [jake] = crew;
    crew = updateCrewMember(crew, jake.id, { name: 'Jake B' });
    expect(crew[0]).toMatchObject({ id: jake.id, name: 'Jake B', costRate: 45 });
    crew = archiveCrewMember(updateCrewMember(crew, jake.id, { linkToken: 't', linkIssuedAt: 1 }), jake.id);
    expect(crew).toHaveLength(2);
    expect(crew[0]).toMatchObject({ archived: true, linkToken: undefined });
    expect(activeCrew(crew).map((c) => c.name)).toEqual(['Priya']);
  });

  it('wants a name, and not one already on the crew', () => {
    const crew = addCrewMember(undefined, 'Jake');
    expect(cleanCrewName('   ', crew).error).toBeTruthy();
    expect(cleanCrewName(' jake ', crew).error).toMatch(/already/);
    expect(cleanCrewName('  Jake   Smith ', crew).name).toBe('Jake Smith');
    // Renaming someone to their own name is fine.
    expect(cleanCrewName('Jake', crew, crew[0].id).name).toBe('Jake');
    // Someone taken off the crew frees the name.
    expect(cleanCrewName('Jake', archiveCrewMember(crew, crew[0].id)).name).toBe('Jake');
  });

  it('reads a cost rate, blank meaning none', () => {
    expect(parseCostRate('')).toEqual({});
    expect(parseCostRate('$45.50')).toEqual({ rate: 45.5 });
    expect(parseCostRate('0').error).toBeTruthy();
    expect(parseCostRate('heaps').error).toBeTruthy();
  });

  it("writes the link text in the business's name, not the app's", () => {
    const msg = crewLinkMessage('Jake Smith', 'Rivo Plumbing', 'tok/+=');
    expect(msg).toBe(`G'day Jake, here's your link to put your hours in for Rivo Plumbing: ${crewLinkUrl('tok/+=')}`);
    expect(crewLinkUrl('tok/+=')).toBe('https://quotemateapp.au/t?token=tok%2F%2B%3D');
  });
});
