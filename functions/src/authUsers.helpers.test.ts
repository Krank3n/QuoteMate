/**
 * Regression tests for listAllAuthUsers: the all-user sweeps (onboarding drip,
 * re-engagement, admin analytics, announcements) used a single
 * admin.auth().listUsers(1000) call, silently ignoring every user past the
 * first page once the base grows beyond 1000.
 */
import { describe, it, expect, vi } from 'vitest';
import { listAllAuthUsers } from './authUsers.helpers';

function pagedAuth(pages: string[][]) {
  const listUsers = vi.fn(async (_max: number, pageToken?: string) => {
    const idx = pageToken ? Number(pageToken) : 0;
    return {
      users: pages[idx],
      pageToken: idx + 1 < pages.length ? String(idx + 1) : undefined,
    };
  });
  return { listUsers };
}

describe('listAllAuthUsers', () => {
  it('drains every page, not just the first (the >1000-users regression)', async () => {
    const auth = pagedAuth([['a', 'b'], ['c'], ['d', 'e']]);
    const users = await listAllAuthUsers(auth);
    expect(users).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(auth.listUsers).toHaveBeenCalledTimes(3);
    expect(auth.listUsers).toHaveBeenNthCalledWith(2, 1000, '1');
  });

  it('handles a single page', async () => {
    const auth = pagedAuth([['a']]);
    expect(await listAllAuthUsers(auth)).toEqual(['a']);
    expect(auth.listUsers).toHaveBeenCalledTimes(1);
  });

  it('handles zero users', async () => {
    const auth = pagedAuth([[]]);
    expect(await listAllAuthUsers(auth)).toEqual([]);
  });
});
