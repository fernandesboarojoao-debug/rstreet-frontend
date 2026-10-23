const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../admin.html'), 'utf8');
function load(start, end, scope) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from);
  vm.runInContext(source.slice(from, to), scope);
}
function nodes() {
  const map = new Map();
  return id => {
    if (!map.has(id)) {
      const attrs = {}, classes = new Set();
      map.set(id, { value: '', innerHTML: '', textContent: '', style: {}, disabled: false, inert: false,
        setAttribute: (key, value) => { attrs[key] = value; }, removeAttribute: key => { delete attrs[key]; },
        getAttribute: key => attrs[key], classList: { add: key => classes.add(key), remove: key => classes.delete(key), contains: key => classes.has(key) }, focus() {} });
    }
    return map.get(id);
  };
}
const item = { nome_produto: 'Produto ficticio', quantidade: 1, preco_unitario: 10, total: 10 };
const response = data => ({ ok: true, json: async () => data });
function orderScope(fetch) {
  const field = nodes();
  const scope = vm.createContext({ AbortSignal, fetch, BACKEND_BASE: 'https://fixture.invalid/api', authHeaders: value => value,
    allPedidos: [1, 2].map(id => ({ id, subtotal: 10, total: 10, frete_valor: 0 })),
    document: { getElementById: field }, setPedidoVisto() {}, updatePedidosStats() {}, renderPedidosTable() {},
    safeHttpUrl: () => '', ENVIO_LABEL: {}, escapeHtml: String, escapeAttr: String, formatDate: () => 'data',
  });
  load('let pedidoDetalheRequest =', 'async function atualizarStatus(', scope);
  return { scope, field };
}

test('order detail blocks printing during loading and after failure, then recovers on retry', async () => {
  let finish;
  const fixture = orderScope(() => new Promise(resolve => { finish = resolve; }));
  const pending = fixture.scope.verPedido(1);
  assert.equal(fixture.field('btnImprimir').disabled, true);
  assert.match(fixture.field('pedModalBody').innerHTML, /Carregando/);
  finish(response([item])); await pending;
  assert.equal(fixture.field('btnImprimir').disabled, false);
  assert.match(fixture.field('pedModalBody').innerHTML, /Produto ficticio/);
  fixture.scope.fetch = async () => ({ ok: false, status: 503 });
  await fixture.scope.verPedido(2);
  assert.equal(fixture.field('btnImprimir').disabled, true);
  assert.equal(fixture.field('btnImprimir').onclick, null);
  assert.match(fixture.field('pedModalBody').innerHTML, /Tentar novamente/);
  fixture.scope.fetch = async () => response([item]);
  await fixture.scope.verPedido(2);
  assert.equal(fixture.field('btnImprimir').disabled, false);
});

test('late order details cannot replace a newer order or reopen a closed dialog', async () => {
  const pending = [];
  const fixture = orderScope(() => new Promise(resolve => pending.push(resolve)));
  const old = fixture.scope.verPedido(1), fresh = fixture.scope.verPedido(2);
  pending[1](response([{ ...item, nome_produto: 'Pedido novo' }])); await fresh;
  pending[0](response([{ ...item, nome_produto: 'Pedido antigo' }])); await old;
  assert.equal(fixture.field('pedModalTitle').textContent, 'Pedido #2');
  assert.doesNotMatch(fixture.field('pedModalBody').innerHTML, /Pedido antigo/);
  const closing = fixture.scope.verPedido(1); fixture.scope.closePedidoModal();
  pending[2](response([item])); await closing;
  assert.equal(fixture.field('pedidoModal').classList.contains('open'), false);
  assert.equal(fixture.field('btnImprimir').disabled, true);
});

test('empty malformed or incomplete order items cannot be printed', async () => {
  const fixture = orderScope(async () => response([]));
  let windows = 0;
  fixture.scope.window = { open() { windows++; } }; fixture.scope.toast = () => {};
  load('function imprimirPedido(', 'function formatFretePrint(', fixture.scope);
  for (const invalid of [null, {}, [], [null], [{ ...item, quantidade: 0 }], [{ ...item, quantidade: true }], [{ ...item, total: null }], [{ ...item, total: ' ' }], [{ ...item, preco_unitario: 'invalid' }]]) {
    fixture.scope.fetch = async () => response(invalid);
    await fixture.scope.verPedido(1);
    fixture.scope.imprimirPedido({ id: 1 }, invalid);
    assert.equal(fixture.field('btnImprimir').disabled, true);
  }
  assert.equal(windows, 0);
});

