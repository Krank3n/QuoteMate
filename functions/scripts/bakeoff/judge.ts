/**
 * Blind head-to-head judge.
 *
 * The arms are shuffled and relabelled A/B/C per job, and the judge is never
 * told which pipeline produced which quote — otherwise "the one with real SKU
 * names" or "the tidy one" wins on presentation. It sees only the customer's
 * scope and three bills of materials.
 *
 * This scorer covers what arithmetic cannot: did the quote include the things
 * the job actually needs, and are the QUANTITIES sane for the described work?
 * A line can price a real SKU perfectly and still be 10850 kg of adhesive.
 */

import { askJson } from './claude';
import { ArmResult, CorpusJob } from './types';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['quotes', 'bestLabel', 'worstLabel', 'comment'],
  properties: {
    quotes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'completeness', 'quantitySanity', 'priceSanity', 'sendable', 'missingItems', 'worstProblem'],
        properties: {
          label: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
          completeness: { type: 'integer', enum: [1, 2, 3, 4, 5], description: 'Does it cover the materials the described scope actually needs? 5 = nothing important missing.' },
          quantitySanity: { type: 'integer', enum: [1, 2, 3, 4, 5], description: '5 = every quantity is derivable from the scope; 1 = quantities are wild.' },
          priceSanity: { type: 'integer', enum: [1, 2, 3, 4, 5], description: '5 = every line price is plausible for Australian retail; 1 = prices are implausible.' },
          sendable: { type: 'boolean', description: 'Would an Australian tradie send this to a customer without reworking it?' },
          missingItems: { type: 'array', items: { type: 'string' }, description: 'Materials the scope needs that this quote omits.' },
          worstProblem: { type: 'string', description: 'The single worst defect, naming the line.' },
        },
      },
    },
    bestLabel: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
    worstLabel: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
    comment: { type: 'string' },
  },
} as const;

function render(r: ArmResult): string {
  if (r.error) return `  (this quote failed to generate: ${r.error})`;
  if (r.lines.length === 0) return '  (no materials)';
  const lines = r.lines
    .map(
      (l) =>
        `  - ${l.name} | needs ${l.requiredQty} ${l.requiredUnit} | buy ${l.quantity} ${l.unit} @ $${l.unitPrice} = $${l.totalPrice}${l.productName ? ` | product: ${l.productName}` : ''}`,
    )
    .join('\n');
  return `${lines}\n  MATERIALS SUBTOTAL: $${r.materialsSubtotal}${r.estimatedHours ? ` | labour est: ${r.estimatedHours} h` : ''}`;
}

export interface JudgeResult {
  perLabel: Record<string, any>;
  bestLabel: string;
  worstLabel: string;
  comment: string;
  /** label -> arm name, so callers can de-anonymise after the fact. */
  mapping: Record<string, string>;
}

export async function judgeBlind(job: CorpusJob, arms: ArmResult[]): Promise<JudgeResult | null> {
  // Shuffle so label position carries no information about which arm it is.
  const shuffled = [...arms].sort(() => Math.random() - 0.5);
  const labels = ['A', 'B', 'C', 'D'];
  const mapping: Record<string, string> = {};
  shuffled.forEach((r, i) => {
    mapping[labels[i]] = r.arm;
  });

  const body = shuffled.map((r, i) => `QUOTE ${labels[i]}:\n${render(r)}`).join('\n\n');

  try {
    const { value } = await askJson<any>(
      `Several different systems quoted the same job. Judge them on the merits — you are not told which system produced which, and the ordering is random.

Judge each on: does it include what the job needs, are the quantities derivable from the scope, and are the prices plausible for Australian retail today.

Be strict about quantities. A line that prices a real product perfectly but asks for ten times what the job needs is a worse defect than a slightly-off price.

CUSTOMER'S JOB SCOPE:
${job.jobDescription}

${body}`,
      SCHEMA as any,
      {
        system: 'You are a senior Australian estimator reviewing quotes before they go to customers. You are blunt about defects.',
        effort: 'high',
        maxTokens: 64000,
      },
    );
    const perLabel: Record<string, any> = {};
    for (const q of value.quotes || []) perLabel[q.label] = q;
    return { perLabel, bestLabel: value.bestLabel, worstLabel: value.worstLabel, comment: value.comment, mapping };
  } catch (err: any) {
    console.warn(`  judge failed: ${String(err?.message || err).slice(0, 140)}`);
    return null;
  }
}
