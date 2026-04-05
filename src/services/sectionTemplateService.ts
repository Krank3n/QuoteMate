/**
 * Section Template Service
 *
 * Manages reusable section templates (assemblies) with local + cloud sync.
 * A section template captures a group of materials + labor settings
 * that can be dropped into new quotes.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirestore, doc, setDoc, getDoc, getDocs, deleteDoc, collection } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { SectionTemplate } from '../types';

const STORAGE_KEY = 'section_templates';

/**
 * Load all section templates from local storage
 */
export async function loadTemplatesFromLocal(): Promise<SectionTemplate[]> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    // silently ignore
    return [];
  }
}

/**
 * Save all section templates to local storage
 */
async function saveTemplatesToLocal(templates: SectionTemplate[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  } catch (error) {
    // silently ignore
  }
}

/**
 * Load templates from cloud (Firestore)
 */
export async function loadTemplatesFromCloud(): Promise<SectionTemplate[]> {
  try {
    const auth = getAuth();
    if (!auth.currentUser) return [];

    const db = getFirestore();
    const snapshot = await getDocs(
      collection(db, `users/${auth.currentUser.uid}/sectionTemplates`)
    );

    return snapshot.docs.map(doc => doc.data() as SectionTemplate);
  } catch (error) {
    // silently ignore
    return [];
  }
}

/**
 * Load templates — local first, then sync with cloud
 */
export async function loadTemplates(): Promise<SectionTemplate[]> {
  const local = await loadTemplatesFromLocal();

  // Try to sync with cloud in background
  try {
    const cloud = await loadTemplatesFromCloud();
    if (cloud.length > 0) {
      // Merge: cloud wins for matching IDs, keep local-only items
      const cloudMap = new Map(cloud.map(t => [t.id, t]));
      const localMap = new Map(local.map(t => [t.id, t]));

      const merged = new Map<string, SectionTemplate>();
      // Add all cloud items
      cloud.forEach(t => merged.set(t.id, t));
      // Add local-only items
      local.forEach(t => {
        if (!merged.has(t.id)) merged.set(t.id, t);
      });

      const result = Array.from(merged.values());
      await saveTemplatesToLocal(result);
      return result;
    }
  } catch {
    // Fall back to local
  }

  return local;
}

/**
 * Save a section template (local + cloud)
 */
export async function saveTemplate(template: SectionTemplate): Promise<void> {
  // Update local
  const templates = await loadTemplatesFromLocal();
  const existingIdx = templates.findIndex(t => t.id === template.id);
  if (existingIdx >= 0) {
    templates[existingIdx] = template;
  } else {
    templates.push(template);
  }
  await saveTemplatesToLocal(templates);

  // Sync to cloud
  try {
    const auth = getAuth();
    if (auth.currentUser) {
      const db = getFirestore();
      // Strip undefined values — Firestore rejects them
      const cleanTemplate = JSON.parse(JSON.stringify(template));
      await setDoc(
        doc(db, `users/${auth.currentUser.uid}/sectionTemplates/${template.id}`),
        cleanTemplate
      );
    }
  } catch (error) {
    // silently ignore
  }
}

/**
 * Delete a section template (local + cloud)
 */
export async function deleteTemplate(templateId: string): Promise<void> {
  // Remove from local
  const templates = await loadTemplatesFromLocal();
  const filtered = templates.filter(t => t.id !== templateId);
  await saveTemplatesToLocal(filtered);

  // Remove from cloud
  try {
    const auth = getAuth();
    if (auth.currentUser) {
      const db = getFirestore();
      await deleteDoc(
        doc(db, `users/${auth.currentUser.uid}/sectionTemplates/${templateId}`)
      );
    }
  } catch (error) {
    // silently ignore
  }
}

// ── Keyword matching utilities ──────────────────────────────────────

const STOP_WORDS = new Set(['standard', 'basic', 'premium', 'custom', 'default', 'general', 'typical', 'normal', 'regular']);

/**
 * Check if a keyword phrase appears in the job text.
 * Handles plurals by also checking keyword+"s" and keyword minus trailing "s".
 */
function phraseMatchesText(phrase: string, text: string): boolean {
  const p = phrase.toLowerCase().trim();
  const t = text.toLowerCase();
  if (t.includes(p)) return true;
  // Handle plurals: "fence bay" matches "fence bays"
  if (t.includes(p + 's')) return true;
  if (p.endsWith('s') && t.includes(p.slice(0, -1))) return true;
  // Handle plural of last word: "fence bays" matches text with "fence bay"
  const words = p.split(/\s+/);
  if (words.length > 1) {
    const lastWord = words[words.length - 1];
    const withoutPlural = [...words.slice(0, -1), lastWord.endsWith('s') ? lastWord.slice(0, -1) : lastWord + 's'].join(' ');
    if (t.includes(withoutPlural)) return true;
  }
  return false;
}

/**
 * Match templates against job text using keywords.
 * Checks explicit keywords first, then falls back to template name as phrase (minus stop words).
 */
export function matchTemplatesByKeywords(
  templates: SectionTemplate[],
  jobText: string
): { templateId: string; matchedKeyword: string }[] {
  if (!jobText.trim()) return [];
  const matches: { templateId: string; matchedKeyword: string }[] = [];

  for (const t of templates) {
    // Check explicit keywords first
    if (t.keywords && t.keywords.length > 0) {
      const matched = t.keywords.find(kw => phraseMatchesText(kw, jobText));
      if (matched) {
        matches.push({ templateId: t.id, matchedKeyword: matched });
        continue;
      }
    }
    // Fallback: use template name as phrase (strip stop words)
    const namePhrase = t.name
      .toLowerCase()
      .split(/\s+/)
      .filter(w => !STOP_WORDS.has(w))
      .join(' ')
      .trim();
    if (namePhrase.length > 3 && phraseMatchesText(namePhrase, jobText)) {
      matches.push({ templateId: t.id, matchedKeyword: namePhrase });
    }
  }

  return matches;
}

/**
 * Extract a quantity from job text near a keyword.
 * Matches patterns like "4 fence bays", "fence bays x4", "4x fence bay".
 */
export function extractQuantityForKeyword(
  jobText: string,
  keyword: string
): number | null {
  const text = jobText.toLowerCase();
  const kw = keyword.toLowerCase().trim();
  // Build regex-safe keyword that also handles plural
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pluralEscaped = kw.endsWith('s')
    ? escaped.slice(0, -1) + 's?'
    : escaped + 's?';

  const patterns = [
    // "4 fence bays", "4x fence bays", "4 x fence bays"
    new RegExp(`(\\d+)\\s*x?\\s+${pluralEscaped}\\b`, 'i'),
    // "fence bays x4", "fence bays x 4"
    new RegExp(`${pluralEscaped}\\s*x\\s*(\\d+)`, 'i'),
    // "fence bays 4" (number right after keyword)
    new RegExp(`${pluralEscaped}\\s+(\\d+)\\b`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const num = parseInt(match[1] || match[2], 10);
      if (num > 0 && num < 1000) return num;
    }
  }
  return null;
}

/**
 * Auto-suggest keywords from a template name.
 * Strips common adjectives and returns the remaining phrase as a keyword candidate.
 */
export function suggestKeywordsFromName(name: string): string[] {
  const phrase = name
    .toLowerCase()
    .split(/\s+/)
    .filter(w => !STOP_WORDS.has(w) && w.length > 1)
    .join(' ')
    .trim();
  return phrase.length > 2 ? [phrase] : [];
}
