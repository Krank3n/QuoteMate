/**
 * The per-business block rides into every Mate session — appended to the
 * static prompt for the paths that send one, and as a "[context]" note for
 * the provider that owns its prompt. A fresh account gets the static prompt
 * byte-for-byte.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { MATE_SYSTEM_PROMPT } from '../systemPrompt';
import {
  quotingProfileContextNote,
  registerQuotingProfileSource,
  systemPromptWithProfile,
} from '../quotingProfileContext';

afterEach(() => registerQuotingProfileSource(() => null));

describe('systemPromptWithProfile', () => {
  it('is the static prompt when nothing is saved', () => {
    expect(systemPromptWithProfile()).toBe(MATE_SYSTEM_PROMPT);
    expect(quotingProfileContextNote()).toBeNull();
  });

  it('appends the saved profile after the static prompt', () => {
    registerQuotingProfileSource(() => ({
      quotingPreferences: ['labour separate from materials'],
      rateCard: [
        { id: 'r1', label: 'Patio roof', unit: 'm²', rate: 220, pricesIncludeGst: false, includesMaterials: true, updatedAt: '' },
      ],
    }));
    const prompt = systemPromptWithProfile();
    expect(prompt.startsWith(MATE_SYSTEM_PROMPT)).toBe(true);
    expect(prompt).toContain('- labour separate from materials');
    expect(prompt).toContain('- Patio roof — $220.00 per m² ex GST · materials included');
    expect(quotingProfileContextNote()!.startsWith('[context] How this business quotes')).toBe(true);
  });

  it('never throws when the source does', () => {
    registerQuotingProfileSource(() => {
      throw new Error('store not ready');
    });
    expect(systemPromptWithProfile()).toBe(MATE_SYSTEM_PROMPT);
  });
});
