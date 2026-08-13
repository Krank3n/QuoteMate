/**
 * The hazard these exist for: a customer on the Customer screen is a DERIVED
 * group, keyed on phone or name when no contact is linked. Editing the phone
 * would therefore change the key, and the screen would lose its own subject —
 * "No jobs yet" for a customer with four jobs.
 *
 * planCustomerEdit defuses that by promoting the group to a real Contact and
 * stamping customerId across it, so the key becomes c:<id> and stops moving.
 * The other half of the job is restraint: an edit must not touch job SITE
 * addresses, and must not reach a job outside the group.
 */
import { describe, it, expect } from 'vitest';

import { groupJobsByCustomer } from './customerGroups';
import { findContactForGroup, planCustomerEdit } from './customerEdit';

const T = 1_700_000_000_000;

function job(over: Record<string, any> = {}): any {
  return {
    id: 'job1',
    stage: 'inquiry',
    name: 'A job',
    customerName: 'Jane Smith',
    customerPhone: '0400 111 111',
    jobAddress: '12 Smith St',
    createdAt: T,
    updatedAt: T,
    ...over,
  };
}

function doc(over: Record<string, any> = {}): any {
  return {
    id: 'doc1',
    jobId: 'job1',
    type: 'quote',
    stage: 'draft',
    customerName: 'Jane Smith',
    customerPhone: '0400 111 111',
    total: 1000,
    paidTotal: 0,
    ...over,
  };
}

function contact(over: Record<string, any> = {}): any {
  return {
    id: 'contact-1',
    name: 'Jane Smith',
    phone: '0400 111 111',
    source: 'manual',
    createdAt: new Date(T).toISOString(),
    updatedAt: new Date(T).toISOString(),
    ...over,
  };
}

/** Build a plan over a one-customer population. */
function plan(
  jobs: any[],
  docs: Record<string, any[]> = {},
  contacts: any[] = [],
  fields: Record<string, any> = { name: 'Jane Smith', phone: '0400 111 111' },
) {
  const docsByJob = new Map<string, any[]>(Object.entries(docs));
  const group = groupJobsByCustomer(jobs, docsByJob)[0];
  return planCustomerEdit({
    group,
    jobsById: new Map(jobs.map((j) => [j.id, j])),
    docsByJob,
    contacts,
    fields: fields as any,
  });
}

describe('findContactForGroup', () => {
  it('finds the contact a contact-keyed group names directly', () => {
    const jobs = [job({ customerId: 'contact-1' })];
    const group = groupJobsByCustomer(jobs)[0];
    expect(findContactForGroup(group, [contact()])?.id).toBe('contact-1');
  });

  it('finds a saved contact that derives the same key, so editing links instead of duplicating', () => {
    // Group keys on phone; the contact has that same phone.
    const group = groupJobsByCustomer([job()])[0];
    expect(findContactForGroup(group, [contact()])?.id).toBe('contact-1');
  });

  it('returns undefined when no saved contact matches', () => {
    const group = groupJobsByCustomer([job()])[0];
    expect(findContactForGroup(group, [contact({ phone: '0400 999 999', name: 'Bob' })]))
      .toBeUndefined();
  });
});

describe('planCustomerEdit — promoting the group', () => {
  it('creates a contact when the group has none, so there is something to write to', () => {
    const result = plan([job()]);
    expect(result.contactIsNew).toBe(true);
    expect(result.contact.name).toBe('Jane Smith');
  });

  it('reuses an existing contact rather than creating a duplicate beside it', () => {
    const result = plan([job()], {}, [contact()]);
    expect(result.contactIsNew).toBe(false);
    expect(result.contact.id).toBe('contact-1');
  });

  it('marks a contact materialised from real work as coming from a quote, not manual entry', () => {
    expect(plan([job()]).contact.source).toBe('quote');
  });

  it('stamps customerId on every job in the group', () => {
    const jobs = [job({ id: 'a' }), job({ id: 'b' }), job({ id: 'c' })];
    const result = plan(jobs);
    expect(result.jobs.map((j) => j.id).sort()).toEqual(['a', 'b', 'c']);
    for (const j of result.jobs) expect(j.customerId).toBe(result.contact.id);
  });

  it('REGRESSION: returns a stable c:<id> key, so renaming does not strand the screen', () => {
    // The group keys on phone. Change the phone — the derived key would move,
    // but the key the screen switches to must be the contact instead.
    const result = plan([job()], {}, [], {
      name: 'Jane Smith',
      phone: '0400 222 222',
    });
    expect(result.nextCustomerKey).toBe(`c:${result.contact.id.toLowerCase()}`);
  });

  it('changing the name and number still lands every job under the one stable key', () => {
    const jobs = [job({ id: 'a' }), job({ id: 'b' })];
    const result = plan(jobs, {}, [], { name: 'Jane Smyth', phone: '0400 222 222' });
    for (const j of result.jobs) {
      expect(j.customerId).toBe(result.contact.id);
      expect(j.customerName).toBe('Jane Smyth');
      expect(j.customerPhone).toBe('0400 222 222');
    }
  });
});

