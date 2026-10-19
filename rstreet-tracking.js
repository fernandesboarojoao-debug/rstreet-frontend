(function () {
  const CONFIG = {
    gaMeasurementId: '',
    metaPixelId: '',
    currency: 'BRL',
    engagementApi: 'https://rstreet-backend.onrender.com/api/engajamento/metricas'
  };
  const pendingAnalytics = [];
  let analyticsReady = false;
  let sessionId = '';
  let consent = { analytics: false, marketing: false };
  let gaLoaded = false;
  let metaLoaded = false;
  let consentPending = null;

  function consentSignature() { return `${CONFIG.gaMeasurementId}|${CONFIG.metaPixelId}`; }

  function parseConsent(raw) {
    try {
      const saved = JSON.parse(raw);
      const age = Date.now() - Number(saved?.updatedAt);
      if (saved?.signature === consentSignature() && Number.isFinite(age) && age >= 0 && age < 180 * 86400000 && typeof saved.analytics === 'boolean' && typeof saved.marketing === 'boolean') return saved;
    } catch {}
    return null;
  }

  function storedConsent() {
    try { return parseConsent(localStorage.getItem('rstreet_privacy_v1')); } catch { return null; }
  }

  function clearOptionalCookies(choice) {
    if (typeof document.cookie !== 'string') return;
    const names = document.cookie.split(';').map(cookie => cookie.split('=')[0].trim()).filter(name =>
      (!choice.analytics && /^_ga(?:_|$)/.test(name)) || (!choice.marketing && /^_fb[pc]$/.test(name)));
    const host = location.hostname;
    const domains = ['', ...(host ? [...new Set([host, host.replace(/^www\./, '')])].map(domain => `; Domain=${domain}`) : [])];
    for (const name of names) for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; Path=/${domain}; SameSite=Lax`;
    }
  }

  function chooseConsent() {
    if (consentPending) return consentPending;
    consentPending = new Promise(resolve => {
      const panel = document.createElement('section');
      panel.setAttribute('role', 'region');
      panel.setAttribute('aria-label', 'Preferências de privacidade');
      panel.className = 'rstreet-consent';
      const services = [CONFIG.gaMeasurementId ? 'Google Analytics' : '', CONFIG.metaPixelId ? 'Meta Pixel' : ''].filter(Boolean).join(' e ');
      panel.innerHTML = `<strong>Sua privacidade</strong><p>Com sua permissão, usamos ${services} para analisar visitas${CONFIG.metaPixelId ? ', compras e anúncios' : ' e compras'}. Você pode recusar os cookies opcionais.</p><a href="politica.html">Política de privacidade</a><div class="rstreet-consent-actions"><button type="button" data-choice="analytics">Permitir análises</button>${CONFIG.metaPixelId ? '<button type="button" data-choice="all">Análises e anúncios</button>' : ''}<button type="button" data-choice="none">Recusar opcionais</button></div>`;
      panel.querySelectorAll('[data-choice]').forEach(button => button.addEventListener('click', () => {
        const choice = { analytics: button.dataset.choice !== 'none', marketing: button.dataset.choice === 'all', signature: consentSignature(), updatedAt: Date.now() };
        try { localStorage.setItem('rstreet_privacy_v1', JSON.stringify(choice)); } catch {}
        panel.remove();
        document.body.classList.remove('rstreet-consent-open');
        consentPending = null;
        resolve(choice);
      }));
      document.body.classList.add('rstreet-consent-open');
      document.body.appendChild(panel);
    });
    return consentPending;
  }

  function installPrivacyControls() {
    const style = document.createElement('style');
    style.textContent = `.rstreet-consent{position:fixed;left:20px;bottom:20px;width:460px;max-width:calc(100% - 40px);padding:20px;background:#fff;color:#171717;border:1px solid #ccc;border-radius:4px;box-shadow:0 6px 24px #0004;z-index:9800;font:13px/1.5 Arial,sans-serif}.rstreet-consent strong{font-size:17px;color:#171717}.rstreet-consent p{margin:10px 0;color:#333}.rstreet-consent a{color:#554015;text-decoration:underline}.rstreet-consent-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.rstreet-consent-actions button{flex:1;min-width:130px;padding:10px;border:1px solid #666;border-radius:3px;background:#fff;color:#171717;font:700 12px Arial,sans-serif;cursor:pointer}.rstreet-consent-actions button:hover{background:#eee}.rstreet-consent-actions button:focus-visible{outline:2px solid #171717;outline-offset:2px}.rstreet-consent-open .rstreet-whatsapp-float{visibility:hidden}.rstreet-privacy-button{border:0;background:none;color:inherit;text-decoration:underline;cursor:pointer;font:inherit;padding:10px}@media(max-width:640px){.rstreet-consent{left:12px;bottom:12px;max-width:calc(100% - 24px);padding:16px}}`;
    document.head.appendChild(style);
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'rstreet-privacy-button'; button.textContent = 'Preferências de privacidade';
    button.addEventListener('click', async () => {
      applyAnalyticsConsent(await chooseConsent());
      externalPageView();
    });
    (document.querySelector('footer') || document.querySelector('main') || document.body).appendChild(button);
  }

  function applyAnalyticsConsent(choice) {
    consent = choice;
    clearOptionalCookies(choice);
    window[`ga-disable-${CONFIG.gaMeasurementId}`] = !consent.analytics;
    if (CONFIG.gaMeasurementId && consent.analytics && !gaLoaded) {
      gaLoaded = true;
      window.dataLayer = window.dataLayer || [];
      window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
      window.gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
      loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(CONFIG.gaMeasurementId)}`);
      window.gtag('js', new Date());
      window.gtag('consent', 'update', { analytics_storage: 'granted' });
      window.gtag('config', CONFIG.gaMeasurementId, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
        page_location: cleanPageUrl(location.href), page_referrer: cleanPageUrl(document.referrer) });
    } else if (gaLoaded) {
      window.gtag('consent', 'update', { analytics_storage: consent.analytics ? 'granted' : 'denied' });
    }
    const allowMeta = consent.marketing && metaPageAllowed();
    if (CONFIG.metaPixelId && allowMeta && !metaLoaded) {
      metaLoaded = true;
      window.fbq = window.fbq || function () {
        window.fbq.callMethod ? window.fbq.callMethod.apply(window.fbq, arguments) : window.fbq.queue.push(arguments);
      };
      if (!window._fbq) window._fbq = window.fbq;
      window.fbq.push = window.fbq; window.fbq.loaded = true; window.fbq.version = '2.0'; window.fbq.queue = window.fbq.queue || [];
      window.fbq.disablePushState = true;
      window.fbq('set', 'autoConfig', false, CONFIG.metaPixelId);
      window.fbq('consent', 'grant');
      window.fbq('init', CONFIG.metaPixelId);
      loadScript('https://connect.facebook.net/en_US/fbevents.js');
    } else if (metaLoaded) {
      window.fbq('consent', allowMeta ? 'grant' : 'revoke');
    }
  }

  function handlePrivacyStorage(event) {
    if (event.key !== 'rstreet_privacy_v1' && event.key !== null) return;
    const saved = parseConsent(event.newValue);
    // A background tab may revoke permission, but never grant new permissions silently.
    applyAnalyticsConsent({ analytics: consent.analytics && Boolean(saved?.analytics), marketing: consent.marketing && Boolean(saved?.marketing) });
  }

  if (typeof window.addEventListener === 'function') window.addEventListener('storage', handlePrivacyStorage);

  function getSessionId() {
    if (sessionId) return sessionId;
    const key = 'rstreet_metrics_session';
    try { sessionId = sessionStorage.getItem(key) || ''; } catch {}
    if (!sessionId) sessionId = `rs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
    try { sessionStorage.setItem(key, sessionId); } catch {}
    return sessionId;
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

  function cleanPageUrl(value) {
    try {
      const url = new URL(value);
      return `${url.origin}${url.pathname}`;
    } catch { return ''; }
  }

  function metaPageAllowed() {
    const publicPaths = new Set(['/', '/index.html', '/catalogo.html', '/produto.html', '/sobre.html', '/politica.html']);
    function publicUrl(value, externalReferrer = false) {
      if (!value) return true;
      try {
        const url = new URL(value);
        if (!/^https?:$/.test(url.protocol) || url.hash) return false;
        if (externalReferrer && url.origin !== new URL(location.href).origin) return !url.search;
        if (!publicPaths.has(url.pathname)) return false;
        // Only numeric product IDs may accompany a Pixel URL. Searches and order tokens stay private.
        return [...url.searchParams].every(([key, val]) => key === 'id' && /^\d{1,10}$/.test(val));
      } catch { return false; }
    }
    return publicUrl(location.href) && publicUrl(document.referrer, true);
  }

  function loadScript(src) {
    const script = document.createElement('script');
    script.async = true;
    script.src = src;
    document.head.appendChild(script);
  }

  async function initializeAnalytics() {
    try {
      const response = await fetch('/api/public-config', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const config = await response.json();
        if (/^G-[A-Z0-9]+$/.test(config.gaMeasurementId || '')) CONFIG.gaMeasurementId = config.gaMeasurementId;
        if (/^\d{5,25}$/.test(config.metaPixelId || '')) CONFIG.metaPixelId = config.metaPixelId;
      }
    } catch {}

    if (CONFIG.gaMeasurementId || CONFIG.metaPixelId) {
      if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
      installPrivacyControls();
      applyAnalyticsConsent(storedConsent() || await chooseConsent());
    }

    analyticsReady = true;
    pendingAnalytics.splice(0).forEach(call => call());
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
    const run = () => {
      if (consent.analytics && typeof window.gtag === 'function') window.gtag('event', name, params || {});
    };
    if (analyticsReady) run(); else if (pendingAnalytics.length < 50) pendingAnalytics.push(run);
  }

  function metaEvent(name, params) {
    const run = () => {
      if (!consent.marketing) return;
      if (!metaPageAllowed()) {
        if (metaLoaded) window.fbq('consent', 'revoke');
        return;
      }
      if (!metaLoaded) applyAnalyticsConsent(consent);
      if (typeof window.fbq !== 'function') return;
      window.fbq('consent', 'grant');
      window.fbq('track', name, params || {});
    };
    if (analyticsReady) run(); else if (pendingAnalytics.length < 50) pendingAnalytics.push(run);
  }

  function externalPageView() {
      gaEvent('page_view', {
        page_location: cleanPageUrl(window.location.href),
        page_referrer: cleanPageUrl(document.referrer),
        page_title: document.title
      });
      metaEvent('PageView');
  }

  window.RStreetTrack = {
    pageView() {
      externalPageView();
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
        width: 64px;
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
          width: 54px;
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
    link.innerHTML = '<img class="rstreet-whatsapp-float-img" src="whatsapp-floating.webp" alt="">';
    document.body.appendChild(link);
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.footer-copy').forEach(el => {
      el.textContent = el.textContent.replace(/©\s*\d{4}/, `© ${new Date().getFullYear()}`);
    });
    addWhatsAppFloatingButton();
    window.RStreetTrack.pageView();
    document.body.addEventListener('click', event => {
      const link = event.target.closest('a[href*="wa.me"],a[href*="api.whatsapp.com"]');
      if (link) window.RStreetTrack.contactWhatsApp(link.getAttribute('aria-label') || link.textContent.trim() || 'WhatsApp');
    });
  });

  void initializeAnalytics();
})();
