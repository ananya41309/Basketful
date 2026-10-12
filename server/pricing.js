// Pricing and hold policy. The server is the only place totals are computed;
// the browser displays what this returns and never sends amounts back.
import { CATALOG_BY_ID, findSubstitute } from './catalog.js';

export const FEES = {
  delivery: 399,
  service: 250,
};

// Blended estimated sales tax. Many US states tax groceries at a reduced rate
// and prepared food at the full rate; real item-level tax is deferred (tax provider).
export const TAX_RATE = 0.0202;

// Hold policy (PRD decisions D4 and D13):
//   substitutable items get a 15% buffer ("similar price" = up to 15% more);
//   weighed items get a 20% buffer;
//   a customer can opt in at checkout to a pricier replacement, up to $3 more per unit;
//   each line takes its single largest buffer, never a sum;
//   the total buffer is capped at $50.
export const BUFFER_POLICY = {
  substitutionRate: 0.15,
  weightRate: 0.2,
  upgradeCents: 300,
  capCents: 5000,
};

const BUCKETS = ['weight', 'substitution', 'upgrade'];

const round = (n) => Math.round(n);

export function resolveLine(line) {
  const item = CATALOG_BY_ID[line.itemId];
  if (!item) throw new HttpError(400, `Unknown item: ${line.itemId}`);
  const allowSubstitution = item.substitutable && line.allowSubstitution !== false;
  if (item.weighed) {
    const estLb = Number(line.estLb);
    if (!(estLb > 0 && estLb <= 50)) throw new HttpError(400, `Invalid weight for ${item.name}`);
    return { ...item, itemId: item.id, estLb, qty: null, allowSubstitution, allowUpgrade: false, estimate: round(item.price * estLb) };
  }
  const qty = Number.parseInt(line.qty, 10);
  if (!(qty >= 1 && qty <= 50)) throw new HttpError(400, `Invalid quantity for ${item.name}`);
  // The opt-in only makes sense when substitution is allowed at all.
  const allowUpgrade = allowSubstitution && line.allowUpgrade === true;
  return { ...item, itemId: item.id, qty, estLb: null, allowSubstitution, allowUpgrade, estimate: item.price * qty };
}

// Each line takes its single largest applicable buffer.
function bufferFor(line) {
  const candidates = [];
  if (line.weighed) candidates.push({ kind: 'weight', cents: round(line.estimate * BUFFER_POLICY.weightRate) });
  if (line.allowSubstitution) candidates.push({ kind: 'substitution', cents: round(line.estimate * BUFFER_POLICY.substitutionRate) });
  if (line.allowUpgrade) candidates.push({ kind: 'upgrade', cents: BUFFER_POLICY.upgradeCents * line.qty });
  return candidates.reduce((best, c) => (c.cents > best.cents ? c : best), { kind: null, cents: 0 });
}

// Highest unit price the shopper may pick as a substitute for this line.
export function substituteCeiling(line) {
  const similar = round(line.price * (1 + BUFFER_POLICY.substitutionRate));
  return line.allowUpgrade ? Math.max(similar, line.price + BUFFER_POLICY.upgradeCents) : similar;
}

