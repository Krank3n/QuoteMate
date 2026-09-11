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

export interface NotificationTapNavigatorDeps {
  /**
   * RootNavigator — home of every screen a push can name — is mounted. It
   * mounts only after onboarding finishes; navigating before then throws
   * "not handled by any navigator" (Sentry #163).
   */
  isMainAppMounted: () => boolean;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  /** A navigate that threw, for reporting. The tap is dropped either way. */
  onError?: (err: unknown, route: PushRoute) => void;
}

export type NotificationTapOutcome = 'navigated' | 'held' | 'ignored';

export interface NotificationTapNavigator {
  /**
   * Act on a tapped notification's data payload. Navigates now when the main
   * app is up; otherwise holds the route until flush(). `key` de-duplicates
   * one tap that reaches us twice — the live listener and the launch-response
   * lookup can both report the tap that started the process.
   */
  handle(data: unknown, key?: string): NotificationTapOutcome;
  /** Once the main app has mounted: navigate the held route, if any. */
  flush(): boolean;
}

/**
 * Where a notification tap goes, and WHEN.
 *
 * A "Quote accepted" push that arrives while the phone is in a pocket is
 * opened cold. The live response listener is registered after sign-in, and
 * whether the OS replays a launch tap to it differs by platform, so the app
 * also asks for the launch response outright (getLaunchNotificationResponse).
 * That lookup used to be attribution-only: the tradie who tapped "{customer}
 * accepted your quote" landed on the dashboard and had to find the job
 * themselves. Now both paths land here, a tap that arrives before
 * RootNavigator is mounted is held until it is, and a tap seen from both
 * sides navigates once.
 */
export function createNotificationTapNavigator(
  deps: NotificationTapNavigatorDeps,
): NotificationTapNavigator {
  const seen = new Set<string>();
  let held: PushRoute | null = null;

  const go = (route: PushRoute): boolean => {
    try {
      deps.navigate(route.screen, route.params);
      return true;
    } catch (err) {
      deps.onError?.(err, route);
      return false;
    }
  };

  return {
    handle(data, key) {
      if (key) {
        if (seen.has(key)) return 'ignored';
        seen.add(key);
      }
      const route = routeForNotification(data);
      if (!route) return 'ignored';
      if (!deps.isMainAppMounted()) {
        // The newest tap wins: it is the one the tradie is asking for.
        held = route;
        return 'held';
      }
      // A tap that navigates now supersedes anything still held from before
      // the app was up — otherwise a later gate toggle would replay it.
      held = null;
      go(route);
      return 'navigated';
    },
    flush() {
      if (!held || !deps.isMainAppMounted()) return false;
      const route = held;
      held = null;
      return go(route);
    },
  };
}
