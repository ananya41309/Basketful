// Order storage behind a small, synchronous interface.
//   DATABASE_URL set (e.g. Neon on Render): Postgres is the system of record. All rows are loaded into
//   memory at startup and every change is written through, in order, to a single JSONB table.
//   Otherwise: a local JSON file, for development.
// A demo has a handful of orders on one instance, so an in-memory cache with write-through is
// plenty; a real system would query Postgres per request.
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'store.json');

let state = { orders: {}, processedEvents: {} };
let pool = null;
let writeQueue = Promise.resolve();

export async function init() {
  if (!process.env.DATABASE_URL) {
    state = loadFile();
    return 'file';
  }
  const { default: pg } = await import('pg');
  // The connection string carries sslmode (Neon uses sslmode=require).
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  await pool.query(`
    create table if not exists basketful_docs (
      kind text not null,
      id text not null,
      doc jsonb not null,
      updated_at timestamptz not null default now(),
      primary key (kind, id)
    )`);
  const { rows } = await pool.query('select kind, id, doc from basketful_docs');
  for (const row of rows) {
    if (row.kind === 'order') state.orders[row.id] = row.doc;
    if (row.kind === 'event') state.processedEvents[row.id] = row.doc.at;
  }
  return 'postgres';
}

export function storageKind() {
  return pool ? 'postgres' : 'file';
}

function loadFile() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { orders: {}, processedEvents: {} };
  }
}

function writeFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

function persist(kind, id, doc) {
  if (!pool) return writeFile();
  // Serialize writes so an older snapshot can never land after a newer one.
  const json = JSON.stringify(doc);
  writeQueue = writeQueue
    .then(() =>
      pool.query(
        `insert into basketful_docs (kind, id, doc) values ($1, $2, $3::jsonb)
         on conflict (kind, id) do update set doc = excluded.doc, updated_at = now()`,
        [kind, id, json],
      ),
    )
    .catch((err) => console.error(`[store] failed to save ${kind} ${id}:`, err.message));
}

export function getOrder(id) {
  return state.orders[id] ?? null;
}

export function findOrderByPaymentId(paymentId) {
  return Object.values(state.orders).find((o) => o.payment?.id === paymentId) ?? null;
}

export function saveOrder(order) {
  state.orders[order.id] = order;
  persist('order', order.id, order);
  return order;
}

export function listOrders() {
  return Object.values(state.orders).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Webhook de-duplication: Hyperswitch retries deliveries for up to 24 hours.
export function hasProcessedEvent(eventId) {
  return Boolean(state.processedEvents[eventId]);
}

export function markEventProcessed(eventId) {
  const at = new Date().toISOString();
  state.processedEvents[eventId] = at;
  persist('event', eventId, { at });
}

// Lets tests wait for pending Postgres writes.
export function flush() {
  return writeQueue;
}
