import { describe, expect, it } from 'vitest';
import { resolvableNotificationRoute, routeForNotification } from '../notificationRouting';

describe('routeForNotification', () => {
  it('opens the job a notification is about', () => {
    expect(routeForNotification({ type: 'invoice_paid', jobId: 'job-1', invoiceId: 'inv-1' }))
      .toEqual({ screen: 'ViewJob', params: { jobId: 'job-1' } });
  });

  it('prefers the specific job over a list hint', () => {
    expect(routeForNotification({ jobId: 'job-9', screen: 'invoices' }))
      .toEqual({ screen: 'ViewJob', params: { jobId: 'job-9' } });
  });

  it('sends summary pushes to the jobs list', () => {
    expect(routeForNotification({ type: 'invoice_overdue', screen: 'invoices' }))
      .toEqual({ screen: 'Jobs' });
    expect(routeForNotification({ type: 'draft_nudge', screen: 'quotes' }))
      .toEqual({ screen: 'Jobs' });
  });

  it('falls back to the jobs list for a document with no job linkage', () => {
    // Quotes created before job linkage existed carry no jobId.
    expect(routeForNotification({ type: 'quote_accepted', quoteId: 'q-1' }))
      .toEqual({ screen: 'Jobs' });
    expect(routeForNotification({ type: 'invoice_paid', invoiceId: 'inv-1' }))
      .toEqual({ screen: 'Jobs' });
  });

  it('returns null when there is nothing useful to open', () => {
    expect(routeForNotification({ type: 'milestone' })).toBeNull();
    expect(routeForNotification({})).toBeNull();
    expect(routeForNotification(null)).toBeNull();
    expect(routeForNotification(undefined)).toBeNull();
    expect(routeForNotification('not-an-object')).toBeNull();
  });

  it('ignores blank and non-string ids rather than navigating to nowhere', () => {
    expect(routeForNotification({ jobId: '   ', quoteId: '' })).toBeNull();
    expect(routeForNotification({ jobId: 123 as unknown as string })).toBeNull();
  });

  it('ignores an unrecognised screen hint', () => {
    expect(routeForNotification({ screen: 'settings' })).toBeNull();
  });
});

describe('resolvableNotificationRoute', () => {
  it('resolves the route when the main app is mounted', () => {
    expect(resolvableNotificationRoute({ jobId: 'job-1' }, true))
      .toEqual({ screen: 'ViewJob', params: { jobId: 'job-1' } });
  });

  it('returns null when RootNavigator is not mounted, even with a valid route', () => {
    // Regression: a tap that lands while the user is still onboarding would
    // otherwise throw "not handled by any navigator" (Sentry issue #163).
    expect(resolvableNotificationRoute({ jobId: 'job-1' }, false)).toBeNull();
  });

  it('returns null when the payload resolves to no route', () => {
    expect(resolvableNotificationRoute({}, true)).toBeNull();
  });
});
