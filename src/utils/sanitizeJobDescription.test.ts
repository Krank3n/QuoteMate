import { describe, it, expect } from 'vitest';
import { sanitizeJobDescription } from './sanitizeJobDescription';

describe('sanitizeJobDescription', () => {
  it('strips the real QU-178342 leak — question + contact chatter after the scope', () => {
    const leaked =
      "Prep and poor 230 square metres of exposed aggregate what's their name and phone number so I can add them to your list customer name is tarik";
    const { text, stripped } = sanitizeJobDescription(leaked);
    expect(text).toBe('Prep and poor 230 square metres of exposed aggregate');
    expect(stripped).toContain("what's their name");
  });

  it('cuts at the earliest marker when several kinds of chatter follow', () => {
    const { text } = sanitizeJobDescription(
      'Replace kitchen sink and mixer tap do you want me to draft the quote customer name is Bob',
    );
    expect(text).toBe('Replace kitchen sink and mixer tap');
  });

  it('strips trailing "customer name is" chatter on its own', () => {
    const { text } = sanitizeJobDescription(
      'Install 12 downlights in the living room and hallway, customer name is Sarah',
    );
    expect(text).toBe('Install 12 downlights in the living room and hallway');
  });

  it('leaves clean scopes untouched', () => {
    const clean =
      'Construction of a 2m x 4m merbau deck. Includes footings, subframe, decking and two coats of oil. Access via side gate.';
    const result = sanitizeJobDescription(clean);
    expect(result.text).toBe(clean);
    expect(result.stripped).toBeUndefined();
  });

  it('does not cut when the remainder would be too short to be a scope', () => {
    // Everything is chatter — better to keep the original than save a stub.
    const allChatter = "what's their name and phone number so I can add them";
    expect(sanitizeJobDescription(allChatter).text).toBe(allChatter);
  });

  it('does not false-positive on scope sentences that resemble markers', () => {
    // "can you" inside legitimate scope phrasing is rare, but customer-facing
    // scopes routinely contain second-person-free instructions like these:
    const scope = 'Supply and install new letterbox. Customer to supply paint. Remove old letterbox and make good.';
    expect(sanitizeJobDescription(scope).text).toBe(scope);
  });

  it('handles empty and whitespace input', () => {
    expect(sanitizeJobDescription('').text).toBe('');
    expect(sanitizeJobDescription('   ').text).toBe('');
  });
});
