const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../admin.html'), 'utf8');
function extract(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}

test('admin distinguishes free delivery, pickup, paid shipping and missing freight', () => {
  const scope = vm.createContext({});
  vm.runInContext(extract('function formatAdminFrete(', 'function renderPedidosTable()'), scope);
  assert.equal(scope.formatAdminFrete({ frete_tipo: 'Retirada na loja', frete_valor: 0 }), 'Retirada');
  assert.equal(scope.formatAdminFrete({ frete_tipo: 'Entrega local', frete_valor: 0 }), 'Grátis');
  assert.equal(scope.formatAdminFrete({ frete_tipo: 'PAC', frete_valor: '19.9' }), 'R$ 19,90');
  for (const value of [undefined, null, '', -1, 'invalid']) {
    assert.equal(scope.formatAdminFrete({ frete_valor: value }), '—');
  }
});
function loginScope(fetch) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: id === 'loginInput' ? 'local-fixture-password' : '',
      disabled: false, textContent: '', classList: { add() {}, remove() {} }, focus() {} });
    return elements.get(id);
  };
  let unlocked = 0;
  const scope = vm.createContext({ AbortSignal, setTimeout: () => 1, Date, BACKEND_URL_AUTH: 'https://fixture.invalid', fetch,
    document: { getElementById: element }, sessionStorage: { setItem() {} },
    unlockAdminInterface: () => { unlocked++; }, loadProducts() {} });
  vm.runInContext(extract('async function fazerLogin()', 'function verificarLogin()'), scope);
  return { scope, element, unlocked: () => unlocked };
}

test('repeated admin login activation sends only one authentication request', async () => {
  let calls = 0, finish;
  const fixture = loginScope(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const first = fixture.scope.fazerLogin();
  await fixture.scope.fazerLogin();
  assert.equal(calls, 1);
  finish({ ok: true, json: async () => ({ token: 'local-fixture' }) });
  await first;
  assert.equal(fixture.unlocked(), 1);
  assert.equal(fixture.element('loginBtn').disabled, false);
});

test('admin temporary errors retain the password while a wrong password is cleared explicitly', async () => {
  for (const status of [401, 429, 503]) {
    const fixture = loginScope(async () => ({ ok: false, status }));
    await fixture.scope.fazerLogin();
    assert.equal(fixture.element('loginBtn').disabled, false);
    if (status === 401) {
      assert.equal(fixture.element('loginInput').value, '');
      assert.match(fixture.element('loginError').textContent, /Senha incorreta/);
    } else {
      assert.equal(fixture.element('loginInput').value, 'local-fixture-password');
      assert.doesNotMatch(fixture.element('loginError').textContent, /Senha incorreta/);
    }
    assert.equal(fixture.unlocked(), 0);
  }
});

test('admin server preparation failure never sends the password', async () => {
  const fixture = loginScope(() => { throw Error('must not transmit credentials'); });
  fixture.scope.RStreetBackendConnection = { ready: async () => { throw Object.assign(Error('offline'), { code: 'BACKEND_UNAVAILABLE' }); } };
  await fixture.scope.fazerLogin();
  assert.equal(fixture.element('loginInput').value, 'local-fixture-password');
  assert.equal(fixture.element('loginBtn').disabled, false);
  assert.match(fixture.element('loginError').textContent, /conexão/);
});

test('order refresh preserves previous orders on failure and ignores older responses', async () => {
  const pending = [];
  let renders = 0;
  const scope = vm.createContext({ allPedidos: [{ id: 1 }], document: { getElementById: () => ({ innerHTML: '' }) },
    toast() {}, updatePedidosStats() {}, renderPedidosTable: () => { renders++; },
    sbFetch: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) });
  vm.runInContext(extract('let pedidosRequest = 0;', 'function csvCell('), scope);
  const old = scope.loadPedidos(), fresh = scope.loadPedidos();
  pending[1].resolve([{ id: 2 }]); await fresh;
  pending[0].resolve([{ id: 1 }]); await old;
  assert.equal(scope.allPedidos[0].id, 2);
  assert.equal(renders, 1);
  const failed = scope.loadPedidos(); pending[2].reject(Error('offline')); await failed;
  assert.equal(scope.allPedidos[0].id, 2);
  assert.equal(renders, 1);
});
