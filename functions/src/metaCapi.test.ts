import { describe, expect, it } from 'vitest';
import { parseBeacon, buildCapiPayload, sha256Lower } from './metaCapi';

describe('parseBeacon', () => {
  it('accepts a well-formed SignupStart beacon with tracking cookies', () => {
    expect(
      parseBeacon({
        eventName: 'SignupStart',
        eventId: 'evt-123',
        url: 'https://quotemateapp.au/?utm_content=qm-a1',
        fbc: 'fb.1.1.IwAR',
        fbp: 'fb.1.2.333',
      }),
    ).toEqual({
      eventName: 'SignupStart',
      eventId: 'evt-123',
      url: 'https://quotemateapp.au/?utm_content=qm-a1',
      fbc: 'fb.1.1.IwAR',
      fbp: 'fb.1.2.333',
    });
  });

  it('rejects unknown event names (allow-list, not passthrough)', () => {
    expect(parseBeacon({ eventName: 'Purchase', eventId: 'x' })).toBeNull();
  });

  it('rejects missing, empty, or oversized eventId', () => {
    expect(parseBeacon({ eventName: 'Lead' })).toBeNull();
    expect(parseBeacon({ eventName: 'Lead', eventId: '  ' })).toBeNull();
    expect(parseBeacon({ eventName: 'Lead', eventId: 'x'.repeat(65) })).toBeNull();
  });

  it('rejects non-object bodies', () => {
    expect(parseBeacon(null)).toBeNull();
    expect(parseBeacon('str')).toBeNull();
  });

  it('caps optional string fields at 512 chars and drops non-strings', () => {
    const parsed = parseBeacon({
      eventName: 'PageView',
      eventId: 'e',
      url: 'u'.repeat(600),
      fbc: 42,
    });
    expect(parsed!.url).toHaveLength(512);
    expect(parsed!.fbc).toBeUndefined();
  });
});

describe('buildCapiPayload', () => {
  it('builds the Meta events payload with epoch seconds and dedup event_id', () => {
    const payload = buildCapiPayload(
      { eventName: 'SignupStart', eventId: 'evt-1', url: 'https://quotemateapp.au/', fbp: 'fb.1' },
      new Date('2026-07-26T00:00:00Z'),
      '1.2.3.4',
      'Mozilla/5.0',
    );
    expect(payload).toEqual({
      data: [
        {
          event_name: 'SignupStart',
          event_time: 1785024000,
          event_id: 'evt-1',
          action_source: 'website',
          event_source_url: 'https://quotemateapp.au/',
          user_data: {
            fbp: 'fb.1',
            client_ip_address: '1.2.3.4',
            client_user_agent: 'Mozilla/5.0',
          },
        },
      ],
    });
  });

  it('hashes email (sha256 of trimmed lowercase) and never sends it raw', () => {
    const payload = buildCapiPayload(
      { eventName: 'Lead', eventId: 'e', email: '  Tradie@Example.COM ' },
      new Date(0),
    );
    const em = (payload.data[0].user_data as any).em;
    expect(em).toEqual([sha256Lower('tradie@example.com')]);
    expect(JSON.stringify(payload)).not.toMatch(/example\.com/i);
  });

  it('omits user_data fields that are absent rather than sending empties', () => {
    const payload = buildCapiPayload({ eventName: 'PageView', eventId: 'e' }, new Date(0));
    expect(payload.data[0].user_data).toEqual({});
    expect(payload.data[0]).not.toHaveProperty('event_source_url');
  });
});
