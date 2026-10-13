// Decline path in the live sandbox, through the same server code the app uses
// (createHoldPayment with the checkout's "Simulate a declined card" switch):
//   1. Hold with simulateDecline            -> failed (PayPal DO_NOT_HONOR)
//   2. New hold for the same order, normal  -> requires_capture   ("Try another payment method")
//   3. Void it so nothing is left on hold   -> cancelled
//
// PayPal's sandbox declines when the cardholder name is CCREJECT-REFUSED (its negative-testing trigger);
// Hyperswitch sends the billing name as the card name. Card and name come from Hyperswitch's own PayPal tests.
// Run: npm run test:decline
import 'dotenv/config';
import { createHoldPayment, cancelPayment, HyperswitchError } from '../server/hyperswitch.js';

const BASE_URL = (process.env.HYPERSWITCH_BASE_URL || 'https://sandbox.hyperswitch.io').replace(/\/$/, '');
const HOLD = 7068;
const results = [];

function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function confirmWithCard(paymentId, cardNumber) {
  const res = await fetch(`${BASE_URL}/payments/${encodeURIComponent(paymentId)}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'api-key': process.env.HYPERSWITCH_API_KEY },
    body: JSON.stringify({
      payment_method: 'card',
      payment_method_type: 'credit',
      payment_method_data: { card: { card_number: cardNumber, card_exp_month: '12', card_exp_year: '2030', card_cvc: '123' } },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new HyperswitchError(res.status, json);
  return json;
}

async function hold({ simulateDecline, cardNumber, label }) {
  const created = await createHoldPayment({
    amount: HOLD,
    orderId: 'bf_decline_test',
    description: `Basketful sandbox test: ${label}`,
    returnUrl: 'https://example.com/return',
    simulateDecline,
  });
  return confirmWithCard(created.payment_id, cardNumber);
}

async function main() {
  if (!process.env.HYPERSWITCH_API_KEY) {
    console.error('HYPERSWITCH_API_KEY is missing. Copy .env.example to .env and add your sandbox key.');
    process.exit(1);
  }
  console.log(`Hyperswitch: ${BASE_URL}\n`);

  const declined = await hold({ simulateDecline: true, cardNumber: '4012888888881881', label: 'simulated decline' });
  check(
    'Simulated decline fails the payment',
    declined.status === 'failed',
    `status=${declined.status}, error=${[declined.error_code, declined.error_message].filter(Boolean).join(' ') || '—'}`,
  );

  const retried = await hold({ simulateDecline: false, cardNumber: '4012000033330026', label: 'retry after decline' });
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
