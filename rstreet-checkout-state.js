(function (root) {
  'use strict';
  const PREFIX = 'rstreet_checkout_hold_';
  const CART = 'rstreet_cart';
  function read(key, fallback = null) {
    try { return JSON.parse(root.localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  }
  function key(item) {
    return `${Number(item.id ?? item.produto_id)}:${Number(item.produto_variante_id) || 0}`;
  }
  function records() {
    try {
      return Object.keys(root.localStorage).filter(k => k.startsWith(PREFIX))
        .map(k => ({ ...read(k, {}), storageKey: k }))
        .filter(record => record.completed || (Array.isArray(record.items) && Number.isFinite(record.until)
          && record.items.every(item => item && Number.isInteger(item.id) && item.id > 0
            && Number.isInteger(item.qty) && item.qty > 0)));
    } catch { return []; }
  }
  function remember(token, items, response = {}) {
    if (!/^[0-9a-f-]{36}$/i.test(token || '')) return;
    const storageKey = PREFIX + token;
    const previous = records().find(record => record.storageKey === storageKey) || {};
    if (previous.completed) return;
    const currentCart = read(CART, []);
    const canTagCart = JSON.stringify(currentCart) === JSON.stringify(items);
    const tagged = items.map((item, index) => ({ ...item,
      checkoutLineId: item.checkoutLineId || `${token}:${index}`,
    }));
    const expires = Date.parse(response.reserva_expira_em || '');
    // This is only a display safeguard; the backend remains the stock authority.
    const until = Number.isFinite(expires) ? expires + 5 * 60000 : previous.until || Date.now() + 35 * 60000;
    try {
      if (!previous.items && canTagCart) {
        root.localStorage.setItem(CART, JSON.stringify(tagged));
        items.forEach((item, index) => { item.checkoutLineId = tagged[index].checkoutLineId; });
      }
      root.localStorage.setItem(storageKey, JSON.stringify({
        token, orderId: response.pedido_id || previous.orderId || null, until,
        items: previous.items || items.map(item => ({ id: Number(item.id), produto_variante_id: Number(item.produto_variante_id) || null,
          qty: Math.max(1, Number(item.qty) || 1), checkoutLineId: item.checkoutLineId || null })),
      }));
    } catch {}
  }
  function protectedQuantity(item) {
    // Preference expiry alone does not settle a Pix or a payment under review.
    // Keep its cart for retry; only the backend can close the attempt.
    return records().filter(record => !record.completed && record.until + 7 * 86400000 > Date.now())
      .reduce((max, record) => Math.max(max, (record.items || []).filter(held => key(held) === key(item)
        && held.checkoutLineId && held.checkoutLineId === item.checkoutLineId)
        .reduce((sum, held) => sum + held.qty, 0)), 0);
  }
  function available(item, stock) {
    return Math.max(0, Number(stock) || 0, protectedQuantity(item));
  }
  function preserve(item) {
    const held = protectedQuantity(item);
    return held ? { ...item, estoque: Math.max(Number(item.qty) || 1, held) } : null;
  }
  function attemptFor(cart) {
    const signature = items => JSON.stringify(items.map(item => [key(item), Number(item.qty), item.checkoutLineId || null]).sort());
    return records().find(record => !record.completed && record.until + 7 * 86400000 > Date.now()
      && Array.isArray(record.items) && signature(record.items) === signature(cart)) || null;
  }
  function release(token) {
    try { root.localStorage.removeItem(PREFIX + token); } catch {}
  }
  async function complete(orderId, token) {
    const consume = () => {
      const record = records().find(entry => String(entry.orderId) === String(orderId)
        || (token && entry.token === token && !entry.orderId));
      if (!record || record.completed || !orderId) return;
      const purchased = new Map();
      const lineKey = item => `${key(item)}:${item.checkoutLineId || ''}`;
      (record.items || []).filter(item => item.checkoutLineId).forEach(item => purchased.set(lineKey(item), (purchased.get(lineKey(item)) || 0) + item.qty));
      const cart = read(CART, []);
      if (!Array.isArray(cart)) return;
      const next = cart.map(item => {
        const quantity = Math.max(0, Number(item.qty) || 0);
        const removed = Math.min(quantity, purchased.get(lineKey(item)) || 0);
        purchased.set(lineKey(item), (purchased.get(lineKey(item)) || 0) - removed);
        return { ...item, qty: quantity - removed };
      }).filter(item => item.qty > 0);
      // A durable receipt makes revisiting an old confirmation harmless.
      root.localStorage.setItem(record.storageKey, JSON.stringify({ completed: true, orderId, token: record.token }));
      root.localStorage.setItem(CART, JSON.stringify(next));
    };
    try {
      if (root.navigator?.locks) return await root.navigator.locks.request('rstreet-checkout-cart', consume);
      return consume();
    } catch {
      // Storage restrictions must never hide an already-confirmed order.
      return false;
    }
  }
  root.RStreetCheckoutState = { remember, available, preserve, protectedQuantity, attemptFor, release, complete };
})(window);
