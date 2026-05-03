import {
  LEGAL_TRANSITIONS,
  allowedNextStages,
  canTransition,
  isStageDowngrade,
  isTerminal,
  stageRank,
} from '../documentStage';
import type { DocumentStage } from '../../types/document';

const ALL_STAGES: DocumentStage[] = [
  'draft',
  'quote_sent',
  'quote_accepted',
  'quote_rejected',
  'invoice_sent',
  'partially_paid',
  'paid',
  'cancelled',
];

describe('documentStage', () => {
  describe('canTransition', () => {
    it('always allows the no-op self-transition', () => {
      for (const s of ALL_STAGES) {
        expect(canTransition(s, s)).toBe(true);
      }
    });

    it('allows every documented legal transition', () => {
      for (const from of ALL_STAGES) {
        for (const to of LEGAL_TRANSITIONS[from]) {
          expect(canTransition(from, to)).toBe(true);
        }
      }
    });

    it('rejects every transition not on the allow-list', () => {
      for (const from of ALL_STAGES) {
        const allowed = new Set<DocumentStage>([from, ...LEGAL_TRANSITIONS[from]]);
        for (const to of ALL_STAGES) {
          if (allowed.has(to)) continue;
          expect(canTransition(from, to)).toBe(false);
        }
      }
    });

    it('rejects key illegal jumps explicitly', () => {
      // Jumping straight from draft to paid skips invoice_sent
      expect(canTransition('draft', 'paid')).toBe(false);
      // Cannot un-pay
      expect(canTransition('paid', 'draft')).toBe(false);
      expect(canTransition('paid', 'invoice_sent')).toBe(false);
      // Cancelled is escapable via draft, but only via draft — no direct
      // jump into a paid / sent / accepted stage.
      expect(canTransition('cancelled', 'paid')).toBe(false);
      expect(canTransition('cancelled', 'invoice_sent')).toBe(false);
      expect(canTransition('cancelled', 'quote_sent')).toBe(false);
      // Quote cannot become an invoice without going via accepted
      expect(canTransition('quote_sent', 'invoice_sent')).toBe(false);
    });

    it('allows un-cancelling back to draft', () => {
      expect(canTransition('cancelled', 'draft')).toBe(true);
    });
  });

  describe('allowedNextStages', () => {
    it('matches LEGAL_TRANSITIONS exactly', () => {
      for (const s of ALL_STAGES) {
        expect(allowedNextStages(s)).toEqual(LEGAL_TRANSITIONS[s]);
      }
    });
  });

  describe('isTerminal', () => {
    it('no stage is terminal — even cancelled can drop back to draft', () => {
      // Strict definition: terminal ⇒ no outbound transitions.
      // With the cancelled → draft un-cancel edge, every stage can exit.
      for (const s of ALL_STAGES) {
        expect(isTerminal(s)).toBe(false);
      }
    });
  });

  describe('isStageDowngrade', () => {
    // The mirror trigger relies on this ordering to refuse to walk a sent /
    // accepted / paid doc back to draft when the legacy `status` field gets
    // overwritten by a stale-cache client write. Lock down the cases that
    // actually fire in production.
    it('flags the saveDraft-after-send race as a downgrade', () => {
      expect(isStageDowngrade('quote_sent', 'draft')).toBe(true);
      expect(isStageDowngrade('quote_accepted', 'draft')).toBe(true);
      expect(isStageDowngrade('invoice_sent', 'draft')).toBe(true);
      expect(isStageDowngrade('paid', 'draft')).toBe(true);
    });

    it('lets legitimate forward progress through', () => {
      expect(isStageDowngrade('draft', 'quote_sent')).toBe(false);
      expect(isStageDowngrade('quote_sent', 'quote_accepted')).toBe(false);
      expect(isStageDowngrade('quote_accepted', 'invoice_sent')).toBe(false);
      expect(isStageDowngrade('invoice_sent', 'paid')).toBe(false);
    });

    it('treats self-transitions as non-downgrades', () => {
      for (const s of ALL_STAGES) {
        expect(isStageDowngrade(s, s)).toBe(false);
      }
    });

    it('protects cancelled docs from a legacy-status un-cancel', () => {
      // Un-cancel is a legitimate transition but goes through setDocumentStage
      // directly. The mirror must not perform it implicitly off a stale legacy
      // status='draft' write.
      expect(isStageDowngrade('cancelled', 'draft')).toBe(true);
    });

    it('ranks quote_rejected alongside quote_sent', () => {
      // Both are sent-tier outcomes; flipping between them should not count
      // as a downgrade in either direction.
      expect(stageRank('quote_rejected')).toBe(stageRank('quote_sent'));
      expect(isStageDowngrade('quote_rejected', 'quote_sent')).toBe(false);
      expect(isStageDowngrade('quote_sent', 'quote_rejected')).toBe(false);
    });
  });
});
