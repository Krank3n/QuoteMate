/**
 * Editing a customer, when "a customer" is a derived group rather than a record.
 *
 * The jobs list groups jobs by a key derived from whatever identifies the
 * customer — a linked contact id if one exists, otherwise their phone, email or
 * name (see customerGroups). That works for reading. It is dangerous for
 * WRITING, for one specific reason:
 *
 *   Editing the phone or the name CHANGES THE KEY. The screen you are standing
 *   on refers to a key that no longer exists, so a customer with four jobs
 *   suddenly reads "No jobs yet".
 *
 * So editing doesn't just write fields — it PROMOTES the group to a real
 * Contact and stamps `customerId` on every job in it. After that the group's
 * key is `c:<contactId>`, which no later rename or number change can move. The
 * act of editing is what turns a derived pile into a durable customer record,
 * which is also how the Contacts list starts filling itself from real work
 * instead of manual entry.
 *
 * Two things this deliberately does NOT do:
 *
 *   - It never writes the customer's address onto a job's `jobAddress`. Those
 *     are different facts: a customer has one address, and their jobs can be at
 *     five different sites. Overwriting sites from a customer record would
 *     silently relocate finished work.
 *   - It doesn't touch jobs outside the group, so an edit can never reach
 *     another customer's records.
 *
 * Kept pure (no store, no firebase) so the fan-out is unit-testable — the same
 * split localDataReset uses.
 */

import type { Job } from '../../shared/job/types';
import type { Document } from '../types/document';
import type { Contact } from '../types';
import { createContact, updateContact } from './contactRecord';
import { customerKeyFor, type CustomerGroup } from './customerGroups';

export interface CustomerEditFields {
  name: string;
  businessName?: string;
  email?: string;
  phone?: string;
  /** The customer's own address. Never fanned out to job sites. */
  address?: string;
  website?: string;
  notes?: string;
}

export interface CustomerEditPlan {
  /** The Contact to save — created if the group had none. */
  contact: Contact;
  contactIsNew: boolean;
  /** Only the jobs whose fields actually change. */
  jobs: Job[];
  /** Only the documents whose fields actually change. */
  documents: Document[];
  /**
   * The key the screen must switch to after saving. Always `c:<id>`, because
   * every job in the group is now linked to the contact.
   */
  nextCustomerKey: string;
}

function trimmed(v?: string | null): string {
  return (v || '').trim();
}

/**
 * Find the Contact this group already corresponds to, if any.
 *
 * A contact-keyed group names its contact directly. Otherwise we look for a
 * contact that would derive the SAME key as the group — i.e. one the tradie
 * already saved with this phone / email / name — so editing links to it rather
 * than creating a duplicate alongside it.
 */
export function findContactForGroup(
  group: CustomerGroup,
  contacts: Contact[],
): Contact | undefined {
  if (group.basis === 'contact') {
    const id = group.key.slice(2);
    const byId = contacts.find((c) => c.id.toLowerCase() === id);
    if (byId) return byId;
  }
  return contacts.find(
    (c) =>
      customerKeyFor({
        customerName: c.name,
        customerPhone: c.phone,
        customerEmail: c.email,
      }).key === group.key,
  );
}

export function planCustomerEdit(input: {
  group: CustomerGroup;
  jobsById: Map<string, Job>;
  docsByJob: Map<string, Document[]>;
  contacts: Contact[];
  fields: CustomerEditFields;
}): CustomerEditPlan {
  const { group, jobsById, docsByJob, contacts, fields } = input;

  const name = trimmed(fields.name);
  const email = trimmed(fields.email) || undefined;
  const phone = trimmed(fields.phone) || undefined;

  const existing = findContactForGroup(group, contacts);
  const details = {
    name,
    businessName: trimmed(fields.businessName) || undefined,
    email,
    phone,
    address: trimmed(fields.address) || undefined,
    website: trimmed(fields.website) || undefined,
    notes: trimmed(fields.notes) || undefined,
  };

  // 'quote' is the honest source here: the contact is being materialised from
  // work already on the books, not typed into the address book.
  const contact = existing
    ? updateContact(existing, details)
    : createContact({ ...details, source: 'quote' });

  const jobs: Job[] = [];
  const documents: Document[] = [];

  for (const jobId of group.jobIds) {
    const job = jobsById.get(jobId);
    if (!job) continue;

    const needsJobPatch =
      job.customerId !== contact.id ||
      job.customerName !== name ||
      (job.customerEmail || undefined) !== email ||
      (job.customerPhone || undefined) !== phone;

    if (needsJobPatch) {
      jobs.push({
        ...job,
        customerId: contact.id,
        customerName: name,
        customerEmail: email,
        customerPhone: phone,
        // jobAddress intentionally untouched — that's the SITE, not the
        // customer. See the file header.
      });
    }

    for (const doc of docsByJob.get(jobId) ?? []) {
      if (!doc) continue;
      const needsDocPatch =
        doc.contactId !== contact.id ||
        doc.customerName !== name ||
        (doc.customerEmail || undefined) !== email ||
        (doc.customerPhone || undefined) !== phone;
      if (!needsDocPatch) continue;
      documents.push({
        ...doc,
        contactId: contact.id,
        customerName: name,
        customerEmail: email,
        customerPhone: phone,
      });
    }
  }

  return {
    contact,
    contactIsNew: !existing,
    jobs,
    documents,
    nextCustomerKey: `c:${contact.id.toLowerCase()}`,
  };
}
