import { describe, it, expect } from 'vitest';
import * as crypto from 'crypto';
import {
  verifySentrySignature,
  parseSentryAlert,
  buildIssueTitle,
  buildIssueBody,
  dailyKey,
  SentryBug,
} from './sentryAutofix.helpers';

const SECRET = 'test-client-secret';
const sign = (body: string) => crypto.createHmac('sha256', SECRET).update(body).digest('hex');

describe('verifySentrySignature', () => {
  it('accepts a valid HMAC-SHA256 hex signature of the raw body', () => {
    const body = JSON.stringify({ action: 'triggered' });
    expect(verifySentrySignature(body, sign(body), SECRET)).toBe(true);
  });

  it('accepts a Buffer raw body (the type functions gives us)', () => {
    const body = Buffer.from('{"a":1}');
    expect(verifySentrySignature(body, sign('{"a":1}'), SECRET)).toBe(true);
  });

  it('rejects a signature computed with the wrong secret', () => {
    const body = '{"a":1}';
    const wrong = crypto.createHmac('sha256', 'other-secret').update(body).digest('hex');
    expect(verifySentrySignature(body, wrong, SECRET)).toBe(false);
  });

  it('rejects a signature for a different body (tampered payload)', () => {
    expect(verifySentrySignature('{"a":2}', sign('{"a":1}'), SECRET)).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(verifySentrySignature('{"a":1}', undefined, SECRET)).toBe(false);
  });

  it('rejects everything when no secret is configured', () => {
    const body = '{"a":1}';
    expect(verifySentrySignature(body, sign(body), '')).toBe(false);
  });

  it('rejects a malformed (wrong-length) signature without throwing', () => {
    expect(verifySentrySignature('{"a":1}', 'deadbeef', SECRET)).toBe(false);
  });
});

describe('parseSentryAlert', () => {
  const ORG = 'hansendev-0p';

  it('parses an issue-alert (event_alert) payload including in-app stack frames', () => {
    const payload = {
      action: 'triggered',
      data: {
        event: {
          issue_id: '987654',
          title: "TypeError: Cannot read property 'total' of undefined",
          culprit: 'src/screens/JobPreview.tsx in renderTotals',
          web_url: 'https://hansendev-0p.sentry.io/issues/987654/events/abc/',
          environment: 'production',
          release: '1.47.0',
          platform: 'javascript',
          exception: {
            values: [
              {
                stacktrace: {
                  frames: [
                    { filename: 'node_modules/react/index.js', function: 'render', lineno: 1, in_app: false },
                    { filename: 'src/screens/JobPreview.tsx', function: 'renderTotals', lineno: 214, in_app: true },
                  ],
                },
              },
            ],
          },
        },
      },
    };
    const bug = parseSentryAlert(payload, ORG);
    expect(bug).not.toBeNull();
    expect(bug!.issueId).toBe('987654');
    expect(bug!.title).toContain('TypeError');
    expect(bug!.environment).toBe('production');
    expect(bug!.topFrames).toEqual(['src/screens/JobPreview.tsx : renderTotals : line 214']);
  });

  it('falls back to a constructed permalink when the event has no web_url', () => {
    const bug = parseSentryAlert(
      { action: 'triggered', data: { event: { issue_id: '42', title: 'Boom' } } },
      ORG,
    );
    expect(bug!.permalink).toBe('https://hansendev-0p.sentry.io/issues/42/');
  });

  it('parses an issue-created webhook payload', () => {
    const bug = parseSentryAlert(
      {
        action: 'created',
        data: {
          issue: {
            id: '111',
            title: 'ReferenceError: x is not defined',
            culprit: 'src/utils/foo.ts',
            permalink: 'https://hansendev-0p.sentry.io/issues/111/',
            platform: 'javascript',
          },
        },
      },
      ORG,
    );
    expect(bug).toEqual(
      expect.objectContaining({ issueId: '111', permalink: 'https://hansendev-0p.sentry.io/issues/111/' }),
    );
  });

  it('returns null for installation pings and non-alert actions', () => {
    expect(parseSentryAlert({ action: 'created', data: { installation: {} } }, ORG)).toBeNull();
    expect(parseSentryAlert({ action: 'resolved', data: { issue: { id: '9' } } }, ORG)).toBeNull();
    expect(parseSentryAlert({ action: 'triggered', data: {} }, ORG)).toBeNull();
    expect(parseSentryAlert(null, ORG)).toBeNull();
    expect(parseSentryAlert('junk', ORG)).toBeNull();
  });

  it('returns null when the event has no issue id (nothing to dedupe on)', () => {
    expect(parseSentryAlert({ action: 'triggered', data: { event: { title: 'x' } } }, ORG)).toBeNull();
  });
});

describe('buildIssueTitle / buildIssueBody', () => {
  const bug: SentryBug = {
    issueId: '987654',
    title: "TypeError: Cannot read property 'total' of undefined",
    culprit: 'src/screens/JobPreview.tsx in renderTotals',
    permalink: 'https://hansendev-0p.sentry.io/issues/987654/',
    environment: 'production',
    release: '1.47.0',
    platform: 'javascript',
    topFrames: ['src/screens/JobPreview.tsx : renderTotals : line 214'],
  };

  it('prefixes the title with [Sentry] and truncates very long titles', () => {
    expect(buildIssueTitle(bug)).toBe(
      "[Sentry] TypeError: Cannot read property 'total' of undefined",
    );
    const long = buildIssueTitle({ ...bug, title: 'x'.repeat(300) });
    expect(long.length).toBeLessThanOrEqual('[Sentry] '.length + 100);
    expect(long.endsWith('...')).toBe(true);
  });

  it('includes the qm-ticket marker the agent must copy into the PR body', () => {
    expect(buildIssueBody(bug)).toContain('<!-- qm-ticket:sentry-987654 -->');
  });

  it('puts the task spec above the --- divider (agent-task.md contract)', () => {
    const body = buildIssueBody(bug);
    const [spec] = body.split('\n---\n');
    expect(spec).toContain('regression test');
    expect(spec).toContain(bug.permalink);
    expect(spec).toContain('src/screens/JobPreview.tsx : renderTotals : line 214');
  });

  it('omits empty metadata lines and the frames block when there are none', () => {
    const sparse = buildIssueBody({
      ...bug,
      culprit: '',
      environment: '',
      release: '',
      platform: '',
      topFrames: [],
    });
    expect(sparse).not.toContain('**Where:**');
    expect(sparse).not.toContain('**Release:**');
    expect(sparse).not.toContain('stack frames');
  });

  it('tells the agent to stop rather than guess on native/dependency crashes', () => {
    expect(buildIssueBody(bug)).toContain('STOP');
  });
});

describe('dailyKey', () => {
  it('buckets by UTC calendar day', () => {
    expect(dailyKey(new Date('2026-07-24T23:59:59Z'))).toBe('2026-07-24');
    expect(dailyKey(new Date('2026-07-25T00:00:01Z'))).toBe('2026-07-25');
  });
});