function sessionScope() {
  const field = nodes(), storage = new Map([['rstreet_auth', '6000'], ['rstreet_admin_token', 'fixture']]);
  let now = 1000, timer, reloads = 0;
  const scope = vm.createContext({ Date: { now: () => now }, clearTimeout() {}, setTimeout: (fn, delay) => { timer = { fn, delay }; return 1; },
    sessionStorage: { getItem: key => storage.get(key), removeItem: key => storage.delete(key) },
    document: { getElementById: field, querySelector: () => null }, closePedidoModal() {},
    productSaveInProgress: false, adminMediaUploading: false, homeHighlightsSaving: false, temaSaving: false,
    toast() {}, confirm: () => true, window: { location: { reload() { reloads++; } } },
  });
  load('let adminSessionExpiryTimer;', 'function authHeaders(', scope);
  return { scope, field, storage, timer: () => timer, reloads: () => reloads, setNow: value => { now = value; } };
}

test('expired admin session locks the interface, clears only its credentials and preserves drafts', () => {
  const fixture = sessionScope(); fixture.field('f-nome').value = 'Rascunho local';
  assert.equal(fixture.scope.getAdminToken(), 'fixture');
  fixture.scope.scheduleAdminSessionExpiry(); assert.equal(fixture.timer().delay, 5000);
  fixture.setNow(6001); assert.equal(fixture.scope.getAdminToken(), '');
  fixture.timer().fn();
  assert.equal(fixture.field('adminMain').getAttribute('inert'), '');
  assert.equal(fixture.field('loginScreen').style.display, 'flex');
  assert.equal(fixture.field('f-nome').value, 'Rascunho local');
  assert.equal(fixture.storage.size, 0);
});

test('logout waits for writes and honors confirmation for an unsaved modal', () => {
  const fixture = sessionScope(); fixture.scope.adminMediaUploading = true;
  fixture.scope.logoutAdmin(); assert.equal(fixture.reloads(), 0);
  fixture.scope.adminMediaUploading = false;
  fixture.scope.document.querySelector = () => ({}); fixture.scope.confirm = () => false;
  fixture.scope.logoutAdmin(); assert.equal(fixture.reloads(), 0);
  fixture.scope.confirm = () => true; fixture.scope.logoutAdmin();
  assert.equal(fixture.reloads(), 1); assert.equal(fixture.storage.size, 0);
});

function uploadScope() {
  const field = nodes(), notices = [];
  const scope = vm.createContext({ adminMediaUploading: false, productSaveInProgress: false, homeHighlightsSaving: false, homeHighlightsLoading: false, temaSaving: false, temaReadVersion: 0,
    document: { getElementById: field, querySelector: () => field('editor') },
    toast: message => notices.push(message), getFriendlySaveError: error => error.message,
  });
  load('async function runAdminMediaUpload(', 'async function uploadPendingVariantMedia()', scope);
  return { scope, field, notices };
}

test('uploads serialize jobs, release the editor after errors and preserve previous values', async () => {
  const fixture = uploadScope(); let fail, calls = 0;
  fixture.field('banner').value = 'https://fixture.invalid/old.jpg';
  const pending = fixture.scope.runAdminMediaUpload(fixture.field('editor'), fixture.field('file'), () => new Promise((_resolve, reject) => { fail = reject; }));
  assert.equal(fixture.field('editor').inert, true);
  await fixture.scope.runAdminMediaUpload(fixture.field('editor'), fixture.field('other'), async () => { calls++; });
  assert.equal(calls, 0);
  fail(Error('timeout ficticio')); await pending;
  assert.equal(fixture.scope.adminMediaUploading, false); assert.equal(fixture.field('editor').inert, false);
  assert.equal(fixture.field('file').disabled, false);
  assert.equal(fixture.field('banner').value, 'https://fixture.invalid/old.jpg');
});

