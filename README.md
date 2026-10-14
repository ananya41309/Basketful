# Basketful

A grocery delivery checkout on [Juspay Hyperswitch](https://docs.hyperswitch.io/) that places a hold for the
estimate and charges only what was delivered.

**Live demo:** https://basketful-w64j.onrender.com (free hosting: the first load after a quiet spell takes about a minute)

> Estimate $62.00 → hold $70.68 (incl. an opt-in to pay up to $3 more for oat milk) → shopper swaps and weighs items → charged $58.25 → $12.43 released.

## Run it locally

Requires Node 20 or newer (`node -v`).

```bash
npm install
cp .env.example .env      # then fill in your sandbox keys
npm run test:pricing      # offline: checks the math
npm run test:capture      # live: proves hold + partial capture + refund + void in your sandbox
npm run test:decline      # live: a refused card fails, a new payment for the same order succeeds
npm run dev               # open http://localhost:5173
```

### Keys (Hyperswitch Control Center)

| Variable | Where |
|---|---|
| `HYPERSWITCH_API_KEY` | Developers → Keys → Create API Key (`snd_…`, shown once) |
| `HYPERSWITCH_PUBLISHABLE_KEY` | Developers → Keys (`pk_snd_…`) |
| `HYPERSWITCH_WEBHOOK_SECRET` | Developers → Payment Settings → payment response hash key |

A processor must be connected: Connectors → PayPal with sandbox Client ID and Secret (developer.paypal.com),
cards enabled, other processors disabled.

### Test card (PayPal sandbox)

`4012 0000 3333 0026`, any future expiry, any CVC. The demo customer's name, email and billing address are
prefilled server-side, so the checkout form only asks for the card.

Declines: PayPal's sandbox refuses a card when the cardholder name is `CCREJECT-REFUSED` (card `4012 8888 8888 1881`,
from Hyperswitch's own PayPal tests). Hyperswitch sends the billing name as the card name, and the app normally prefills
"Demo Customer", so a decline needs the checkout's **Demo · Simulate a declined card** switch, which sends the refusal name
for that one payment attempt. "Try another payment method" then creates a new, normal payment for the same order, so
Hyperswitch's `manual_retry` setting is not needed. `npm run test:decline` checks the same path server-to-server.

### How we chose the processor

Hyperswitch's checkout collects the card and forwards it to the processor. Each swap below was a dashboard
change in Hyperswitch; no application code changed.

| Processor | Result in the hosted sandbox |
|---|---|
| Stripe | Refuses card numbers forwarded by an orchestrator without a PCI review, even in test mode (confirmed by Stripe support) |
| Cybersource | New sandbox returned `502 SERVER_ERROR` ("General system failure") on every authorization |
| Hyperswitch test processor | Authorizes, but capture is not implemented and void is empty, so no hold-then-capture |
| Authorize.net | Sandbox signup blocked |
| Square | Needs a card token step that the hosted sandbox did not run (`Missing required param: payment_method_token`) |
| **PayPal** | **Hold, partial capture, release, partial refund and void all pass** (`npm run test:capture`) |

## Demo (about 5 minutes)

The header switches between three roles that share one current order: **Customer**, **Shopper** and **Ops**.
The payment inspector on the right shows the live Hyperswitch state for that order.

1. **Customer · Store.** The demo basket is preloaded. Add or remove items; weighed items move in half-pound steps.
2. **Customer · Checkout.** Each substitutable item has an "If out of stock" choice. Oat milk is set to
   "OK to pay up to $3 more", which shows as its own line in the hold. The hold is **$70.68**.
3. **Pay** with 4012 0000 3333 0026. The order shows "$70.68 on hold"; the inspector shows `requires_capture`.
4. **Shopper.** Open the order. Mark strawberries out of stock, weigh bananas at 2.6 lb, and substitute oat milk:
   Barista oat milk ($7.08) is allowed only because of the opt-in; Small-batch oat milk ($25.00) is disabled because
   it's above what the customer approved. The headroom meter tracks the running total against the hold.
   ("Fill demo picks" does all three.)
5. **Customer** (switch back while picking): "Live from your shopper" shows each change and the running total.
6. **Shopper · Finish picking.** Charges **$58.25** and releases $12.43. The inspector shows `partially_captured`.
7. **Ops.** Open the order, refund the oat milk ($7.08); the timeline shows the refund. A second refund of the same item is refused.
8. **Cancel:** start a new order, pay, and cancel it while held (Customer or Ops): `cancelled`, hold released.
9. **Decline:** start a new order and, at checkout, tick **Demo · Simulate a declined card**. Pay with 4012 8888 8888 1881:
   the page turns red with "Your bank declined this card", no hold is placed, and the basket is kept (the processor's
   `DO_NOT_HONOR` shows only in the inspector and Ops). **Try another payment method** opens a normal attempt; pay with
   4012 0000 3333 0026 and the hold is placed. Ops shows both attempts on one order.

## Webhooks

Hyperswitch can't reach `localhost`, so locally the app updates from API responses and status syncs.
After deploying, set the webhook URL in Developers → Payment Settings to
`https://<your-app>/api/webhooks/hyperswitch`. Events then appear in the inspector with their signature status.

## Deploy (Render free + Neon)

1. Push this folder to a GitHub repository (`.env` and `data/` are git-ignored).
2. Create a free Postgres database at neon.tech and copy its connection string.
3. In Render, choose **New → Blueprint**, pick the repository; `render.yaml` defines the service.
   Enter `HYPERSWITCH_API_KEY`, `HYPERSWITCH_PUBLISHABLE_KEY`, `HYPERSWITCH_WEBHOOK_SECRET` and `DATABASE_URL`.
4. After the first deploy, open `https://<your-app>.onrender.com/api/health`: it should say `"storage": "postgres"`.
5. In Hyperswitch, Developers → Payment Settings, set the webhook URL to
   `https://<your-app>.onrender.com/api/webhooks/hyperswitch`.

The free plan sleeps after 15 minutes without traffic and takes about a minute to wake, so open the link before
sharing it. A webhook that arrives while it sleeps is retried by Hyperswitch for up to 24 hours.
