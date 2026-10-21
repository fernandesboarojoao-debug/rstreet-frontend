const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function setup(file, fetch) {
  const scope = vm.createContext({ fetch, URL, Response, Headers, AbortSignal, Date });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), scope);
  return scope;
}
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

test('catalog reads every page with stable ordering and preserves query filters', async () => {
  const calls = [];
  const scope = setup('rstreet-catalog-data.js', async (url, options) => {
    const parsed = new URL(url); calls.push(parsed);
    assert.equal(parsed.searchParams.get('ativo'), 'eq.true');
    assert.equal(parsed.searchParams.get('order'), 'ordem.asc,id.asc');
    assert.ok(options.signal);
    return json(parsed.searchParams.get('offset') === '0'
      ? Array.from({ length: 400 }, (_, index) => ({ id: index + 1 })) : [{ id: 401 }]);
  });
  const response = await scope.RStreetCatalogData.fetchAll('https://fixture.invalid/rest/v1/produto_variantes?ativo=eq.true&order=ordem.asc');
  assert.equal((await response.json()).length, 401);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].searchParams.get('offset'), '400');
});

test('partial catalog failures and changing pages never become a successful incomplete catalog', async () => {
  for (const kind of ['http', 'duplicate', 'invalid']) {
    let calls = 0;
    const scope = setup('rstreet-catalog-data.js', async () => {
      if (++calls === 1) return json(Array.from({ length: 400 }, (_, index) => ({ id: index + 1 })));
      return kind === 'http' ? new Response('', { status: 503 }) : json(kind === 'duplicate' ? [{ id: 1 }] : {});
    });
    const pending = scope.RStreetCatalogData.fetchAll('https://fixture.invalid/rest/v1/produtos');
    if (kind === 'http') assert.equal((await pending).status, 503);
    else await assert.rejects(pending);
  }
});

test('server response caps smaller than the requested page do not hide the remaining variants', async () => {
  let calls = 0;
  const scope = setup('rstreet-catalog-data.js', async (url, options) => {
    calls++;
    assert.equal(options.headers.get('Prefer'), 'count=exact');
    const offset = Number(new URL(url).searchParams.get('offset'));
    const length = Math.min(100, 450 - offset);
    return new Response(JSON.stringify(Array.from({ length }, (_, index) => ({ id: offset + index + 1 }))), {
      headers: { 'Content-Type': 'application/json', 'Content-Range': `${offset}-${offset + length - 1}/450` } });
  });
  const response = await scope.RStreetCatalogData.fetchAll('https://fixture.invalid/rest/v1/produto_variantes');
  assert.equal((await response.json()).length, 450);
  assert.equal(calls, 5);
});

test('an intentionally limited related-products query is not expanded, and writes are rejected', async () => {
  let calls = 0;
  const scope = setup('rstreet-catalog-data.js', async () => { calls++; return json([{ id: 1 }]); });
  await scope.RStreetCatalogData.fetchAll('https://fixture.invalid/rest/v1/produtos?limit=20');
  assert.equal(calls, 1);
  await assert.rejects(scope.RStreetCatalogData.fetchAll('https://fixture.invalid/rest/v1/produtos', { method: 'POST' }));
  assert.equal(calls, 1);
});

test('server preparation shares one health request and never sends payment or personal information', async () => {
  let calls = 0, finish;
  const scope = setup('rstreet-backend-connection.js', (url, options) => {
    calls++; assert.equal(url, 'https://fixture.invalid/health');
    assert.equal(options.body, undefined); assert.equal(options.method, undefined);
    return new Promise(resolve => { finish = resolve; });
  });
  const first = scope.RStreetBackendConnection.ready('https://fixture.invalid');
  const second = scope.RStreetBackendConnection.ready('https://fixture.invalid');
  assert.equal(first, second);
  finish(json({ status: 'ok', app: 'R Street Backend' }));
  assert.equal(await first, true);
  await scope.RStreetBackendConnection.ready('https://fixture.invalid');
  assert.equal(calls, 1);
});

test('health timeout or invalid response is recoverable and never cached as ready', async () => {
  let broken = true, calls = 0;
  const scope = setup('rstreet-backend-connection.js', async () => {
    calls++;
    if (broken) return json({ status: 'ok', app: 'another service' });
    return json({ status: 'ok', app: 'R Street Backend' });
  });
  await assert.rejects(scope.RStreetBackendConnection.ready('https://fixture.invalid'), error => error.code === 'BACKEND_UNAVAILABLE');
  broken = false;
  assert.equal(await scope.RStreetBackendConnection.ready('https://fixture.invalid'), true);
  assert.equal(calls, 2);
});
