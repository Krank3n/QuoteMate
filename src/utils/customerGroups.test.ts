/**
 * Jobs carry no reliable link to a customer — `Job.customerId` is declared but
 * almost never written — so these group by a derived key, and the whole design
 * question is how eagerly to merge.
 *
 * The answer is "conservatively", and it's an asymmetry about money: a split
 * shows Jane twice and each owed figure is short, which is visible and
 * annoying. A wrong MERGE blends two different Jane Smiths into one row with a
 * combined owed total, so the tradie rings the wrong Jane about money she
 * doesn't owe — silently, with nothing on screen to say the row is fiction.
 * Most of the cases below exist to pin that choice.
 */
import { describe, it, expect } from 'vitest';

import {
  computeCustomerRollup,
  customerKeyFor,
  customerKeyForJob,
  findCustomerGroup,
  groupJobsByCustomer,
  jobCountByJobId,
  normaliseCustomerName,
} from './customerGroups';

const DAY = 24 * 60 * 60 * 1000;
const T = 1_700_000_000_000;

function job(over: Record<string, any> = {}): any {
  return {
    id: 'job1',
    stage: 'inquiry',
    name: 'A job',
    customerName: 'Jane Smith',
    createdAt: T,
    updatedAt: T,
    ...over,
  };
}

function invoice(over: Record<string, any> = {}): any {
  return {
    id: 'inv1',
    type: 'invoice',
    stage: 'invoice_sent',
    total: 1000,
    paidTotal: 0,
    ...over,
  };
}

function quote(over: Record<string, any> = {}): any {
  return { id: 'q1', type: 'quote', stage: 'draft', total: 1000, paidTotal: 0, ...over };
}

function docsMap(entries: Record<string, any[]>): Map<string, any[]> {
  return new Map(Object.entries(entries));
}

function jobsById(jobs: any[]): Map<string, any> {
  return new Map(jobs.map((j) => [j.id, j]));
}

describe('normaliseCustomerName', () => {
  it('folds case and padding', () => {
    expect(normaliseCustomerName('  JANE   Smith ')).toBe(normaliseCustomerName('jane smith'));
  });

  it('sorts tokens so a reversed name folds the same way', () => {
    expect(normaliseCustomerName('Smith, Jane')).toBe(normaliseCustomerName('Jane Smith'));
  });

  it('treats punctuation as a separator, matching tokenize and normaliseSiteText', () => {
    expect(normaliseCustomerName("O'Brien-Smith")).toBe(normaliseCustomerName('smith o brien'));
  });

  it('therefore keeps "OBrien" and "O\'Brien" apart — a split is the safe error, a wrong merge is not', () => {
    // Consistency with the rest of the codebase's folding wins here. If this
    // ever needs to change, it must change in textMatch.tokenize too.
    expect(normaliseCustomerName("O'Brien")).not.toBe(normaliseCustomerName('OBrien'));
  });

  it('returns an empty string for nothing usable', () => {
    expect(normaliseCustomerName('')).toBe('');
    expect(normaliseCustomerName(undefined)).toBe('');
    expect(normaliseCustomerName('!!!')).toBe('');
  });
});

describe('customerKeyFor — precedence', () => {
  it('prefers the linked contact id over any typed field', () => {
    const key = customerKeyFor({
      customerId: 'contact-9',
      customerName: 'Jane Smith',
      customerPhone: '0400 123 456',
    });
    expect(key).toEqual({ key: 'c:contact-9', basis: 'contact' });
  });

  it('falls back to the phone when there is no contact id', () => {
    expect(customerKeyFor({ customerName: 'Jane', customerPhone: '0400 123 456' }).basis).toBe(
      'phone',
    );
  });

  it('falls back to email when there is no phone', () => {
    expect(customerKeyFor({ customerName: 'Jane', customerEmail: 'J@x.com' })).toEqual({
      key: 'e:j@x.com',
      basis: 'email',
    });
  });

  it('prefers phone over email so a shared family inbox cannot merge two customers', () => {
    const a = customerKeyFor({ customerPhone: '0400 111 111', customerEmail: 'home@x.com' });
    const b = customerKeyFor({ customerPhone: '0400 222 222', customerEmail: 'home@x.com' });
    expect(a.key).not.toBe(b.key);
  });

  it('falls back to the folded name last', () => {
    expect(customerKeyFor({ customerName: 'Jane Smith' })).toEqual({
      key: 'n:jane smith',
      basis: 'name',
    });
  });

  it('returns an empty key when there is no name, phone or email — nameless jobs must never pile into one fake customer', () => {
    expect(customerKeyFor({})).toEqual({ key: '', basis: 'none' });
  });

  it('ignores a phone too short to be distinctive', () => {
    expect(customerKeyFor({ customerName: 'Jane', customerPhone: '123' }).basis).toBe('name');
  });
});

