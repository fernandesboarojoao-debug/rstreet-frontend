(function () {
  const CONFIG = {
    gaMeasurementId: '',
    metaPixelId: '',
    currency: 'BRL',
    engagementApi: 'https://rstreet-backend.onrender.com/api/engajamento/metricas'
  };

  function getSessionId() {
    const key = 'rstreet_metrics_session';
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = `rs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
      sessionStorage.setItem(key, id);
    }
    return id;
  }

  function saveMetric(type, data = {}) {
    if (!CONFIG.engagementApi || typeof fetch !== 'function') return;
    const payload = {
      tipo: type,
      sessao_id: getSessionId(),
      pagina: location.pathname.replace(/^\//, '') || 'index.html',
      produto_id: data.id || data.produto_id || data.item_id || null,
      produto_variante_id: data.produto_variante_id || null,
      marca: data.marca || data.item_brand || '',
      categoria: data.categoria || data.item_category || '',
      valor: data.valor ?? data.preco ?? data.price ?? null
    };
    fetch(CONFIG.engagementApi, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(() => {});
  }

  function hasValue(value) {
    return typeof value === 'string' && value.trim().length > 4 && !value.includes('COLE_');
  }

  function loadScript(src) {
    const script = document.createElement('script');
    script.async = true;
    script.src = src;
    document.head.appendChild(script);
  }

  if (hasValue(CONFIG.gaMeasurementId)) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(CONFIG.gaMeasurementId)}`);
    window.gtag('js', new Date());
    window.gtag('config', CONFIG.gaMeasurementId);
  }

  if (hasValue(CONFIG.metaPixelId)) {
    window.fbq = window.fbq || function () {
      window.fbq.callMethod ? window.fbq.callMethod.apply(window.fbq, arguments) : window.fbq.queue.push(arguments);
    };
    if (!window._fbq) window._fbq = window.fbq;
    window.fbq.push = window.fbq;
    window.fbq.loaded = true;
    window.fbq.version = '2.0';
    window.fbq.queue = window.fbq.queue || [];
    loadScript('https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', CONFIG.metaPixelId);
    window.fbq('track', 'PageView');
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeItem(item) {
    return {
      item_id: String(item.id || item.produto_id || item.produto_variante_id || ''),
      item_name: String(item.nome || item.name || 'Produto R Street'),
      item_brand: String(item.marca || ''),
      item_category: String(item.categoria || ''),
      item_variant: [item.cor, item.tamanho].filter(Boolean).join(' / '),
      price: number(item.preco || item.preco_unitario || item.price),
      quantity: number(item.qty || item.quantidade || 1) || 1
    };
  }

  function gaEvent(name, params) {
    if (typeof window.gtag === 'function') window.gtag('event', name, params || {});
  }

  function metaEvent(name, params) {
    if (typeof window.fbq === 'function') window.fbq('track', name, params || {});
  }

  window.RStreetTrack = {
    pageView() {
      gaEvent('page_view', {
        page_location: window.location.href,
        page_title: document.title
      });
      saveMetric('page_view');
    },
    viewContent(product) {
      const item = normalizeItem(product || {});
      gaEvent('view_item', {
        currency: CONFIG.currency,
        value: item.price,
        items: [item]
      });
      metaEvent('ViewContent', {
        currency: CONFIG.currency,
        value: item.price,
        content_ids: [item.item_id],
        content_name: item.item_name,
        content_type: 'product'
      });
      saveMetric('view_item', product || {});
    },
    addToCart(item) {
      const normalized = normalizeItem(item || {});
      const value = normalized.price * normalized.quantity;
      gaEvent('add_to_cart', {
        currency: CONFIG.currency,
        value,
        items: [normalized]
      });
      metaEvent('AddToCart', {
        currency: CONFIG.currency,
        value,
        content_ids: [normalized.item_id],
        content_name: normalized.item_name,
        content_type: 'product'
      });
      saveMetric('add_to_cart', item || {});
    },
    beginCheckout(cart, total) {
      const items = Array.isArray(cart) ? cart.map(normalizeItem) : [];
      gaEvent('begin_checkout', {
        currency: CONFIG.currency,
        value: number(total),
        items
      });
      metaEvent('InitiateCheckout', {
        currency: CONFIG.currency,
        value: number(total),
        num_items: items.reduce((sum, item) => sum + item.quantity, 0)
      });
      saveMetric('begin_checkout', { valor: total });
      items.forEach(item => saveMetric('begin_checkout_item', item));
    },
    purchase(order) {
      const items = Array.isArray(order?.itens) ? order.itens.map(normalizeItem) : [];
      gaEvent('purchase', {
        transaction_id: String(order?.pedido_id || order?.id || ''),
        currency: CONFIG.currency,
        value: number(order?.total),
        shipping: number(order?.frete?.valor),
        items
      });
      metaEvent('Purchase', {
        currency: CONFIG.currency,
        value: number(order?.total),
        content_ids: items.map(item => item.item_id).filter(Boolean),
        content_type: 'product'
      });
      saveMetric('purchase', { valor: order?.total });
      items.forEach(item => saveMetric('purchase_item', item));
    },
    contactWhatsApp(label) {
      gaEvent('generate_lead', { method: 'whatsapp', label: String(label || '') });
      metaEvent('Contact', { content_name: String(label || 'WhatsApp R Street') });
      saveMetric('whatsapp');
    }
  };

  function addWhatsAppFloatingButton() {
    if (document.querySelector('.rstreet-whatsapp-float')) return;
    const style = document.createElement('style');
    style.textContent = `
      .rstreet-whatsapp-float {
        position: fixed;
        right: 22px;
        bottom: calc(22px + env(safe-area-inset-bottom, 0px));
        z-index: 900;
        display: block;
        width: 74px;
        height: auto;
        padding: 0;
        background: transparent;
        border: 0;
        box-shadow: none;
        text-decoration: none;
        transition: transform 0.2s ease;
      }
      .rstreet-whatsapp-float:hover {
        transform: translateY(-2px);
      }
      .rstreet-whatsapp-float-img {
        width: 100%;
        height: auto;
        display: block;
        object-fit: contain;
      }
      @media (max-width: 640px) {
        .rstreet-whatsapp-float {
          right: 14px;
          bottom: calc(16px + env(safe-area-inset-bottom, 0px));
          width: 62px;
        }
      }`;
    document.head.appendChild(style);

    const message = encodeURIComponent('Olá! Vim pelo site da R Street e preciso de ajuda.');
    const link = document.createElement('a');
    link.className = 'rstreet-whatsapp-float';
    link.href = `https://wa.me/5519993111599?text=${message}`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.setAttribute('aria-label', 'Falar com a R Street no WhatsApp');
    link.innerHTML = '<img class="rstreet-whatsapp-float-img" src="whatsapp-floating.png" alt="">';
    document.body.appendChild(link);
  }

  document.addEventListener('DOMContentLoaded', () => {
    addWhatsAppFloatingButton();
    window.RStreetTrack.pageView();
    document.body.addEventListener('click', event => {
      const link = event.target.closest('a[href*="wa.me"],a[href*="api.whatsapp.com"]');
      if (link) window.RStreetTrack.contactWhatsApp(link.textContent || link.href);
    });
  });
})();
