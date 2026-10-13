// Order lifecycle. Every payment state change goes through applyPayment(), whether it came
// from an API response, a webhook, or a status sync, so the order and its event log stay consistent.
import crypto from 'node:crypto';
import * as hs from './hyperswitch.js';
import * as store from './store.js';
import { quote, finalize, evaluatePicks, HttpError } from './pricing.js';

// Hyperswitch payment status -> what the order is doing, in the customer's terms.
const STATUS_MAP = {
  requires_payment_method: 'awaiting_payment',
  requires_confirmation: 'awaiting_payment',
  requires_customer_action: 'awaiting_payment',
  processing: 'confirming',
  requires_capture: 'held',
  partially_captured: 'charged',
  partially_captured_and_capturable: 'charged',
  succeeded: 'charged',
  cancelled: 'released',
  failed: 'payment_failed',
};

const TERMINAL = new Set(['charged', 'released', 'refunded']);

const now = () => new Date().toISOString();
const newId = () => `bf_${crypto.randomBytes(5).toString('hex')}`;

function logEvent(order, event) {
  order.events.push({ at: now(), ...event });
}

function returnUrlFor(orderId) {
  // RENDER_EXTERNAL_URL is set automatically on Render.
  const base = (process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173').replace(/\/$/, '');
  return `${base}/?order=${orderId}`;
}

// Apply a payment snapshot from any source. Ignores snapshots older than what we have,
// because webhooks can arrive out of order.
export function applyPayment(order, payment, { source, eventType, verification } = {}) {
  const summary = hs.summarizePayment(payment);
  const current = order.payment;
  const isStale =
    current && current.id === summary.id && current.updated && summary.updated && summary.updated < current.updated;

  logEvent(order, {
    source,
    type: eventType || `payment.${summary.status}`,
    paymentId: summary.id,
    paymentStatus: summary.status,
    amount: summary.amount,
    amountCapturable: summary.amountCapturable,
    amountReceived: summary.amountReceived,
    verification,
    note: summary.errorCode || summary.errorMessage ? [summary.errorCode, summary.errorMessage].filter(Boolean).join(' · ') : undefined,
    ignored: isStale ? 'older than current state' : undefined,
  });

  if (isStale) return order;
  // A payment we no longer track (e.g. an abandoned first attempt) must not overwrite the current one.
  if (current && current.id !== summary.id) return order;

  order.payment = summary;
  let mapped = STATUS_MAP[summary.status];
  // Some processors (e.g. Cybersource) report a capture as 'processing' until it settles.
  // Once we've asked to capture, that means the customer is being charged, not still paying.
  if (summary.status === 'processing' && order.captureRequestedAt) mapped = 'charged';
  if (mapped && order.status !== 'refunded') order.status = mapped;
  return order;
}

async function startPayment(order, { simulateDecline = false } = {}) {
  const payment = await hs.createHoldPayment({
    amount: order.pricing.hold,
    orderId: order.id,
    description: `Basketful order ${order.id}`,
    returnUrl: returnUrlFor(order.id),
    simulateDecline,
  });
  order.payment = null; // the new payment becomes current
  order.paymentIds.push(payment.payment_id);
  if (simulateDecline) {
    // Remembered per payment, so a retry (a new payment) is a normal attempt.
    order.simulatedDeclinePaymentId = payment.payment_id;
    logEvent(order, {
      source: 'app',
      type: 'demo.decline_simulated',
      paymentId: payment.payment_id,
      note: `Demo: the PayPal sandbox will refuse this attempt (cardholder name ${hs.DECLINE_TRIGGER_NAME})`,
    });
  }
  applyPayment(order, payment, { source: 'api', eventType: 'payment.created (manual capture)' });
  return payment.client_secret;
}

export async function createOrder({ lines, tipCents, simulateDecline }) {
  const pricing = quote(lines, tipCents);
  const order = {
    id: newId(),
    createdAt: now(),
    status: 'awaiting_payment',
    pricing,
    final: null,
    payment: null,
    paymentIds: [],
    refunds: [],
    events: [],
  };
  logEvent(order, { source: 'app', type: 'order.created', note: `Estimate ${pricing.estimate}, hold ${pricing.hold}` });
  const clientSecret = await startPayment(order, { simulateDecline: simulateDecline === true });
  store.saveOrder(order);
  return { order, clientSecret };
}

// A declined card must not lose the basket: start a fresh payment on the same order.
export async function retryPayment(orderId) {
  const order = mustGet(orderId);
  if (!['payment_failed', 'awaiting_payment'].includes(order.status)) {
    throw new HttpError(409, `Order is ${order.status}; a new payment is not needed`);
  }
  logEvent(order, { source: 'app', type: 'payment.retry', note: 'Customer is trying another payment method' });
  const clientSecret = await startPayment(order);
  store.saveOrder(order);
  return { order, clientSecret };
}

export async function syncOrder(orderId) {
  const order = mustGet(orderId);
  if (!order.payment) return order;
  const payment = await hs.retrievePayment(order.payment.id);
  applyPayment(order, payment, { source: 'sync' });
  return store.saveOrder(order);
}

const PICK_STATUSES = new Set(['found', 'out_of_stock', 'substituted']);

// Keep only known items and fields from what the browser sent; prices are never accepted.
function cleanPicks(order, picks = {}) {
  const ids = new Set(order.pricing.lines.map((l) => l.itemId));
  const clean = {};
  for (const [itemId, pick] of Object.entries(picks || {})) {
    if (!ids.has(itemId) || !pick || !PICK_STATUSES.has(pick.status)) continue;
    const c = { status: pick.status };
    if (pick.actualLb != null) c.actualLb = Number(pick.actualLb);
    if (pick.substituteId) c.substituteId = String(pick.substituteId);
    clean[itemId] = c;
  }
  return clean;
}

// The slice of a pick evaluation the customer and shopper screens need.
function summarize(result) {
  return {
    items: result.items,
    tax: result.tax,
    total: result.total,
    hold: result.hold,
    headroom: result.headroom,
    withinHold: result.withinHold,
    errors: result.errors,
    lines: result.lines.map((l) => ({
      itemId: l.itemId,
      name: l.name,
      estimate: l.estimate,
      final: l.final,
      finalLabel: l.finalLabel,
      error: l.error,
      changed: Boolean(l.error) || l.pick.status !== 'found' || l.final !== l.estimate,
    })),
  };
}

// Shopper's work in progress. Saved on every change so the customer sees it live (D16);
// nothing is charged until completePicking().
export function savePickingDraft(orderId, picks) {
  const order = mustGet(orderId);
  if (order.status !== 'held' || order.final) {
    throw new HttpError(409, `This order can't be picked right now (status: ${order.status})`);
  }
  const clean = cleanPicks(order, picks);
  const preview = summarize(evaluatePicks(order, clean));
  if (!order.picking) logEvent(order, { source: 'app', type: 'picking.started', note: 'Shopper started picking' });
  order.picking = { picks: clean, preview, startedAt: order.picking?.startedAt ?? now(), updatedAt: now() };
  return store.saveOrder(order);
}

// Shopper taps "Finish picking": lock the final total, then capture it.
export async function completePicking(orderId, picks) {
  const order = mustGet(orderId);
  const chosen = cleanPicks(order, picks ?? order.picking?.picks ?? {});
  recordPicking(orderId, chosen);
  return captureOrder(orderId);
}

// Shopper finished picking: compute the final total and make sure it fits in the hold.
export function recordPicking(orderId, picks) {
  const order = mustGet(orderId);
  if (order.status !== 'held') throw new HttpError(409, `Picking can only be recorded while the payment is held (now: ${order.status})`);
  let final;
  try {
    final = finalize(order, picks);
    if (!final.withinHold) {
      throw new HttpError(409, 'These changes would exceed the hold. Pick cheaper replacements or mark items out of stock.', {
        total: final.total,
        hold: order.pricing.hold,
      });
    }
  } catch (err) {
    // Record refused changes so the inspector shows the guardrail working.
    if (err instanceof HttpError && err.status === 409) {
      logEvent(order, { source: 'app', type: 'picking.blocked', note: err.message });
      store.saveOrder(order);
    }
    throw err;
  }
  order.final = final;
  order.picking = { ...(order.picking ?? {}), picks, preview: summarize(final), updatedAt: now() };
  logEvent(order, { source: 'app', type: 'picking.completed', note: `Final ${final.total}, releases ${final.released}` });
  return store.saveOrder(order);
}

export async function captureOrder(orderId) {
  const order = mustGet(orderId);
  if (order.status !== 'held') throw new HttpError(409, `Only a held payment can be captured (now: ${order.status})`);
  if (!order.final) throw new HttpError(409, 'Finish picking before capturing');
  if (order.captureInFlight) throw new HttpError(409, 'Capture already in progress');

  order.captureInFlight = true;
  order.captureRequestedAt = now();
  store.saveOrder(order);
  try {
    // Amount comes from the server-side final total, never from the browser.
    const payment = await hs.capturePayment(order.payment.id, order.final.total);
    applyPayment(order, payment, { source: 'api', eventType: `payment.capture (${order.final.total})` });
  } catch (err) {
    delete order.captureRequestedAt; // the capture never happened
    logEvent(order, { source: 'api', type: 'payment.capture_failed', note: err.message });
    throw err;
  } finally {
    order.captureInFlight = false;
    store.saveOrder(order);
  }
  return order;
}

export async function cancelOrder(orderId) {
  const order = mustGet(orderId);
  // Held: void the authorization so the customer's funds are released without a refund.
  // Awaiting payment: nothing is authorized yet, but cancelling closes the open payment.
  if (!['held', 'awaiting_payment'].includes(order.status) || !order.payment) {
    throw new HttpError(409, `Only a held order can be cancelled (now: ${order.status})`);
  }
  const payment = await hs.cancelPayment(order.payment.id);
  applyPayment(order, payment, { source: 'api', eventType: 'payment.cancel (void hold)' });
  return store.saveOrder(order);
}

// Refund after capture, e.g. a missing or damaged item reported after delivery.
export async function refundOrder(orderId, { itemId, amount, reason }) {
  const order = mustGet(orderId);
  if (!['charged', 'refunded'].includes(order.status) || !order.final) {
    throw new HttpError(409, 'Only a charged order can be refunded');
  }
  let refundAmount = Number.parseInt(amount, 10);
  let label = reason || 'Refund';
  if (itemId) {
    const line = order.final.lines.find((l) => l.itemId === itemId);
    if (!line || line.final <= 0) throw new HttpError(400, 'That item was not charged');
    if (order.refunds.some((r) => r.itemId === itemId && r.status !== 'failed')) {
      throw new HttpError(409, `${line.name} has already been refunded`);
    }
    refundAmount = line.final;
    label = reason || `Missing item: ${line.name}`;
  }
  const alreadyRefunded = order.refunds.filter((r) => r.status !== 'failed').reduce((s, r) => s + r.amount, 0);
  const received = order.payment.amountReceived ?? order.final.total;
  if (!(refundAmount > 0) || alreadyRefunded + refundAmount > received) {
    throw new HttpError(400, 'Refund exceeds the amount charged');
  }

  const refund = await hs.refundPayment(order.payment.id, refundAmount, label);
  order.refunds.push({ id: refund.refund_id, amount: refundAmount, status: refund.status, reason: label, at: now(), itemId });
  logEvent(order, { source: 'api', type: `refund.${refund.status}`, amount: refundAmount, note: label });
  const total = order.refunds.filter((r) => r.status !== 'failed').reduce((s, r) => s + r.amount, 0);
  if (total >= received) order.status = 'refunded';
  return store.saveOrder(order);
}

export function applyRefundWebhook(order, refund, { eventType, verification }) {
  const existing = order.refunds.find((r) => r.id === refund.refund_id);
  if (existing) existing.status = refund.status;
  logEvent(order, { source: 'webhook', type: eventType, amount: refund.amount, verification, note: `Refund ${refund.refund_id}: ${refund.status}` });
  return store.saveOrder(order);
}

export function getOrder(orderId) {
  return mustGet(orderId);
}

export function listOrders() {
  return store.listOrders();
}

export function isTerminal(order) {
  return TERMINAL.has(order.status);
}

function mustGet(orderId) {
  const order = store.getOrder(orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  return order;
}
