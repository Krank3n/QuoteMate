import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  updateDoc,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore';
import type { SupplierPartner } from '../types';
import { deleteAllFavoritesByStore } from './materialFavorites';
import { saveGroup, deleteGroup, loadGroupsFromLocal } from './supplierGroupService';

const API_BASE = process.env.API_BASE_URL || 'https://us-central1-hansendev.cloudfunctions.net';

/**
 * Fetch all active supplier partners from Firestore.
 */
export async function fetchActiveSuppliers(): Promise<SupplierPartner[]> {
  const db = getFirestore();
  const q = query(
    collection(db, 'suppliers'),
    where('status', '==', 'active')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as SupplierPartner));
}

/**
 * Subscribe to a supplier — creates the subscriber doc (triggering server-side sync)
 * and creates a local supplier group for the Saved tab.
 */
export async function subscribeToSupplier(supplierId: string, supplierName: string): Promise<void> {
  const auth = getAuth();
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');

  const db = getFirestore();

  // Create subscriber doc (triggers onSubscriberWrite Cloud Function)
  await setDoc(
    doc(db, `suppliers/${supplierId}/subscribers/${uid}`),
    {
      subscribedAt: serverTimestamp(),
      tradieName: auth.currentUser?.displayName || undefined,
    }
  );

  // Update user doc with subscription reference
  await updateDoc(doc(db, `users/${uid}`), {
    supplierSubscriptions: arrayUnion(supplierId),
  }).catch(() => {
    // User doc may not exist yet — ignore
  });

  // Create a supplier group so items appear grouped in the Saved tab
  const groups = await loadGroupsFromLocal();
  const existingGroup = groups.find((g) => g.name === supplierName);
  if (!existingGroup) {
    await saveGroup({
      id: `partner_${supplierId}`,
      name: supplierName,
      sortOrder: groups.length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
}

/**
 * Unsubscribe from a supplier — removes subscriber doc and cleans up local data.
 */
export async function unsubscribeFromSupplier(supplierId: string, supplierName: string): Promise<void> {
  const auth = getAuth();
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');

  const db = getFirestore();

  // Delete subscriber doc (triggers onSubscriberWrite to remove synced favorites)
  await deleteDoc(doc(db, `suppliers/${supplierId}/subscribers/${uid}`));

  // Remove from user doc
  await updateDoc(doc(db, `users/${uid}`), {
    supplierSubscriptions: arrayRemove(supplierId),
  }).catch(() => {});

  // Clean up local favorites and supplier group
  await deleteAllFavoritesByStore(supplierName);
  await deleteGroup(`partner_${supplierId}`);
}

/**
 * Check for a deferred deep link after first sign-in.
 * Returns the supplierId if one was pending, or null.
 */
export async function checkDeferredLink(): Promise<string | null> {
  try {
    const auth = getAuth();
    const token = await auth.currentUser?.getIdToken();
    if (!token) return null;

    const res = await fetch(`${API_BASE}/checkPendingLink`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!res.ok) return null;

    const data = await res.json();
    return data.supplierId || null;
  } catch {
    return null;
  }
}
