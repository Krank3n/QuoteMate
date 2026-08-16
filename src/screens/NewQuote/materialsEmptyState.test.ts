import { describe, it, expect } from 'vitest';
import { getMaterialsEmptyState } from './materialsEmptyState';

describe('getMaterialsEmptyState', () => {
  it('offers generation when job notes exist and the user is pro/trial', () => {
    const content = getMaterialsEmptyState({ hasJobNotes: true, isPro: true });
    expect(content.hero.action).toBe('generate');
    expect(content.hero.showProBadge).toBe(false);
    expect(content.hero.ctaLabel).toBe('Build my list');
  });

  it('routes to the paywall with a Pro badge when the user is on the free plan', () => {
    const content = getMaterialsEmptyState({ hasJobNotes: true, isPro: false });
    expect(content.hero.action).toBe('paywall');
    expect(content.hero.showProBadge).toBe(true);
    // Same pitch as the pro variant — the paywall is the gate, not the copy.
    expect(content.hero.title).toBe(
      getMaterialsEmptyState({ hasJobNotes: true, isPro: true }).hero.title,
    );
  });

  it('sends the user back to job notes instead of a dead-end when notes are missing', () => {
    const content = getMaterialsEmptyState({ hasJobNotes: false, isPro: true });
    expect(content.hero.action).toBe('add-notes');
    expect(content.hero.ctaLabel).toBe('Add job notes');
    expect(content.hero.subtitle.toLowerCase()).toContain('notes');
  });

  it('hides the Pro badge on the add-notes hero — the tap is a free action, not a paywall', () => {
    const content = getMaterialsEmptyState({ hasJobNotes: false, isPro: false });
    expect(content.hero.action).toBe('add-notes');
    expect(content.hero.showProBadge).toBe(false);
  });

  it('promises ballpark costs, not final prices — real supplier pricing is a later step', () => {
    for (const hasJobNotes of [true, false]) {
      const { hero } = getMaterialsEmptyState({ hasJobNotes, isPro: true });
      expect(hero.subtitle.toLowerCase()).toContain('ballpark');
      expect(hero.subtitle.toLowerCase()).not.toMatch(/\bcosted\b|\bpriced\b/);
    }
  });

  it('never mentions AI in any user-facing copy', () => {
    for (const hasJobNotes of [true, false]) {
      for (const isPro of [true, false]) {
        const content = getMaterialsEmptyState({ hasJobNotes, isPro });
        const allCopy = [
          content.hero.title,
          content.hero.subtitle,
          content.hero.ctaLabel,
          content.manual.title,
          content.manual.subtitle,
          content.skipLabel,
        ].join(' ');
        expect(allCopy).not.toMatch(/\bAI\b/i);
      }
    }
  });

  it('always offers the manual and labour-only escape hatches', () => {
    const content = getMaterialsEmptyState({ hasJobNotes: false, isPro: false });
    expect(content.manual.title).toBeTruthy();
    expect(content.skipLabel).toContain('Labour only');
  });

  it('mentions scope lines so labour-dominant trades know the app fits them', () => {
    // A painter or plasterer reading only "gear" concludes the app can't do
    // their quote and stops at this screen.
    for (const hasJobNotes of [true, false]) {
      const content = getMaterialsEmptyState({ hasJobNotes, isPro: true });
      expect(content.manual.subtitle.toLowerCase()).toContain('scope lines');
    }
  });
});
