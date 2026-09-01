/** One job through analyzeJobDescription, to confirm what the harness is talking to. */
import './preload';
import { callFunction, FUNCTIONS_BASE } from './auth';
(async () => {
  console.log('base =', FUNCTIONS_BASE);
  const t0 = Date.now();
  const r: any = await callFunction('analyzeJobDescription', {
    jobDescription:
      'Build a 2m x 5m deck with handrail and paint. Handrail to be 1m high, merbau decking on treated pine frame.',
  });
  console.log(`materials=${(r.materials || []).length}  hours=${r.estimatedHours}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log((r.materials || []).slice(0, 6).map((m: any) => ` - ${m.name} ${m.quantity}${m.unit}`).join('\n'));
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
