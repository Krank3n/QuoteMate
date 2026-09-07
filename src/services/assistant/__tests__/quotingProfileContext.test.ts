/**
 * The per-business block rides into every Mate session — appended to the
 * static prompt for the paths that send one, and as a "[context]" note for
 * the provider that owns its prompt. Settings that are loaded but empty get
 * the explicit "nothing saved yet" line instead, which is what makes Mate ask
 * once on the first job; no settings at all leaves the static prompt
 * byte-for-byte, so a store that isn't ready never triggers the question.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { MATE_SYSTEM_PROMPT } from '../systemPrompt';
import { NO_PROFILE_NOTE } from '../../quotingProfile';
import {
  quotingProfileContextNote,
  registerQuotingProfileSource,
  systemPromptWithProfile,
} from '../quotingProfileContext';

afterEach(() => registerQuotingProfileSource(() => null));

describe('systemPromptWithProfile', () => {
  it('is the static prompt when there are no settings to read', () => {
    expect(systemPromptWithProfile()).toBe(MATE_SYSTEM_PROMPT);
    expect(quotingProfileContextNote()).toBeNull();
  });

  it('tells Mate nothing is saved yet when settings are loaded but empty', () => {
    registerQuotingProfileSource(() => ({ supplierPriority: [] } as any));
    expect(systemPromptWithProfile()).toBe(`${MATE_SYSTEM_PROMPT}\n\n${NO_PROFILE_NOTE}`);
    expect(quotingProfileContextNote()).toBe(`[context] ${NO_PROFILE_NOTE}`);
  });

  it('the nothing-saved line is the cue the prompt keys off, and points at the rule', () => {
    expect(NO_PROFILE_NOTE.startsWith('How this business quotes: nothing saved yet')).toBe(true);
    expect(NO_PROFILE_NOTE).toContain('"How they quote"');
  });

  it('appends the saved profile after the static prompt, and drops the nothing-saved line', () => {
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
    expect(prompt).not.toContain(NO_PROFILE_NOTE);
    expect(quotingProfileContextNote()!.startsWith('[context] How this business quotes —')).toBe(true);
  });

  it('a single saved rule is enough to stop the question', () => {
    registerQuotingProfileSource(() => ({ quotingPreferences: ['Work up materials and labour for every job'] } as any));
    expect(systemPromptWithProfile()).not.toContain(NO_PROFILE_NOTE);
    expect(systemPromptWithProfile()).toContain('- Work up materials and labour for every job');
  });

  it('never throws when the source does, and never asks on its behalf', () => {
    registerQuotingProfileSource(() => {
      throw new Error('store not ready');
    });
    expect(systemPromptWithProfile()).toBe(MATE_SYSTEM_PROMPT);
    expect(quotingProfileContextNote()).toBeNull();
  });
});
