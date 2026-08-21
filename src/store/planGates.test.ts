// @vitest-environment jsdom
/**
 * Plan-parity gate on Mate's pipeline applies. The wizard paywalls the
 * materials + pricing pipeline for free (post-trial) users; Mate's Apply
 * path runs the same pipeline, so a free plan must get PLAN_GATED back
 * BEFORE any pipeline call or quote mint — otherwise chat is a bypass.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) },
}));
vi.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: vi.fn(async () => {}),
  deactivateKeepAwake: vi.fn(async () => {}),
}));
// The store's import graph reaches most expo-* native modules; none of their
// behaviour matters for the plan gate under test.
vi.mock('expo-constants', () => ({ default: { expoConfig: {} } }));
vi.mock('expo-haptics', () => ({ impactAsync: vi.fn(), notificationAsync: vi.fn(), selectionAsync: vi.fn(), ImpactFeedbackStyle: {}, NotificationFeedbackType: {} }));
vi.mock('expo-file-system', () => ({ documentDirectory: '/tmp/', cacheDirectory: '/tmp/', writeAsStringAsync: vi.fn(), readAsStringAsync: vi.fn(), getInfoAsync: vi.fn(), EncodingType: { UTF8: 'utf8', Base64: 'base64' } }));
vi.mock('expo-print', () => ({ printToFileAsync: vi.fn() }));
vi.mock('expo-sharing', () => ({ shareAsync: vi.fn(), isAvailableAsync: vi.fn(async () => false) }));
vi.mock('expo-store-review', () => ({ requestReview: vi.fn(), hasAction: vi.fn(async () => false), isAvailableAsync: vi.fn(async () => false) }));
vi.mock('expo-web-browser', () => ({ openBrowserAsync: vi.fn(), openAuthSessionAsync: vi.fn(), maybeCompleteAuthSession: vi.fn() }));
vi.mock('expo-auth-session', () => ({ makeRedirectUri: vi.fn(() => 'redirect://'), useAuthRequest: vi.fn(), AuthRequest: class {}, ResponseType: {} }));
vi.mock('expo-crypto', () => ({ digestStringAsync: vi.fn(async () => 'hash'), CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, randomUUID: vi.fn(() => 'uuid') }));
vi.mock('expo-contacts', () => ({ requestPermissionsAsync: vi.fn(), getContactsAsync: vi.fn() }));
vi.mock('expo-av', () => ({ Audio: { Sound: class {}, setAudioModeAsync: vi.fn() } }));
vi.mock('expo-image-manipulator', () => ({ manipulateAsync: vi.fn(), SaveFormat: {} }));
vi.mock('expo-mail-composer', () => ({ composeAsync: vi.fn(), isAvailableAsync: vi.fn(async () => false) }));

import { useStore } from './useStore';
import { canRunMatePipeline } from './planGates';
import type { Proposal } from '../types/assistant';

const base = { id: 'p1', toolUseId: 't1', createdAt: '2026-08-21T00:00:00Z' };
const pipelineProposals: Proposal[] = [
  { ...base, type: 'propose_draft_quote', customerDraft: { name: 'Sam' }, jobName: 'Bathroom reno', jobDescription: 'Strip out and retile.' },
  { ...base, type: 'propose_add_line_item', quoteId: 'q1', searchTerm: 'treated pine sleeper', qty: 4, unit: 'each' },
  { ...base, type: 'propose_reprice', quoteId: 'q1' },
];

beforeEach(() => {
  useStore.setState({
    quotes: [],
    documents: [],
    contacts: [],
    currentQuote: null,
    // Post-trial free plan.
    subscriptionStatus: { plan: 'free' },
  } as any);
});

describe('canRunMatePipeline', () => {
  it('free plan blocks pipeline applies with PLAN_GATED', async () => {
    expect(canRunMatePipeline('free')).toBe(false);

    for (const proposal of pipelineProposals) {
      const result = await useStore.getState().applyProposal(proposal);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('PLAN_GATED');
        expect(result.error).not.toMatch(/\bAI\b/);
      }
    }
    // Gated before any mint — no draft quote came into existence.
    expect(useStore.getState().currentQuote).toBeNull();
    expect(useStore.getState().quotes).toHaveLength(0);
  });

  it('trial and pro pass', () => {
    expect(canRunMatePipeline('trial')).toBe(true);
    expect(canRunMatePipeline('pro')).toBe(true);
  });
});
