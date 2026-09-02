import { describe, it, expect } from 'vitest';
import { REASON_BY_KIND, chatReviewRow, headlineFor, reviewBlockForChat } from './reviewChatFormat';
import type { QuoteIssue, QuoteIssueKind } from './quoteReview';

function issue(over: Partial<QuoteIssue>): QuoteIssue {
  return {
    materialId: over.materialId || 'm',
    name: 'Paper Joint Tape',
    kind: 'unpriced',
    detail: '',
    price: 0,
    quantity: 1,
    unit: 'each',
    ...over,
  };
}

describe('reviewBlockForChat', () => {
  it('is null when every line came back clean', () => {
    expect(reviewBlockForChat({ issues: [] })).toBeNull();
    expect(reviewBlockForChat(undefined)).toBeNull();
  });

  it('one row per issue — money first, then the name, then why', () => {
    const block = reviewBlockForChat({
      issues: [
        issue({ materialId: 'a', name: 'Merbau decking board 90x19mm', kind: 'implausible_cost', price: 795.5, quantity: 3 }),
        issue({ materialId: 'b', name: 'Metal Etch Primer', kind: 'unpriced', price: 0, quantity: 1 }),
      ],
    });
    expect(block).toEqual({
      headline: '2 rows need a look',
      rows: [
        { amount: '$2,386.50', name: 'Merbau decking board 90x19mm', reason: "price can't be right" },
        { amount: '$0.00', name: 'Metal Etch Primer', reason: 'no price yet' },
      ],
      more: 0,
    });
  });

  it('caps the list and counts the rest', () => {
    const many = Array.from({ length: 8 }, (_, i) => issue({ materialId: `m${i}`, name: `Row ${i}`, kind: 'estimated', price: 10, quantity: 1 }));
    const block = reviewBlockForChat({ issues: many })!;
    expect(block.rows).toHaveLength(5);
    expect(block.more).toBe(3);
    expect(block.headline).toBe('8 rows need a look');
  });

  it('singular headline for one row', () => {
    expect(headlineFor({ issues: [issue({})] })).toBe('1 row needs a look');
  });

  it('every issue kind has a reason a tradie can read', () => {
    const kinds: QuoteIssueKind[] = ['unpriced', 'estimated', 'low_confidence', 'inflated_quantity', 'weak_match', 'implausible_cost'];
    for (const kind of kinds) {
      expect(REASON_BY_KIND[kind]).toBeTruthy();
      expect(chatReviewRow(issue({ kind })).reason).toBe(REASON_BY_KIND[kind]);
      expect(REASON_BY_KIND[kind]).not.toMatch(/\bAI\b/);
    }
  });
});
