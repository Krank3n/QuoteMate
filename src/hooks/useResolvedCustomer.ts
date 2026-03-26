/**
 * useResolvedCustomer
 * Resolves live contact data for a quote/invoice.
 * If the document has a contactId, returns the current contact's data.
 * Otherwise falls back to the inline snapshot fields on the document.
 */

import { useMemo } from 'react';
import { useStore } from '../store/useStore';

interface DocumentWithCustomer {
  contactId?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  jobAddress?: string;
}

interface ResolvedCustomer {
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  jobAddress?: string;
  website?: string;
  businessName?: string;
  contactId?: string;
  /** True if data comes from a linked contact (not just the inline snapshot) */
  isLinked: boolean;
}

export function useResolvedCustomer(doc: DocumentWithCustomer | null): ResolvedCustomer | null {
  const contacts = useStore((s) => s.contacts);

  return useMemo(() => {
    if (!doc) return null;

    if (doc.contactId) {
      const contact = contacts.find((c) => c.id === doc.contactId);
      if (contact) {
        return {
          customerName: contact.name,
          customerEmail: contact.email,
          customerPhone: contact.phone,
          jobAddress: contact.address || doc.jobAddress,
          website: contact.website,
          businessName: contact.businessName,
          contactId: contact.id,
          isLinked: true,
        };
      }
    }

    // Fallback to inline snapshot
    return {
      customerName: doc.customerName,
      customerEmail: doc.customerEmail,
      customerPhone: doc.customerPhone,
      jobAddress: doc.jobAddress,
      contactId: doc.contactId,
      isLinked: false,
    };
  }, [doc, contacts]);
}
