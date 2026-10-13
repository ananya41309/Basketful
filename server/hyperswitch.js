// Thin client for the Hyperswitch Payments API (v1). Server-side only: it holds the secret key.
// Docs: https://api-reference.hyperswitch.io/introduction
import crypto from 'node:crypto';

const BASE_URL = (process.env.HYPERSWITCH_BASE_URL || 'https://sandbox.hyperswitch.io').replace(/\/$/, '');

export class HyperswitchError extends Error {
  constructor(status, body) {
    const e = body?.error ?? {};
    super(e.message || `Hyperswitch request failed with HTTP ${status}`);
    this.status = status;
    this.code = e.code;
    this.type = e.type;
    this.body = body;
  }
}

async function call(method, path, body) {
  const apiKey = process.env.HYPERSWITCH_API_KEY;
  if (!apiKey) throw new Error('HYPERSWITCH_API_KEY is not set. Copy .env.example to .env and add your sandbox key.');

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'api-key': apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new HyperswitchError(res.status, json);
  return json;
}

// Create a payment that only authorizes (places a hold). The browser confirms it
// through Unified Checkout using the returned client_secret.
export function createHoldPayment({ amount, orderId, description, returnUrl, simulateDecline = false }) {
  const body = {
    amount,
    currency: 'USD',
    capture_method: 'manual',
    confirm: false,
    // US has no SCA mandate, so we do not force 3DS; issuers can still step up.
    authentication_type: 'no_three_ds',
    description,
    return_url: returnUrl,
    metadata: simulateDecline ? { order_id: orderId, demo: 'simulated_decline' } : { order_id: orderId },
    // Prefilled demo customer. Some processors (e.g. Cybersource) require name, email and billing
    // address; sending them here means the checkout form only asks for the card.
    email: DEMO_CUSTOMER.email,
    billing: simulateDecline ? DECLINE_BILLING : DEMO_CUSTOMER.billing,
  };
  if (process.env.HYPERSWITCH_PROFILE_ID) body.profile_id = process.env.HYPERSWITCH_PROFILE_ID;
  return call('POST', '/payments', body);
}

export const DEMO_CUSTOMER = {
  email: 'demo.customer@example.com',
  billing: {
    address: {
      first_name: 'Demo',
      last_name: 'Customer',
      line1: '1 Demo Street',
      city: 'Chicago',
      state: 'IL',
      zip: '60601',
      country: 'US',
    },
    email: 'demo.customer@example.com',
  },
};

// Demo only (checkout's "Simulate a declined card"). PayPal's sandbox refuses a card when the cardholder
// name is CCREJECT-REFUSED, and Hyperswitch sends the billing name as the card name.
export const DECLINE_TRIGGER_NAME = 'CCREJECT-REFUSED';
const DECLINE_BILLING = {
  ...DEMO_CUSTOMER.billing,
  address: { ...DEMO_CUSTOMER.billing.address, first_name: DECLINE_TRIGGER_NAME, last_name: undefined },
};

// force_sync asks Hyperswitch to fetch the latest status from the processor.
export function retrievePayment(paymentId, { forceSync = true } = {}) {
  return call('GET', `/payments/${encodeURIComponent(paymentId)}${forceSync ? '?force_sync=true' : ''}`);
}

// Capture less than the hold; Hyperswitch releases the uncaptured remainder.
export function capturePayment(paymentId, amountToCapture) {
  return call('POST', `/payments/${encodeURIComponent(paymentId)}/capture`, {
    amount_to_capture: amountToCapture,
  });
}

// Void an uncaptured hold (customer cancels before picking finishes).
export function cancelPayment(paymentId, reason = 'requested_by_customer') {
  return call('POST', `/payments/${encodeURIComponent(paymentId)}/cancel`, {
    cancellation_reason: reason,
  });
}

export function refundPayment(paymentId, amount, reason) {
  return call('POST', '/refunds', { payment_id: paymentId, amount, reason });
}

// Outgoing webhooks are signed with HMAC-SHA512 over the raw JSON body using the
// profile's payment response hash key, sent as x-webhook-signature-512.
// Returns 'verified' | 'invalid' | 'unverified' (no secret configured).
export function verifyWebhook(rawBody, signatureHeader) {
  const secret = process.env.HYPERSWITCH_WEBHOOK_SECRET;
  if (!secret) return 'unverified';
  if (!signatureHeader) return 'invalid';
  const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
  const received = String(signatureHeader).trim().toLowerCase();
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? 'verified' : 'invalid';
}

// The subset of the payment we keep on the order and show in the inspector.
export function summarizePayment(p) {
  return {
    id: p.payment_id,
    status: p.status,
    amount: p.amount,
    amountCapturable: p.amount_capturable,
    amountReceived: p.amount_received ?? null,
    captureMethod: p.capture_method,
    connector: p.connector ?? null,
    paymentMethod: p.payment_method ?? null,
    paymentMethodType: p.payment_method_type ?? null,
    errorCode: p.error_code ?? null,
    errorMessage: p.error_message ?? null,
    updated: p.updated ?? null,
  };
}
