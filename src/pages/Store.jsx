import { useMemo } from 'react';
import { usd, lbText, lineEstimate } from '../lib/format.js';
import { Badge, Button, Card } from '../components/ui.jsx';

const WEIGHT_STEP = 0.5;

// D15: a small store, enough to build a real basket. The demo basket is preloaded;
// quantities here are choices only, the server prices everything at checkout.
export default function Store({ config, lines, setLines, locked, onCheckout, onViewOrder, onResetDemo }) {
  const byId = useMemo(() => Object.fromEntries(config.catalog.map((i) => [i.id, i])), [config.catalog]);
  const lineFor = (itemId) => lines.find((l) => l.itemId === itemId);

  function change(item, direction) {
    setLines((prev) => {
      const existing = prev.find((l) => l.itemId === item.id);
      if (!existing) {
        if (direction < 0) return prev;
        const fresh = item.weighed ? { itemId: item.id, estLb: 1 } : { itemId: item.id, qty: 1 };
        return [...prev, { ...fresh, allowSubstitution: true, allowUpgrade: false }];
      }
      const next = item.weighed
        ? { ...existing, estLb: Math.round((existing.estLb + direction * WEIGHT_STEP) * 10) / 10 }
        : { ...existing, qty: existing.qty + direction };
      const empty = item.weighed ? next.estLb <= 0 : next.qty <= 0;
      if (empty) return prev.filter((l) => l.itemId !== item.id);
      return prev.map((l) => (l.itemId === item.id ? next : l));
    });
  }

  const subtotal = lines.reduce((sum, l) => (byId[l.itemId] ? sum + lineEstimate(byId[l.itemId], l) : sum), 0);
  const count = lines.length;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-6">
        {locked && (
          <div className="flex items-center justify-between rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
            <span>You have an order in progress. Its basket is locked to the hold you approved.</span>
            <Button variant="secondary" onClick={onViewOrder}>View order</Button>
          </div>
        )}
        {config.aisles.map((aisle) => (
          <section key={aisle}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">{aisle}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {config.catalog
                .filter((item) => item.category === aisle)
                .map((item) => {
                  const line = lineFor(item.id);
                  return (
                    <div key={item.id} className="flex flex-col justify-between rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                      <div>
                        <p className="font-medium text-stone-900">{item.name}</p>
                        <p className="tabular text-sm text-stone-600">
                          {usd(item.price)}
                          {item.weighed ? ' / lb' : ''}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {item.weighed && <Badge tone="amber">Priced by weight</Badge>}
                          {item.substitutable && <Badge tone="sky">Substitutes available</Badge>}
                        </div>
                      </div>
                      <div className="mt-4">
                        {!line ? (
                          <Button variant="secondary" className="w-full" onClick={() => change(item, 1)} disabled={locked}>
                            Add
                          </Button>
                        ) : (
                          <div className="flex items-center justify-between rounded-xl bg-stone-50 p-1 ring-1 ring-inset ring-stone-200">
                            <StepButton label={`Less ${item.name}`} onClick={() => change(item, -1)} disabled={locked}>
                              −
                            </StepButton>
                            <span className="tabular text-sm font-medium text-stone-800">
                              {item.weighed ? `est. ${lbText(line.estLb)}` : `${line.qty}`}
                            </span>
                            <StepButton label={`More ${item.name}`} onClick={() => change(item, 1)} disabled={locked}>
                              +
                            </StepButton>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>
        ))}
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <Card title="Your basket" subtitle={`${count} ${count === 1 ? 'item' : 'items'}`}>
          <ul className="mb-4 max-h-72 space-y-1.5 overflow-y-auto text-sm">
            {lines.map((l) => {
              const item = byId[l.itemId];
              if (!item) return null;
              return (
                <li key={l.itemId} className="flex justify-between gap-3">
                  <span className="truncate text-stone-700">
                    {item.name}
                    <span className="text-stone-400"> · {item.weighed ? `~${lbText(l.estLb)}` : `×${l.qty}`}</span>
                  </span>
                  <span className="tabular text-stone-800">{usd(lineEstimate(item, l))}</span>
                </li>
              );
            })}
            {count === 0 && <li className="text-stone-500">Your basket is empty.</li>}
          </ul>
          <div className="flex justify-between border-t border-stone-200 pt-3 text-sm">
            <span className="text-stone-600">Estimated items</span>
            <span className="tabular font-semibold">{usd(subtotal)}</span>
          </div>
          <p className="mt-1 text-xs text-stone-500">Fees, tax, tip and the temporary hold are shown at checkout.</p>
          <Button className="mt-4 w-full" onClick={onCheckout} disabled={count === 0 || locked}>
            Go to checkout
          </Button>
          {!locked && (
            <button onClick={onResetDemo} className="mt-2 w-full text-center text-xs text-stone-500 hover:text-stone-800">
              Reset to the demo basket
            </button>
          )}
        </Card>
      </aside>
    </div>
  );
}

function StepButton({ label, children, ...props }) {
  return (
    <button
      aria-label={label}
      className="h-8 w-8 rounded-lg text-lg font-semibold text-stone-700 hover:bg-white disabled:opacity-40"
      {...props}
    >
      {children}
    </button>
  );
}
