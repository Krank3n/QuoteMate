/**
 * Push Mate's prompt, tools and agent config to ElevenLabs.
 *
 * The repo is the source of truth. Nothing else may write this agent — edit it
 * in the dashboard and the next run will put it back, which is the point: a
 * prompt that drifts between the repo and the live agent means voice-Mate and
 * text-Mate disagree in front of a customer.
 *
 *   npm run mate:agent          dry run — prints what would change, exits 1 on drift
 *   npm run mate:agent -- --write   apply it
 *
 * Auth comes from functions/.env (ELEVENLABS_API_KEY). Never pass the key on
 * the command line — it would land in shell history.
 *
 * GOTCHA: ELEVENLABS_VOICE_ID must be a voice in YOUR workspace, not just a
 * voice_id from the shared library. Referencing a library voice you haven't
 * added fails with a 400 "voice_not_found" that reads like a wrong id and
 * isn't. Add it first:
 *   POST /v1/voices/add/{public_owner_id}/{voice_id}  { new_name }
 * The workspace keeps the same voice_id, which is why the error is confusing.
 *
 * ADDITIVE ONLY for tools: never delete or rename one the shipped app still
 * handles. An agent that emits a tool the installed build has no handler for
 * stalls the turn for every user on that version. Prune only after the minimum
 * supported version has moved past it.
 */
import fs from 'fs';
import path from 'path';
import {
  buildAgentToolConfigs,
  buildAgentPatch,
  toolFingerprint,
  type ElevenLabsClientTool,
} from '../src/services/assistant/elevenLabsAgentConfig';

const ROOT = path.resolve(__dirname, '..');
const BASE = 'https://api.elevenlabs.io';
const WRITE = process.argv.includes('--write');

/** Mate's opening line, spoken verbatim — no LLM turn, so it cannot leak. */
export const MATE_FIRST_MESSAGE =
  "{{greeting}} — I can draft you a quote or an invoice. What are we after?";

function loadEnv(): Record<string, string> {
  const file = path.join(ROOT, 'functions', '.env');
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8').split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
}

const env = loadEnv();
const KEY = env.ELEVENLABS_API_KEY;
if (!KEY) throw new Error('ELEVENLABS_API_KEY missing from functions/.env');
const H = { 'xi-api-key': KEY, 'Content-Type': 'application/json' };

async function api(pathname: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${BASE}${pathname}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${pathname} -> ${res.status}: ${text.slice(0, 600)}`);
  return body;
}

/**
 * Compare only the fields WE set.
 *
 * The API echoes back defaults it adds itself — enum:null, is_omitted:false,
 * dynamic_variable:"", constant_value:"" — on every schema node. Diffing the
 * whole response would report drift on every single run and train everyone to
 * ignore this script. Verified against the live API.
 */
function ourFieldsOnly(remote: any, ours: any): any {
  if (ours === null || typeof ours !== 'object') return remote;
  if (Array.isArray(ours)) return Array.isArray(remote) ? remote.slice(0, ours.length) : remote;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(ours)) out[k] = ourFieldsOnly(remote?.[k], ours[k]);
  return out;
}

const same = (remote: any, ours: any) =>
  toolFingerprint(ourFieldsOnly(remote, ours)) === toolFingerprint(ours);

async function syncTools(): Promise<Record<string, string>> {
  const desired = buildAgentToolConfigs();
  const existing: any[] = (await api('/v1/convai/tools')).tools || [];
  const byName = new Map(existing.map((t) => [t.tool_config?.name, t]));
  const ids: Record<string, string> = {};
  let created = 0, patched = 0, unchanged = 0;

  for (const tool of desired) {
    const found = byName.get(tool.name);
    if (!found) {
      console.log(`  + create ${tool.name}`);
      created++;
      if (WRITE) {
        const made = await api('/v1/convai/tools', { method: 'POST', body: JSON.stringify({ tool_config: tool }) });
        ids[tool.name] = made.id || made.tool_id;
      }
      continue;
    }
    const id = found.id || found.tool_id;
    ids[tool.name] = id;
    if (same(found.tool_config, tool as ElevenLabsClientTool)) { unchanged++; continue; }
    console.log(`  ~ update ${tool.name}`);
    patched++;
    if (WRITE) await api(`/v1/convai/tools/${id}`, { method: 'PATCH', body: JSON.stringify({ tool_config: tool }) });
  }

  const orphans = existing.filter((t) => !desired.some((d) => d.name === t.tool_config?.name));
  for (const o of orphans) console.log(`  ! extra tool on ElevenLabs, left alone: ${o.tool_config?.name}`);

  console.log(`  tools: ${created} to create, ${patched} to update, ${unchanged} unchanged`);
  return ids;
}

async function syncAgent(toolIds: string[]): Promise<string> {
  const voiceId = env.ELEVENLABS_VOICE_ID;
  if (!voiceId) throw new Error('ELEVENLABS_VOICE_ID missing from functions/.env');
  const patch = buildAgentPatch({ toolIds, voiceId, firstMessage: MATE_FIRST_MESSAGE });
  const agentId = env.ELEVENLABS_AGENT_ID;

  if (!agentId) {
    console.log('  + create agent "Mate (voice)"');
    if (!WRITE) return '(dry run — no agent created)';
    const made = await api('/v1/convai/agents/create', {
      method: 'POST',
      body: JSON.stringify({ name: 'Mate (voice)', ...patch }),
    });
    console.log(`\n  ELEVENLABS_AGENT_ID=${made.agent_id}   <- add this to functions/.env`);
    return made.agent_id;
  }

  const remote = await api(`/v1/convai/agents/${agentId}`);
  if (same(remote, patch)) { console.log('  agent: unchanged'); return agentId; }
  console.log('  ~ update agent');
  if (WRITE) await api(`/v1/convai/agents/${agentId}`, { method: 'PATCH', body: JSON.stringify(patch) });
  return agentId;
}

async function main() {
  console.log(WRITE ? 'Syncing Mate agent (WRITE)\n' : 'Dry run — nothing will be written\n');
  const ids = await syncTools();
  const toolIds = Object.values(ids).filter(Boolean);
  console.log('');
  await syncAgent(toolIds);
  console.log(WRITE ? '\nDone.' : '\nDry run complete. Re-run with --write to apply.');
}

main().catch((err) => { console.error('\nFAILED:', err.message); process.exit(1); });
