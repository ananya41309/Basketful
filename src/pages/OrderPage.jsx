import { useState } from 'react';
import { api } from '../lib/api.js';
import { usd, time } from '../lib/format.js';
import { Badge, Button, Card, ErrorNote, Row, StatusBadge } from '../components/ui.jsx';
import PayStep from '../components/PayStep.jsx';

// After checkout: order status in plain words, live picking updates (D16), cancel and receipt.
export default function OrderPage({ config, order, clientSecret, onOrder, onRetryPayment, onPaymentSettled, onNewOrder, onSwitchRole }) {
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

  const { pricing, final } = order;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-6">
        <StatusHero order={order} />
        <ErrorNote error={error} />

        {order.status === 'held' && !final && <LiveFromShopper order={order} onSwitchRole={onSwitchRole} />}

        {final && <PickedTable order={order} />}

        {order.status === 'held' && final && (
          <Card title="Finishing up" subtitle="Your shopper has finished picking.">
            <p className="text-sm text-stone-600">Charging {usd(final.total)} and releasing the rest of your hold…</p>
            <Button variant="secondary" className="mt-3" busy={busy === 'capture'} onClick={() => run('capture', () => api.capture(order.id))}>
              Retry charge
            </Button>
          </Card>
        )}

        {(order.status === 'payment_failed' || order.status === 'awaiting_payment') && (
          <Card title="Payment" subtitle="Your basket is saved. Try again or use another payment method.">
            {clientSecret ? (
              <PayStep
                key={clientSecret}
                publishableKey={config.publishableKey}
                clientSecret={clientSecret}
                orderId={order.id}
                holdAmount={pricing.hold}
                onSettled={onPaymentSettled}
              />
            ) : (
              <Button busy={busy === 'retry'} onClick={() => run('retry', onRetryPayment)}>
                Try another payment method
              </Button>
            )}
          </Card>
        )}

        {['charged', 'refunded'].includes(order.status) && <Receipt order={order} />}
      </div>

      <div className="space-y-6">
        <Card title="Order" subtitle={order.id} action={<StatusBadge status={order.status} />}>
          <Row label="Estimate at checkout" value={usd(pricing.estimate)} />
          <Row label="Hold placed" value={usd(pricing.hold)} />
          {final && <Row label="Final total" value={usd(final.total)} strong />}
          {['held', 'awaiting_payment'].includes(order.status) && (
            <Button
              variant="danger"
              className="mt-4 w-full"
              busy={busy === 'cancel'}
              onClick={() => run('cancel', () => api.cancel(order.id))}
            >
              Cancel order
            </Button>
          )}
          {['charged', 'released', 'refunded'].includes(order.status) && (
            <Button variant="secondary" className="mt-4 w-full" onClick={onNewOrder}>
              Start a new order
            </Button>
          )}
        </Card>
      </div>
    </div>
  );
}

function StatusHero({ order }) {
  const { pricing, final, payment } = order;
  const copy = {
    awaiting_payment: ['Waiting for payment', 'Complete payment to place the hold and send your order to a shopper.'],
    confirming: ['Confirming your payment…', 'This usually takes a few seconds.'],
    held: [
      `${usd(pricing.hold)} on hold`,
      "Your shopper is picking your order. You'll only be charged for what we deliver.",
    ],
    charged: [
      `Charged ${usd(payment?.amountReceived ?? final?.total)}`,
      `We released the remaining ${usd(pricing.hold - (payment?.amountReceived ?? final?.total ?? 0))} of your hold.`,
    ],
    released: ['Order cancelled', `The ${usd(pricing.hold)} hold was released. You were not charged.`],
    payment_failed: ["Your payment didn't go through", payment?.errorMessage || 'No hold was placed. Your basket is saved.'],
    refunded: ['Refunded', 'Your refund is on its way to your card.'],
  }[order.status] ?? [order.status, ''];

  return (
    <section className="rounded-2xl bg-gradient-to-br from-brand-700 to-brand-800 p-6 text-white shadow-sm">
      <p className="text-sm text-emerald-100">Order {order.id}</p>
      <h1 className="mt-1 text-2xl font-semibold">{copy[0]}</h1>
      <p className="mt-1 text-emerald-50">{copy[1]}</p>
    </section>
  );
}

