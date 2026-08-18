import { describe, expect, it, vi } from 'vitest';
import { runPushPermissionPrompt, PromptDeps } from '../pushPermissionPrompt';

function deps(overrides: Partial<PromptDeps> = {}) {
  const base: PromptDeps = {
    hasPermission: vi.fn(async () => false),
    canAskPermission: vi.fn(async () => true),
    register: vi.fn(async () => 'ExpoPushToken[abc]'),
    wasAsked: vi.fn(async () => false),
    markAsked: vi.fn(async () => {}),
    // Accept by default.
    confirm: vi.fn((onAccept: () => void) => onAccept()),
  };
  return { ...base, ...overrides };
}

describe('push permission prompt timing', () => {
  it('asks after a real send and registers on acceptance', async () => {
    const d = deps();
    await expect(runPushPermissionPrompt(d)).resolves.toBe('granted');
    expect(d.confirm).toHaveBeenCalled();
    expect(d.register).toHaveBeenCalled();
    expect(d.markAsked).toHaveBeenCalled();
  });

  it('never asks on a test send to the tradie themselves', async () => {
    const d = deps();
    await expect(runPushPermissionPrompt(d, { isSelfSend: true })).resolves.toBe('self_send');
    expect(d.confirm).not.toHaveBeenCalled();
    expect(d.register).not.toHaveBeenCalled();
    // The one ask must still be available for a real send later.
    expect(d.markAsked).not.toHaveBeenCalled();
  });

  it('does nothing when permission is already granted', async () => {
    const d = deps({ hasPermission: vi.fn(async () => true) });
    await expect(runPushPermissionPrompt(d)).resolves.toBe('already_on');
    expect(d.confirm).not.toHaveBeenCalled();
  });

  it('asks only once, so every later send is silent', async () => {
    const d = deps({ wasAsked: vi.fn(async () => true) });
    await expect(runPushPermissionPrompt(d)).resolves.toBe('already_asked');
    expect(d.confirm).not.toHaveBeenCalled();
  });

  it('stays quiet when the OS will no longer show a prompt', async () => {
    // iOS after a decline: asking again is a guaranteed no-op.
    const d = deps({ canAskPermission: vi.fn(async () => false) });
    await expect(runPushPermissionPrompt(d)).resolves.toBe('blocked');
    expect(d.confirm).not.toHaveBeenCalled();
    expect(d.register).not.toHaveBeenCalled();
  });

  it('does not spend the OS prompt when the tradie declines our own dialog', async () => {
    const d = deps({ confirm: vi.fn((_a: () => void, onDecline: () => void) => onDecline()) });
    await expect(runPushPermissionPrompt(d)).resolves.toBe('declined');
    // This is the whole point of the soft ask: the OS prompt is untouched.
    expect(d.register).not.toHaveBeenCalled();
  });

  it('reports a decline when the OS prompt itself is refused', async () => {
    const d = deps({ register: vi.fn(async () => null) });
    await expect(runPushPermissionPrompt(d)).resolves.toBe('declined');
    expect(d.markAsked).toHaveBeenCalled();
  });

  it('checks permission before burning the one-ask flag', async () => {
    const order: string[] = [];
    const d = deps({
      hasPermission: vi.fn(async () => { order.push('hasPermission'); return false; }),
      wasAsked: vi.fn(async () => { order.push('wasAsked'); return false; }),
      markAsked: vi.fn(async () => { order.push('markAsked'); }),
    });
    await runPushPermissionPrompt(d);
    expect(order).toEqual(['hasPermission', 'wasAsked', 'markAsked']);
  });
});
