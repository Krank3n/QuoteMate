import { describe, expect, it, vi } from 'vitest';
import { createNotificationTapNavigator, routeForNotification } from '../notificationRouting';

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

describe('createNotificationTapNavigator', () => {
  const accepted = { type: 'quote_accepted', quoteId: 'q-1', jobId: 'job-1', response: 'accepted' };

  function navigator(mounted = true) {
    const state = { mounted };
    const navigate = vi.fn();
    const onError = vi.fn();
    const nav = createNotificationTapNavigator({
      isMainAppMounted: () => state.mounted,
      navigate,
      onError,
    });
    return { nav, navigate, onError, state };
  }

  it('a quote_accepted tap opens that job', () => {
    const { nav, navigate } = navigator();
    expect(nav.handle(accepted, 'default:n1')).toBe('navigated');
    expect(navigate).toHaveBeenCalledWith('ViewJob', { jobId: 'job-1' });
  });

  it('holds a tap that lands before RootNavigator is mounted, then flushes it once it is', () => {
    // A launch tap: the process was started by "{customer} accepted your
    // quote". Before this the launch lookup was attribution-only and the
    // tradie landed on the dashboard. Navigating early would throw "not
    // handled by any navigator" (Sentry #163), so it waits.
    const { nav, navigate, state } = navigator(false);
    expect(nav.handle(accepted, 'default:n1')).toBe('held');
    expect(navigate).not.toHaveBeenCalled();
    expect(nav.flush()).toBe(false); // still not mounted — keeps holding
    state.mounted = true;
    expect(nav.flush()).toBe(true);
    expect(navigate).toHaveBeenCalledWith('ViewJob', { jobId: 'job-1' });
    expect(nav.flush()).toBe(false); // consumed
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('navigates once when the live listener and the launch lookup both report the same tap', () => {
    const { nav, navigate } = navigator();
    expect(nav.handle(accepted, 'default:n1')).toBe('navigated');
    expect(nav.handle(accepted, 'default:n1')).toBe('ignored');
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('a different tap with its own key still navigates', () => {
    const { nav, navigate } = navigator();
    nav.handle(accepted, 'default:n1');
    nav.handle({ ...accepted, jobId: 'job-2' }, 'default:n2');
    expect(navigate).toHaveBeenLastCalledWith('ViewJob', { jobId: 'job-2' });
  });

  it('the newest held tap wins', () => {
    const { nav, navigate, state } = navigator(false);
    nav.handle({ jobId: 'job-old' }, 'default:n1');
    nav.handle({ jobId: 'job-new' }, 'default:n2');
    state.mounted = true;
    nav.flush();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('ViewJob', { jobId: 'job-new' });
  });

  it('ignores a payload with nowhere to go, and a keyless tap is not de-duplicated', () => {
    const { nav, navigate } = navigator();
    expect(nav.handle({ type: 'milestone' })).toBe('ignored');
    expect(nav.handle({ type: 'milestone' }, 'default:n1')).toBe('ignored');
    expect(navigate).not.toHaveBeenCalled();
    expect(nav.handle(accepted)).toBe('navigated');
    expect(nav.handle(accepted)).toBe('navigated');
  });

  it('reports a navigate that throws and drops the tap rather than rethrowing', () => {
    const { nav, navigate, onError } = navigator();
    navigate.mockImplementation(() => {
      throw new Error('not handled by any navigator');
    });
    expect(() => nav.handle(accepted, 'default:n1')).not.toThrow();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { screen: 'ViewJob', params: { jobId: 'job-1' } });
  });
});
