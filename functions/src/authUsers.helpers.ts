/**
 * admin.auth().listUsers() returns at most 1000 users per call, so every
 * "sweep all users" job must drain the pager or it silently ignores everyone
 * past the first page. The auth client is injected (anything with a
 * listUsers method) so the pagination logic is unit testable without
 * firebase-admin.
 */
export interface AuthUserPager<U> {
  listUsers(maxResults: number, pageToken?: string): Promise<{ users: U[]; pageToken?: string }>;
}

export async function listAllAuthUsers<U>(auth: AuthUserPager<U>): Promise<U[]> {
  const all: U[] = [];
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    all.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return all;
}
