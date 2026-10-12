import { Row } from './ui.jsx';
import { usd, pct } from '../lib/format.js';

// The single most important screen: why the hold is higher than the estimate.
export default function HoldBreakdown({ pricing, policy }) {
  if (!pricing) return <div className="h-64 animate-pulse rounded-xl bg-stone-100" />;
  const { buffer } = pricing;
  return (
    <div>
      <Row label="Items" value={usd(pricing.items)} />
      <Row label="Delivery fee" value={usd(pricing.fees.delivery)} />
      <Row label="Service fee" value={usd(pricing.fees.service)} />
      <Row label="Estimated tax" value={usd(pricing.tax)} />
      <Row label="Tip" value={usd(pricing.tip)} />
      <div className="my-2 border-t border-stone-200" />
      <Row label="Estimated total" value={usd(pricing.estimate)} strong />

      <div className="mt-4 rounded-xl bg-amber-50/60 p-3 ring-1 ring-inset ring-amber-100">
        <Row
          label="Weight buffer"
          hint={`${pct(policy.weightRate)} of ${usd(buffer.weightBase)} priced by weight`}
          value={`+ ${usd(buffer.weight)}`}
        />
        <Row
          label="Substitution buffer"
          hint={`${pct(policy.substitutionRate)} of ${usd(buffer.substitutionBase)} OK to substitute`}
          value={`+ ${usd(buffer.substitution)}`}
        />
        {buffer.upgrade > 0 && (
          <Row
            label="Pricier replacement OK"
            hint={`up to ${usd(policy.upgradeCents)} more on ${buffer.upgradeItems} ${buffer.upgradeItems === 1 ? 'item' : 'items'}`}
            value={`+ ${usd(buffer.upgrade)}`}
          />
        )}
        {buffer.capped && <p className="mt-1 text-xs text-amber-800">Buffers are capped at {usd(policy.capCents)} in total.</p>}
        <div className="my-2 border-t border-amber-200/70" />
        <Row label="Temporary hold" value={usd(pricing.hold)} strong />
      </div>

      <p className="mt-3 text-sm leading-relaxed text-stone-600">
        We'll place a temporary hold of <strong className="text-stone-900">{usd(pricing.hold)}</strong> on your card. You'll only
        be charged for what we deliver, and the rest of the hold is released as soon as we finish shopping.
      </p>
    </div>
  );
}