describe('customerKeyFor — the real-world messes', () => {
  it('treats "0400 123 456", "0400123456" and "+61 400 123 456" as one customer', () => {
    const keys = ['0400 123 456', '0400123456', '+61 400 123 456'].map(
      (customerPhone) => customerKeyFor({ customerPhone }).key,
    );
    expect(new Set(keys).size).toBe(1);
  });

  it('keeps two Jane Smiths on different numbers apart — a merged owed total has you chasing the wrong person', () => {
    const a = customerKeyFor({ customerName: 'Jane Smith', customerPhone: '0400 111 111' });
    const b = customerKeyFor({ customerName: 'Jane Smith', customerPhone: '0400 222 222' });
    expect(a.key).not.toBe(b.key);
  });

  it('folds case and padding: "Jane Smith", "jane smith" and "JANE  SMITH" are one key', () => {
    const keys = ['Jane Smith', 'jane smith', 'JANE  SMITH'].map(
      (customerName) => customerKeyFor({ customerName }).key,
    );
    expect(new Set(keys).size).toBe(1);
  });

  it('folds a reversed name: "Smith, Jane" keys the same as "Jane Smith"', () => {
    expect(customerKeyFor({ customerName: 'Smith, Jane' }).key).toBe(
      customerKeyFor({ customerName: 'Jane Smith' }).key,
    );
  });

  it('never sounds names alike: "Smith" and "Smythe" stay separate keys', () => {
    expect(customerKeyFor({ customerName: 'Jane Smith' }).key).not.toBe(
      customerKeyFor({ customerName: 'Jane Smythe' }).key,
    );
  });

  it('does not use the address, so two owners of one rental unit stay separate', () => {
    const a = customerKeyFor({ customerName: 'Jane Smith' });
    const b = customerKeyFor({ customerName: 'Bob Jones' });
    expect(a.key).not.toBe(b.key);
  });
});

describe('customerKeyForJob', () => {
  it('uses a document contactId when the job has no customerId — that is where the wizard actually records the link', () => {
    const key = customerKeyForJob(job({ customerPhone: '0400 111 111' }), [
      quote({ contactId: 'contact-7' }),
    ]);
    expect(key).toEqual({ key: 'c:contact-7', basis: 'contact' });
  });

  it('prefers the job customerId over a document contactId', () => {
    const key = customerKeyForJob(job({ customerId: 'job-link' }), [
      quote({ contactId: 'doc-link' }),
    ]);
    expect(key.key).toBe('c:job-link');
  });

  it('yields the same key whatever order the attached documents arrive in', () => {
    const docs = [
      quote({ id: 'a', contactId: 'older', createdAt: T }),
      quote({ id: 'b', contactId: 'newer', createdAt: T + DAY }),
    ];
    const forward = customerKeyForJob(job(), docs);
    const backward = customerKeyForJob(job(), [...docs].reverse());
    expect(forward).toEqual(backward);
    expect(forward.key).toBe('c:newer');
  });

  it('ignores documents with no contactId', () => {
    const key = customerKeyForJob(job({ customerPhone: '0400 111 111' }), [quote()]);
    expect(key.basis).toBe('phone');
  });
});