describe('planCustomerEdit — what it must not touch', () => {
  it("never overwrites a job's site address from the customer's address", () => {
    const jobs = [job({ id: 'a', jobAddress: '12 Smith St' })];
    const result = plan(jobs, {}, [], {
      name: 'Jane Smith',
      phone: '0400 111 111',
      address: '99 Postal Rd',
    });
    expect(result.jobs[0].jobAddress).toBe('12 Smith St');
    expect(result.contact.address).toBe('99 Postal Rd');
  });

  it('leaves two different job sites for one customer both intact', () => {
    const jobs = [
      job({ id: 'a', jobAddress: '12 Smith St' }),
      job({ id: 'b', jobAddress: '400 Rental Ave' }),
    ];
    const result = plan(jobs, {}, [], {
      name: 'Jane Smith',
      phone: '0400 111 111',
      address: '99 Postal Rd',
    });
    const byId = new Map(result.jobs.map((j) => [j.id, j.jobAddress]));
    expect(byId.get('a')).toBe('12 Smith St');
    expect(byId.get('b')).toBe('400 Rental Ave');
  });

  it('never patches a job belonging to another customer', () => {
    const jobs = [
      job({ id: 'jane' }),
      job({ id: 'bob', customerName: 'Bob Jones', customerPhone: '0400 999 999' }),
    ];
    const docsByJob = new Map<string, any[]>();
    const janeGroup = groupJobsByCustomer(jobs, docsByJob).find((g) =>
      g.jobIds.includes('jane'),
    )!;
    const result = planCustomerEdit({
      group: janeGroup,
      jobsById: new Map(jobs.map((j) => [j.id, j])),
      docsByJob,
      contacts: [],
      fields: { name: 'Jane Smith', phone: '0400 111 111' },
    });
    expect(result.jobs.map((j) => j.id)).toEqual(['jane']);
  });

  it('patches nothing when the details are already correct', () => {
    const existing = contact();
    const jobs = [job({ customerId: existing.id })];
    const result = plan(jobs, {}, [existing], {
      name: 'Jane Smith',
      phone: '0400 111 111',
    });
    expect(result.jobs).toEqual([]);
    expect(result.documents).toEqual([]);
  });

  it('does not mutate the jobs it was given', () => {
    const original = job();
    const before = { ...original };
    plan([original], {}, [], { name: 'Changed Name', phone: '0400 222 222' });
    expect(original).toEqual(before);
  });
});

describe('planCustomerEdit — documents', () => {
  it('fans the corrected details onto the attached documents too', () => {
    const jobs = [job({ id: 'a' })];
    const result = plan(jobs, { a: [doc({ jobId: 'a' })] }, [], {
      name: 'Jane Smyth',
      phone: '0400 222 222',
    });
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].customerName).toBe('Jane Smyth');
    expect(result.documents[0].customerPhone).toBe('0400 222 222');
  });

  it('links the documents to the contact so a later contact edit reaches them', () => {
    const jobs = [job({ id: 'a' })];
    const result = plan(jobs, { a: [doc({ jobId: 'a' })] });
    expect(result.documents[0].contactId).toBe(result.contact.id);
  });

  it('patches every attached document, not just the primary', () => {
    const jobs = [job({ id: 'a' })];
    const result = plan(
      jobs,
      { a: [doc({ id: 'd1', jobId: 'a' }), doc({ id: 'd2', jobId: 'a' })] },
      [],
      { name: 'Jane Smyth', phone: '0400 111 111' },
    );
    expect(result.documents.map((d) => d.id).sort()).toEqual(['d1', 'd2']);
  });

  it("never overwrites a document's job address either", () => {
    const jobs = [job({ id: 'a' })];
    const result = plan(
      jobs,
      { a: [doc({ jobId: 'a', jobAddress: '12 Smith St' })] },
      [],
      { name: 'Jane Smyth', phone: '0400 111 111', address: '99 Postal Rd' },
    );
    expect(result.documents[0].jobAddress).toBe('12 Smith St');
  });

  it('clears a removed email rather than leaving the old one on the records', () => {
    const jobs = [job({ id: 'a', customerEmail: 'old@x.com' })];
    const result = plan(jobs, { a: [doc({ jobId: 'a', customerEmail: 'old@x.com' })] }, [], {
      name: 'Jane Smith',
      phone: '0400 111 111',
    });
    expect(result.jobs[0].customerEmail).toBeUndefined();
    expect(result.documents[0].customerEmail).toBeUndefined();
  });
});
