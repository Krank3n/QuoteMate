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
      // Cannot resurrect a cancelled doc
      expect(canTransition('cancelled', 'draft')).toBe(false);
      expect(canTransition('cancelled', 'paid')).toBe(false);
      // Quote cannot become an invoice without going via accepted
      expect(canTransition('quote_sent', 'invoice_sent')).toBe(false);
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
    it('marks cancelled as terminal', () => {
      expect(isTerminal('cancelled')).toBe(true);
    });

    it('does not mark paid as fully terminal — refund escape hatch exists', () => {
      // paid → cancelled is the refund path; paid is therefore non-terminal
      // by the strict definition (no outbound transitions = terminal).
      expect(isTerminal('paid')).toBe(false);
    });

    it('marks every non-cancelled stage as non-terminal', () => {
      for (const s of ALL_STAGES) {
        if (s === 'cancelled') continue;
        expect(isTerminal(s)).toBe(false);
      }
    });
  });
});
