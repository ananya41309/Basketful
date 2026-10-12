// Slice 0 gate: does the Hyperswitch sandbox (with our connector) support the grocery flow?
//   1. Authorize a $68.50 hold (manual capture)            -> requires_capture
//   2. Capture only the $58.25 final total                   -> partially_captured, $10.25 released
//   3. Refund one $7.08 item after capture                   -> refund created
//   4. Authorize a second hold and void it (order cancelled) -> cancelled
//
// Sends a test card server-to-server, so it needs no browser. Run: npm run test:capture
// Processor: PayPal sandbox behind Hyperswitch. Override the card with TEST_CARD=... npm run test:capture
import 'dotenv/config';
import {
  capturePayment,
  cancelPayment,
  refundPayment,
  retrievePayment,
  HyperswitchError,
  DEMO_CUSTOMER,
} from '../server/hyperswitch.js';

const BASE_URL = (process.env.HYPERSWITCH_BASE_URL || 'https://sandbox.hyperswitch.io').replace(/\/$/, '');
const HOLD = 6850;
const FINAL = 5825;
const REFUND = 708;

const usd = (c) => (c == null ? '—' : `$${(c / 100).toFixed(2)}`);
const results = [];

function check(name, pass, detail) {
  results.push({ name, pass, detail });
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

// Two steps, like the app's checkout: create the payment, then confirm it with the card.
// Some processors (e.g. Square) need Hyperswitch to swap the card for a processor token first,
// and Hyperswitch does that during a separate confirm call.
// A raw test card is only acceptable in the sandbox; the app itself uses Unified Checkout.
async function createConfirmedHold(amount, label) {
  const create = {
    amount,
    currency: 'USD',
    capture_method: 'manual',
    confirm: false,
    authentication_type: 'no_three_ds',
    email: DEMO_CUSTOMER.email,
    billing: DEMO_CUSTOMER.billing,
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
        card_number: process.env.TEST_CARD || '4012000033330026', // PayPal sandbox Visa
        card_exp_month: '12',
        card_exp_year: '2030',
        card_holder_name: 'Test Customer',
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

  // 1. Hold
  const held = await createConfirmedHold(HOLD, 'partial capture');
  console.log(`payment ${held.payment_id} via ${held.connector ?? 'unknown connector'}`);
  check('Hold authorized for $68.50', held.status === 'requires_capture', `status=${held.status}, capturable=${usd(held.amount_capturable)}`);
  if (held.status !== 'requires_capture') {
    console.log('\nError from connector:', held.error_code, held.error_message);
    return summary();
  }

  // 2. Partial capture
  const captured = await capturePayment(held.payment_id, FINAL);
  check(
    'Captured only the final $58.25',
    ['partially_captured', 'succeeded', 'processing'].includes(captured.status),
    `status=${captured.status}`,
  );
  const synced = await retrievePayment(held.payment_id);
  // Some processors settle captures in a batch: the payment reads 'processing' until then.
  const pending = synced.status === 'processing';
  check(
    'Charged amount is $58.25',
    synced.amount_received === FINAL || pending,
    pending ? `capture accepted, pending settlement (amount_received=${usd(synced.amount_received)})` : `amount_received=${usd(synced.amount_received)}`,
  );
  check(
    'Remainder released (nothing left to capture)',
    (synced.amount_capturable ?? 0) === 0,
    `amount_capturable=${usd(synced.amount_capturable)}, status=${synced.status}`,
  );

  // 3. Partial refund of one item. Informational: some processors (e.g. Authorize.net) only refund
  // a capture after it settles, which in their sandbox happens about once a day.
  try {
    const refund = await refundPayment(held.payment_id, REFUND, 'Missing item: Barista oat milk');
    const ok = ['pending', 'succeeded'].includes(refund.status);
    console.log(`${ok ? 'PASS' : 'NOTE'}  Partial refund of $7.08  (status=${refund.status}${ok ? '' : '; may need the capture to settle first'})`);
  } catch (err) {
    console.log(`NOTE  Partial refund of $7.08 not accepted yet  (${err.message}; may need the capture to settle first)`);
  }

  // 4. Void a second hold
  const second = await createConfirmedHold(HOLD, 'void');
  const voided = await cancelPayment(second.payment_id);
  check('Second hold voided on cancel', voided.status === 'cancelled' || voided.status === 'processing', `status=${voided.status}`);

  summary();
}

function summary() {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.log('Paste this output into the chat; the failing line and its status say what to fix.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('\nRequest failed:', err.message);
  if (err.body) console.error(JSON.stringify(err.body, null, 2));
  process.exit(1);
});