test('upload response requires a valid HTTP URL and uses the configured timeout', async () => {
  const scope = vm.createContext({ BACKEND_BASE: 'https://fixture.invalid', authHeaders: value => value,
    AbortSignal: { timeout: ms => { assert.equal(ms, 60000); return new AbortController().signal; } },
    fetch: async () => response({ url: '' }), safeHttpUrl: value => /^https:\/\//.test(value || '') ? value : '',
  });
  load('async function uploadMediaDataUrl(', 'async function runAdminMediaUpload(', scope);
  await assert.rejects(scope.uploadMediaDataUrl('data:fixture'), /endereço válido/);
  scope.fetch = async () => response({ url: 'https://fixture.invalid/image.jpg' });
  assert.equal(await scope.uploadMediaDataUrl('data:fixture'), 'https://fixture.invalid/image.jpg');
});

test('failed highlight load never offers defaults for saving and an existing draft is not reloaded', async () => {
  const fixture = uploadScope(); let renders = 0, calls = 0;
  Object.assign(fixture.scope, { homeHighlightsLoaded: false, API: 'https://fixture.invalid', AbortSignal,
    authHeaders: value => value, renderHomeHighlightsAdmin: () => { renders++; },
    fetch: async () => { calls++; return { ok: false, text: async () => 'unavailable' }; } });
  load('async function loadHomeHighlightsAdmin(', 'async function handleHomeHighlightFile(', fixture.scope);
  await fixture.scope.loadHomeHighlightsAdmin();
  assert.equal(renders, 0); assert.equal(fixture.field('saveHomeHighlightsBtn').disabled, true);
  assert.match(fixture.field('homeHighlightsEditor').innerHTML, /Tentar novamente/);
  fixture.scope.homeHighlightsLoaded = true; fixture.field('homeHighlightsEditor').innerHTML = 'Rascunho';
  await fixture.scope.loadHomeHighlightsAdmin();
  assert.equal(calls, 1); assert.equal(fixture.field('homeHighlightsEditor').innerHTML, 'Rascunho');
});

test('a later failed highlight upload keeps earlier successful files in its preview', async () => {
  const fixture = uploadScope(); let uploads = 0;
  Object.assign(fixture.scope, { homeHighlightsState: [{ midias: [{ url: 'old.jpg', tipo: 'image' }] }],
    normalizeHomeHighlightMedia: value => value.midias, validateMediaFile: () => 'image',
    prepareMediaForUpload: async file => ({ dataUrl: 'data:fixture', name: file.name }),
    uploadMediaDataUrl: async () => { if (++uploads === 2) throw Error('falha ficticia'); return 'new.jpg'; },
    updateHomeHighlightPreview() {},
  });
  load('async function handleHomeHighlightFile(', 'function setHomeHighlightPrimary(', fixture.scope);
  const input = { files: [{ name: 'one' }, { name: 'two' }], value: 'files', disabled: false };
  await fixture.scope.handleHomeHighlightFile(0, { target: input });
  assert.deepEqual(Array.from(fixture.scope.homeHighlightsState[0].midias, media => media.url), ['old.jpg', 'new.jpg']);
  assert.equal(input.value, ''); assert.equal(input.disabled, false);
});

test('campaign save ignores repeated activation and preserves its form on a failure', async () => {
  const fixture = uploadScope(); let calls = 0, fail;
  Object.assign(fixture.scope, { API: 'https://fixture.invalid', AbortSignal, getTemaSitePayload: () => ({ nome: 'Rascunho' }),
    authHeaders: value => value, fetch: () => { calls++; return new Promise((_resolve, reject) => { fail = reject; }); },
    setTemaSiteForm() { throw Error('must preserve the form'); } });
  load('async function saveTemaSite()', 'const tabs =', fixture.scope);
  const pending = fixture.scope.saveTemaSite(); await fixture.scope.saveTemaSite();
  assert.equal(calls, 1); fail(Error('falha ficticia')); await pending;
  assert.equal(fixture.scope.temaSaving, false); assert.equal(fixture.field('saveTemaBtn').disabled, false);
  assert.equal(fixture.field('editor').inert, false);
  assert.equal(fixture.scope.temaReadVersion, 1);
});

