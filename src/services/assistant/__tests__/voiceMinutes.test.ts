/**
 * Billing arithmetic. Both edges here are unobservable on a device and both
 * cost real money in one direction or the other.
 */
import { describe, it, expect } from 'vitest';
import { elapsedVoiceSeconds } from '../voiceMinutes';

const T = 1_700_000_000_000;

describe('elapsedVoiceSeconds', () => {
  it('measures from connect', () => {
    expect(elapsedVoiceSeconds(T, T + 187_000)).toBe(187);
  });

  it('costs nothing for a session that never connected', () => {
    // The mint, the WebRTC handshake and the mic permission prompt all happen
    // before there is anything to talk to. A tradie who denied the mic, or
    // walked out of coverage mid-handshake, owes nothing.
    expect(elapsedVoiceSeconds(null, T + 60_000)).toBe(0);
  });

  it('never returns a negative when the clock jumps backwards', () => {
    // NTP correction or a manual clock change mid-call would otherwise hand
    // back minutes the tradie never had.
    expect(elapsedVoiceSeconds(T, T - 30_000)).toBe(0);
  });

  it('rounds to the nearest second rather than accumulating fractions', () => {
    expect(elapsedVoiceSeconds(T, T + 1_600)).toBe(2);
    expect(elapsedVoiceSeconds(T, T + 1_400)).toBe(1);
  });

  it('reports zero for an instant disconnect rather than a stray 1', () => {
    expect(elapsedVoiceSeconds(T, T)).toBe(0);
    expect(elapsedVoiceSeconds(T, T + 200)).toBe(0);
  });

  it('handles a long session without drift', () => {
    expect(elapsedVoiceSeconds(T, T + 900_000)).toBe(900);
  });
});
