/**
 * Supplier Group Service
 *
 * Manages user-defined supplier groups for scoping material searches.
 * Local storage + cloud sync pattern matching materialFavorites.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirestore, doc, setDoc, getDocs, deleteDoc, collection } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { SupplierGroup } from '../types';

const STORAGE_KEY = 'supplier_groups';

/**
 * Load all supplier groups from local storage
 */
export async function loadGroupsFromLocal(): Promise<SupplierGroup[]> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    // silently ignore
    return [];
  }
}

/**
 * Save all supplier groups to local storage
 */
async function saveGroupsToLocal(groups: SupplierGroup[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  } catch (error) {
    // silently ignore
  }
}

/**
 * Load groups from cloud (Firestore)
 */
export async function loadGroupsFromCloud(): Promise<SupplierGroup[]> {
  try {
    const auth = getAuth();
    if (!auth.currentUser) return [];

    const db = getFirestore();
    const snapshot = await getDocs(
      collection(db, `users/${auth.currentUser.uid}/supplierGroups`)
    );

    return snapshot.docs.map(doc => doc.data() as SupplierGroup);
  } catch (error) {
    // silently ignore
    return [];
  }
}

/**
 * Load groups — local first, then sync with cloud
 */
export async function loadGroups(): Promise<SupplierGroup[]> {
  const local = await loadGroupsFromLocal();

  try {
    const cloud = await loadGroupsFromCloud();
    if (cloud.length > 0) {
      const merged = new Map<string, SupplierGroup>();
      const seenNames = new Set<string>();
      cloud.forEach(g => {
        const key = g.name.trim().toLowerCase();
        if (!seenNames.has(key)) {
          merged.set(g.id, g);
          seenNames.add(key);
        }
      });
      local.forEach(g => {
        const key = g.name.trim().toLowerCase();
        if (!merged.has(g.id) && !seenNames.has(key)) {
          merged.set(g.id, g);
          seenNames.add(key);
        }
      });

      const result = Array.from(merged.values()).sort((a, b) => a.sortOrder - b.sortOrder);
      await saveGroupsToLocal(result);
      return result;
    }
  } catch {
    // Fall back to local
  }

  // Deduplicate local-only results by name as well
  const seen = new Set<string>();
  const deduped = local.filter(g => {
    const key = g.name.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return deduped;
}

/**
 * Save a supplier group (local + cloud)
 */
export async function saveGroup(group: SupplierGroup): Promise<void> {
  const groups = await loadGroupsFromLocal();
  const existingIdx = groups.findIndex(g => g.id === group.id);
  // Also check for an existing group with the same name but different ID
  const nameKey = group.name.trim().toLowerCase();
  const existingByName = existingIdx < 0
    ? groups.findIndex(g => g.name.trim().toLowerCase() === nameKey)
    : -1;
  const targetIdx = existingIdx >= 0 ? existingIdx : existingByName;
  if (targetIdx >= 0) {
    groups[targetIdx] = { ...groups[targetIdx], ...group };
  } else {
    groups.push(group);
  }
  await saveGroupsToLocal(groups);

  try {
    const auth = getAuth();
    if (auth.currentUser) {
      const db = getFirestore();
      // Firestore rejects raw `undefined` — strip optional fields that aren't set.
      const cleaned = Object.fromEntries(
        Object.entries(group).filter(([, v]) => v !== undefined)
      );
      await setDoc(
        doc(db, `users/${auth.currentUser.uid}/supplierGroups/${group.id}`),
        cleaned
      );
    }
  } catch (error) {
    // silently ignore
  }
}

/**
 * Look up a supplier group by name (case-insensitive).
 * Returns null if no match. Used to join the materialFavorites supplier
 * string back to its SupplierGroup record (e.g. for contact details).
 */
export async function getSupplierGroupByName(name: string): Promise<SupplierGroup | null> {
  if (!name) return null;
  const target = name.trim().toLowerCase();
  const groups = await loadGroups();
  return groups.find(g => g.name.trim().toLowerCase() === target) || null;
}

/**
 * Delete a supplier group (local + cloud)
 */
export async function deleteGroup(groupId: string): Promise<void> {
  const groups = await loadGroupsFromLocal();
  const filtered = groups.filter(g => g.id !== groupId);
  await saveGroupsToLocal(filtered);

  try {
    const auth = getAuth();
    if (auth.currentUser) {
      const db = getFirestore();
      await deleteDoc(
        doc(db, `users/${auth.currentUser.uid}/supplierGroups/${groupId}`)
      );
    }
  } catch (error) {
    // silently ignore
  }
}