export function quote(rawLines, tipCents) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) throw new HttpError(400, 'Cart is empty');
  const tip = Number.parseInt(tipCents, 10);
  if (!(tip >= 0 && tip <= 10000)) throw new HttpError(400, 'Invalid tip');

  const lines = rawLines
    .map(resolveLine)
    .map((line) => ({ ...line, buffer: bufferFor(line), ceiling: line.allowSubstitution ? substituteCeiling(line) : null }));
  const items = lines.reduce((sum, l) => sum + l.estimate, 0);
  const tax = round(items * TAX_RATE);
  const estimate = items + FEES.delivery + FEES.service + tax + tip;

  const amounts = {};
  const bases = {};
  const counts = {};
  for (const kind of BUCKETS) {
    const inBucket = lines.filter((l) => l.buffer.kind === kind);
    amounts[kind] = inBucket.reduce((s, l) => s + l.buffer.cents, 0);
    bases[kind] = inBucket.reduce((s, l) => s + l.estimate, 0);
    counts[kind] = inBucket.length;
  }

  const uncapped = BUCKETS.reduce((s, k) => s + amounts[k], 0);
  const capped = uncapped > BUFFER_POLICY.capCents;
  if (capped) {
    // Scale every bucket down proportionally so the breakdown still adds up to the hold.
    const factor = BUFFER_POLICY.capCents / uncapped;
    let assigned = 0;
    BUCKETS.forEach((k, i) => {
      amounts[k] = i === BUCKETS.length - 1 ? BUFFER_POLICY.capCents - assigned : round(amounts[k] * factor);
      assigned += amounts[k];
    });
  }
  const total = BUCKETS.reduce((s, k) => s + amounts[k], 0);

  return {
    lines,
    tip,
    items,
    fees: { ...FEES },
    tax,
    estimate,
    buffer: {
      weight: amounts.weight,
      weightBase: bases.weight,
      substitution: amounts.substitution,
      substitutionBase: bases.substitution,
      upgrade: amounts.upgrade,
      upgradeItems: counts.upgrade,
      total,
      capped,
    },
    hold: estimate + total,
  };
}

const usdText = (cents) => `$${(cents / 100).toFixed(2)}`;

// Evaluate the shopper's picks against the order. Never throws on a bad pick: each line carries
// its own `error`, so the shopper console can show a live preview. finalize() is the strict version.
// picks: { [itemId]: { status: 'found' | 'out_of_stock' | 'substituted', actualLb?, substituteId? } }
export function evaluatePicks(order, picks = {}) {
  const lines = order.pricing.lines.map((line) => {
    const pick = picks?.[line.itemId] ?? { status: 'found' };
    const asOrdered = { ...line, pick: { status: 'found' }, final: line.estimate, finalLabel: 'Found' };

    if (pick.status === 'out_of_stock') {
      return { ...line, pick, final: 0, finalLabel: 'Out of stock' };
    }

    if (pick.status === 'substituted') {
      if (!line.allowSubstitution) {
        return { ...asOrdered, error: `The customer chose no substitutes for ${line.name}` };
      }
      const sub = findSubstitute(line.itemId, pick.substituteId);
      if (!sub) return { ...asOrdered, error: `Unknown substitute for ${line.name}` };
      const ceiling = substituteCeiling(line);
      if (sub.price > ceiling) {
        return {
          ...asOrdered,
          error: `${sub.name} costs more than the customer approved for ${line.name} (up to ${usdText(ceiling)}). Pick a cheaper replacement or mark it out of stock.`,
        };
      }
      const units = line.weighed ? line.estLb : line.qty;
      return {
        ...line,
        pick: { status: 'substituted', substituteId: sub.id },
        substitute: sub,
        final: round(sub.price * units),
        finalLabel: `Substituted: ${sub.name}`,
      };
    }

    if (line.weighed) {
      const actualLb = Number(pick.actualLb ?? line.estLb);
      if (!(actualLb > 0 && actualLb <= 50)) return { ...asOrdered, error: `Invalid weight for ${line.name}` };
      return { ...line, pick: { status: 'found', actualLb }, final: round(line.price * actualLb), finalLabel: `${actualLb} lb weighed` };
    }

    return asOrdered;
  });

  const items = lines.reduce((sum, l) => sum + l.final, 0);
  const tax = round(items * TAX_RATE);
  const total = items + order.pricing.fees.delivery + order.pricing.fees.service + tax + order.pricing.tip;
  const hold = order.pricing.hold;
  const errors = lines.filter((l) => l.error).map((l) => ({ itemId: l.itemId, message: l.error }));

  return {
    lines,
    items,
    tax,
    fees: order.pricing.fees,
    tip: order.pricing.tip,
    total,
    hold,
    released: hold - total,
    headroom: hold - total,
    withinHold: total <= hold,
    errors,
  };
}

// Final amount after picking. Throws on any refused pick or a total above the hold.
export function finalize(order, picks = {}) {
  const result = evaluatePicks(order, picks);
  if (result.errors.length) throw new HttpError(409, result.errors[0].message, { errors: result.errors });
  return result;
}

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
