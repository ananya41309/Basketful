import { useState } from 'react';
import { api } from '../lib/api.js';
import { usd, time } from '../lib/format.js';
import { Badge, Button, Card, ErrorNote, Row, StatusBadge } from '../components/ui.jsx';

const refundedTotal = (o) => o.refunds.filter((r) => r.status !== 'failed').reduce((s, r) => s + r.amount, 0);
const chargedOf = (o) => (['charged', 'refunded'].includes(o.status) ? o.payment?.amountReceived ?? o.final?.total ?? 0 : 0);

// D17: support and operations. Order list, payment timeline, refund a specific item, cancel a hold.
export default function Ops({ orders, currentOrder, onOpenOrder, onOrder }) {
  if (currentOrder) return <OrderDetail order={currentOrder} onBack={() => onOpenOrder(null)} onOrder={onOrder} />;
  return (
    <Card title="Orders" subtitle="Every order and where its payment stands.">
      {orders.length === 0 ? (
        <p className="text-sm text-stone-500">No orders yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-stone-400">
              <tr>
                <th className="pb-2 font-medium">Order</th>
                <th className="pb-2 font-medium">Placed</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 text-right font-medium">Hold</th>
                <th className="pb-2 text-right font-medium">Charged</th>
                <th className="pb-2 text-right font-medium">Refunded</th>
                <th className="pb-2 pl-4 font-medium">Processor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {orders.map((o) => (
                <tr key={o.id} onClick={() => onOpenOrder(o.id)} className="cursor-pointer hover:bg-stone-50">
                  <td className="py-2.5 pr-3 font-medium text-brand-800">{o.id}</td>
                  <td className="py-2.5 pr-3 text-stone-500">{time(o.createdAt)}</td>
                  <td className="py-2.5 pr-3">
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="tabular py-2.5 text-right">{usd(o.pricing.hold)}</td>
                  <td className="tabular py-2.5 text-right">{chargedOf(o) ? usd(chargedOf(o)) : '—'}</td>
                  <td className="tabular py-2.5 text-right">{refundedTotal(o) ? usd(refundedTotal(o)) : '—'}</td>
                  <td className="py-2.5 pl-4 text-stone-500">{o.payment?.connector ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function OrderDetail({ order, onBack, onOrder }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  async function run(label, fn) {
    setBusy(label);
    setError(null);
    try {
      onOrder(await fn());
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  const refundedItems = new Set(order.refunds.filter((r) => r.status !== 'failed' && r.itemId).map((r) => r.itemId));
  const canRefund = ['charged', 'refunded'].includes(order.status) && order.final;
  const lines = order.final?.lines ?? order.pricing.lines.map((l) => ({ ...l, final: null, finalLabel: 'Not picked yet' }));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        <button onClick={onBack} className="text-sm font-medium text-brand-700 hover:text-brand-800">
          ← All orders
        </button>
        <ErrorNote error={error} />
        <Card title="Items" subtitle={canRefund ? 'Refund an item the customer reports as missing or damaged.' : 'Refunds become available once the order is charged.'}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-stone-400">
              <tr>
                <th className="pb-2 font-medium">Item</th>
                <th className="pb-2 font-medium">Outcome</th>
                <th className="pb-2 text-right font-medium">Charged</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {lines.map((l) => (
                <tr key={l.itemId}>
                  <td className="py-2 pr-2 text-stone-800">{l.name}</td>
                  <td className="py-2 pr-2 text-stone-500">{l.finalLabel}</td>
                  <td className="tabular py-2 text-right">{l.final == null ? '—' : usd(l.final)}</td>
                  <td className="py-2 pl-3 text-right">
                    {canRefund && l.final > 0 &&
                      (refundedItems.has(l.itemId) ? (
                        <Badge tone="stone">Refunded</Badge>
                      ) : (
                        <Button
                          variant="secondary"
                          className="!px-3 !py-1.5"
                          busy={busy === l.itemId}
                          onClick={() => run(l.itemId, () => api.refund(order.id, { itemId: l.itemId }))}
                        >
                          Refund {usd(l.final)}
                        </Button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Payment timeline" subtitle="Every API call, webhook and sync for this order.">
          <ol className="space-y-2 text-sm">
            {[...order.events].reverse().map((e, i) => (
              <li key={i} className={`flex gap-3 ${e.ignored ? 'opacity-50' : ''}`}>
                <span className="tabular w-20 shrink-0 text-xs text-stone-400">{time(e.at)}</span>
                <span className="w-16 shrink-0">
                  <Badge tone={{ api: 'sky', webhook: 'violet', sync: 'amber', app: 'stone' }[e.source] ?? 'stone'}>{e.source}</Badge>
                </span>
                <span className="min-w-0">
                  <span className="font-mono text-xs text-stone-800">{e.type}</span>
                  {e.paymentStatus && <span className="text-xs text-stone-500"> · {e.paymentStatus}</span>}
                  {e.note && <span className="block text-xs text-stone-500">{e.note}</span>}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Card title={order.id} subtitle={`Placed ${time(order.createdAt)}`} action={<StatusBadge status={order.status} />}>
          <Row label="Estimate" value={usd(order.pricing.estimate)} muted />
          <Row label="Hold" value={usd(order.pricing.hold)} />
          <Row label="Charged" value={chargedOf(order) ? usd(chargedOf(order)) : '—'} strong />
          <Row label="Refunded" value={refundedTotal(order) ? usd(refundedTotal(order)) : '—'} />
          <Row label="Processor" value={order.payment?.connector ?? '—'} muted />
          <Row label="Payment" value={<span className="font-mono text-xs">{order.payment?.id ?? '—'}</span>} muted />
          {['held', 'awaiting_payment'].includes(order.status) && (
            <Button variant="danger" className="mt-4 w-full" busy={busy === 'cancel'} onClick={() => run('cancel', () => api.cancel(order.id))}>
              Cancel order and release hold
            </Button>
          )}
        </Card>
      </aside>
    </div>
  );
}
