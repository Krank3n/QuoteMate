// The 'inactive'-vs-'background' policy for a live voice session. The bug
// this guards against: treating iOS 'inactive' (Control Center, notification
// shade, incoming-call banner) like a real backgrounding killed the session
// every time the tradie peeked at a notification mid-conversation.

import { describe, it, expect } from 'vitest';
import { voiceActionForAppState } from '../voiceAppStatePolicy';

describe('voiceActionForAppState', () => {
  it('stops immediately on background, session or not', () => {
    expect(
      voiceActionForAppState({ nextState: 'background', hasVoiceSession: true, graceRunning: false }),
    ).toBe('stop');
    expect(
      voiceActionForAppState({ nextState: 'background', hasVoiceSession: false, graceRunning: false }),
    ).toBe('stop');
  });

  it('stops on background even while a grace countdown is running (inactive → background)', () => {
    expect(
      voiceActionForAppState({ nextState: 'background', hasVoiceSession: true, graceRunning: true }),
    ).toBe('stop');
  });

  it('starts a grace countdown on inactive when a session is live', () => {
    expect(
      voiceActionForAppState({ nextState: 'inactive', hasVoiceSession: true, graceRunning: false }),
    ).toBe('start-grace');
  });

  it('does NOT stop or start grace on inactive without a session', () => {
    expect(
      voiceActionForAppState({ nextState: 'inactive', hasVoiceSession: false, graceRunning: false }),
    ).toBe('ignore');
  });

  it('lets an already-running countdown ride on repeated inactive events', () => {
    expect(
      voiceActionForAppState({ nextState: 'inactive', hasVoiceSession: true, graceRunning: true }),
    ).toBe('ignore');
  });

  it('cancels the countdown on return to active (session survives the peek)', () => {
    expect(
      voiceActionForAppState({ nextState: 'active', hasVoiceSession: true, graceRunning: true }),
    ).toBe('cancel-grace');
    expect(
      voiceActionForAppState({ nextState: 'active', hasVoiceSession: false, graceRunning: false }),
    ).toBe('cancel-grace');
  });

  it('never tears down on ambiguous states', () => {
    for (const nextState of ['unknown', 'extension'] as const) {
      expect(
        voiceActionForAppState({ nextState, hasVoiceSession: true, graceRunning: false }),
      ).toBe('ignore');
    }
  });
});
