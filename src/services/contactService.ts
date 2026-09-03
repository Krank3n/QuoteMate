/**
 * Contact Service
 * Handles contact CRUD, phone contacts integration, and deduplication
 */

import * as ExpoContacts from 'expo-contacts';
import { Contact, SearchableContact, ContactSource } from '../types';
import { generateId } from '../utils/generateId';
import { normalizePhoneTail } from '../utils/textMatch';

// createContact / updateContact live in utils/contactRecord — this module
// imports expo-contacts to read the phone's address book, and pure utils that
// build a Contact (customerEdit) must not drag native modules in to do it.
// Re-exported here so existing callers don't move.
export { createContact, updateContact } from '../utils/contactRecord';

/**
 * Normalize an Australian phone number for comparison.
 * Strips spaces, dashes, parentheses, and country code prefix.
 * Returns the last 8 digits for matching.
 *
 * Delegates to textMatch so contact matching, Mate's findCustomer and the
 * jobs-list search all agree on what counts as the same number.
 */
export const normalizePhone = normalizePhoneTail;

/**
 * Request permission to access device contacts.
 * Returns { granted, canAskAgain } so callers know whether to retry or direct to settings.
 *
 * Checks first and asks only when asking can change the answer. On Android a
 * request for a permission that is already granted (or can no longer be
 * asked) shows no dialog, and React Native only delivers the result on the
 * next resume — so the promise never settled and Mate's contact picker hung
 * on its second use (API 36 emulator, 3 Sep 2026).
 */
export async function requestPhoneContactsPermission(): Promise<{ granted: boolean; canAskAgain: boolean }> {
  const current = await checkPhoneContactsPermission();
  if (current.granted || !current.canAskAgain) return current;
  const { status, canAskAgain } = await ExpoContacts.requestPermissionsAsync();
  return { granted: status === 'granted', canAskAgain: canAskAgain !== false };
}

/**
 * Check current phone contacts permission status
 */
export async function checkPhoneContactsPermission(): Promise<{ granted: boolean; canAskAgain: boolean }> {
  const { status, canAskAgain } = await ExpoContacts.getPermissionsAsync();
  return { granted: status === 'granted', canAskAgain: canAskAgain !== false };
}

/**
 * Map an expo-contacts Contact to our Contact type
 */
export function phoneContactToContact(expoContact: ExpoContacts.Contact): Contact {
  const name = [expoContact.firstName, expoContact.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();

  const email = expoContact.emails?.[0]?.email;
  const phone = expoContact.phoneNumbers?.[0]?.number;

  const addressParts = expoContact.addresses?.[0];
  const address = addressParts
    ? [addressParts.street, addressParts.city, addressParts.region, addressParts.postalCode]
        .filter(Boolean)
        .join(', ')
    : undefined;

  const businessName = expoContact.company || undefined;
  const website = expoContact.urlAddresses?.[0]?.url || undefined;

  const now = new Date().toISOString();
  return {
    id: generateId(),
    name: name || 'Unknown',
    businessName,
    email,
    phone,
    address,
    website,
    source: 'phone' as ContactSource,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Fetch all device phone contacts, mapped to our Contact type.
 * Used for bulk import. Filters out entries with no name.
 */
export async function getAllPhoneContacts(): Promise<Contact[]> {
  try {
    const { data } = await ExpoContacts.getContactsAsync({
      fields: [
        ExpoContacts.Fields.FirstName,
        ExpoContacts.Fields.LastName,
        ExpoContacts.Fields.Emails,
        ExpoContacts.Fields.PhoneNumbers,
        ExpoContacts.Fields.Addresses,
        ExpoContacts.Fields.Company,
        ExpoContacts.Fields.UrlAddresses,
      ],
    });

    return data
      .filter((c) => c.firstName || c.lastName)
      .map(phoneContactToContact);
  } catch (error) {
    return [];
  }
}

/**
 * Search device phone contacts by name query
 */
export async function searchPhoneContacts(
  query: string
): Promise<SearchableContact[]> {
  try {
    const { data } = await ExpoContacts.getContactsAsync({
      name: query,
      fields: [
        ExpoContacts.Fields.FirstName,
        ExpoContacts.Fields.LastName,
        ExpoContacts.Fields.Emails,
        ExpoContacts.Fields.PhoneNumbers,
        ExpoContacts.Fields.Addresses,
        ExpoContacts.Fields.Company,
        ExpoContacts.Fields.UrlAddresses,
      ],
      pageSize: 10,
      pageOffset: 0,
    });

    return data
      .filter((c) => c.firstName || c.lastName)
      .slice(0, 8)
      .map((c) => ({
        ...phoneContactToContact(c),
        searchSource: 'phone' as const,
      }));
  } catch (error) {
    return [];
  }
}

/**
 * Deduplicate contacts across sources.
 * Groups by normalized name + matching phone (last 8 digits) or email.
 * Priority: saved > xero > recent > phone
 */
export function deduplicateContacts(
  contacts: SearchableContact[]
): SearchableContact[] {
  const sourcePriority: Record<string, number> = {
    saved: 0,
    xero: 1,
    recent: 2,
    phone: 3,
  };

  const seen = new Map<string, SearchableContact>();

  // Sort by priority first so higher-priority contacts win
  const sorted = [...contacts].sort(
    (a, b) => sourcePriority[a.searchSource] - sourcePriority[b.searchSource]
  );

  for (const contact of sorted) {
    const nameKey = contact.name.toLowerCase().trim();

    // Check if we already have a contact with this name
    let isDuplicate = false;
    for (const [key, existing] of seen) {
      const existingNameKey = existing.name.toLowerCase().trim();
      if (existingNameKey !== nameKey) continue;

      // Same name — check if phone or email also matches
      const phoneMatch =
        contact.phone &&
        existing.phone &&
        normalizePhone(contact.phone) === normalizePhone(existing.phone);
      const emailMatch =
        contact.email &&
        existing.email &&
        contact.email.toLowerCase() === existing.email.toLowerCase();

      // If same name and (phone or email matches, or neither has phone/email to compare)
      if (phoneMatch || emailMatch || (!contact.phone && !contact.email)) {
        // Keep the existing (higher priority) but merge missing fields
        if (!existing.email && contact.email) existing.email = contact.email;
        if (!existing.phone && contact.phone) existing.phone = contact.phone;
        if (!existing.address && contact.address) existing.address = contact.address;
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      seen.set(`${nameKey}-${contact.searchSource}-${contact.id}`, contact);
    }
  }

  return Array.from(seen.values());
}
