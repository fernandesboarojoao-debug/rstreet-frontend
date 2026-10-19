const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../rstreet-tracking.js'), 'utf8');

async function tracking(href, marketing = true, referrer = '') {
  const scripts = [], listeners = {};
  const scope = vm.createContext({ URL, AbortSignal, Date, Math,
    location: new URL(href),
    localStorage: { getItem: () => JSON.stringify({ analytics: true, marketing, signature: 'G-TEST|123456789', updatedAt: Date.now() }) },
    sessionStorage: { getItem: () => 'fixture', setItem() {} },
    document: { title: 'Fixture', referrer, readyState: 'complete', addEventListener() {},
      createElement: () => ({ addEventListener() {} }), querySelector: () => ({ appendChild() {} }),
      head: { appendChild: node => scripts.push(node) } },
    window: { addEventListener: (name, callback) => { listeners[name] = callback; } },
    fetch: async url => url === '/api/public-config' ? { ok: true, json: async () => ({ gaMeasurementId: 'G-TEST', metaPixelId: '123456789' }) } : {}
  });
  scope.window.location = scope.location;
  vm.runInContext(source, scope);
  await new Promise(resolve => setImmediate(resolve));
  return { scope, scripts, listeners, calls: () => Array.from(scope.window.fbq?.queue || [], args => Array.from(args)) };
}

test('Pixel requires separate advertising consent and disables automatic collection before init', async () => {
  const denied = await tracking('https://www.rstreet.com.br/catalogo.html', false);
  denied.scope.window.RStreetTrack.pageView();
  assert.ok(denied.scripts.every(node => !/facebook/.test(node.src || '')));
  const allowed = await tracking('https://www.rstreet.com.br/produto.html?id=1336');
  assert.equal(allowed.scope.window.fbq.disablePushState, true);
  assert.deepEqual(allowed.calls().slice(0, 3), [['set', 'autoConfig', false, '123456789'], ['consent', 'grant'], ['init', '123456789']]);
  allowed.scope.window.RStreetTrack.viewContent({ id: 1336, preco: 159.9, nome: 'Camiseta' });
  assert.ok(allowed.calls().some(call => call[0] === 'track' && call[1] === 'ViewContent'));
  allowed.listeners.storage({ key: 'rstreet_privacy_v1', newValue: null });
  const before = allowed.calls().filter(call => call[0] === 'track').length;
  allowed.scope.window.RStreetTrack.addToCart({ id: 1336 });
  assert.equal(allowed.calls().filter(call => call[0] === 'track').length, before);
  assert.deepEqual(allowed.calls().at(-1), ['consent', 'revoke']);
});

test('Pixel stays absent from private pages, searches, unknown parameters and private referrers', async () => {
  const cases = [
    ['/confirmacao.html?pedido=1&token=private', ''], ['/acompanhar.html', ''], ['/carrinho.html', ''],
    ['/admin.html', ''], ['/catalogo.html?busca=private@example.test', ''],
    ['/produto.html?id=1&token=private', ''], ['/catalogo.html#private', ''],
    ['/catalogo.html', 'https://www.rstreet.com.br/confirmacao.html?token=private'],
    ['/produto.html?id=1', 'https://example.test/?email=private@example.test']
  ];
  for (const [route, referrer] of cases) {
    const loaded = await tracking('https://www.rstreet.com.br' + route, true, referrer);
    loaded.scope.window.RStreetTrack.pageView();
    loaded.scope.window.RStreetTrack.purchase({ id: 1, total: 100 });
    assert.equal(loaded.calls().length, 0, route);
    assert.ok(loaded.scripts.every(node => !/facebook/.test(node.src || '')), route);
  }
});

test('URL changes cannot send a free-text search through the Pixel', async () => {
  const loaded = await tracking('https://www.rstreet.com.br/catalogo.html?busca=private');
  loaded.scope.location.href = 'https://www.rstreet.com.br/catalogo.html';
  loaded.scope.window.RStreetTrack.pageView();
  assert.ok(loaded.calls().some(call => call[1] === 'PageView'));
  loaded.scope.location.href = 'https://www.rstreet.com.br/catalogo.html?busca=private@example.test';
  const before = loaded.calls().filter(call => call[0] === 'track').length;
  loaded.scope.window.RStreetTrack.pageView();
  assert.equal(loaded.calls().filter(call => call[0] === 'track').length, before);
  assert.deepEqual(loaded.calls().at(-1), ['consent', 'revoke']);
});
