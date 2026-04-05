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
      cloud.forEach(g => merged.set(g.id, g));
      local.forEach(g => {
        if (!merged.has(g.id)) merged.set(g.id, g);
      });

      const result = Array.from(merged.values()).sort((a, b) => a.sortOrder - b.sortOrder);
      await saveGroupsToLocal(result);
      return result;
    }
  } catch {
    // Fall back to local
  }

  return local;
}

/**
 * Save a supplier group (local + cloud)
 */
export async function saveGroup(group: SupplierGroup): Promise<void> {
  const groups = await loadGroupsFromLocal();
  const existingIdx = groups.findIndex(g => g.id === group.id);
  if (existingIdx >= 0) {
    groups[existingIdx] = group;
  } else {
    groups.push(group);
  }
  await saveGroupsToLocal(groups);

  try {
    const auth = getAuth();
    if (auth.currentUser) {
      const db = getFirestore();
      await setDoc(
        doc(db, `users/${auth.currentUser.uid}/supplierGroups/${group.id}`),
        group
      );
    }
  } catch (error) {
    // silently ignore
  }
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
