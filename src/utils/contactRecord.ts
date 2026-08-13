/**
 * Building and updating Contact records — the pure half of contact handling.
 *
 * Split out of contactService because that module imports expo-contacts at the
 * top level to read the phone's address book, which drags native modules into
 * anything that touches it. These two functions are plain object construction,
 * and utils that need them (customerEdit, which materialises a Contact from a
 * customer's existing jobs) must not pay for a native dependency to get there.
 *
 * contactService re-exports both, so existing callers are unaffected.
 */

import { Contact } from '../types';
import { generateId } from './generateId';

/**
 * Create a new contact with generated ID and timestamps
 */
export function createContact(
  data: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>
): Contact {
  const now = new Date().toISOString();
  return {
    ...data,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Update an existing contact, merging fields and bumping updatedAt
 */
export function updateContact(
  existing: Contact,
  updates: Partial<Omit<Contact, 'id' | 'createdAt'>>
): Contact {
  return {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
}
