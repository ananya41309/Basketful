export const usd = (cents) => (cents == null ? '—' : `$${(cents / 100).toFixed(2)}`);

export const pct = (rate) => `${Math.round(rate * 100)}%`;

// Order status in the customer's words (the Hyperswitch status is in the inspector).
export const STATUS_COPY = {
  awaiting_payment: { label: 'Waiting for payment', tone: 'stone' },
  confirming: { label: 'Confirming payment…', tone: 'amber' },
  held: { label: 'On hold', tone: 'amber' },
  charged: { label: 'Charged', tone: 'emerald' },
  released: { label: 'Cancelled, hold released', tone: 'stone' },
  payment_failed: { label: "Payment didn't go through", tone: 'rose' },
  refunded: { label: 'Refunded', tone: 'stone' },
};

export const TERMINAL = new Set(['charged', 'released', 'refunded']);

export const time = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

export const signedUsd = (cents) => (cents === 0 ? '$0.00' : `${cents > 0 ? '+' : '−'}${usd(Math.abs(cents))}`);

export const lbText = (lb) => `${Number(lb)} lb`;

// Client-side estimate for the store sidebar only. The server quote is the source of truth.
export const lineEstimate = (item, line) => (item.weighed ? Math.round(item.price * line.estLb) : item.price * line.qty);

// What the customer agreed to for one line, in plain words.
export function substitutionPolicyText(line) {
  if (!line.substitutable) return 'No substitutes for this item';
  if (!line.allowSubstitution) return "Customer: don't substitute";
  if (line.allowUpgrade) return `Customer: OK up to ${usd(line.ceiling)} (+$3 opt-in)`;
  return `Customer: similar price, up to ${usd(line.ceiling)}`;
}
