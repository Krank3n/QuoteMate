import { describe, it, expect } from 'vitest';
import { quoteAcceptedHook } from './email';

describe('quoteAcceptedHook — monetisation hook on the best-engaged email', () => {
  it('unconnected users get the connect-Square pitch (Path B activation)', () => {
    const hook = quoteAcceptedHook(false);
    expect(hook.tag).toBe('square-hook');
    expect(hook.line).toContain('Square');
    expect(hook.cta).toContain('get paid');
  });

  it('connected users get pointed at the card-link invoice they already have', () => {
    const hook = quoteAcceptedHook(true);
    expect(hook.tag).toBe('square-ready');
    expect(hook.line).toContain('pay by card');
    expect(hook.line).not.toContain('Connect Square');
  });

  it('variant tags are distinct so emailLogAudit can compare performance', () => {
    expect(quoteAcceptedHook(true).tag).not.toBe(quoteAcceptedHook(false).tag);
  });
});
