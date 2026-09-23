// Probe a Gemini Live model with the app's own setup frame, without a device.
//
//   cd functions
//   GEMINI_API_KEY=... node scripts/probeLiveModel.mjs gemini-3.8-live lang
//   AUTH_MODE=token GEMINI_API_KEY=auth_tokens/... node scripts/probeLiveModel.mjs gemini-3.8-live lang
//
// Second arg `lang` sends speechConfig.languageCode en-US (what voiceSession
// sends); anything else omits it. AUTH_MODE=token connects through the same
// constrained v1alpha socket the client uses, with an ephemeral token minted
// the way assistantToken mints them (POST v1alpha/auth_tokens). Prints one JSON
// line: setup ack, audio bytes, spoken transcription, tool calls made, message
// kinds seen, a usageMetadata sample, and any close code. Used 21 Sep 2026 to
// clear gemini-3.8-live before the swap from gemini-3.1-flash-live-preview.
const [model, langFlag] = process.argv.slice(2);
const key = process.env.GEMINI_API_KEY;
const url = process.env.AUTH_MODE === 'token' ? `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(key)}` : `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${key}`;
const ws = new WebSocket(url);
const seen = {}; let audioBytes = 0, outText = '', toolCalls = [], closed = null, setupOk = false;
const t0 = Date.now();
const done = () => { console.log(JSON.stringify({ model, languageCode: langFlag === 'lang', setupOk, audioBytes, outText: outText.slice(0, 160), toolCalls, seen, closed, ms: Date.now() - t0 })); process.exit(0); };
setTimeout(done, 20000);
ws.onopen = () => {
  ws.send(JSON.stringify({ setup: {
    model: `models/${model}`,
    generationConfig: { responseModalities: ['AUDIO'], ...(langFlag === 'lang' ? { speechConfig: { languageCode: 'en-US' } } : {}) },
    systemInstruction: { parts: [{ text: "You are Mate, a quoting assistant for Australian tradies. Keep replies to one short sentence. When asked to draft, call propose_draft_quote." }] },
    tools: [{ functionDeclarations: [{ name: 'propose_draft_quote', description: 'Draft a quote', parameters: { type: 'OBJECT', properties: { jobName: { type: 'STRING' }, jobDescription: { type: 'STRING' } }, required: ['jobName', 'jobDescription'] } }] }],
    realtimeInputConfig: { automaticActivityDetection: { disabled: false, silenceDurationMs: 1200, prefixPaddingMs: 300 } },
    inputAudioTranscription: {}, outputAudioTranscription: {},
  } }));
};
ws.onmessage = async (ev) => {
  const raw = typeof ev.data === 'string' ? ev.data : await ev.data.text();
  let m; try { m = JSON.parse(raw); } catch { return; }
  for (const k of Object.keys(m)) seen[k] = (seen[k] || 0) + 1; if (m.usageMetadata) seen.usageSample = m.usageMetadata;
  if (m.setupComplete) { setupOk = true; ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: "G'day Mate. Draft a quote to replace a hot water system for Sam, then tell me it's done." }] }], turnComplete: true } })); }
  const parts = m.serverContent?.modelTurn?.parts || [];
  for (const p of parts) if (p.inlineData?.data) audioBytes += Buffer.from(p.inlineData.data, 'base64').length;
  if (m.serverContent?.outputTranscription?.text) outText += m.serverContent.outputTranscription.text;
  if (m.toolCall?.functionCalls) { toolCalls.push(...m.toolCall.functionCalls.map(c => c.name)); ws.send(JSON.stringify({ toolResponse: { functionResponses: m.toolCall.functionCalls.map(c => ({ id: c.id, name: c.name, response: { ok: true, quoteId: 'q-1' } })) } })); }
  if (m.serverContent?.turnComplete && toolCalls.length && audioBytes > 0) setTimeout(done, 1500);
};
ws.onclose = (e) => { closed = { code: e.code, reason: e.reason }; done(); };
ws.onerror = (e) => { closed = { error: String(e.message || e) }; };
