// Client-side lookup for the July 2026 deletion-incident recovery.
// accountReclaims/{email} maps a wrongly-deleted account's email to its old
// uid. App.tsx uses it as a last-chance veto before wiping local data: if
// the email signing in used to own exactly the account this device last
// held, it's the same person re-registering — their local data must survive
// so it can re-upload to the new account.

import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

export async function fetchReclaimedOldUid(email: string): Promise<string | null> {
  try {
    const snap = await getDoc(doc(db, 'accountReclaims', email.trim().toLowerCase()));
    if (!snap.exists()) return null;
    const oldUid = snap.data()?.oldUid;
    return typeof oldUid === 'string' && oldUid ? oldUid : null;
  } catch {
    // Offline or rules denial — treat as no record. The caller's default
    // behaviour (wipe on genuine identity change) then stands.
    return null;
  }
}
