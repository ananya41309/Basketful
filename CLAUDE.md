# Basketful — project context for Claude

Prototype for a Juspay Hyperswitch assessment (forward deployed PM role). A US grocery delivery
app whose checkout **holds an estimate and captures the true total** after the order is picked.
The full PRD lives in a shared doc; this file holds what you need to build.

## The one idea to protect

Grocery totals are unknown at checkout (weights, substitutions, out-of-stocks). So:

1. Authorize a hold = estimate + buffers (`capture_method: manual`).
2. Shopper picks; server computes the final total.
3. Capture only the final total; Hyperswitch releases the rest (`partially_captured`).
4. Receipt shows held vs charged vs released.

Worked example the code and tests reproduce: estimate $62.00, hold $70.68 (oat milk opted in to "up to $3 more"),
charged $58.25, released $12.43. Without the opt-in the hold is $68.50.

## Decisions (agreed unless marked)

| # | Decision |
|---|---|
| D1 | Vertical: US grocery delivery |
| D2 | Basketful is merchant of record; one charge per order; retailer payouts deferred |
| D3 | Authorize estimate + buffer, capture final amount after picking |
| D4 | Buffers: 15% of substitutable items ("similar price" = up to 15% more), 20% of weighed items; each line takes its single largest buffer; total capped at $50 |
| D5 | Hyperswitch Unified Checkout (React SDK), payments created server-side |
| D6 | Cards in the prototype; Google Pay and Apple Pay next; PayPal not built; no BNPL/ACH at checkout; SNAP/EBT deferred |
| D7 | PayPal sandbox behind Hyperswitch (live test passes: hold, partial capture, release, partial refund, void). Stripe, Cybersource, the Hyperswitch test processor, Authorize.net and Square were each ruled out; see README. |
| D8 | React + Tailwind (Vite) frontend, thin Express API; Render free plan + Neon free Postgres |
| D9 | One app, Customer / Shopper / Ops role switcher (navigation only, no auth) |
| D10 | Read-only payment inspector drawer in the MVP |
| D11 | Laptop-first; phone layout deferred |
| D12 | Substitution choice lives in the cart, on by default |
| D13 | A substitute above the hold or above the item's ceiling is refused. The customer can opt in at checkout to a pricier replacement (up to $3 more per unit), which goes into the one hold. A live mid-order approval is paper only (needs incremental auth). |
| D14 | Shopper console: per-item found / weight / out of stock / catalog substitute; over-approval options disabled; headroom meter |
| D15 | Store: 16 items in 4 aisles, steppers, half-pound weights, demo basket preloaded; no search or accounts |
| D16 | Customer sees picking live, read-only (draft saved on every shopper change) |
| D17 | Ops: order list, detail with timeline, refund a line item once, cancel a hold |
| D18 | One shared current order across roles; Shopper opens on held orders, Ops on all orders |

## Guardrails against feature creep

- A feature enters a slice only if it is on the payment path or makes the hold-and-capture story clearer.
- The role switcher only changes the view of the same order. No login, roles or permissions.
- The payment inspector is read-only (plus a status sync button).
- Everything else goes to "paper only" in the decisions doc with a one-line approach.

## Slices

- **Slice 0 (done):** demo basket, hold breakdown, Unified Checkout, capture, cancel, decline retry, receipt, inspector.
- **Slice 1 (built):** role switcher (D18 shared current order); store (D15); shopper console with catalog
  substitutes, disabled over-approval options and headroom meter (D14); live customer updates (D16);
  ops list/detail with line-item refunds and cancel (D17); Postgres write-through store; Render blueprint.
- **Slice 2:** delivery window picker, PayPal wallet button, Apple Pay.
- **Paper only:** phone layout, saved cards, tip after delivery, incremental auth / live approval of pricier swaps,
  scheduled orders (extended auth), membership (mandates), SNAP/EBT (split tender), payouts (split payments),
  item-level tax, fraud/3DS rules, disputes.

## Engineering rules

- Money is integer cents everywhere. Format only in the UI (`src/lib/format.js`).
- The server is the only place totals are computed (`server/pricing.js`). The browser sends choices
  (items, substitution flags, tip), never amounts. Capture uses `order.final.total` from the server.
- The secret API key and webhook secret never reach the browser. The browser gets the publishable key and a
  per-payment `client_secret` only.
- Every payment state change goes through `applyPayment()` in `server/orders.js` (API response, webhook, or sync),
  which logs an event and ignores stale snapshots (webhooks can arrive out of order).
- Order status changes only on server-confirmed payment state, never on the browser redirect alone.
- Webhooks: verify `x-webhook-signature-512` (HMAC-SHA512 of the raw body with the payment response hash key);
  de-duplicate on `event_id`; always return 2xx for valid events so Hyperswitch stops retrying.
- Picks reference catalog substitute ids; the server looks up prices (`findSubstitute`) and drops anything else the
  browser sends (`cleanPicks`). `evaluatePicks()` never throws (live preview); `finalize()` is strict.
- Changes that push the final total above the hold, or a substitute above its item's ceiling (`substituteCeiling()`),
  are rejected (409) and logged as `picking.blocked`. Live customer approval is a later flow.

## Layout

```
server/index.js        Express app, routes, webhook endpoint, prod static serving
server/orders.js       Order lifecycle and payment state mapping
server/pricing.js      Estimate, buffers, hold, final total
server/hyperswitch.js  Hyperswitch API client + webhook verification
server/catalog.js      Demo catalog, demo basket, demo picks
server/store.js        Postgres (DATABASE_URL) write-through store, JSON file fallback; same sync interface
src/App.jsx            Shell, routing by ?order=, polling, inspector
src/pages/             Store, Checkout, OrderPage (customer), Shopper, Ops
src/components/        PayStep (Unified Checkout), HoldBreakdown, PaymentInspector, ui
scripts/               test-pricing (offline), test-partial-capture (live sandbox)
```

## Commands

- `npm run dev` — API on :3001 and Vite on :5173 (proxy /api).
- `npm run test:pricing` — offline check of the PRD numbers.
- `npm run test:capture` — live sandbox check: hold, partial capture, refund, void.
- `npm run test:decline` — live sandbox check: refused card (`CCREJECT-REFUSED` name) fails; a new payment succeeds.
- `npm run build && npm start` — production mode on one port.

## Hyperswitch API used

`POST /payments` (manual capture, confirm false, prefilled demo customer billing + email) · `GET /payments/{id}?force_sync=true` ·
`POST /payments/{id}/capture` (`amount_to_capture`) · `POST /payments/{id}/cancel` · `POST /refunds`.
Auth header: `api-key`. Base URL: `https://sandbox.hyperswitch.io`.
