import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { usd, signedUsd, lbText, time, substitutionPolicyText } from '../lib/format.js';
import { Badge, Button, Card, ErrorNote } from '../components/ui.jsx';

// D14: the shopper picks in store. Substitutes come from the catalog with their prices; options above
// what the customer approved are shown but disabled. Every change is saved as a draft so the
// customer sees it live (D16). Nothing is charged until "Finish picking".
export default function Shopper({ config, orders, currentOrder, onOpenOrder, onOrder }) {
  const picking = currentOrder && currentOrder.status === 'held' && !currentOrder.final ? currentOrder : null;
  if (picking) return <Console key={picking.id} config={config} order={picking} onOrder={onOrder} onBack={() => onOpenOrder(null)} />;
  return <Queue orders={orders} currentOrder={currentOrder} onOpenOrder={onOpenOrder} />;
}

function Queue({ orders, currentOrder, onOpenOrder }) {
  const waiting = orders.filter((o) => o.status === 'held' && !o.final);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {currentOrder && currentOrder.status === 'charged' && (
        <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-inset ring-emerald-200">
          Order {currentOrder.id} is picked and charged {usd(currentOrder.payment?.amountReceived ?? currentOrder.final?.total)}.
        </p>
      )}
      <Card title="Orders to pick" subtitle="Orders with a payment on hold, waiting for a shopper.">
        {waiting.length === 0 ? (
          <p className="text-sm text-stone-500">No orders waiting. Place one as the customer, then come back here.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {waiting.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="font-medium text-stone-900">{o.id}</p>
                  <p className="text-sm text-stone-500">
                    {o.pricing.lines.length} items · hold {usd(o.pricing.hold)} · placed {time(o.createdAt)}
                    {o.picking ? ' · in progress' : ''}
                  </p>
                </div>
                <Button onClick={() => onOpenOrder(o.id)}>{o.picking ? 'Continue picking' : 'Start picking'}</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Console({ config, order, onOrder, onBack }) {
  const [picks, setPicks] = useState(() => order.picking?.picks ?? {});
  const [preview, setPreview] = useState(order.picking?.preview ?? null);
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState(null);
  const first = useRef(true);

  // Save the draft shortly after each change; the server returns the priced preview.
  useEffect(() => {
    if (first.current && order.picking) {
      first.current = false;
      return undefined;
    }
    first.current = false;
    setSaving(true);
    const t = setTimeout(async () => {
      try {
        const updated = await api.savePicking(order.id, picks);
        setPreview(updated.picking.preview);
        setError(null);
      } catch (e) {
        setError(e.message);
      } finally {
        setSaving(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [picks, order.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (itemId, pick) => setPicks((prev) => ({ ...prev, [itemId]: pick }));
  const previewLine = (itemId) => preview?.lines.find((l) => l.itemId === itemId);

  async function finish() {
    setFinishing(true);
    setError(null);
    try {
      onOrder(await api.complete(order.id, picks));
    } catch (e) {
      setError(e.message);
    } finally {
      setFinishing(false);
    }
  }

  const hold = order.pricing.hold;
  const total = preview?.total ?? order.pricing.estimate;
  const used = Math.min(100, Math.round((total / hold) * 100));
  const blocked = Boolean(preview?.errors?.length) || (preview && !preview.withinHold);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="text-sm font-medium text-brand-700 hover:text-brand-800">
            ← All orders
          </button>
          <button onClick={() => setPicks(config.demoPicks)} className="text-sm text-stone-500 hover:text-stone-800">
            Fill demo picks
          </button>
        </div>
        {order.pricing.lines.map((line) => (
          <PickRow
            key={line.itemId}
            line={line}
            pick={picks[line.itemId] ?? { status: 'found' }}
            preview={previewLine(line.itemId)}
            onChange={(p) => set(line.itemId, p)}
          />
        ))}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Card title={`Picking ${order.id}`} subtitle={saving ? 'Saving…' : 'Changes are shared with the customer live'} action={<Badge tone="violet">Shopper</Badge>}>
          <div className="mb-2 flex items-baseline justify-between text-sm">
            <span className="text-stone-600">Running total</span>
            <span className="tabular text-lg font-semibold">{usd(total)}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-stone-100" role="meter" aria-valuenow={total} aria-valuemax={hold} aria-label="Hold used">
            <div className={`h-full rounded-full ${preview && !preview.withinHold ? 'bg-rose-500' : 'bg-brand-600'}`} style={{ width: `${used}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-xs text-stone-500">
            <span>Hold {usd(hold)}</span>
            <span>{preview ? `${usd(Math.max(0, preview.headroom))} headroom` : `${usd(hold - total)} headroom`}</span>
          </div>
          {preview?.errors?.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-rose-700">
              {preview.errors.map((e) => (
                <li key={e.itemId}>{e.message}</li>
              ))}
            </ul>
          )}
          {preview && !preview.withinHold && (
            <p className="mt-3 text-xs text-rose-700">This is over the hold. Pick cheaper items or mark something out of stock.</p>
          )}
          <ErrorNote error={error} />
          <Button className="mt-4 w-full" busy={finishing} disabled={saving || blocked} onClick={finish}>
            Finish picking · charge {usd(total)}
          </Button>
          <p className="mt-2 text-xs text-stone-500">Charges the final total and releases {usd(Math.max(0, hold - total))} of the hold.</p>
        </Card>
      </aside>
    </div>
  );
}

function PickRow({ line, pick, preview, onChange }) {
  const outOfStock = pick.status === 'out_of_stock';
  const substituting = pick.status === 'substituted' || pick.status === 'choosing';
  const canSubstitute = line.allowSubstitution && line.substitutes?.length > 0;

  const choose = (status) => {
    if (status === 'found') onChange(line.weighed ? { status: 'found', actualLb: pick.actualLb ?? line.estLb } : { status: 'found' });
    if (status === 'out_of_stock') onChange({ status: 'out_of_stock' });
    if (status === 'substituted') onChange({ status: 'choosing' });
  };

  return (
    <div className={`rounded-2xl border bg-white p-4 shadow-sm ${preview?.error ? 'border-rose-300' : 'border-stone-200'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-stone-900">{line.name}</p>
          <p className="text-sm text-stone-500">
            Ordered {line.weighed ? `est. ${lbText(line.estLb)} at ${usd(line.price)}/lb` : `${line.qty} × ${usd(line.price)}`} · {usd(line.estimate)}
          </p>
          <p className="mt-0.5 text-xs text-stone-500">{substitutionPolicyText(line)}</p>
        </div>
        <div className="text-right">
          <p className="tabular font-semibold text-stone-900">{usd(preview?.final ?? line.estimate)}</p>
          {preview && preview.final !== line.estimate && (
            <p className="tabular text-xs text-stone-500">{signedUsd(preview.final - line.estimate)}</p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Segment active={!outOfStock && !substituting} onClick={() => choose('found')}>
          Found
        </Segment>
        <Segment active={outOfStock} onClick={() => choose('out_of_stock')}>
          Out of stock
        </Segment>
        {canSubstitute && (
          <Segment active={substituting} onClick={() => choose('substituted')}>
            Substitute
          </Segment>
        )}
        {line.weighed && !outOfStock && (
          <label className="ml-auto flex items-center gap-2 text-sm text-stone-600">
            Weighed
            <input
              type="number"
              min="0.05"
              max="50"
              step="0.05"
              className="tabular w-20 rounded-lg border border-stone-300 px-2 py-1 text-right"
              value={pick.actualLb ?? line.estLb}
              onChange={(e) => onChange({ status: 'found', actualLb: e.target.value === '' ? line.estLb : Number(e.target.value) })}
            />
            lb
          </label>
        )}
      </div>

      {substituting && canSubstitute && (
        <div className="mt-3 space-y-2">
          {line.substitutes.map((sub) => {
            const allowed = sub.price <= line.ceiling;
            const selected = pick.substituteId === sub.id;
            return (
              <label
                key={sub.id}
                className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm ring-1 ring-inset ${
                  !allowed ? 'cursor-not-allowed bg-stone-50 text-stone-400 ring-stone-200' : selected ? 'bg-brand-50 ring-brand-600' : 'cursor-pointer ring-stone-200 hover:bg-stone-50'
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`sub-${line.itemId}`}
                    className="accent-emerald-700"
                    disabled={!allowed}
                    checked={selected}
                    onChange={() => onChange({ status: 'substituted', substituteId: sub.id })}
                  />
                  <span>
                    {sub.name}
                    {!allowed && <span className="block text-xs">Above what the customer approved (up to {usd(line.ceiling)})</span>}
                  </span>
                </span>
                <span className="tabular whitespace-nowrap">
                  {usd(sub.price)} <span className="text-xs">({signedUsd(sub.price - line.price)})</span>
                </span>
              </label>
            );
          })}
          {pick.status === 'choosing' && <p className="text-xs text-stone-500">Pick a replacement, or mark the item out of stock.</p>}
        </div>
      )}
      {preview?.error && <p className="mt-2 text-xs text-rose-700">{preview.error}</p>}
    </div>
  );
}

function Segment({ active, children, ...props }) {
  return (
    <button
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition ${
        active ? 'bg-stone-900 text-white ring-stone-900' : 'bg-white text-stone-700 ring-stone-300 hover:bg-stone-50'
      }`}
      {...props}
    >
      {children}
    </button>
  );
}