test('campaign reload ignores late responses and preserves the previous list on invalid data or failure', async () => {
  const fixture = uploadScope(), pending = [];
  Object.assign(fixture.scope, { API: 'https://fixture.invalid', AbortSignal, allProducts: [{}],
    authHeaders: value => value, siteThemesState: [{ id: 1, nome: 'Anterior' }],
    renderTemasSiteList() {}, renderTemaProducts() {},
    fetch: () => new Promise(resolve => pending.push(resolve)) });
  load('async function loadTemasSiteAdmin()', 'function editTemaSite(', fixture.scope);
  const first = fixture.scope.loadTemasSiteAdmin(), second = fixture.scope.loadTemasSiteAdmin();
  pending[1](response([{ id: 2, nome: 'Atual' }])); await second;
  pending[0](response([{ id: 1, nome: 'Antiga' }])); await first;
  assert.equal(fixture.scope.siteThemesState[0].nome, 'Atual');
  fixture.scope.fetch = async () => response({ erro: 'invalid' });
  await fixture.scope.loadTemasSiteAdmin();
  assert.equal(fixture.scope.siteThemesState[0].nome, 'Atual');
  fixture.scope.fetch = async () => { throw Error('offline'); };
  await fixture.scope.loadTemasSiteAdmin();
  assert.equal(fixture.scope.siteThemesState[0].nome, 'Atual');
});

test('a campaign mutation invalidates an older read and blocks changing its form during uploads', async () => {
  const fixture = uploadScope(); let finish, renders = 0;
  Object.assign(fixture.scope, { API: 'https://fixture.invalid', AbortSignal, allProducts: [{}],
    authHeaders: value => value, siteThemesState: [{ id: 2, nome: 'Atual' }],
    renderTemasSiteList() { renders++; }, renderTemaProducts() {},
    fetch: () => new Promise(resolve => { finish = resolve; }) });
  load('async function loadTemasSiteAdmin()', 'function editTemaSite(', fixture.scope);
  load('function resetTemaSiteForm()', 'function setTemaSiteForm(', fixture.scope);
  load('function editTemaSite(', 'async function deleteTemaSite(', fixture.scope);
  const reading = fixture.scope.loadTemasSiteAdmin();
  fixture.scope.temaReadVersion++;
  finish(response([{ id: 1, nome: 'Antiga' }])); await reading;
  assert.equal(fixture.scope.siteThemesState[0].nome, 'Atual'); assert.equal(renders, 0);
  fixture.scope.adminMediaUploading = true;
  fixture.field('tema-nome').value = 'Rascunho';
  fixture.scope.resetTemaSiteForm(); fixture.scope.editTemaSite(2);
  assert.equal(fixture.field('tema-nome').value, 'Rascunho');
});

test('returning to the campaign tab keeps its unsaved form', () => {
  const fixture = uploadScope(); let resets = 0, loads = 0;
  fixture.scope.document.querySelectorAll = () => [];
  fixture.scope.loadTemasSiteAdmin = () => { loads++; };
  fixture.scope.resetTemaSiteForm = () => { resets++; };
  fixture.field('tema-nome').value = 'Campanha em andamento';
  load('const tabs = { dashboard:', '// ─── PEDIDOS', fixture.scope);
  fixture.scope.showTab('temas'); fixture.scope.showTab('dashboard'); fixture.scope.showTab('temas');
  assert.equal(loads, 2); assert.equal(resets, 0);
  assert.equal(fixture.field('tema-nome').value, 'Campanha em andamento');
});

test('campaign deletion serializes requests, invalidates reads and preserves the form on failure', async () => {
  const fixture = uploadScope(); let reject, calls = 0;
  Object.assign(fixture.scope, { API: 'https://fixture.invalid', AbortSignal, confirm: () => true,
    authHeaders: value => value, fetch: () => { calls++; return new Promise((_resolve, fail) => { reject = fail; }); },
    siteThemesState: [{ id: 2 }], editingThemeId: 2,
    setTemaSiteForm() { throw Error('must preserve failed draft'); }, renderTemasSiteList() {} });
  load('async function deleteTemaSite(', 'async function handleTemaBannerFile(', fixture.scope);
  const deleting = fixture.scope.deleteTemaSite(2); await fixture.scope.deleteTemaSite(2);
  assert.equal(calls, 1); assert.equal(fixture.scope.temaReadVersion, 1);
  reject(Error('offline')); await deleting;
  assert.equal(fixture.scope.siteThemesState.length, 1);
  assert.equal(fixture.scope.temaSaving, false); assert.equal(fixture.field('editor').inert, false);
});

