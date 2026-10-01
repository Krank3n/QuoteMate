import { describe, it, expect } from 'vitest';
import {
  activeCrew,
  matchCrewMember,
  addCrewMember,
  archiveCrewMember,
  cleanCrewName,
  crewLinkMessage,
  crewLinkUrl,
  parseCostRate,
  parseCrewEmail,
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

describe('finding who Mate means', () => {
  const crew = [
    { id: 'j', name: 'Jake Smith', createdAt: 1 },
    { id: 'p', name: 'Priya', createdAt: 1 },
    { id: 'jt', name: 'Jake Tran', createdAt: 1 },
    { id: 'old', name: 'Shane', createdAt: 1, archived: true },
  ];

  it('takes the full name, a unique first name, or the start of a name', () => {
    expect(matchCrewMember(crew, 'jake smith').member?.id).toBe('j');
    expect(matchCrewMember(crew, 'Priya').member?.id).toBe('p');
    expect(matchCrewMember(crew, 'the apprentice Priya').member?.id).toBe('p');
    expect(matchCrewMember(crew, 'pri').member?.id).toBe('p');
  });

  it('asks rather than guesses when two people match', () => {
    const r = matchCrewMember(crew, 'Jake');
    expect(r.member).toBeUndefined();
    expect(r.error).toMatch(/Jake Smith or Jake Tran/);
  });

  it("refuses someone who isn't on the crew — including someone taken off it", () => {
    expect(matchCrewMember(crew, 'Dave').error).toMatch(/isn't on the crew list.*Jake Smith, Priya, Jake Tran/);
    expect(matchCrewMember(crew, 'Shane').member).toBeUndefined();
    expect(matchCrewMember([], 'Jake').error).toMatch(/no one on the crew list/);
  });
});

describe('a crew member\'s email', () => {
  it('is optional, tidied, and has to look like one address', () => {
    expect(parseCrewEmail('')).toEqual({});
    expect(parseCrewEmail('  Jake@Rivo.com.au ')).toEqual({ email: 'jake@rivo.com.au' });
    expect(parseCrewEmail('jake at rivo').error).toBeTruthy();
    expect(parseCrewEmail('a@b.com, c@d.com').error).toBeTruthy();
  });

  it('is kept on the crew member when added', () => {
    const [jake] = addCrewMember(undefined, 'Jake', undefined, 'jake@rivo.com.au');
    expect(jake).toMatchObject({ name: 'Jake', email: 'jake@rivo.com.au' });
  });
});
