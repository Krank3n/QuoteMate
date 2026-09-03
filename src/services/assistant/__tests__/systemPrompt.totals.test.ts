/**
 * Pins for the prompt sections that came out of one electrician's three
 * conversations on 3 Sep 2026: a total Mate said it couldn't set, a
 * read-back of two totals the document never was, an invoice scoped like a
 * quote, "access contacts" ignored, a phone number padded from chunks, and a
 * reply spoken in three fragments that promised a draft that never came.
 * Literal assertions on purpose — a reworded prompt that quietly drops one
 * of these should fail here, not in a transcript audit.
 */
import { describe, it, expect } from 'vitest';
import { MATE_SYSTEM_PROMPT } from '../systemPrompt';
import { TOOL_DECLARATIONS } from '../toolSchemas';
import { expectHouseTone, promptSection } from './systemPrompt.test';

describe('setting the total', () => {
  const section = promptSection('Reading out a total');

  it('names propose_set_total as THE tool for a total and bans the markup detour', () => {
    expect(MATE_SYSTEM_PROMPT).toContain('propose_set_total — set the customer-facing total to a figure the tradie said.');
    expect(MATE_SYSTEM_PROMPT).toContain('never steer them to markup or a labour rate instead, and never say you can\'t set the final price — you can.');
    expect(section).toContain('Setting the total is one card and one line');
  });

  it('makes every total a looked-up fact — the context line or get_quote, never memory', () => {
    expect(section).toContain('A total is a fact you look up, never a number you remember or work out.');
    expect(section).toContain('Never quote a total from memory');
    expect(section).toContain('read it from there, or call get_quote');
    expectHouseTone(section);
  });

  it('the tool description carries the mechanism and the refusal, once', () => {
    const tool = TOOL_DECLARATIONS.find((t) => t.name === 'propose_set_total')!;
    expect(tool.description).toContain('never steer them to markup or a labour rate instead');
    expect(tool.description).toContain('A total under the materials alone is refused.');
    expect(tool.parameters.required).toEqual(['quoteId', 'targetTotal']);
  });
});

describe('lump sums from chat', () => {
  it('propose_add_line_item carries the lump-sum form and forbids inventing a price', () => {
    expect(MATE_SYSTEM_PROMPT).toContain('or a lump sum at a price the tradie SAID (label + price; lands at exactly that figure, no search, no markup)');
    const tool = TOOL_DECLARATIONS.find((t) => t.name === 'propose_add_line_item')!;
    expect(tool.description).toContain('never invent a price to make a lump sum');
    expect(Object.keys(tool.parameters.properties ?? {})).toEqual(expect.arrayContaining(['label', 'price', 'scope', 'pricesIncludeGst']));
    expect(tool.parameters.required).toEqual(['quoteId']);
  });
});

describe('invoice fast path', () => {
  const section = promptSection('Quote or invoice?');

  it('an invoice skips the scoping gate and the supplier-list offer', () => {
    expect(section).toContain('An invoice is for work that is DONE.');
    expect(section).toContain("Pass documentType 'invoice' to get_job_requirements");
    expect(section).toContain('what did you do, and who for');
    expect(section).toContain('no plan, no supplier-list offer');
    const tool = TOOL_DECLARATIONS.find((t) => t.name === 'get_job_requirements')!;
    expect((tool.parameters.properties as any).documentType.enum).toEqual(['quote', 'invoice']);
  });
});

describe('contacts off the phone', () => {
  const section = promptSection('Customer');

  it('routes "access my contacts" to the picker and never to a read-out', () => {
    expect(section).toContain('"Access my contacts", "open contacts", "it\'s in my phone" → propose_pick_contact, straight away — never a request to read the number out instead.');
  });

  it('a phone-book or recent hit goes on as customerDraft, never as customerId', () => {
    expect(section).toContain("Only 'saved' is a QuoteMate contact");
    expect(section).toContain("Never pass a phone or recent hit's contactId — it isn't one.");
  });
});

describe('phone numbers and emails by voice', () => {
  const section = promptSection('Phone numbers and emails by voice');

  it('collects chunks, reads back once, never asks for the rest twice, never pads', () => {
    expect(section).toContain('Keep collecting the digits across turns without comment.');
    expect(section).toContain('read the whole number back once');
    expect(section).toContain('Exactly eight digits is a landline missing its area code — ask for that once.');
    expect(section).toContain('Never say "what\'s the rest?" twice');
    expect(section).toContain('draft without it and say so in the same line');
    expect(section).toContain('Never pad a number.');
    expect(section).toContain('Never invent one from a half-heard name.');
    expectHouseTone(section);
  });
});

describe('one reply, no promises without the call', () => {
  it('bans "drafting that" without the propose_* call in the same turn', () => {
    expect(MATE_SYSTEM_PROMPT).toContain('Never say "drafting that", "adding it", "sending it" or "done" unless the propose_* call for it came back ok in THIS turn.');
  });

  it('tells voice Mate to ignore side conversation and to speak once per turn', () => {
    const section = promptSection('Voice mode');
    expect(section).toContain("don't answer it and don't draft from it");
    expect(section).toContain('Never turn a stray line into a number, a name or an email.');
    expect(section).toContain('One reply per turn.');
    expectHouseTone(section);
  });

  it('keeps customer details out of a scope update', () => {
    expect(MATE_SYSTEM_PROMPT).toContain('never for customer details — a name, phone, email or address change is propose_update_customer');
  });
});
