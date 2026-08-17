/**
 * Regression tests for job-title generation ("Clean-up & Generate Title").
 *
 * Same shape as the email-generation bug in llmService.email.test.ts, one
 * screen upstream. The client bundle ships no LLM API keys (removed after the
 * July 2026 leak; see .env.backup-pre-key-removal), but
 * cleanupTranscriptionAndGenerateTitle kept a mobile-only branch that went
 * straight to Gemini and then Anthropic with bundled keys. Because
 * babel.config.js sets `allowUndefined: true`, those imports compiled to
 * `undefined` rather than failing the build, so on iOS/Android both paths threw
 * and every title silently fell through to extractSimpleTitle.
 *
 * That fallback was `firstSentence.substring(0, 47) + '...'`, so QU-178692 went
 * out to a customer titled:
 *
 *   "Replace the left boundary paling fence at a sin..."
 *
 * — on the PDF's JOB DETAILS heading, in the email subject line, and in the
 * attachment filename. Two things must hold: generation routes through the
 * Firebase Function on every platform, and the last-ditch fallback never emits
 * a mid-word truncation or an ellipsis.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Simulate a native runtime — the platform the bug affected. (vitest aliases
// react-native to react-native-web, whose Platform.OS is 'web'.)
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const fetchMock = vi.fn();

const WARRAGUL_FENCE =
  'Replace the left boundary paling fence at a single storey house in Warragul. ' +
  'About 25 metres long, 1.8m high treated pine palings on 65x65 steel posts with ' +
  'three rails. Remove and dump the old fence. Good side access down the driveway.';

async function importFresh() {
  vi.resetModules();
  const mod = await import('./llmService');
  const { auth } = await import('../config/firebase');
  (auth as any).currentUser = { uid: 'test-uid', getIdToken: vi.fn(async () => 'test-token') };
  return mod;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cleanupTranscriptionAndGenerateTitle on iOS', () => {
  it('routes through the Firebase Function, never a direct LLM API', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        cleanedDescription: 'Replace the left boundary paling fence.',
        suggestedTitle: 'Replace Left Boundary Paling Fence',
      }),
    });
    const { cleanupTranscriptionAndGenerateTitle } = await importFresh();

    const result = await cleanupTranscriptionAndGenerateTitle(WARRAGUL_FENCE);

    expect(result.suggestedTitle).toBe('Replace Left Boundary Paling Fence');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/cleanupTranscription');
    expect(url).not.toContain('api.anthropic.com');
    expect(url).not.toContain('generativelanguage.googleapis.com');
    expect(init.headers.Authorization).toBe('Bearer test-token');
  });

  it('passes the niche checklist through so pill state comes back', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        cleanedDescription: 'Cleaned.',
        suggestedTitle: 'Fence Replacement',
        pills: { access: true, deadline: false },
      }),
    });
    const { cleanupTranscriptionAndGenerateTitle } = await importFresh();

    const result = await cleanupTranscriptionAndGenerateTitle(WARRAGUL_FENCE, undefined, [
      { id: 'access', label: 'Access' },
      { id: 'deadline', label: 'Deadline' },
    ]);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).pillSpec).toHaveLength(2);
    expect(result.pills).toEqual({ access: true, deadline: false });
  });

  it('treats an empty title from the server as a failure, not an answer', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ cleanedDescription: 'Cleaned.', suggestedTitle: '  ' }),
    });
    const { cleanupTranscriptionAndGenerateTitle } = await importFresh();

    const result = await cleanupTranscriptionAndGenerateTitle(WARRAGUL_FENCE);

    // Falls through the ladder to the local fallback rather than handing the
    // caller a blank title.
    expect(result.suggestedTitle.trim()).not.toBe('');
  });

  describe('when the server is unreachable', () => {
    it('never emits an ellipsis or a mid-word cut', async () => {
      fetchMock.mockRejectedValue(new Error('Network request failed'));
      const { cleanupTranscriptionAndGenerateTitle } = await importFresh();

      const { suggestedTitle } = await cleanupTranscriptionAndGenerateTitle(WARRAGUL_FENCE);

      expect(suggestedTitle).not.toContain('...');
      expect(suggestedTitle).not.toContain('…');
      // The exact string that shipped on QU-178692.
      expect(suggestedTitle).not.toBe('Replace the left boundary paling fence at a sin...');
      // Every word is a whole word from the source text.
      for (const word of suggestedTitle.split(' ')) {
        expect(WARRAGUL_FENCE).toContain(word);
      }
    });

    it('produces a title that reads as a phrase', async () => {
      fetchMock.mockRejectedValue(new Error('Network request failed'));
      const { cleanupTranscriptionAndGenerateTitle } = await importFresh();

      const { suggestedTitle } = await cleanupTranscriptionAndGenerateTitle(WARRAGUL_FENCE);

      expect(suggestedTitle).toBe('Replace the left boundary paling fence');
    });

    it('leaves the description untouched so no detail is lost', async () => {
      fetchMock.mockRejectedValue(new Error('Network request failed'));
      const { cleanupTranscriptionAndGenerateTitle } = await importFresh();

      const { cleanedDescription } = await cleanupTranscriptionAndGenerateTitle(WARRAGUL_FENCE);

      expect(cleanedDescription).toBe(WARRAGUL_FENCE);
    });
  });
});

describe('the offline title fallback, across real job descriptions', () => {
  // Drawn from production quotes (replay-audit dumps), recovered-quote records
  // excluded. Each must survive the fallback intact or as a clean phrase.
  const cases: { input: string; expected: string }[] = [
    // Short real titles pass through whole — including their prepositions.
    { input: 'Clear blocked sink', expected: 'Clear blocked sink' },
    { input: 'Construction of 2m x 4m Deck', expected: 'Construction of 2m x 4m Deck' },
    { input: 'Stainless Steel Splashback Installation', expected: 'Stainless Steel Splashback Installation' },
    { input: 'Tree removal', expected: 'Tree removal' },
    // Long ones cut on a word boundary and back off the severed clause.
    {
      input: 'Replace the left boundary paling fence at a single storey house in Warragul.',
      expected: 'Replace the left boundary paling fence',
    },
    {
      input: 'Supply and install aluminium pool fencing around the swimming pool area.',
      expected: 'Supply and install aluminium pool fencing',
    },
    // A leading article is load-bearing and must not be trimmed away.
    {
      input: 'The kitchen renovation project requires extensive demolition first.',
      expected: 'The kitchen renovation project requires extensive',
    },
  ];

  for (const { input, expected } of cases) {
    it(`turns ${JSON.stringify(input.slice(0, 46))} into ${JSON.stringify(expected)}`, async () => {
      fetchMock.mockRejectedValue(new Error('offline'));
      const { cleanupTranscriptionAndGenerateTitle } = await importFresh();

      const { suggestedTitle } = await cleanupTranscriptionAndGenerateTitle(input);

      expect(suggestedTitle).toBe(expected);
      expect(suggestedTitle.length).toBeLessThanOrEqual(50);
    });
  }

  it('falls back to Custom Job on empty input', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const { cleanupTranscriptionAndGenerateTitle } = await importFresh();

    expect((await cleanupTranscriptionAndGenerateTitle('   ')).suggestedTitle).toBe('Custom Job');
  });

  it('hard-cuts a single unbroken word rather than emitting an ellipsis', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const { cleanupTranscriptionAndGenerateTitle } = await importFresh();

    const { suggestedTitle } = await cleanupTranscriptionAndGenerateTitle('W'.repeat(80));

    expect(suggestedTitle).toBe('W'.repeat(50));
    expect(suggestedTitle).not.toContain('...');
  });
});
