/**
 * The repo → ElevenLabs conversion is nearly identity, so these tests exist for
 * the edge cases, each of which fails silently in production if it regresses:
 *
 *  • expects_response defaults to FALSE on the ElevenLabs API. A read tool that
 *    doesn't wait for its answer is Mate inventing a customer, confidently.
 *  • Nested `required` (propose_draft_quote.customerDraft requires `name`) is
 *    the difference between a named contact and a blank one on a real quote.
 *  • `required: []` vs an absent `required` are semantically identical but
 *    fingerprint differently — the gap shows up as permanent phantom drift.
 */
import { describe, it, expect } from 'vitest';
import {
  AGENT_LLM,
  MATE_ASR_KEYWORDS,
  MAX_ASR_KEYWORDS,
  buildAgentPatch,
  buildAgentToolConfigs,
  humanisePropertyName,
  toElevenLabsTool,
  toolFingerprint,
} from '../elevenLabsAgentConfig';
import {
  ALL_TOOL_DECLARATIONS,
  CONTROL_TOOL_NAMES,
  PROPOSAL_TOOL_NAMES,
  READ_TOOL_NAMES,
  TOOL_RUNTIME,
} from '../toolSchemas';

const byName = (name: string) => {
  const decl = ALL_TOOL_DECLARATIONS.find((d) => d.name === name);
  if (!decl) throw new Error(`no declaration named ${name}`);
  return toElevenLabsTool(decl);
};

describe('toElevenLabsTool', () => {
  it('marks every tool as a client tool that expects a response', () => {
    for (const tool of buildAgentToolConfigs()) {
      expect(tool.type, tool.name).toBe('client');
      expect(tool.expects_response, tool.name).toBe(true);
    }
  });

  it('converts a flat declaration, carrying description and timeout across', () => {
    const tool = byName('find_customer');
    expect(tool.name).toBe('find_customer');
    expect(tool.description).toContain('saved contacts');
    expect(tool.response_timeout_secs).toBe(TOOL_RUNTIME.find_customer.timeoutSecs);
    expect(tool.parameters.properties?.query?.type).toBe('string');
    expect(tool.parameters.required).toEqual(['query']);
  });

  it('preserves a nested object and its own required list', () => {
    const draft = byName('propose_draft_quote').parameters.properties?.customerDraft;
    expect(draft?.type).toBe('object');
    expect(Object.keys(draft?.properties || {}).sort()).toEqual(['address', 'email', 'name', 'phone']);
    // The whole point: a nested required that gets dropped lets Mate draft a
    // contact with no name.
    expect(draft?.required).toEqual(['name']);
  });

  it('preserves enum values', () => {
    expect(byName('propose_draft_quote').parameters.properties?.documentType?.enum)
      .toEqual(['quote', 'invoice']);
    expect(byName('propose_mark_paid').parameters.properties?.method?.enum)
      .toEqual(['cash', 'bank_transfer', 'card', 'cheque', 'other']);
  });

  it('preserves array item schemas', () => {
    const missed = byName('propose_import_supplier_list').parameters.properties?.missedItems;
    expect(missed?.type).toBe('array');
    expect(missed?.items?.type).toBe('string');
  });

  it('emits an empty object schema for a tool that takes no parameters', () => {
    const params = byName('get_business_defaults').parameters;
    expect(params.type).toBe('object');
    expect(params.properties).toEqual({});
    // Normalised to [], never undefined — see the file header.
    expect(params.required).toEqual([]);
  });

  it('normalises an absent required to an empty array everywhere', () => {
    for (const tool of buildAgentToolConfigs()) {
      expect(Array.isArray(tool.parameters.required), tool.name).toBe(true);
    }
  });

  it('synthesises a description for leaf properties that have none', () => {
    // propose_create_contact declares name/phone/email/address bare.
    const props = byName('propose_create_contact').parameters.properties!;
    expect(props.name.description).toBe('Name.');
    expect(props.address.description).toBe('Address.');
  });

  it('never emits a property without a description', () => {
    const undescribed: string[] = [];
    const walk = (schema: any, path: string) => {
      for (const [key, child] of Object.entries<any>(schema.properties || {})) {
        if (!child.description) undescribed.push(`${path}.${key}`);
        walk(child, `${path}.${key}`);
      }
    };
    for (const tool of buildAgentToolConfigs()) walk(tool.parameters, tool.name);
    expect(undescribed).toEqual([]);
  });

  it('keeps every response_timeout_secs inside the API-accepted 1..120 range', () => {
    for (const tool of buildAgentToolConfigs()) {
      expect(tool.response_timeout_secs, tool.name).toBeGreaterThanOrEqual(1);
      expect(tool.response_timeout_secs, tool.name).toBeLessThanOrEqual(120);
    }
  });

  it('throws a pointed error for a declaration with no TOOL_RUNTIME entry', () => {
    expect(() =>
      toElevenLabsTool({ name: 'brand_new_tool', description: 'x', parameters: { type: 'object' } } as any),
    ).toThrow(/TOOL_RUNTIME/);
  });

  it('emits only known schema keys, so an upstream Gemini-ism cannot leak through', () => {
    const allowed = new Set(['type', 'description', 'properties', 'required', 'enum', 'items']);
    const walk = (schema: any, path: string) => {
      for (const key of Object.keys(schema)) {
        expect(allowed.has(key), `${path} emitted "${key}"`).toBe(true);
      }
      for (const [k, child] of Object.entries<any>(schema.properties || {})) walk(child, `${path}.${k}`);
      if (schema.items) walk(schema.items, `${path}[]`);
    };
    for (const tool of buildAgentToolConfigs()) walk(tool.parameters, tool.name);
  });
});

