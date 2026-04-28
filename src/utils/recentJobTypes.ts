import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@quotemate:recent_job_types';
const MAX_TRACKED = 12;

export async function getRecentJobTypeIds(): Promise<string[]> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function recordJobTypeUsed(id: string): Promise<void> {
  if (!id) return;
  try {
    const existing = await getRecentJobTypeIds();
    const next = [id, ...existing.filter(x => x !== id)].slice(0, MAX_TRACKED);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Silent — this is a UX nicety, not critical state.
  }
}

export function sortByRecency<T extends { id: string }>(items: T[], recentIds: string[]): T[] {
  if (recentIds.length === 0) return items;
  const rank = new Map<string, number>();
  recentIds.forEach((id, idx) => rank.set(id, idx));
  return [...items].sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id)! : Number.POSITIVE_INFINITY;
    const rb = rank.has(b.id) ? rank.get(b.id)! : Number.POSITIVE_INFINITY;
    return ra - rb;
  });
}
