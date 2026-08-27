/**
 * Talk to the live Mate agent, server-side, without a device.
 *
 * ElevenLabs drives a simulated tradie against the real agent — real prompt,
 * real tools, real model — and returns the transcript. That makes the things
 * we could previously only assert about (does Mate read a mismatched contact
 * back? does it point at the card's button instead of saying "Apply"? does the
 * nested customerDraft arrive populated?) observable before a human has to sit
 * on a job site and find out.
 *
 *   npm run mate:simulate               the default fencing scenario
 *   npm run mate:simulate -- --scenario wrong-contact
 *
 * Client tools can't execute here — they run on the device — so each is
 * mocked with what the real dispatcher would return.
 *
 * Costs LLM credits per run. It is a smoke test, not something to loop.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const BASE = 'https://api.elevenlabs.io';

function loadEnv(): Record<string, string> {
  const file = path.join(ROOT, 'functions', '.env');
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8').split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
}

const mock = (v: unknown) => ({ default_return_value: JSON.stringify(v) });

/** What the real dispatcher would hand back, so Mate's side stays honest. */
const TOOL_MOCKS = {
  find_customer: mock({
    matches: [{ contactId: 'c_marcus', name: 'Marcus Webb', phoneMasked: '••••4417', hasEmail: true, lastJob: 'Gate repair', matchType: 'close', confidence: 0.62 }],
    confidence: 0.62, ambiguous: false, needsConfirmation: true,
  }),
  get_business_defaults: mock({ tradeCategory: 'fencing', defaultLabourRate: 95, defaultMarkup: 20, gstInclusive: true, businessName: 'HansenDev Fencing' }),
  get_job_requirements: mock({ mustAsk: ['fence height', 'number of gates'], specialistSupply: false, supplierBookPopulated: false }),
  propose_draft_quote: mock({ ok: true, proposalId: 'p_1', note: 'Card shown — nothing is saved until the tradie taps Apply. proposalId is not a quote id.' }),
  list_recent_quotes: mock({ quotes: [{ id: 'q_88', customerName: 'Katie Nguyen', jobName: 'Raised deck', total: 1183.4, status: 'draft', type: 'quote' }] }),
  get_quote: mock({
    id: 'q_88', customerName: 'Katie Nguyen', jobName: 'Raised deck', total: 1183.4, status: 'draft',
    materials: [
      { id: 'm1', name: 'Weed mat 1m x 20m', quantity: 1, unit: 'each', price: 179.88, total: 179.88 },
      { id: 'm2', name: 'Plywood panel 2400x1200', quantity: 2, unit: 'each', price: 0, total: 0, pricingSource: 'ai', estimated: true },
    ],
  }),
  show_quote: mock({ ok: true }),
  propose_update_line_item: mock({ ok: true, proposalId: 'p_2', note: 'Card shown — nothing is saved until the tradie taps Update it.' }),
  apply_pending_proposal: mock({ ok: false, error: 'No card is waiting.' }),
};

const SCENARIOS: Record<string, { first: string; persona: string }> = {
  // The everyday path: new customer, must-ask questions, draft.
  fence: {
    first: "yeah gday, need a quote for a 20 metre colorbond fence for Marcus",
    persona: 'You are an Australian tradie (a fencer) quoting by voice on a job site. Speak briefly and casually. Answer whatever is asked plainly. After about 4 exchanges, say thanks and stop.',
  },
  // find_customer comes back needsConfirmation — Mate must read the match
  // back and wait, never silently attach a quote to the wrong contact.
  'wrong-contact': {
    first: "quote for Marcus, the fencing job",
    persona: 'You are an Australian tradie. The assistant will suggest a contact that is NOT who you meant — correct it. Keep replies short. After about 4 exchanges, say thanks and stop.',
  },
  // The row has no price. Mate used to tell the tradie to go and type it in
  // themselves — twice, in the conversation that prompted propose_update_line_item.
  'set-a-price': {
    first: "on Katie Nguyen's raised deck quote, the plywood panel has no price on it",
    persona:
      'You are an Australian tradie with ONE specific request: the plywood panel line on Katie Nguyen\'s "Raised deck" quote has no price, and you want it set to one hundred dollars each. Say so plainly and stay on that single line item — do not ask about the whole job or any other quote. If the assistant suggests you set the price yourself, push back once and tell it to do it. Keep replies short. Stop once it has offered to make the change.',
  },
  // Mate has no tool for this. It must say so in the first reply rather than
  // sending the tradie hunting for a control that was never there.
  'no-tool': {
    first: "can you change my logo on the quote PDF",
    persona: 'You are an Australian tradie. Ask about changing the logo on quotes. If told it cannot be done from chat, accept it. Keep replies short and stop after 3 exchanges.',
  },
};

async function main() {
  const env = loadEnv();
  const key = env.ELEVENLABS_API_KEY;
  const agent = env.ELEVENLABS_AGENT_ID;
  if (!key) throw new Error('ELEVENLABS_API_KEY missing from functions/.env');
  if (!agent) throw new Error('ELEVENLABS_AGENT_ID missing from functions/.env');

  const idx = process.argv.indexOf('--scenario');
  const name = idx >= 0 ? process.argv[idx + 1] : 'fence';
  const scenario = SCENARIOS[name];
  if (!scenario) throw new Error(`unknown scenario "${name}" — try: ${Object.keys(SCENARIOS).join(', ')}`);

  console.log(`Scenario: ${name}\n`);
  const res = await fetch(`${BASE}/v1/convai/agents/${agent}/simulate-conversation`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      simulation_specification: {
        simulated_user_config: { first_message: scenario.first, language: 'en', prompt: { prompt: scenario.persona } },
        tool_mock_config: TOOL_MOCKS,
        // Every {{placeholder}} must be supplied or the run 400s with
        // "missing_dynamic_variables" — the same failure a real session would
        // hit, which is why the session sets this from the device clock.
        dynamic_variables: { greeting: 'Morning' },
      },
      new_turns_limit: 12,
    }),
  });

  const text = await res.text();
  if (!res.ok) { console.error(`HTTP ${res.status}: ${text.slice(0, 800)}`); process.exit(1); }
  const out = JSON.parse(text);

  for (const turn of out.simulated_conversation || []) {
    const who = turn.role === 'user' ? 'TRADIE' : 'MATE  ';
    if (turn.message) console.log(`${who}: ${turn.message}`);
    for (const call of turn.tool_calls || []) {
      const p = call.params_as_json || call.parameters || {};
      const shown = typeof p === 'string' ? p : JSON.stringify(p);
      console.log(`        > ${call.tool_name}(${shown.slice(0, 180)})`);
    }
  }
  if (out.analysis) {
    console.log(`\n--- ${out.analysis.call_successful} ---`);
    console.log(out.analysis.transcript_summary);
  }
}

main().catch((err) => { console.error('\nFAILED:', err.message); process.exit(1); });
