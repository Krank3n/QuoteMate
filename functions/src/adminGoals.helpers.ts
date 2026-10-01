// Goals set on the admin "Goals & projections" page. One shared list for the
// whole admin team, stored as a single doc so every device sees the same goals.

export type GoalMetric = 'mrr' | 'payers';

export interface ProjectionGoal {
  id: string;
  metric: GoalMetric;
  target: number;
  /** 'YYYY-MM' — the month the target should be reached by. */
  by: string;
}

export const MAX_GOALS = 50;
const MAX_TARGET = 1e9;

// Drops anything malformed rather than rejecting the whole save: the client
// only ever sends goals it built itself, so a bad row is a bug, not intent.
export function sanitizeGoals(input: unknown): ProjectionGoal[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: ProjectionGoal[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const g = raw as Record<string, unknown>;
    const id = typeof g.id === 'string' ? g.id.trim().slice(0, 40) : '';
    const metric = g.metric === 'mrr' || g.metric === 'payers' ? g.metric : null;
    const target = typeof g.target === 'number' ? g.target : NaN;
    const by = typeof g.by === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(g.by) ? g.by : null;
    if (!id || seen.has(id) || !metric || !by) continue;
    if (!Number.isFinite(target) || target <= 0 || target > MAX_TARGET) continue;
    seen.add(id);
    out.push({ id, metric, target, by });
    if (out.length >= MAX_GOALS) break;
  }
  return out.sort((a, b) => a.by.localeCompare(b.by));
}
