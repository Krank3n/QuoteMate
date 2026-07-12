import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGraceController } from '../voiceGraceController';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createGraceController', () => {
  it('fires onExpire once when the grace runs to completion', () => {
    const onExpire = vi.fn();
    const g = createGraceController(onExpire);
    g.start(1000);
    expect(g.isRunning()).toBe(true);
    vi.advanceTimersByTime(999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(g.isRunning()).toBe(false);
  });

  it('clear() cancels a running grace without firing onExpire', () => {
    const onExpire = vi.fn();
    const g = createGraceController(onExpire);
    g.start(1000);
    g.clear();
    expect(g.isRunning()).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('start() supersedes a running grace (only the latest fires, once)', () => {
    const onExpire = vi.fn();
    const g = createGraceController(onExpire);
    g.start(15_000);           // long
    vi.advanceTimersByTime(500);
    g.start(1500);             // replace with short
    vi.advanceTimersByTime(1500);
    expect(onExpire).toHaveBeenCalledTimes(1); // the old 15s timer never fired
    vi.advanceTimersByTime(20_000);
    expect(onExpire).toHaveBeenCalledTimes(1); // and still only once
  });

  it('isRunning reflects lifecycle', () => {
    const g = createGraceController(vi.fn());
    expect(g.isRunning()).toBe(false);
    g.start(1000);
    expect(g.isRunning()).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(g.isRunning()).toBe(false);
  });
});