describe('buildAgentToolConfigs', () => {
  it('covers every declared tool exactly once', () => {
    const tools = buildAgentToolConfigs();
    const names = tools.map((t) => t.name).sort();
    const expected = [...READ_TOOL_NAMES, ...PROPOSAL_TOOL_NAMES, ...CONTROL_TOOL_NAMES, 'show_quote'].sort();
    expect(names).toEqual(expected);
    expect(new Set(names).size).toBe(names.length);
  });

  it('carries all 22 tools — 20 declarations plus the 2 control tools', () => {
    expect(buildAgentToolConfigs()).toHaveLength(22);
  });

  it('gives every declared tool a TOOL_RUNTIME entry', () => {
    for (const decl of ALL_TOOL_DECLARATIONS) {
      expect(TOOL_RUNTIME[decl.name], decl.name).toBeDefined();
    }
  });

  it('has no TOOL_RUNTIME entry for a tool that no longer exists', () => {
    const declared = new Set(ALL_TOOL_DECLARATIONS.map((d) => d.name));
    for (const name of Object.keys(TOOL_RUNTIME)) {
      expect(declared.has(name), `${name} has a timeout but no declaration`).toBe(true);
    }
  });
});

describe('toolFingerprint', () => {
  it('is stable across key ordering', () => {
    expect(toolFingerprint({ a: 1, b: { c: 2, d: 3 } }))
      .toBe(toolFingerprint({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it('changes when a description changes', () => {
    const tool = byName('get_quote');
    const edited = { ...tool, description: `${tool.description} (edited)` };
    expect(toolFingerprint(edited)).not.toBe(toolFingerprint(tool));
  });

  it('changes when a nested required changes', () => {
    const tool = byName('propose_draft_quote');
    const edited = JSON.parse(JSON.stringify(tool));
    edited.parameters.properties.customerDraft.required = [];
    expect(toolFingerprint(edited)).not.toBe(toolFingerprint(tool));
  });

  it('is unchanged for an identical rebuild — no phantom drift in --check', () => {
    const a = buildAgentToolConfigs().map(toolFingerprint);
    const b = buildAgentToolConfigs().map(toolFingerprint);
    expect(a).toEqual(b);
  });
});

describe('buildAgentPatch', () => {
  const patch = buildAgentPatch({
    toolIds: ['tool_b', 'tool_a'],
    voiceId: 'voice_test',
    firstMessage: 'G’day.',
  });

  it('pins the LLM to the model the text path already runs', () => {
    expect(patch.conversation_config.agent.prompt.llm).toBe(AGENT_LLM);
    expect(AGENT_LLM).toBe('claude-sonnet-5');
  });

  it('ships the repo system prompt verbatim', () => {
    expect(patch.conversation_config.agent.prompt.prompt).toContain('You are Mate.');
  });

  it('sorts tool ids so an unordered API response cannot look like drift', () => {
    expect(patch.conversation_config.agent.prompt.tool_ids).toEqual(['tool_a', 'tool_b']);
  });

  it('requires auth so only server-minted tokens can open a session', () => {
    expect(patch.platform_settings.auth.enable_auth).toBe(true);
  });

  it('enables exactly the overrides the client sends and nothing else', () => {
    const o = patch.platform_settings.overrides.conversation_config_override as any;
    expect(Object.keys(o).sort()).toEqual(['agent', 'asr']);
    expect(Object.keys(o.agent).sort()).toEqual(['first_message', 'prompt']);
    // tts.* and conversation.text_only stay off: every enabled override is a
    // field anyone holding a conversation token can rewrite, and neither buys
    // the server anything.
    expect(o.tts).toBeUndefined();
    expect(o.conversation).toBeUndefined();
  });

  it('bounds a runaway session in both directions', () => {
    expect(patch.conversation_config.conversation.max_duration_seconds).toBeGreaterThan(0);
    // The API default is -1 (never) — a phone left connected in a ute pocket
    // would bill until the daily budget stopped it.
    expect(patch.conversation_config.turn.silence_end_call_timeout).toBeGreaterThan(0);
  });

  it('does not fill every gap in the conversation', () => {
    // Device-tested regression. turn_timeout is how long Mate sits through
    // SILENCE before speaking unprompted — not the end-of-utterance threshold,
    // which is what I first took it for. At 2s Mate produced five unprompted
    // turns in 32 seconds of a session where nobody spoke at all. A tradie
    // reading a tape measure needs longer than a couple of seconds.
    expect(patch.conversation_config.turn.turn_timeout).toBeGreaterThanOrEqual(15);
    // Still inside the API's 1..30 range.
    expect(patch.conversation_config.turn.turn_timeout).toBeLessThanOrEqual(30);
  });

  it('answers promptly once the tradie has finished', () => {
    // 'patient' measured 2-5s from end-of-speech to reply on a real device and
    // read as sluggish. Most of that gap is end-of-speech detection, which is
    // what this governs — turn_timeout only ever fires on total silence.
    expect(patch.conversation_config.turn.turn_eagerness).toBe('normal');
  });

  it('uses the expressive TTS model, not the latency-first one', () => {
    // eleven_flash_v2 (the default) came across as flat — "a little unhappy".
    expect(patch.conversation_config.tts.model_id).toBe('eleven_v3_conversational');
    expect(patch.conversation_config.tts.model_id).not.toMatch(/flash/);
  });

  it('leaves delivery room to vary rather than flattening it', () => {
    // Lower stability = more variation. Not so low that a noisy worksite gets
    // an unreliable read of the numbers.
    expect(patch.conversation_config.tts.stability).toBeLessThan(0.5);
    expect(patch.conversation_config.tts.stability).toBeGreaterThanOrEqual(0.3);
  });

  it('still hangs up before an abandoned session bills all day', () => {
    const t = patch.conversation_config.turn;
    expect(t.silence_end_call_timeout).toBeGreaterThan(t.turn_timeout);
  });

  it('stays inside the ASR keyword cap with headroom for per-session surnames', () => {
    expect(patch.conversation_config.asr.keywords.length).toBeLessThanOrEqual(MAX_ASR_KEYWORDS);
    expect(MATE_ASR_KEYWORDS.length).toBeLessThan(MAX_ASR_KEYWORDS);
  });

  it('boosts the trade words the prompt says STT mangles', () => {
    const kw = patch.conversation_config.asr.keywords;
    expect(kw).toContain('weed mat');
    expect(kw).toContain('brickwork');
  });
});

describe('humanisePropertyName', () => {
  it('splits camelCase into a sentence', () => {
    expect(humanisePropertyName('quoteId')).toBe('Quote id.');
    expect(humanisePropertyName('customerDraft')).toBe('Customer draft.');
    expect(humanisePropertyName('estimatedDurationHours')).toBe('Estimated duration hours.');
  });

  it('handles snake_case and single words', () => {
    expect(humanisePropertyName('display_total')).toBe('Display total.');
    expect(humanisePropertyName('name')).toBe('Name.');
  });
});

describe('array item schemas (live-API preflight, 27 Aug 2026)', () => {
  it('gives array items a description — the API 422s without one', () => {
    // Verified against the live API: creating a tool whose array items carry
    // no description fails with "Must set one of: description,
    // dynamic_variable, is_system_provided, constant_value, or is_omitted".
    // That's a 422 on provisioning, so the whole agent fails to come up.
    const missed = byName('propose_import_supplier_list').parameters.properties?.missedItems;
    expect(missed?.type).toBe('array');
    expect(missed?.items?.description).toBeTruthy();
  });

  it('names the parent list in the synthesised item description', () => {
    const missed = byName('propose_import_supplier_list').parameters.properties?.missedItems;
    expect(missed?.items?.description).toMatch(/missed items/i);
  });

  it('leaves an item description that was already declared alone', () => {
    const tool = toElevenLabsTool({
      name: 'find_customer',
      description: 'x',
      parameters: {
        type: 'object',
        properties: {
          tags: { type: 'array', items: { type: 'string', description: 'A tag.' } },
        },
      },
    } as any);
    expect(tool.parameters.properties?.tags?.items?.description).toBe('A tag.');
  });

  it('leaves no schema node anywhere without a description', () => {
    // The API's rule applies at every depth, not just to top-level properties.
    const missing: string[] = [];
    const walk = (schema: any, path: string) => {
      for (const [key, child] of Object.entries<any>(schema.properties || {})) {
        if (!child.description) missing.push(`${path}.${key}`);
        walk(child, `${path}.${key}`);
      }
      if (schema.items) {
        if (!schema.items.description) missing.push(`${path}[]`);
        walk(schema.items, `${path}[]`);
      }
    };
    for (const tool of buildAgentToolConfigs()) walk(tool.parameters, tool.name);
    expect(missing).toEqual([]);
  });
});
