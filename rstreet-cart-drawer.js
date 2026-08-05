(function () {
  const CART_KEY = 'rstreet_cart';

  function money(value) {
    return 'R$ ' + Number(value || 0).toFixed(2).replace('.', ',');
  }

  function getCart() {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateBadges(cart);
    renderDrawer();
  }

  function getCartCount(cart = getCart()) {
    return cart.reduce((total, item) => total + (Number(item.qty) || 0), 0);
  }

  function updateBadges(cart = getCart()) {
    const total = getCartCount(cart);
    document.querySelectorAll('#navCartCount, [data-cart-count]').forEach(el => {
      el.textContent = total;
    });
  }

  function itemMax(item) {
    const stock = Number(item.estoque);
    return Number.isFinite(stock) && stock > 0 ? stock : 99;
  }

  function changeQty(index, delta) {
    const cart = getCart();
    const item = cart[index];
    if (!item) return;
    const max = itemMax(item);
    const nextQty = Math.max(1, Math.min(max, (Number(item.qty) || 1) + delta));
    if (delta > 0 && (Number(item.qty) || 1) >= max) {
      showDrawerNotice(`Temos apenas ${max} unidade(s) disponível(is).`);
      return;
    }
    item.qty = nextQty;
    saveCart(cart);
  }

  function removeItem(index) {
    const cart = getCart();
    cart.splice(index, 1);
    saveCart(cart);
    showDrawerNotice('Produto removido do carrinho.');
  }

  function renderDrawer() {
    const body = document.getElementById('rstreetCartDrawerBody');
    const subtotalEl = document.getElementById('rstreetCartDrawerSubtotal');
    const countEl = document.getElementById('rstreetCartDrawerCount');
    if (!body || !subtotalEl || !countEl) return;

    const cart = getCart();
    updateBadges(cart);
    countEl.textContent = `${getCartCount(cart)} item(ns)`;
    subtotalEl.textContent = money(cart.reduce((sum, item) => sum + Number(item.preco || 0) * Number(item.qty || 0), 0));

    if (!cart.length) {
      body.innerHTML = '<div class="rstreet-cart-empty">Seu carrinho está vazio.</div>';
      return;
    }

    body.innerHTML = cart.map((item, index) => {
      const image = item.imagem
        ? `<img src="${escapeHtml(item.imagem)}" alt="${escapeHtml(item.nome || 'Produto')}">`
        : '<span class="rstreet-cart-img-fallback">R</span>';
      const meta = [
        item.cor ? `Cor: ${item.cor}` : '',
        item.tamanho ? `Tam: ${item.tamanho}` : '',
        item.referencia ? `Ref: ${item.referencia}` : ''
      ].filter(Boolean).join(' - ');
      const max = itemMax(item);
      const qty = Number(item.qty) || 1;
      return `
        <div class="rstreet-cart-item">
          <div class="rstreet-cart-img">${image}</div>
          <div class="rstreet-cart-info">
            <div class="rstreet-cart-brand">${escapeHtml(item.marca || 'R Street')}</div>
            <div class="rstreet-cart-name">${escapeHtml(item.nome || 'Produto')}</div>
            <div class="rstreet-cart-meta">${escapeHtml(meta)}</div>
            <div class="rstreet-cart-price">${money(Number(item.preco || 0) * qty)}</div>
            <div class="rstreet-cart-controls">
              <button type="button" onclick="window.RStreetCartDrawer.changeQty(${index}, -1)" ${qty <= 1 ? 'disabled' : ''}>-</button>
              <span>${qty}</span>
              <button type="button" onclick="window.RStreetCartDrawer.changeQty(${index}, 1)" ${qty >= max ? 'disabled' : ''}>+</button>
              <button type="button" class="is-remove" onclick="window.RStreetCartDrawer.removeItem(${index})">Remover</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);
  }

  function showDrawerNotice(message) {
    const el = document.getElementById('rstreetCartDrawerNotice');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(showDrawerNotice.timer);
    showDrawerNotice.timer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function openDrawer(event) {
    if (event) event.preventDefault();
    if (typeof window.closeCatalogMenu === 'function') window.closeCatalogMenu();
    if (typeof window.closeSiteMenu === 'function') window.closeSiteMenu();
    ensureDrawer();
    renderDrawer();
    document.body.classList.add('rstreet-cart-open');
  }

  function closeDrawer() {
    document.body.classList.remove('rstreet-cart-open');
  }

  function ensureDrawer() {
    if (document.getElementById('rstreetCartDrawer')) return;
    injectStyles();
    document.body.insertAdjacentHTML('beforeend', `
      <div class="rstreet-cart-backdrop" onclick="window.RStreetCartDrawer.close()"></div>
      <aside class="rstreet-cart-drawer" id="rstreetCartDrawer" aria-label="Carrinho">
        <div class="rstreet-cart-head">
          <div>
            <strong>Meu carrinho</strong>
            <span id="rstreetCartDrawerCount">0 item(ns)</span>
          </div>
          <button type="button" onclick="window.RStreetCartDrawer.close()" aria-label="Fechar carrinho">x</button>
        </div>
        <div class="rstreet-cart-notice" id="rstreetCartDrawerNotice"></div>
        <div class="rstreet-cart-body" id="rstreetCartDrawerBody"></div>
        <div class="rstreet-cart-foot">
          <div class="rstreet-cart-subtotal">
            <span>Subtotal</span>
            <strong id="rstreetCartDrawerSubtotal">R$ 0,00</strong>
          </div>
          <a class="rstreet-cart-primary" href="checkout.html">Finalizar compra</a>
          <a class="rstreet-cart-secondary" href="carrinho.html">Ver carrinho completo</a>
        </div>
      </aside>
    `);
  }

  function injectStyles() {
    if (document.getElementById('rstreetCartDrawerStyles')) return;
    const style = document.createElement('style');
    style.id = 'rstreetCartDrawerStyles';
    style.textContent = `
      .rstreet-cart-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.56);z-index:1190;opacity:0;pointer-events:none;transition:opacity .22s}
      .rstreet-cart-drawer{position:fixed;top:0;right:0;width:min(430px,92vw);height:100vh;background:#101010;border-left:1px solid rgba(200,169,110,.24);z-index:1200;transform:translateX(105%);transition:transform .26s ease;box-shadow:-24px 0 60px rgba(0,0,0,.42);display:flex;flex-direction:column;color:#fff}
      body.rstreet-cart-open .rstreet-cart-backdrop{opacity:1;pointer-events:auto}
      body.rstreet-cart-open .rstreet-cart-drawer{transform:translateX(0)}
      .rstreet-cart-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px;border-bottom:1px solid rgba(255,255,255,.08)}
      .rstreet-cart-head strong{display:block;font-family:'Bebas Neue',Impact,sans-serif;font-size:34px;letter-spacing:1px;text-transform:uppercase}
      .rstreet-cart-head span{display:block;color:#999;font-size:12px;margin-top:2px}
      .rstreet-cart-head button{width:38px;height:38px;border:1px solid rgba(255,255,255,.14);background:#1b1b1b;color:#fff;border-radius:3px;cursor:pointer;font-size:18px}
      .rstreet-cart-notice{display:none;margin:12px 16px 0;padding:10px 12px;border:1px solid rgba(200,169,110,.34);background:rgba(200,169,110,.1);color:#d8c28b;font-size:12px;line-height:1.4}
      .rstreet-cart-notice.show{display:block}
      .rstreet-cart-body{flex:1;overflow:auto;padding:16px;display:grid;align-content:start;gap:12px}
      .rstreet-cart-empty{border:1px dashed rgba(255,255,255,.18);padding:28px 16px;text-align:center;color:#aaa;font-size:14px}
      .rstreet-cart-item{display:grid;grid-template-columns:86px 1fr;gap:12px;padding:12px;border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.025);border-radius:4px}
      .rstreet-cart-img{width:86px;aspect-ratio:1;background:#fff;border-radius:3px;overflow:hidden;display:flex;align-items:center;justify-content:center;color:#111;font-weight:900}
      .rstreet-cart-img img{width:100%;height:100%;object-fit:contain;display:block}
      .rstreet-cart-brand{color:#c8a96e;font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px}
      .rstreet-cart-name{font-size:14px;font-weight:800;line-height:1.25;margin-bottom:6px}
      .rstreet-cart-meta{color:#aaa;font-size:12px;line-height:1.35;margin-bottom:8px}
      .rstreet-cart-price{font-family:'Bebas Neue',Impact,sans-serif;color:#c8a96e;font-size:24px;line-height:1;margin-bottom:10px}
      .rstreet-cart-controls{display:flex;align-items:center;gap:0;flex-wrap:wrap}
      .rstreet-cart-controls button,.rstreet-cart-controls span{min-width:34px;height:34px;border:1px solid rgba(255,255,255,.12);background:#1b1b1b;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:800}
      .rstreet-cart-controls button{cursor:pointer}
      .rstreet-cart-controls button:disabled{opacity:.35;cursor:not-allowed}
      .rstreet-cart-controls .is-remove{margin-left:8px;padding:0 10px;color:#bbb;text-transform:uppercase;font-size:10px;letter-spacing:1px}
      .rstreet-cart-foot{border-top:1px solid rgba(255,255,255,.08);padding:16px;display:grid;gap:10px;background:#0c0c0c}
      .rstreet-cart-subtotal{display:flex;align-items:center;justify-content:space-between;gap:16px;color:#aaa;font-size:13px;margin-bottom:4px}
      .rstreet-cart-subtotal strong{color:#c8a96e;font-family:'Bebas Neue',Impact,sans-serif;font-size:30px}
      .rstreet-cart-primary,.rstreet-cart-secondary{min-height:46px;display:flex;align-items:center;justify-content:center;text-decoration:none;text-transform:uppercase;letter-spacing:1px;font-weight:900;font-size:12px;border-radius:3px}
      .rstreet-cart-primary{background:#c8a96e;color:#080808}
      .rstreet-cart-secondary{border:1px solid rgba(255,255,255,.14);color:#eee;background:transparent}
      @media(max-width:520px){.rstreet-cart-drawer{width:100vw}.rstreet-cart-head{padding:18px}.rstreet-cart-item{grid-template-columns:76px 1fr}.rstreet-cart-img{width:76px}.rstreet-cart-controls .is-remove{width:100%;margin:8px 0 0}}
    `;
    document.head.appendChild(style);
  }

  function bindTriggers() {
    document.querySelectorAll('[data-cart-drawer-trigger], #navCartBtn').forEach(trigger => {
      if (trigger.dataset.cartDrawerBound === 'true') return;
      trigger.dataset.cartDrawerBound = 'true';
      trigger.addEventListener('click', openDrawer);
    });
    updateBadges();
  }

  window.RStreetCartDrawer = {
    open: openDrawer,
    close: closeDrawer,
    render: renderDrawer,
    updateBadges,
    changeQty,
    removeItem
  };

  document.addEventListener('DOMContentLoaded', bindTriggers);
  window.addEventListener('storage', event => {
    if (event.key === CART_KEY) {
      updateBadges();
      renderDrawer();
    }
  });
})();
