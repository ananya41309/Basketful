import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import * as orders from './orders.js';
import * as store from './store.js';
import { verifyWebhook, HyperswitchError } from './hyperswitch.js';
import { quote, BUFFER_POLICY, FEES, TAX_RATE, HttpError } from './pricing.js';
import { AISLES, CATALOG, DEMO_CART, DEMO_PICKS, DEMO_BLOCKED_PICK, TIP_PRESETS, DEFAULT_TIP } from './catalog.js';

const app = express();
const PORT = Number(process.env.PORT || 3001);

// The webhook route needs the raw bytes to verify the HMAC signature, so it is
// registered before the JSON body parser.
app.post('/api/webhooks/hyperswitch', express.raw({ type: '*/*' }), (req, res) => {
  const raw = req.body instanceof Buffer ? req.body : Buffer.from('');
  const verification = verifyWebhook(raw, req.get('x-webhook-signature-512'));
  if (verification === 'invalid') {
    console.warn('[webhook] rejected: bad signature');
    return res.status(401).json({ error: 'invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'invalid JSON' });
  }

  // Hyperswitch retries until it gets a 2xx; de-duplicate on event_id.
  if (event.event_id && store.hasProcessedEvent(event.event_id)) {
    return res.json({ ok: true, duplicate: true });
  }

  const object = event.content?.object ?? {};
  const kind = event.content?.type;
  const order =
    store.findOrderByPaymentId(object.payment_id) ??
    (object.metadata?.order_id ? store.getOrder(object.metadata.order_id) : null);

  if (!order) {
    console.warn(`[webhook] ${event.event_type} for unknown payment ${object.payment_id}`);
  } else if (kind === 'payment_details') {
    orders.applyPayment(order, object, { source: 'webhook', eventType: event.event_type, verification });
    store.saveOrder(order);
  } else if (kind === 'refund_details') {
    orders.applyRefundWebhook(order, object, { eventType: event.event_type, verification });
  }

  if (event.event_id) store.markEventProcessed(event.event_id);
  console.log(`[webhook] ${event.event_type} ${object.payment_id ?? ''} (${verification})`);
  res.json({ ok: true });
});

app.use(express.json());

// Everything the browser needs to render the store; no secrets.
app.get('/api/config', (_req, res) => {
  res.json({
    publishableKey: process.env.HYPERSWITCH_PUBLISHABLE_KEY || null,
    aisles: AISLES,
    catalog: CATALOG,
    demoCart: DEMO_CART,
    demoPicks: DEMO_PICKS,
    demoBlockedPick: DEMO_BLOCKED_PICK,
    tipPresets: TIP_PRESETS,
    defaultTip: DEFAULT_TIP,
    bufferPolicy: BUFFER_POLICY,
    fees: FEES,
    taxRate: TAX_RATE,
    webhooksVerified: Boolean(process.env.HYPERSWITCH_WEBHOOK_SECRET),
  });
});

const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
    if (err instanceof HyperswitchError) {
      console.error('[hyperswitch]', err.status, err.body);
      return res.status(502).json({ error: `Hyperswitch: ${err.message}`, code: err.code, details: err.body });
    }
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};

app.get('/api/health', (_req, res) => res.json({ ok: true, storage: store.storageKind() }));

app.post('/api/quote', handle((req) => quote(req.body.lines, req.body.tipCents)));
app.post('/api/orders', handle((req) => orders.createOrder(req.body)));
app.get('/api/orders', handle(() => orders.listOrders()));
app.get('/api/orders/:id', handle((req) => orders.getOrder(req.params.id)));
app.post('/api/orders/:id/payment', handle((req) => orders.retryPayment(req.params.id)));
app.post('/api/orders/:id/sync', handle((req) => orders.syncOrder(req.params.id)));
app.put('/api/orders/:id/picking', handle((req) => orders.savePickingDraft(req.params.id, req.body.picks)));
app.post('/api/orders/:id/complete', handle((req) => orders.completePicking(req.params.id, req.body.picks)));
app.post('/api/orders/:id/pick', handle((req) => orders.recordPicking(req.params.id, req.body.picks)));
app.post('/api/orders/:id/capture', handle((req) => orders.captureOrder(req.params.id)));
app.post('/api/orders/:id/cancel', handle((req) => orders.cancelOrder(req.params.id)));
app.post('/api/orders/:id/refund', handle((req) => orders.refundOrder(req.params.id, req.body)));

// Production: serve the built React app from the same origin as the API.
const dist = path.resolve(process.cwd(), 'dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const storage = await store.init();

app.listen(PORT, () => {
  console.log(`Orders stored in ${storage === 'postgres' ? 'Postgres (DATABASE_URL)' : 'data/store.json'}`);
  const missing = ['HYPERSWITCH_API_KEY', 'HYPERSWITCH_PUBLISHABLE_KEY'].filter((k) => !process.env[k]);
  console.log(`Basketful API on http://localhost:${PORT}`);
  if (missing.length) console.warn(`Missing in .env: ${missing.join(', ')}`);
  if (!process.env.HYPERSWITCH_WEBHOOK_SECRET) console.warn('HYPERSWITCH_WEBHOOK_SECRET not set: webhooks are accepted but marked unverified.');
});
