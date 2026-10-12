// Decline path in the live sandbox: a refused card fails the payment, and a fresh payment for the same
// order then succeeds (the app's "Try another card" creates a new payment rather than re-confirming the
// failed one, so Hyperswitch's manual_retry setting is not needed).
//   1. Hold with PayPal's refusal trigger   -> failed (DO_NOT_HONOR)
//   2. New hold with the good test card     -> requires_capture
//   3. Void it so nothing is left on hold   -> cancelled
//
// PayPal's sandbox declines when the cardholder name is CCREJECT-REFUSED (its negative-testing trigger);
// Hyperswitch sends the billing name as the card name. Card and name come from Hyperswitch's own PayPal tests.
// Run: npm run test:decline
import 'dotenv/config';
import { cancelPayment, HyperswitchError, DEMO_CUSTOMER } from '../server/hyperswitch.js';

const BASE_URL = (process.env.HYPERSWITCH_BASE_URL || 'https://sandbox.hyperswitch.io').replace(/\/$/, '');
const HOLD = 7068;
const DECLINE_NAME = 'CCREJECT-REFUSED';
const results = [];

function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function hs(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'api-key': process.env.HYPERSWITCH_API_KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new HyperswitchError(res.status, json);
  return json;
}

async function hold({ cardNumber, firstName, lastName, label }) {
  const billing = {
    ...DEMO_CUSTOMER.billing,
    address: { ...DEMO_CUSTOMER.billing.address, first_name: firstName, last_name: lastName },
  };
  const create = {
    amount: HOLD,
    currency: 'USD',
    capture_method: 'manual',
    confirm: false,
    authentication_type: 'no_three_ds',
    email: DEMO_CUSTOMER.email,
    billing,
    description: `Basketful sandbox test: ${label}`,
    return_url: 'https://example.com/return',
    metadata: { test: label },
  };
  if (process.env.HYPERSWITCH_PROFILE_ID) create.profile_id = process.env.HYPERSWITCH_PROFILE_ID;
  const created = await hs('POST', '/payments', create);
  return hs('POST', `/payments/${encodeURIComponent(created.payment_id)}/confirm`, {
    payment_method: 'card',
    payment_method_type: 'credit',
    payment_method_data: {
      card: {
        card_number: cardNumber,
        card_exp_month: '12',
        card_exp_year: '2030',
        card_holder_name: [firstName, lastName].filter(Boolean).join(' '),
        card_cvc: '123',
      },
    },
  });
}

async function main() {
  if (!process.env.HYPERSWITCH_API_KEY) {
    console.error('HYPERSWITCH_API_KEY is missing. Copy .env.example to .env and add your sandbox key.');
    process.exit(1);
  }
  console.log(`Hyperswitch: ${BASE_URL}\n`);

  const declined = await hold({ cardNumber: '4012888888881881', firstName: DECLINE_NAME, lastName: undefined, label: 'decline' });
  check(
    'Refused card fails the payment',
    declined.status === 'failed',
    `status=${declined.status}, error=${declined.error_code ?? '—'} ${declined.error_message ?? ''}`.trim(),
  );

  const retried = await hold({ cardNumber: '4012000033330026', firstName: 'Demo', lastName: 'Customer', label: 'retry after decline' });
  check('A new payment with the good card is held', retried.status === 'requires_capture', `status=${retried.status}`);

  if (retried.status === 'requires_capture') {
    const voided = await cancelPayment(retried.payment_id);
    check('Retry hold voided (clean up)', ['cancelled', 'processing'].includes(voided.status), `status=${voided.status}`);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('\nRequest failed:', err.message);
  if (err.body) console.error(JSON.stringify(err.body, null, 2));
  process.exit(1);
});
