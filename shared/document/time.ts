/**
 * Timestamp normalisers for document records. Legacy quotes/invoices carry
 * the same instant in four shapes — epoch ms, ISO string, Date, or a
 * Firestore Timestamp (live `toDate()` or a JSON-round-tripped
 * `{seconds}`) — and the unified Document stores epoch ms only.
 *
 * Lives on its own so modules the adapter depends on (customerOpened.ts)
 * can share it without importing the adapter back.
 */

export function toMs(value: any): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return value;
  if (value instanceof Date) {
    const t = value.getTime();
    return isNaN(t) ? undefined : t;
  }
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return isNaN(t) ? undefined : t;
  }
  if (typeof value === 'object' && typeof (value as any).toDate === 'function') {
    const t = (value as any).toDate().getTime();
    return isNaN(t) ? undefined : t;
  }
  if (typeof value === 'object' && typeof (value as any).seconds === 'number') {
    return (value as any).seconds * 1000;
  }
  return undefined;
}

export function toMsRequired(value: any): number {
  return toMs(value) ?? Date.now();
}

export function fromMs(ms?: number): Date | undefined {
  return typeof ms === 'number' ? new Date(ms) : undefined;
}