describe('groupJobsByCustomer', () => {
  it('puts every groupable job in exactly one group', () => {
    const jobs = [
      job({ id: 'a', customerName: 'Jane Smith' }),
      job({ id: 'b', customerName: 'Bob Jones' }),
      job({ id: 'c', customerName: 'Jane Smith' }),
    ];
    const groups = groupJobsByCustomer(jobs);
    const allIds = groups.flatMap((g) => g.jobIds).sort();
    expect(allIds).toEqual(['a', 'b', 'c']);
    expect(groups).toHaveLength(2);
  });

  it('leaves un-keyable jobs out of every group rather than inventing an "Unknown" customer', () => {
    const jobs = [job({ id: 'ghost', customerName: '' }), job({ id: 'real' })];
    const groups = groupJobsByCustomer(jobs);
    expect(groups.flatMap((g) => g.jobIds)).toEqual(['real']);
  });

  it('counts three jobs for one repeat customer and flags isRepeat', () => {
    const jobs = ['a', 'b', 'c'].map((id) => job({ id }));
    const [group] = groupJobsByCustomer(jobs);
    expect(group.jobCount).toBe(3);
    expect(group.isRepeat).toBe(true);
  });

  it('does not flag a single-job customer as repeat', () => {
    const [group] = groupJobsByCustomer([job()]);
    expect(group.isRepeat).toBe(false);
  });

  it('shows the spelling the tradie used most recently as the display name', () => {
    const jobs = [
      job({ id: 'old', customerName: 'jane smith', updatedAt: T, customerPhone: '0400111111' }),
      job({ id: 'new', customerName: 'Jane Smith', updatedAt: T + DAY, customerPhone: '0400111111' }),
    ];
    expect(groupJobsByCustomer(jobs)[0].name).toBe('Jane Smith');
  });

  it('fills a missing phone on the group from a later job that has one', () => {
    const jobs = [
      job({ id: 'a', customerName: 'Jane Smith', updatedAt: T }),
      job({ id: 'b', customerName: 'Jane Smith', updatedAt: T + DAY, customerPhone: '0400 111 111' }),
    ];
    // Both key on the name (the first has no phone), so they group, and the
    // group carries the number.
    const groups = groupJobsByCustomer(jobs);
    expect(groups[0].phone).toBe('0400 111 111');
  });

  it('produces identical groups when the job array is reversed', () => {
    const jobs = [
      job({ id: 'a', customerName: 'Jane Smith', updatedAt: T }),
      job({ id: 'b', customerName: 'Bob Jones', updatedAt: T + DAY }),
      job({ id: 'c', customerName: 'Jane Smith', updatedAt: T + 2 * DAY }),
    ];
    const forward = groupJobsByCustomer(jobs);
    const backward = groupJobsByCustomer([...jobs].reverse());
    expect(backward).toEqual(forward);
  });

  it('orders each group’s jobIds newest-first, matching the list', () => {
    const jobs = [
      job({ id: 'older', stage: 'quoted', quotedAt: T }),
      job({ id: 'newer', stage: 'quoted', quotedAt: T + DAY }),
    ];
    expect(groupJobsByCustomer(jobs)[0].jobIds).toEqual(['newer', 'older']);
  });

  it('dates last activity from the job’s stage stamp so it matches the date on the card', () => {
    const jobs = [job({ id: 'a', stage: 'quoted', quotedAt: T + 5 * DAY, updatedAt: T })];
    expect(groupJobsByCustomer(jobs)[0].lastActivityMs).toBe(T + 5 * DAY);
  });

  it('puts the most recently active customer first', () => {
    const jobs = [
      job({ id: 'a', customerName: 'Stale Sam', stage: 'quoted', quotedAt: T }),
      job({ id: 'b', customerName: 'Fresh Fran', stage: 'quoted', quotedAt: T + 5 * DAY }),
    ];
    expect(groupJobsByCustomer(jobs).map((g) => g.name)).toEqual(['Fresh Fran', 'Stale Sam']);
  });
});

