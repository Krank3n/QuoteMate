import type { JobTemplate } from '../types';
import type { NicheJobTemplate } from '../data/nicheTemplates';

// High-value Australian trade terms and brands that the system recogniser
// commonly turns into ordinary words (Ekodeck → "echo deck", tip fees →
// "tip face", carpenter's time → "carpenters hi"). These are hints only;
// iOS feeds them to SFSpeechRecognitionRequest.contextualStrings and Android
// 13+ uses EXTRA_BIASING_STRINGS.
const COMMON_JOB_TERMS = [
  'Ekodeck',
  'ModWood',
  'Makita',
  'Diablo',
  'composite decking',
  'decking boards',
  'subfloor',
  'joists',
  'bearers',
  'materials list',
  'enough materials',
  'fixings',
  'hidden clips',
  'starter clips',
  'demolition',
  'rubbish removal',
  'tip fee',
  'tip fees',
  "carpenter's time",
  'carpenter hire',
  'labour hours',
  'millimetres',
  'square metres',
  '185 millimetre blade',
];

/** Build a deduplicated recogniser vocabulary for the selected job type. */
export function buildJobDictationContext(
  template?: JobTemplate | NicheJobTemplate | null,
): string[] {
  const niche = template as NicheJobTemplate | null | undefined;
  const dynamic = [
    template?.name,
    ...(niche?.suggestedMaterials || []),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  const seen = new Set<string>();
  return [...COMMON_JOB_TERMS, ...dynamic].filter((term) => {
    const key = term.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
