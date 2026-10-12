import { useCallback, useEffect, useState } from 'react';
import { api } from './lib/api.js';
import { TERMINAL } from './lib/format.js';
import Store from './pages/Store.jsx';
import Checkout from './pages/Checkout.jsx';
import OrderPage from './pages/OrderPage.jsx';
import Shopper from './pages/Shopper.jsx';
import Ops from './pages/Ops.jsx';
import PaymentInspector from './components/PaymentInspector.jsx';

const orderIdFromUrl = () => new URLSearchParams(window.location.search).get('order');
const demoLines = (config) => config.demoCart.map((l) => ({ allowSubstitution: true, allowUpgrade: false, ...l }));

const ROLES = [
  { id: 'customer', label: 'Customer', dot: 'bg-emerald-500' },
  { id: 'shopper', label: 'Shopper', dot: 'bg-violet-500' },
  { id: 'ops', label: 'Ops', dot: 'bg-sky-500' },
];

// D9 + D18: one app, three roles, one shared current order. The switcher is navigation only.
export default function App() {
  const [config, setConfig] = useState(null);
  const [role, setRole] = useState('customer');
  const [view, setView] = useState(orderIdFromUrl() ? 'order' : 'shop'); // customer: shop | checkout | order
  const [lines, setLines] = useState([]);
  const [tip, setTip] = useState(0);
  const [order, setOrder] = useState(null);
  const [orders, setOrders] = useState([]);
  const [clientSecret, setClientSecret] = useState(null);
  // Shopper and Ops each have a list and a detail view of the shared current order.
  const [detailOpen, setDetailOpen] = useState({ shopper: false, ops: false });
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [fatal, setFatal] = useState(null);

  useEffect(() => {
    api
      .config()
      .then((c) => {
        setConfig(c);
        setLines(demoLines(c));
        setTip(c.defaultTip);
      })
      .catch((e) => setFatal(`Can't reach the Basketful API: ${e.message}`));
  }, []);

  // Returning from a redirect (3DS or wallet) lands on /?order=... : sync with Hyperswitch
  // rather than trusting the query string.
  useEffect(() => {
    const id = orderIdFromUrl();
    if (!id) return;
    api
      .sync(id)
      .catch(() => api.getOrder(id))
      .then(setOrder)
      .catch((e) => setFatal(e.message));
  }, []);

  // Keep the current order fresh while it is still moving (the shopper may be picking it in another tab).
  useEffect(() => {
    if (!order || TERMINAL.has(order.status)) return undefined;
    const t = setInterval(() => api.getOrder(order.id).then(setOrder).catch(() => {}), 2500);
    return () => clearInterval(t);
  }, [order?.id, order?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Shopper queue and ops list.
  useEffect(() => {
    if (role === 'customer') return undefined;
    const load = () => api.listOrders().then(setOrders).catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [role]);

  const updateOrder = useCallback((o) => {
    setOrder(o);
    setOrders((prev) => (prev.some((x) => x.id === o.id) ? prev.map((x) => (x.id === o.id ? o : x)) : [o, ...prev]));
  }, []);

  // Back to the list keeps the shared order (D18); opening an order makes it the current one.
  const openOrder = useCallback(
    async (id) => {
      if (!id) {
        setDetailOpen((d) => ({ ...d, [role]: false }));
        return;
      }
      updateOrder(await api.getOrder(id));
      setDetailOpen((d) => ({ ...d, [role]: true }));
    },
    [role, updateOrder],
  );

  function goToOrderView(id) {
    window.history.pushState({}, '', `/?order=${id}`);
    setView('order');
  }

  async function placeOrder(cartLines, tipCents) {
    const res = await api.createOrder(cartLines, tipCents);
    updateOrder(res.order);
    setClientSecret(res.clientSecret);
  }

  async function paymentSettled() {
    const synced = await api.sync(order.id);
    updateOrder(synced);
    if (synced.status !== 'awaiting_payment') {
      setClientSecret(null);
      goToOrderView(synced.id);
    }
  }

  async function retryPayment() {
    const res = await api.retryPayment(order.id);
    setClientSecret(res.clientSecret);
    return res.order;
  }

  function newOrder() {
    setOrder(null);
    setClientSecret(null);
    if (config) {
      setLines(demoLines(config));
      setTip(config.defaultTip);
    }
    window.history.pushState({}, '', '/');
    setDetailOpen({ shopper: false, ops: false });
    setRole('customer');
    setView('shop');
  }

  // An unfinished order locks the customer's basket to the hold they approved.
  const activeOrder = order && !TERMINAL.has(order.status) ? order : null;

  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <button onClick={newOrder} className="text-left" title="Start a new order">
            <p className="text-lg font-bold tracking-tight text-brand-800">Basketful</p>
            <p className="text-xs text-stone-500">Groceries in an hour · Hyperswitch sandbox</p>
          </button>

          <nav className="flex rounded-xl bg-stone-100 p-1" aria-label="Demo role">
            {ROLES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRole(r.id)}
                aria-pressed={role === r.id}
                className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                  role === r.id ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${r.dot}`} />
                {r.label}
              </button>
            ))}
          </nav>

          <button
            onClick={() => setInspectorOpen((v) => !v)}
            className="rounded-xl px-3 py-2 text-sm font-medium text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50"
          >
            {inspectorOpen ? 'Hide' : 'Show'} payment inspector
          </button>
        </div>
      </header>

      {config && !config.publishableKey && (
        <div className="bg-amber-50 px-6 py-3 text-center text-sm text-amber-900">
          HYPERSWITCH_PUBLISHABLE_KEY is not set in .env, so the payment form can't load.
        </div>
      )}

      <main className={`mx-auto grid max-w-7xl gap-6 px-6 py-8 ${inspectorOpen ? 'xl:grid-cols-[minmax(0,1fr)_340px]' : ''}`}>
        <div className="min-w-0">
          {fatal && <p className="rounded-xl bg-rose-50 p-4 text-rose-800">{fatal}</p>}
          {!config && !fatal && <p className="text-stone-500">Loading…</p>}

          {config && role === 'customer' && view === 'shop' && (
            <Store
              config={config}
              lines={lines}
              setLines={setLines}
              locked={Boolean(activeOrder)}
              onCheckout={() => setView('checkout')}
              onViewOrder={() => (activeOrder?.status === 'awaiting_payment' ? setView('checkout') : goToOrderView(activeOrder.id))}
              onResetDemo={() => setLines(demoLines(config))}
            />
          )}
          {config && role === 'customer' && view === 'checkout' && (
            <Checkout
              config={config}
              lines={lines}
              setLines={setLines}
              tip={tip}
              setTip={setTip}
              order={activeOrder}
              clientSecret={clientSecret}
              onPlaceOrder={placeOrder}
              onPaymentSettled={paymentSettled}
              onBack={() => setView('shop')}
            />
          )}
          {config && role === 'customer' && view === 'order' && order && (
            <OrderPage
              config={config}
              order={order}
              clientSecret={clientSecret}
              onOrder={updateOrder}
              onRetryPayment={retryPayment}
              onPaymentSettled={paymentSettled}
              onNewOrder={newOrder}
              onSwitchRole={setRole}
            />
          )}
          {config && role === 'customer' && view === 'order' && !order && !fatal && <p className="text-stone-500">Loading order…</p>}

          {config && role === 'shopper' && (
            <Shopper
              config={config}
              orders={orders}
              currentOrder={detailOpen.shopper ? order : null}
              onOpenOrder={openOrder}
              onOrder={updateOrder}
            />
          )}
          {config && role === 'ops' && (
            <Ops orders={orders} currentOrder={detailOpen.ops ? order : null} onOpenOrder={openOrder} onOrder={updateOrder} />
          )}
        </div>

        {inspectorOpen && (
          <div className="xl:sticky xl:top-6 xl:h-[calc(100vh-7rem)]">
            <PaymentInspector
              order={order}
              webhooksVerified={config?.webhooksVerified}
              onSync={async () => order && updateOrder(await api.sync(order.id))}
              onClose={() => setInspectorOpen(false)}
            />
          </div>
        )}
      </main>
    </div>
  );
}
