// Browser -> our Express API. The browser never talks to Hyperswitch's server API directly;
// only the checkout SDK does, using the publishable key and a per-payment client secret.
async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `Request failed (${res.status})`);
    err.details = json.details;
    throw err;
  }
  return json;
}

export const api = {
  config: () => request('GET', '/config'),
  quote: (lines, tipCents) => request('POST', '/quote', { lines, tipCents }),
  createOrder: (lines, tipCents, { simulateDecline = false } = {}) =>
    request('POST', '/orders', { lines, tipCents, simulateDecline }),
  getOrder: (id) => request('GET', `/orders/${id}`),
  sync: (id) => request('POST', `/orders/${id}/sync`),
  retryPayment: (id) => request('POST', `/orders/${id}/payment`),
  listOrders: () => request('GET', '/orders'),
  savePicking: (id, picks) => request('PUT', `/orders/${id}/picking`, { picks }),
  complete: (id, picks) => request('POST', `/orders/${id}/complete`, { picks }),
  pick: (id, picks) => request('POST', `/orders/${id}/pick`, { picks }),
  capture: (id) => request('POST', `/orders/${id}/capture`),
  cancel: (id) => request('POST', `/orders/${id}/cancel`),
  refund: (id, body) => request('POST', `/orders/${id}/refund`, body),
};