describe('groupJobsByCustomer — the alias pass', () => {
  it('folds a phone-keyed job into a contact-keyed group when the phone matches exactly one contact', () => {
    const jobs = [
      job({ id: 'linked', customerName: 'Jane Smith', customerPhone: '0400 111 111' }),
      job({ id: 'loose', customerName: 'Jane Smith', customerPhone: '0400 111 111' }),
    ];
    const docs = docsMap({ linked: [quote({ contactId: 'contact-1' })] });
    const groups = groupJobsByCustomer(jobs, docs);
    expect(groups).toHaveLength(1);
    expect(groups[0].jobIds.sort()).toEqual(['linked', 'loose']);
    expect(groups[0].basis).toBe('contact');
  });

  it('leaves a phone-keyed job alone when two contacts claim the same phone — ambiguity must not merge', () => {
    const jobs = [
      job({ id: 'c1', customerName: 'Jane Smith', customerPhone: '0400 111 111' }),
      job({ id: 'c2', customerName: 'Jane Smith', customerPhone: '0400 111 111' }),
      job({ id: 'loose', customerName: 'Jane Smith', customerPhone: '0400 111 111' }),
    ];
    const docs = docsMap({
      c1: [quote({ id: 'd1', contactId: 'contact-1' })],
      c2: [quote({ id: 'd2', contactId: 'contact-2' })],
    });
    const groups = groupJobsByCustomer(jobs, docs);
    // Two contact groups plus the untouched phone group.
    expect(groups).toHaveLength(3);
    expect(groups.find((g) => g.jobIds.includes('loose'))!.basis).toBe('phone');
  });

  it('folds by name when that is the only alias, and only one contact claims it', () => {
    const jobs = [
      job({ id: 'linked', customerName: 'Jane Smith' }),
      job({ id: 'loose', customerName: 'Jane Smith' }),
    ];
    const docs = docsMap({ linked: [quote({ contactId: 'contact-1' })] });
    expect(groupJobsByCustomer(jobs, docs)).toHaveLength(1);
  });

  it('does not fold a customer who shares nothing with the contact group', () => {
    const jobs = [
      job({ id: 'linked', customerName: 'Jane Smith' }),
      job({ id: 'other', customerName: 'Bob Jones' }),
    ];
    const docs = docsMap({ linked: [quote({ contactId: 'contact-1' })] });
    expect(groupJobsByCustomer(jobs, docs)).toHaveLength(2);
  });

  it('folds the same way whatever order the jobs arrive in', () => {
    const jobs = [
      job({ id: 'linked', customerName: 'Jane Smith', customerPhone: '0400 111 111' }),
      job({ id: 'loose', customerName: 'Jane Smith', customerPhone: '0400 111 111' }),
    ];
    const docs = docsMap({ linked: [quote({ contactId: 'contact-1' })] });
    const forward = groupJobsByCustomer(jobs, docs);
    const backward = groupJobsByCustomer([...jobs].reverse(), docs);
    expect(backward).toEqual(forward);
  });
});

describe('computeCustomerRollup', () => {
  function rollupFor(jobs: any[], docs: Record<string, any[]>) {
    const groups = groupJobsByCustomer(jobs, docsMap(docs));
    return computeCustomerRollup(groups[0], jobsById(jobs), docsMap(docs));
  }

  it('sums owed across two unpaid invoices on different jobs', () => {
    const jobs = [job({ id: 'a' }), job({ id: 'b' })];
    const docs = {
      a: [invoice({ id: 'i1', total: 1000, paidTotal: 0 })],
      b: [invoice({ id: 'i2', total: 500, paidTotal: 0 })],
    };
    expect(rollupFor(jobs, docs).owed).toBe(1500);
  });

  it('counts a part-paid invoice at its remaining balance, not its total', () => {
    const jobs = [job({ id: 'a' })];
    const docs = { a: [invoice({ total: 1000, paidTotal: 400 })] };
    expect(rollupFor(jobs, docs).owed).toBe(600);
  });

  it("won't let an overpaid invoice cancel out another invoice's debt", () => {
    const jobs = [job({ id: 'a' })];
    const docs = {
      a: [
        invoice({ id: 'i1', total: 1000, paidTotal: 1500 }),
        invoice({ id: 'i2', total: 800, paidTotal: 0 }),
      ],
    };
    expect(rollupFor(jobs, docs).owed).toBe(800);
  });

  it('ignores cancelled documents in every total', () => {
    const jobs = [job({ id: 'a' })];
    const docs = { a: [invoice({ total: 1000, paidTotal: 0, stage: 'cancelled' })] };
    const rollup = rollupFor(jobs, docs);
    expect(rollup.owed).toBe(0);
    expect(rollup.totalInvoiced).toBe(0);
    expect(rollup.docCount).toBe(0);
  });

  it('treats a within-half-a-cent balance as settled, matching bucketForJob', () => {
    const jobs = [job({ id: 'a' })];
    const docs = { a: [invoice({ total: 1000, paidTotal: 999.999 })] };
    expect(rollupFor(jobs, docs).owed).toBe(0);
  });

  it('recomputes owed from total minus paidTotal rather than trusting a stale stored balanceDue', () => {
    const jobs = [job({ id: 'a' })];
    const docs = { a: [invoice({ total: 1000, paidTotal: 1000, balanceDue: 999 })] };
    expect(rollupFor(jobs, docs).owed).toBe(0);
  });

  it("sums quoted and invoiced separately so a quote that became an invoice isn't double-counted", () => {
    const jobs = [job({ id: 'a' })];
    const docs = { a: [quote({ id: 'q', total: 900 }), invoice({ id: 'i', total: 1000 })] };
    const rollup = rollupFor(jobs, docs);
    expect(rollup.totalQuoted).toBe(900);
    expect(rollup.totalInvoiced).toBe(1000);
  });

  it('sums what has actually been paid', () => {
    const jobs = [job({ id: 'a' })];
    const docs = { a: [invoice({ total: 1000, paidTotal: 250 })] };
    expect(rollupFor(jobs, docs).totalPaid).toBe(250);
  });

  it('returns zeros for a customer with no documents', () => {
    const rollup = rollupFor([job({ id: 'a' })], {});
    expect(rollup.owed).toBe(0);
    expect(rollup.totalQuoted).toBe(0);
    expect(rollup.totalInvoiced).toBe(0);
    expect(rollup.docCount).toBe(0);
  });

  it('dates first and last activity from the jobs’ stage stamps', () => {
    const jobs = [
      job({ id: 'a', stage: 'quoted', quotedAt: T }),
      job({ id: 'b', stage: 'quoted', quotedAt: T + 5 * DAY }),
    ];
    const rollup = rollupFor(jobs, {});
    expect(rollup.firstActivityMs).toBe(T);
    expect(rollup.lastActivityMs).toBe(T + 5 * DAY);
  });
});

