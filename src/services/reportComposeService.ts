/**
 * Service Report write-up compose — client helper.
 *
 * Posts the tradie's rough notes to the `composeServiceReport` Firebase
 * Function, which proxies the text model server-side (the master key never
 * touches the device) and returns the three cleaned write-up fields plus two
 * suggestion lists. Mirrors emailService.ts for the auth header + functions
 * URL so we stay on one auth path.
 *
 * Strictly a rewrite of what the tradie typed — the server prompt forbids
 * invented detail. Facts may be REDISTRIBUTED into the field where they
 * belong (a "recommend…" line typed under work carried out comes back under
 * recommended work), so a field can return non-empty even when its own note
 * was blank; when every note is blank, everything comes back blank.
 *
 * suggestedEquipment / suggestedChecklist are optional extras extracted from
 * the notes for the tradie to review and tap to add — nothing is ever added
 * to the report automatically.
 *
 * suggestedAdditions is the same idea applied to the write-up itself: the
 * closing statements a service report normally carries ("tested after
 * servicing and left operating correctly") that the notes do not support.
 * The server refuses to write them as prose and hands them back as sentences
 * to confirm with one tap, so the report reads in full without the tool
 * asserting anything the tradie didn't.
 */

import { auth } from '../config/firebase';

const USE_EMULATOR = process.env.USE_FIREBASE_EMULATOR === 'true';
const FIREBASE_FUNCTIONS_URL = USE_EMULATOR
  ? 'http://127.0.0.1:5001/hansendev/us-central1'
  : 'https://us-central1-hansendev.cloudfunctions.net';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await auth.currentUser?.getIdToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export interface ComposeNotes {
  natureOfProblem?: string;
  workCarriedOut?: string;
  recommendedWork?: string;
}

export interface ComposeContext {
  businessName?: string;
  tradeCategory?: string;
  /** Previous visit's write-up — vocabulary reference only (see server). */
  previousWriteUp?: string;
}

export type WriteUpField = 'natureOfProblem' | 'workCarriedOut' | 'recommendedWork';

/** A claim the write-up could not assert, offered for one-tap confirmation. */
export interface ComposeAddition {
  text: string;
  field: WriteUpField;
}

export interface ComposedReport {
  natureOfProblem: string;
  workCarriedOut: string;
  recommendedWork: string;
  suggestedEquipment: string[];
  suggestedChecklist: string[];
  suggestedAdditions: ComposeAddition[];
}

const WRITE_UP_FIELDS: WriteUpField[] = [
  'natureOfProblem',
  'workCarriedOut',
  'recommendedWork',
];

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

/**
 * Re-validate the additions on the way in. The server already clamps them;
 * this is the same defensive narrowing the string lists get, so a malformed
 * reply can never put an unlabelled sentence in front of the tradie.
 */
function asAdditions(value: unknown): ComposeAddition[] {
  if (!Array.isArray(value)) return [];
  const out: ComposeAddition[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const text = typeof raw.text === 'string' ? raw.text.trim() : '';
    if (!text) continue;
    const field = WRITE_UP_FIELDS.includes(raw.field as WriteUpField)
      ? (raw.field as WriteUpField)
      : 'workCarriedOut';
    out.push({ text, field });
  }
  return out;
}

/**
 * Send the rough notes off for a clean write-up. Throws on a non-2xx reply so
 * the caller can surface a retry; the returned object always carries all five
 * keys (blank strings / empty arrays where nothing applies).
 */
export async function composeServiceReport(
  notes: ComposeNotes,
  context?: ComposeContext,
): Promise<ComposedReport> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/composeServiceReport`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ notes, context }),
  });

  if (!response.ok) {
    let message = 'Could not write up the notes. Please try again.';
    try {
      const body = await response.json();
      if (body?.error) message = String(body.error);
    } catch {
      /* keep the default message */
    }
    throw new Error(message);
  }

  const data = (await response.json()) as Partial<ComposedReport>;
  return {
    natureOfProblem: data.natureOfProblem || '',
    workCarriedOut: data.workCarriedOut || '',
    recommendedWork: data.recommendedWork || '',
    suggestedEquipment: asStringArray(data.suggestedEquipment),
    suggestedChecklist: asStringArray(data.suggestedChecklist),
    suggestedAdditions: asAdditions(data.suggestedAdditions),
  };
}