test('failed explicit highlight reload preserves the existing draft and requires confirmation', async () => {
  const fixture = uploadScope(); let calls = 0;
  Object.assign(fixture.scope, { homeHighlightsLoaded: true, API: 'https://fixture.invalid', AbortSignal,
    authHeaders: value => value, confirm: () => false,
    fetch: async () => { calls++; throw Error('offline'); }, renderHomeHighlightsAdmin() { throw Error('must not replace draft'); } });
  fixture.field('homeHighlightsEditor').innerHTML = 'Rascunho existente';
  load('async function loadHomeHighlightsAdmin(', 'async function handleHomeHighlightFile(', fixture.scope);
  await fixture.scope.loadHomeHighlightsAdmin(true); assert.equal(calls, 0);
  fixture.scope.confirm = () => true; await fixture.scope.loadHomeHighlightsAdmin(true);
  assert.equal(calls, 1); assert.equal(fixture.scope.homeHighlightsLoaded, true);
  assert.equal(fixture.field('homeHighlightsEditor').innerHTML, 'Rascunho existente');
  assert.equal(fixture.field('saveHomeHighlightsBtn').disabled, false);
});

test('highlight save waits for loading and upload completion, blocks duplicates and keeps failed drafts', async () => {
  const fixture = uploadScope(); let calls = 0, fail;
  Object.assign(fixture.scope, { homeHighlightsLoaded: false, API: 'https://fixture.invalid', AbortSignal,
    authHeaders: value => value, getHomeHighlightFromForm: () => ({ marca: 'Teste', titulo: 'Rascunho', midia_url: 'fixture.jpg' }),
    fetch: () => { calls++; return new Promise((_resolve, reject) => { fail = reject; }); },
    renderHomeHighlightsAdmin() { throw Error('must not replace failed draft'); } });
  load('async function saveHomeHighlights()', 'function dateToLocalInput(', fixture.scope);
  await fixture.scope.saveHomeHighlights(); assert.equal(calls, 0);
  fixture.scope.homeHighlightsLoaded = true;
  const pending = fixture.scope.saveHomeHighlights(); await fixture.scope.saveHomeHighlights();
  assert.equal(calls, 1); fail(Error('offline')); await pending;
  assert.equal(fixture.scope.homeHighlightsSaving, false);
  assert.equal(fixture.field('saveHomeHighlightsBtn').disabled, false);
});

test('variant upload keeps successful earlier files when a later file fails', async () => {
  const fixture = uploadScope(); let calls = 0;
  const variant = { imagens: ['old.jpg'], videos: [] };
  Object.assign(fixture.scope, { validateMediaFile: () => 'image', prepareMediaForUpload: async () => ({ dataUrl: 'data:fixture' }),
    uploadMediaDataUrl: async () => { if (++calls === 2) throw Error('offline'); return 'new.jpg'; },
    updateColorVariants: (_index, update) => update(variant), uniqueMediaList: list => [...new Set(list)],
    getStoredMediaUrl: value => value, renderVariantGrid() {},
  });
  load('async function uploadVariantMedia(', 'function addSizeToColor(', fixture.scope);
  await fixture.scope.uploadVariantMedia(0, { target: { files: [{}, {}], value: '', disabled: false } });
  assert.deepEqual(Array.from(variant.imagens), ['old.jpg', 'new.jpg']);
  assert.equal(fixture.scope.adminMediaUploading, false);
});

test('valid print content includes every item and escapes customer and product markup', () => {
  const fixture = orderScope(async () => response([item])); let html = '';
  Object.assign(fixture.scope, { toast() {}, formatFretePrint: () => 'Grátis',
    window: { open: () => ({ document: { write: value => { html = value; }, close() {} } }) } });
  load('function escapeHtml(', 'function normalizeVariant(', fixture.scope);
  load('function imprimirPedido(', 'function formatFretePrint(', fixture.scope);
  fixture.scope.imprimirPedido({ id: 1, total: 20, cliente_nome: '<b>Teste</b>' }, [item, { ...item, nome_produto: '<img src=x>' }]);
  assert.match(html, /&lt;b&gt;Teste&lt;\/b&gt;/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.match(html, /Produto ficticio/);
  assert.doesNotMatch(html, /<img src=x>/);
});