describe('jobCountByJobId', () => {
  it('reports each job’s customer job count so a card can show the repeat marker', () => {
    const jobs = [
      job({ id: 'a', customerName: 'Jane Smith' }),
      job({ id: 'b', customerName: 'Jane Smith' }),
      job({ id: 'c', customerName: 'Bob Jones' }),
    ];
    const counts = jobCountByJobId(groupJobsByCustomer(jobs));
    expect(counts.get('a')).toBe(2);
    expect(counts.get('b')).toBe(2);
    expect(counts.get('c')).toBe(1);
  });

  it('omits un-keyable jobs, so their cards show no marker', () => {
    const counts = jobCountByJobId(groupJobsByCustomer([job({ id: 'ghost', customerName: '' })]));
    expect(counts.get('ghost')).toBeUndefined();
  });
});

describe('findCustomerGroup', () => {
  const jobs = [
    job({ id: 'a', customerName: 'Jane Smith', customerPhone: '0400 111 111' }),
    job({ id: 'b', customerName: 'Jane Smith', customerPhone: '0400 111 111' }),
  ];
  const groups = groupJobsByCustomer(jobs);

  it('finds a group by its exact key', () => {
    expect(findCustomerGroup(groups, { key: groups[0].key })!.jobCount).toBe(2);
  });

  it('falls back to the phone when the contact key never made it onto the jobs', () => {
    // Tapping a saved contact hands us c:<id>, but these jobs grouped on phone.
    // An exact-key-only lookup would claim this customer has no jobs.
    const found = findCustomerGroup(groups, {
      key: 'c:contact-99',
      phone: '0400 111 111',
      name: 'Jane Smith',
    });
    expect(found).not.toBeNull();
    expect(found!.jobCount).toBe(2);
  });

  it('falls back to the name when there is no phone to match on', () => {
    const nameOnly = groupJobsByCustomer([job({ id: 'a', customerName: 'Bob Jones' })]);
    expect(findCustomerGroup(nameOnly, { key: 'c:x', name: 'Bob Jones' })).not.toBeNull();
  });

  it('prefers the phone alias over the name alias, matching the key precedence', () => {
    const mixed = groupJobsByCustomer([
      job({ id: 'p', customerName: 'Jane Smith', customerPhone: '0400 111 111' }),
      job({ id: 'n', customerName: 'Jane Smith', customerPhone: '0400 222 222' }),
    ]);
    const found = findCustomerGroup(mixed, {
      phone: '0400 222 222',
      name: 'Jane Smith',
    });
    expect(found!.jobIds).toEqual(['n']);
  });

  it('returns null for a contact with no jobs yet — a real state, not an error', () => {
    expect(findCustomerGroup(groups, { key: 'c:nobody', name: 'Nobody Here' })).toBeNull();
  });

  it('returns null when given nothing to match on', () => {
    expect(findCustomerGroup(groups, {})).toBeNull();
  });
});
