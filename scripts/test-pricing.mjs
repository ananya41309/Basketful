// Offline check that the pricing engine reproduces the PRD worked example. Run: npm run test:pricing
import assert from 'node:assert/strict';
import { quote, finalize, evaluatePicks, substituteCeiling } from '../server/pricing.js';
import { DEMO_CART, DEMO_PICKS, DEMO_BLOCKED_PICK, DEFAULT_TIP } from '../server/catalog.js';

// Demo basket: oat milk opted in to "up to $3 more" (D13).
const q = quote(DEMO_CART, DEFAULT_TIP);
assert.equal(q.items, 5000, 'items $50.00');
assert.equal(q.tax, 101, 'tax $1.01');
assert.equal(q.estimate, 6200, 'estimate $62.00');
assert.equal(q.buffer.weight, 200, 'weight buffer $2.00 on $10.00');
assert.equal(q.buffer.substitution, 368, 'substitution buffer $3.68 on the other $24.51 substitutable');
assert.equal(q.buffer.upgrade, 300, 'oat milk opt-in $3.00');
assert.equal(q.hold, 7068, 'hold $70.68');

const order = { pricing: q };
const f = finalize(order, DEMO_PICKS);
assert.equal(f.items, 4632, 'final items $46.32');
assert.equal(f.tax, 94, 'final tax $0.94');
assert.equal(f.total, 5825, 'charged $58.25');
assert.equal(f.released, 1243, 'released $12.43');

// Without the opt-in, the hold is the plain D4 policy: $68.50.
const noOptIn = quote(DEMO_CART.map(({ allowUpgrade, ...l }) => l), DEFAULT_TIP);
assert.equal(noOptIn.buffer.upgrade, 0);
assert.equal(noOptIn.hold, 6850, 'hold $68.50 without opt-in');

// "Similar price" allows up to 15% more: oat milk $5.49 -> ceiling $6.31.
const oatSimilar = noOptIn.lines.find((l) => l.itemId === 'oatmilk');
assert.equal(substituteCeiling(oatSimilar), 631);
// So the $7.08 barista swap is refused without the opt-in...
assert.throws(() => finalize({ pricing: noOptIn }, DEMO_PICKS), /costs more than the customer approved/);
// ...and allowed with it (ceiling $8.49).
assert.equal(substituteCeiling(q.lines.find((l) => l.itemId === 'oatmilk')), 849);

// A $25 replacement is refused even with the opt-in.
assert.throws(() => finalize(order, DEMO_BLOCKED_PICK), /costs more than the customer approved/);

// The live preview never throws: a refused swap is reported on its line, priced as ordered.
const preview = evaluatePicks(order, { ...DEMO_PICKS, ...DEMO_BLOCKED_PICK });
assert.equal(preview.errors.length, 1);
assert.equal(preview.lines.find((l) => l.itemId === 'oatmilk').final, 549);
assert.match(preview.errors[0].message, /up to \$8\.49/);

// Prices come from the catalog, never the browser: an unknown substitute id is refused.
assert.throws(() => finalize(order, { oatmilk: { status: 'substituted', substituteId: 'free_milk' } }), /Unknown substitute/);
// And a price sent by the browser is ignored.
const spoofed = finalize(order, { oatmilk: { status: 'substituted', substituteId: 'oatmilk_store', price: 1 } });
assert.equal(spoofed.lines.find((l) => l.itemId === 'oatmilk').final, 479);

// Heavier-than-estimated weights can push the total over the hold; that is reported, not captured.
const heavy = evaluatePicks(order, { bananas: { status: 'found', actualLb: 40 } });
assert.equal(heavy.withinHold, false);

// No substitution at all: no substitution buffer, and swaps are refused.
const noSubs = quote(DEMO_CART.map((l) => ({ ...l, allowSubstitution: false })), DEFAULT_TIP);
assert.equal(noSubs.buffer.substitution, 0);
assert.equal(noSubs.buffer.upgrade, 0, 'opt-in needs substitution allowed');
assert.equal(noSubs.hold, 6400);
assert.throws(() => finalize({ pricing: noSubs }, DEMO_PICKS), /chose no substitutes/);

// The $50 cap scales all buckets and keeps the breakdown summing to the hold.
const big = quote([{ itemId: 'eggs', qty: 50 }, { itemId: 'apples', estLb: 40 }, { itemId: 'yogurt', qty: 5, allowUpgrade: true }], 0);
assert.equal(big.buffer.capped, true);
assert.equal(big.buffer.total, 5000);
assert.equal(big.buffer.weight + big.buffer.substitution + big.buffer.upgrade, 5000);
assert.equal(big.hold, big.estimate + 5000);

console.log('Pricing matches the PRD: estimate $62.00, hold $70.68 (with oat milk opt-in), charged $58.25, released $12.43.');