// D16: what the shopper has changed so far, read-only. No approvals here: those happened at checkout (D13).
function LiveFromShopper({ order, onSwitchRole }) {
  const preview = order.picking?.preview;
  if (!preview) {
    return (
      <Card title="Waiting for your shopper" action={<Badge tone="amber">On hold</Badge>}>
        <p className="text-sm text-stone-600">
          Your shopper hasn't started yet. Any weights or substitutions will show up here as they happen.
        </p>
        <p className="mt-3 text-xs text-stone-500">
          Demo: open the{' '}
          <button onClick={() => onSwitchRole('shopper')} className="font-medium text-brand-700 underline">
            Shopper
          </button>{' '}
          tab to pick this order.
        </p>
      </Card>
    );
  }
  const changes = preview.lines.filter((l) => l.changed && !l.error);
  return (
    <Card title="Live from your shopper" subtitle={`Updated ${time(order.picking.updatedAt)}`} action={<Badge tone="violet">Picking</Badge>}>
      {changes.length === 0 ? (
        <p className="text-sm text-stone-600">Everything so far is exactly as you ordered.</p>
      ) : (
        <ul className="divide-y divide-stone-100 text-sm">
          {changes.map((l) => (
            <li key={l.itemId} className="flex items-center justify-between gap-3 py-2">
              <span className="text-stone-800">
                {l.name}
                <span className="block text-xs text-stone-500">{l.finalLabel}</span>
              </span>
              <span className="tabular whitespace-nowrap text-stone-700">
                {usd(l.estimate)} → <strong className="text-stone-900">{usd(l.final)}</strong>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 rounded-xl bg-stone-50 p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-stone-600">Running total</span>
          <span className="tabular font-semibold">{usd(preview.total)}</span>
        </div>
        <div className="flex justify-between text-stone-500">
          <span>Your hold</span>
          <span className="tabular">{usd(preview.hold)}</span>
        </div>
        <p className="mt-2 text-xs text-stone-500">You'll be charged the final total when your shopper finishes. The rest of the hold is released.</p>
      </div>
    </Card>
  );
}

function PickedTable({ order }) {
  const { final } = order;
  return (
    <Card title="What changed in store" subtitle={`Final items ${usd(final.items)} vs estimated ${usd(order.pricing.items)}`}>
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-stone-400">
          <tr>
            <th className="pb-2 font-medium">Item</th>
            <th className="pb-2 font-medium">Outcome</th>
            <th className="pb-2 text-right font-medium">Estimated</th>
            <th className="pb-2 text-right font-medium">Final</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {final.lines.map((l) => {
            const changed = l.final !== l.estimate;
            return (
              <tr key={l.itemId} className={changed ? 'bg-amber-50/50' : ''}>
                <td className="py-2 pr-2 text-stone-800">{l.name}</td>
                <td className="py-2 pr-2 text-stone-500">{l.finalLabel}</td>
                <td className="tabular py-2 text-right text-stone-500">{usd(l.estimate)}</td>
                <td className={`tabular py-2 text-right ${changed ? 'font-semibold text-stone-900' : 'text-stone-700'}`}>{usd(l.final)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function Receipt({ order }) {
  const { pricing, final, payment, refunds } = order;
  const charged = payment?.amountReceived ?? final.total;
  const refunded = refunds.filter((r) => r.status !== 'failed').reduce((s, r) => s + r.amount, 0);
  return (
    <Card title="Receipt" subtitle="What you were held, charged and released.">
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <Row label="Items" value={usd(final.items)} />
          <Row label="Delivery fee" value={usd(final.fees.delivery)} />
          <Row label="Service fee" value={usd(final.fees.service)} />
          <Row label="Tax" value={usd(final.tax)} />
          <Row label="Tip" value={usd(final.tip)} />
          <div className="my-2 border-t border-stone-200" />
          <Row label="Total charged" value={usd(charged)} strong />
        </div>
        <div className="rounded-xl bg-stone-50 p-4">
          <Row label="Estimated at checkout" value={usd(pricing.estimate)} muted />
          <Row label="Temporary hold" value={usd(pricing.hold)} />
          <Row label="Charged" value={usd(charged)} strong />
          <Row label="Released" value={usd(pricing.hold - charged)} />
          {refunded > 0 && <Row label="Refunded" value={usd(refunded)} />}
          <p className="mt-2 text-xs text-stone-500">
            Released funds usually disappear from your statement within a few days, depending on your bank.
          </p>
        </div>
      </div>
    </Card>
  );
}
