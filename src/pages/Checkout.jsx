import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { usd } from '../lib/format.js';
import { Badge, Button, Card, ErrorNote } from '../components/ui.jsx';
import HoldBreakdown from '../components/HoldBreakdown.jsx';
import PayStep from '../components/PayStep.jsx';

// Checkout: the customer chooses, per item, whether we may substitute (and whether a pricier
// replacement is OK, D13), picks a tip, and sees the hold recalculate live.
// The browser only sends choices, never amounts.
export default function Checkout({ config, lines, setLines, tip, setTip, order, clientSecret, onPlaceOrder, onPaymentSettled, onBack }) {
  const [pricing, setPricing] = useState(null);
  const [error, setError] = useState(null);
  const [placing, setPlacing] = useState(false);
  const [simulateDecline, setSimulateDecline] = useState(false);

  const locked = Boolean(order); // once a payment exists, its amount is fixed
  const byId = useMemo(() => Object.fromEntries(config.catalog.map((i) => [i.id, i])), [config.catalog]);

  useEffect(() => {
    if (locked) return;
    let cancelled = false;
    api
      .quote(lines, tip)
      .then((q) => !cancelled && setPricing(q))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [lines, tip, locked]);

  const shownPricing = locked ? order.pricing : pricing;

  const choiceOf = (line) => (!line.allowSubstitution ? 'none' : line.allowUpgrade ? 'upgrade' : 'similar');

  function setChoice(itemId, choice) {
    setLines((prev) =>
      prev.map((l) =>
        l.itemId === itemId ? { ...l, allowSubstitution: choice !== 'none', allowUpgrade: choice === 'upgrade' } : l,
      ),
    );
  }

  const upgradeLabel = `OK to pay up to ${usd(config.bufferPolicy.upgradeCents)} more`;

  async function placeOrder() {
    setPlacing(true);
    setError(null);
    try {
      await onPlaceOrder(lines, tip, { simulateDecline });
    } catch (e) {
      setError(e.message);
    } finally {
      setPlacing(false);
    }
  }

  const estimateFor = (itemId) => shownPricing?.lines.find((l) => l.itemId === itemId)?.estimate;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-6">
        <Card
          title="Your basket"
          subtitle="Weighed items are estimates. The shopper weighs them in store."
          action={
            !locked && (
              <button onClick={onBack} className="text-sm font-medium text-brand-700 hover:text-brand-800">
                ← Back to store
              </button>
            )
          }
        >
          <ul className="divide-y divide-stone-100">
            {lines.map((line) => {
              const item = byId[line.itemId];
              return (
                <li key={line.itemId} className="flex items-center gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-stone-900">{item.name}</p>
                    <p className="text-sm text-stone-500">
                      {item.weighed ? `est. ${line.estLb} lb at ${usd(item.price)}/lb` : `${line.qty} × ${usd(item.price)}`}
                    </p>
                  </div>
                  {item.weighed && <Badge tone="amber">Priced by weight</Badge>}
                  {item.substitutable && (
                    <label className="flex flex-col text-xs text-stone-500">
                      If out of stock
                      <select
                        className={`mt-0.5 w-52 rounded-lg border px-2 py-1.5 text-sm ${
                          choiceOf(line) === 'upgrade'
                            ? 'border-amber-300 bg-amber-50 text-amber-900'
                            : 'border-stone-300 bg-white text-stone-800'
                        } disabled:opacity-60`}
                        value={choiceOf(line)}
                        onChange={(e) => setChoice(line.itemId, e.target.value)}
                        disabled={locked}
                      >
                        <option value="similar">Similar price (up to 15% more)</option>
                        <option value="upgrade">{upgradeLabel}</option>
                        <option value="none">Don't substitute</option>
                      </select>
                    </label>
                  )}
                  <span className="tabular w-16 text-right text-sm font-medium">
                    {item.weighed ? '~' : ''}
                    {usd(estimateFor(line.itemId))}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          <Card title="Delivery">
            <p className="text-sm text-stone-700">Today, 5:00 to 6:00 pm</p>
            <p className="text-sm text-stone-500">1 Demo Street, Chicago, IL 60601</p>
          </Card>
          <Card title="Tip your shopper" subtitle="100% goes to the shopper.">
            <div className="flex flex-wrap gap-2">
              {config.tipPresets.map((t) => (
                <button
                  key={t}
                  onClick={() => setTip(t)}
                  disabled={locked}
                  className={`rounded-xl px-3 py-2 text-sm font-medium ring-1 ring-inset transition ${
                    tip === t ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-stone-700 ring-stone-300 hover:bg-stone-50'
                  } disabled:opacity-60`}
                >
                  {t === 0 ? 'No tip' : usd(t)}
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <div className="space-y-6">
        <Card title="Order summary">
          <HoldBreakdown pricing={shownPricing} policy={config.bufferPolicy} />
        </Card>

        <Card title={locked ? 'Payment' : null}>
          <ErrorNote error={error} />
          {!locked && (
            <Button className="mt-2 w-full" onClick={placeOrder} busy={placing} disabled={!pricing}>
              Continue to payment
            </Button>
          )}
          {!locked && <DemoDeclineToggle checked={simulateDecline} onChange={setSimulateDecline} />}
          {locked && clientSecret && (
            <PayStep
              key={clientSecret}
              publishableKey={config.publishableKey}
              clientSecret={clientSecret}
              orderId={order.id}
              holdAmount={order.pricing.hold}
              simulateDecline={order.simulatedDeclinePaymentId === order.payment?.id}
              onSettled={onPaymentSettled}
            />
          )}
        </Card>
      </div>
    </div>
  );
}

// Presenter tooling, not product UI: dashed, grey and tagged "Demo", like the other demo hints.
// Applies to this one payment attempt; "Try another payment method" is always a normal attempt.
function DemoDeclineToggle({ checked, onChange }) {
  return (
    <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-xl border border-dashed border-stone-300 bg-stone-50 px-3 py-2.5 text-xs text-stone-600">
      <input
        type="checkbox"
        className="mt-0.5 accent-stone-700"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="mr-1.5 rounded bg-stone-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-600">
          Demo
        </span>
        Simulate a declined card for this attempt. The PayPal sandbox refuses it, so you can see the retry flow.
      </span>
    </label>
  );
}
