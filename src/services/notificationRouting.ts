/**
 * Where a tapped push notification should take you.
 *
 * Previously the response handler was empty, so "Ka-ching! {customer} paid
 * {amount}" dropped the tradie on whatever screen they happened to have open
 * and left them to find the invoice themselves. A notification that can't be
 * acted on from the notification is just an interruption.
 *
 * Pure so the mapping can be tested without a navigator.
 */

export interface PushRoute {
  screen: string;
  params?: Record<string, unknown>;
}

/** Data payload attached to a push by the Cloud Functions send path. */
export interface PushData {
  type?: string;
  jobId?: string;
  quoteId?: string;
  invoiceId?: string;
  /** Set on summary pushes that cover several documents. */
  screen?: string;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Resolve a notification's data payload to a destination.
 *
 * Order matters: a specific job beats a list, and a list beats nothing. Returns
 * null when there's nothing better than where the user already is — the caller
 * then leaves them be rather than yanking them to a default screen.
 */
export function routeForNotification(data: unknown): PushRoute | null {
  if (!data || typeof data !== 'object') return null;
  const payload = data as PushData;

  // Most pushes concern one job — open it directly.
  const jobId = str(payload.jobId);
  if (jobId) {
    return { screen: 'ViewJob', params: { jobId } };
  }

  // Summary pushes (several overdue invoices, several stale drafts) and any
  // document that predates job linkage land on the list instead.
  const listHint = str(payload.screen);
  if (listHint === 'quotes' || listHint === 'invoices' || listHint === 'jobs') {
    return { screen: 'Jobs' };
  }

  // A quote/invoice we can't resolve to a job is still about work in progress,
  // so the Jobs list is the closest useful destination.
  if (str(payload.quoteId) || str(payload.invoiceId)) {
    return { screen: 'Jobs' };
  }

  return null;
}
