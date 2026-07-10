// Serialization policy for voice-session opens. Guards the two production
// races: a double open (auto-start vs manual tap) orphaning a hot mic, and a
// stop landing mid-open resurrecting refs behind an idle UI.

import { describe, it, expect } from 'vitest';
import { createVoiceOpenGate } from '../voiceOpenGate';

describe('createVoiceOpenGate', () => {
  it('grants one open at a time — a concurrent second open is refused', () => {
    const gate = createVoiceOpenGate();
    const t1 = gate.tryBegin();
    expect(t1).not.toBeNull();
    expect(gate.tryBegin()).toBeNull(); // manual tap during auto-start
  });

  it('releases on end so a later open can begin', () => {
    const gate = createVoiceOpenGate();
    const t1 = gate.tryBegin()!;
    gate.end(t1);
    expect(gate.tryBegin()).not.toBeNull();
  });

  it('invalidate cancels an in-flight open: its token goes stale', () => {
    const gate = createVoiceOpenGate();
    const t1 = gate.tryBegin()!;
    expect(gate.isCurrent(t1)).toBe(true);
    gate.invalidate(); // stopVoiceSession ran mid-open
    expect(gate.isCurrent(t1)).toBe(false);
  });

  it('a stop immediately releases the gate for a fresh open (stop → re-tap)', () => {
    const gate = createVoiceOpenGate();
    gate.tryBegin();
    gate.invalidate();
    const t2 = gate.tryBegin();
    expect(t2).not.toBeNull();
    expect(gate.isCurrent(t2!)).toBe(true);
  });

  it('a stale end from a cancelled open cannot release a newer open', () => {
    const gate = createVoiceOpenGate();
    const t1 = gate.tryBegin()!;
    gate.invalidate();          // stop cancels open #1
    const t2 = gate.tryBegin()!; // user re-taps; open #2 in flight
    gate.end(t1);               // open #1's finally fires late
    expect(gate.tryBegin()).toBeNull(); // gate still held by #2
    expect(gate.isCurrent(t2)).toBe(true);
  });

  it('tokens are never reused across opens', () => {
    const gate = createVoiceOpenGate();
    const t1 = gate.tryBegin()!;
    gate.end(t1);
    const t2 = gate.tryBegin()!;
    expect(t2).not.toBe(t1);
    expect(gate.isCurrent(t1)).toBe(false);
  });
});
