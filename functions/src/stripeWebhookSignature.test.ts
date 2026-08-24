import { describe, expect, it } from 'vitest';
import Stripe from 'stripe';

/**
 * stripeWebhook (index.ts) verifies with stripe.webhooks.constructEvent over
 * req.rawBody — a Buffer of the exact received bytes supplied by the
 * firebase-functions runtime. This pins that the installed stripe library
 * verifies a Buffer payload on this Node/SDK combination; a body-parser
 * regression upstream (e.g. an Express major bump inside firebase-functions)
 * would mean silently rejected payment webhooks — subscriptions never
 * activating — with no client-side error.
 */
const stripe = new Stripe('sk_test_fixture', { apiVersion: '2023-10-16' });
const SECRET = 'whsec_test_fixture_secret';
const PAYLOAD = JSON.stringify({
  id: 'evt_test_1',
  object: 'event',
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_test_1', object: 'checkout.session' } },
});

describe('stripe webhook signature verification', () => {
  it('constructEvent accepts a Buffer payload (the req.rawBody shape)', () => {
    const header = stripe.webhooks.generateTestHeaderString({
      payload: PAYLOAD,
      secret: SECRET,
    });
    const event = stripe.webhooks.constructEvent(Buffer.from(PAYLOAD, 'utf8'), header, SECRET);
    expect(event.type).toBe('checkout.session.completed');
    expect(event.id).toBe('evt_test_1');
  });

  it('constructEvent rejects tampered bytes', () => {
    const header = stripe.webhooks.generateTestHeaderString({
      payload: PAYLOAD,
      secret: SECRET,
    });
    const tampered = Buffer.from(PAYLOAD.replace('cs_test_1', 'cs_test_2'), 'utf8');
    expect(() => stripe.webhooks.constructEvent(tampered, header, SECRET)).toThrow();
  });

  it('constructEvent rejects a wrong secret', () => {
    const header = stripe.webhooks.generateTestHeaderString({
      payload: PAYLOAD,
      secret: SECRET,
    });
    expect(() =>
      stripe.webhooks.constructEvent(Buffer.from(PAYLOAD, 'utf8'), header, 'whsec_other'),
    ).toThrow();
  });
});
