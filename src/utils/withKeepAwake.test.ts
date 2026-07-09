import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withKeepAwake } from './withKeepAwake';

const mocks = vi.hoisted(() => ({
  activateKeepAwakeAsync: vi.fn(async () => {}),
  deactivateKeepAwake: vi.fn(),
}));

vi.mock('expo-keep-awake', () => mocks);

// Manually-resolvable promise so tests can control when a "run" finishes.
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('withKeepAwake', () => {
  beforeEach(() => {
    mocks.activateKeepAwakeAsync.mockClear();
    mocks.activateKeepAwakeAsync.mockImplementation(async () => {});
    mocks.deactivateKeepAwake.mockClear();
    mocks.deactivateKeepAwake.mockImplementation(() => {});
  });

  it('activates before the run and deactivates after it resolves', async () => {
    const result = await withKeepAwake(async () => {
      expect(mocks.activateKeepAwakeAsync).toHaveBeenCalledTimes(1);
      expect(mocks.deactivateKeepAwake).not.toHaveBeenCalled();
      return 'done';
    });
    expect(result).toBe('done');
    expect(mocks.deactivateKeepAwake).toHaveBeenCalledTimes(1);
    // Activate and release use the same tag, or the lock leaks.
    expect(mocks.deactivateKeepAwake.mock.calls[0][0])
      .toBe(mocks.activateKeepAwakeAsync.mock.calls[0][0]);
  });

  it('releases the lock and rethrows when the run fails', async () => {
    await expect(
      withKeepAwake(async () => { throw new Error('pipeline died'); }),
    ).rejects.toThrow('pipeline died');
    expect(mocks.deactivateKeepAwake).toHaveBeenCalledTimes(1);
  });

  it('holds one lock across overlapping runs, releasing only after the last finishes', async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const run1 = withKeepAwake(() => first.promise);
    const run2 = withKeepAwake(() => second.promise);

    // Overlap shares the one lock — no second activation.
    expect(mocks.activateKeepAwakeAsync).toHaveBeenCalledTimes(1);

    first.resolve();
    await run1;
    expect(mocks.deactivateKeepAwake).not.toHaveBeenCalled();

    second.resolve();
    await run2;
    expect(mocks.deactivateKeepAwake).toHaveBeenCalledTimes(1);
  });

  it('still runs (and completes) when the wake lock cannot be acquired', async () => {
    mocks.activateKeepAwakeAsync.mockRejectedValueOnce(new Error('no wake lock on this platform'));
    await expect(withKeepAwake(async () => 42)).resolves.toBe(42);
  });

  it('does not mask the result when releasing the lock throws', async () => {
    mocks.deactivateKeepAwake.mockImplementationOnce(() => { throw new Error('release failed'); });
    await expect(withKeepAwake(async () => 'ok')).resolves.toBe('ok');
  });

  it('re-activates for a fresh run after all prior runs finished', async () => {
    await withKeepAwake(async () => {});
    await withKeepAwake(async () => {});
    expect(mocks.activateKeepAwakeAsync).toHaveBeenCalledTimes(2);
    expect(mocks.deactivateKeepAwake).toHaveBeenCalledTimes(2);
  });
});
