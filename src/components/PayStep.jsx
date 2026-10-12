import { useMemo, useState } from 'react';
import { loadHyper } from '@juspay-tech/hyper-js';
import { HyperElements, UnifiedCheckout, useHyper, useWidgets } from '@juspay-tech/react-hyper-js';
import { Button, ErrorNote } from './ui.jsx';
import { usd } from '../lib/format.js';

// loadHyper must run once per publishable key, not on every render.
const hyperCache = new Map();
function getHyper(publishableKey) {
  if (!hyperCache.has(publishableKey)) hyperCache.set(publishableKey, loadHyper(publishableKey));
  return hyperCache.get(publishableKey);
}

const returnUrlFor = (orderId) => `${window.location.origin}/?order=${orderId}`;

// Unified Checkout renders cards and wallets and sends card data straight to Hyperswitch.
// Our server only ever sees the payment id, amounts and status.
export default function PayStep({ publishableKey, clientSecret, orderId, holdAmount, onSettled }) {
  const hyperPromise = useMemo(() => getHyper(publishableKey), [publishableKey]);
  const options = useMemo(
    () => ({
      clientSecret,
      appearance: {
        theme: 'default',
        variables: { colorPrimary: '#047857', borderRadius: '10px', fontFamily: 'Inter, system-ui, sans-serif' },
      },
    }),
    [clientSecret],
  );

  return (
    <HyperElements hyper={hyperPromise} options={options}>
      <PayForm orderId={orderId} holdAmount={holdAmount} onSettled={onSettled} />
    </HyperElements>
  );
}

function PayForm({ orderId, holdAmount, onSettled }) {
  const hyper = useHyper();
  const elements = useWidgets();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handlePay(e) {
    e.preventDefault();
    if (!hyper || !elements) return;
    setBusy(true);
    setError(null);
    try {
      // redirect: 'if_required' keeps the customer on the page unless 3DS or a wallet needs a redirect.
      const { error: payError, status } = await hyper.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrlFor(orderId) },
        redirect: 'if_required',
      });
      if (payError) {
        setError(payError.message || 'Payment could not be completed.');
      }
      // Whatever the SDK says, the order moves only on what our server confirms with Hyperswitch.
      await onSettled({ sdkStatus: status ?? null, sdkError: payError?.message ?? null });
    } catch (err) {
      setError(err.message || 'Payment could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handlePay} className="space-y-4">
      <UnifiedCheckout
        id="unified-checkout"
        options={{
          layout: { type: 'tabs' },
          business: { name: 'Basketful' },
          wallets: { walletReturnUrl: returnUrlFor(orderId) },
        }}
        onReady={() => setReady(true)}
      />
      <ErrorNote error={error} />
      <Button type="submit" className="w-full" busy={busy} disabled={!ready}>
        Place hold of {usd(holdAmount)}
      </Button>
      <p className="text-center text-xs text-stone-500">
        PayPal sandbox test card 4012 0000 3333 0026 · any future date · any CVC.
      </p>
    </form>
  );
}
