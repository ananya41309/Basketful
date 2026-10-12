import { useState } from 'react';
import { Badge } from './ui.jsx';
import { usd, time } from '../lib/format.js';

const SOURCE_TONE = { api: 'sky', webhook: 'violet', sync: 'amber', app: 'stone' };
const SOURCE_LABEL = { api: 'API', webhook: 'Webhook', sync: 'Sync', app: 'App' };

// Read-only view of the integration for the demo (PRD decision D10). No actions except a status sync.
export default function PaymentInspector({ order, webhooksVerified, onSync, onClose }) {
  const [syncing, setSyncing] = useState(false);
  const payment = order?.payment;

  async function sync() {
    setSyncing(true);
    try {
      await onSync();
    } finally {
      setSyncing(false);
    }
  }

  const webhookCount = order?.events.filter((e) => e.source === 'webhook').length ?? 0;

  return (
    <aside className="flex h-full flex-col rounded-2xl border border-stone-800 bg-stone-900 text-stone-100 shadow-lg">
      <header className="flex items-center justify-between border-b border-stone-800 px-4 py-3">
        <div>
          <p className="text-sm font-semibold">Payment inspector</p>
          <p className="text-xs text-stone-400">Live Hyperswitch state for this order</p>
        </div>
        <button onClick={onClose} className="rounded-lg px-2 py-1 text-xs text-stone-400 hover:bg-stone-800" aria-label="Close inspector">
          Hide
        </button>
      </header>

      {!payment ? (
        <p className="p-4 text-sm text-stone-400">No payment yet. It is created when the customer continues to payment.</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="space-y-3 border-b border-stone-800 p-4 text-stone-200">
            <div className="flex items-center justify-between gap-2">
              <code className="truncate text-xs">{payment.id}</code>
              <span className="shrink-0 rounded-md bg-stone-800 px-2 py-0.5 font-mono text-xs">{payment.status}</span>
            </div>
            <div className="rounded-xl bg-stone-800/60 px-3 py-2">
              <IRow label="Authorized (hold)" value={usd(payment.amount)} />
              <IRow label="Still capturable" value={usd(payment.amountCapturable)} />
              <IRow label="Captured" value={usd(payment.amountReceived)} />
              {order.refunds.length > 0 && (
                <IRow label="Refunded" value={usd(order.refunds.filter((r) => r.status !== 'failed').reduce((s, r) => s + r.amount, 0))} />
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-stone-400">capture_method</dt>
              <dd className="font-mono">{payment.captureMethod ?? '—'}</dd>
              <dt className="text-stone-400">connector</dt>
              <dd className="font-mono">{payment.connector ?? '—'}</dd>
              <dt className="text-stone-400">method</dt>
              <dd className="font-mono">{[payment.paymentMethod, payment.paymentMethodType].filter(Boolean).join(' / ') || '—'}</dd>
              <dt className="text-stone-400">webhooks</dt>
              <dd>{webhookCount} received · {webhooksVerified ? 'signature checked' : 'signing key not set'}</dd>
            </dl>
            {payment.errorMessage && <p className="text-xs text-rose-300">{payment.errorMessage}</p>}
            <button
              onClick={sync}
              disabled={syncing}
              className="w-full rounded-xl bg-stone-800 px-4 py-2 text-sm font-semibold text-stone-100 ring-1 ring-inset ring-stone-700 hover:bg-stone-700 disabled:opacity-60"
            >
              {syncing ? 'Syncing…' : 'Sync status from Hyperswitch'}
            </button>
          </div>

          <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
            {[...order.events].reverse().map((e, i) => (
              <li key={i} className={`rounded-xl bg-stone-800/50 px-3 py-2 text-xs ${e.ignored ? 'opacity-50' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={SOURCE_TONE[e.source] ?? 'stone'}>{SOURCE_LABEL[e.source] ?? e.source}</Badge>
                  <span className="text-stone-500">{time(e.at)}</span>
                </div>
                <p className="mt-1 font-mono text-stone-200">{e.type}</p>
                {e.paymentStatus && (
                  <p className="text-stone-400">
                    status {e.paymentStatus}
                    {e.amountReceived != null ? ` · captured ${usd(e.amountReceived)}` : ''}
                    {e.amountCapturable != null ? ` · capturable ${usd(e.amountCapturable)}` : ''}
                  </p>
                )}
                {e.note && <p className="text-stone-400">{e.note}</p>}
                {e.verification && <p className="text-stone-500">signature: {e.verification}</p>}
                {e.ignored && <p className="text-amber-300">ignored: {e.ignored}</p>}
              </li>
            ))}
          </ol>
          {webhookCount === 0 && (
            <p className="border-t border-stone-800 px-4 py-3 text-xs text-stone-500">
              No webhooks yet. On localhost Hyperswitch can't reach this server, so status comes from API responses and
              syncs. Webhooks arrive once the app is deployed.
            </p>
          )}
        </div>
      )}
    </aside>
  );
}

function IRow({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5 text-sm">
      <span className="text-stone-400">{label}</span>
      <span className="tabular font-medium text-stone-100">{value}</span>
    </div>
  );
}
