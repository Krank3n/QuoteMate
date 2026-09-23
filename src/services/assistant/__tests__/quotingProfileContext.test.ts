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
import { NO_PROFILE_NOTE, labourRateNotSetNote } from '../../quotingProfile';
import {
  FREE_PLAN_NOTE,
  quotingProfileContextNote,
  registerPlanSource,
  registerQuotingProfileSource,
  systemPromptWithProfile,
} from '../quotingProfileContext';

afterEach(() => {
  registerQuotingProfileSource(() => null);
  registerPlanSource(() => null);
});

describe('the free-plan line', () => {
  it('is absent while the plan is unknown, on trial and on Pro', () => {
    expect(systemPromptWithProfile()).not.toContain(FREE_PLAN_NOTE);
    registerPlanSource(() => 'trial');
    expect(systemPromptWithProfile()).not.toContain(FREE_PLAN_NOTE);
    registerPlanSource(() => 'pro');
    expect(systemPromptWithProfile()).toBe(MATE_SYSTEM_PROMPT);
    expect(quotingProfileContextNote()).toBeNull();
  });

  // Two free-plan tradies (16–17 Sep 2026) scoped a job over six turns, tapped
  // "Price it up", and met the paywall as an error bubble. Mate can know first.
  it('rides in on a free account, after the profile, in both the prompt and the context note', () => {
    registerPlanSource(() => 'free');
    registerQuotingProfileSource(() => ({ quotingPreferences: ['Work up materials and labour for every job'] } as any));
    const prompt = systemPromptWithProfile();
    expect(prompt.startsWith(MATE_SYSTEM_PROMPT)).toBe(true);
    expect(prompt.indexOf('- Work up materials and labour')).toBeLessThan(prompt.indexOf(FREE_PLAN_NOTE));
    expect(prompt).toContain('This account is on the FREE plan.');
    expect(quotingProfileContextNote()).toContain(FREE_PLAN_NOTE);
  });

  it('tells Mate to say so before the first scoping question, and which tools still work', () => {
    expect(FREE_PLAN_NOTE).toContain('before any scoping question');
    expect(FREE_PLAN_NOTE).toContain('propose_draft_quote');
    expect(FREE_PLAN_NOTE).toContain('mark paid');
    expect(FREE_PLAN_NOTE).not.toMatch(/\bAI\b(?!")/);
  });

  it('a throwing plan source leaves the prompt static', () => {
    registerPlanSource(() => { throw new Error('store not ready'); });
    expect(systemPromptWithProfile()).toBe(MATE_SYSTEM_PROMPT);
  });
});

describe('systemPromptWithProfile', () => {
  it('is the static prompt when there are no settings to read', () => {
    expect(systemPromptWithProfile()).toBe(MATE_SYSTEM_PROMPT);
    expect(quotingProfileContextNote()).toBeNull();
  });

  it('tells Mate nothing is saved yet when settings are loaded but empty', () => {
    registerQuotingProfileSource(() => ({ supplierPriority: [], defaultLaborRate: 110 } as any));
    expect(systemPromptWithProfile()).toBe(`${MATE_SYSTEM_PROMPT}\n\n${NO_PROFILE_NOTE}`);
    expect(quotingProfileContextNote()).toBe(`[context] ${NO_PROFILE_NOTE}`);
  });

  // Audit 23 Sep 2026: Mate called the pre-filled starting rate "your rate" to
  // tradies who had never seen it ("I never saved that or said that").
  it('says the labour rate is NOT theirs while it is still the pre-filled starting value', () => {
    registerQuotingProfileSource(() => ({ defaultLaborRate: 85 } as any));
    expect(systemPromptWithProfile()).toBe(`${MATE_SYSTEM_PROMPT}\n\n${NO_PROFILE_NOTE}\n${labourRateNotSetNote(85)}`);
    expect(quotingProfileContextNote()).toContain('Labour rate: NOT SET BY THEM');
    // Confirmed, it's theirs — even at exactly the starting figure.
    registerQuotingProfileSource(() => ({ defaultLaborRate: 85, laborRateConfirmed: true } as any));
    expect(systemPromptWithProfile()).toBe(`${MATE_SYSTEM_PROMPT}\n\n${NO_PROFILE_NOTE}`);
  });

  // Deliberately self-contained rather than a pointer: on the simulator a
  // one-line pointer plus the rule in its own section was ignored twice.
  it('the nothing-saved line carries the whole instruction, not a pointer', () => {
    expect(NO_PROFILE_NOTE.startsWith('How this business quotes: NOTHING SAVED YET')).toBe(true);
    expect(NO_PROFILE_NOTE).toContain('the must-ask turn carries one extra question');
    expect(NO_PROFILE_NOTE).toContain('never as a turn of its own');
    expect(NO_PROFILE_NOTE).toContain('propose_save_rate');
    expect(NO_PROFILE_NOTE).toContain('never ask again this conversation');
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
