import {
  LEGAL_TRANSITIONS,
  allowedNextStages,
  canTransition,
  isTerminal,
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
});
