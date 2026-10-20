const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../produto.html'), 'utf8');
function extract(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}
function setup() {
  let resolve;
  const inputs = new Map(['reviewOrder', 'reviewEmail', 'reviewComment'].map(id => [id, { value: `local-${id}`, disabled: false }]));
  const button = { disabled: false, textContent: 'Enviar avaliação' };
  const cancel = { disabled: false };
  const controls = [...inputs.values(), button, cancel];
  const attributes = new Map();
  const form = { querySelector: () => button, querySelectorAll: () => controls,
    setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key) };
  const notices = [];
  let calls = 0, renders = 0;
  const scope = vm.createContext({ AbortSignal, BACKEND_BASE: '/fixture', product: { id: 1 },
    selectedReviewRating: 5, reviewFormOpen: true, reviewSubmitting: false,
    document: { getElementById: id => inputs.get(id) }, toast: text => notices.push(text),
    renderProductReviews: () => { renders++; },
    fetch: () => { calls++; return new Promise(done => { resolve = done; }); },
  });
  vm.runInContext(extract('async function submitProductReview(event)', 'function getCurrentPurchaseLimit()'), scope);
  vm.runInContext(extract('function toggleReviewForm()', 'async function toggleAllProductReviews()'), scope);
  return { scope, inputs, attributes, controls, notices, form, event: { preventDefault() {}, currentTarget: form },
    finish: response => resolve(response), calls: () => calls, renders: () => renders };
}

test('review submission locks editing, blocks duplicate requests and cannot be cancelled midway', async () => {
  const fixture = setup();
  const request = fixture.scope.submitProductReview(fixture.event);
  assert.equal(fixture.attributes.get('aria-busy'), 'true');
  assert.ok(fixture.controls.every(control => control.disabled));
  fixture.scope.toggleReviewForm();
  assert.equal(fixture.scope.reviewFormOpen, true);
  await fixture.scope.submitProductReview(fixture.event);
  assert.equal(fixture.calls(), 1);
  fixture.finish({ ok: true, json: async () => ({}) });
  await request;
  assert.equal(fixture.scope.reviewSubmitting, false);
  assert.equal(fixture.scope.reviewFormOpen, false);
  assert.equal(fixture.renders(), 1);
  assert.equal(fixture.attributes.has('aria-busy'), false);
});

test('failed review submission unlocks the same form and keeps its fields and rating', async () => {
  const fixture = setup();
  const request = fixture.scope.submitProductReview(fixture.event);
  fixture.finish({ ok: false, json: async () => ({ erro: 'Tente mais tarde.' }) });
  await request;
  assert.equal(fixture.scope.reviewSubmitting, false);
  assert.equal(fixture.scope.reviewFormOpen, true);
  assert.equal(fixture.scope.selectedReviewRating, 5);
  assert.equal(fixture.inputs.get('reviewComment').value, 'local-reviewComment');
  assert.ok(fixture.controls.every(control => !control.disabled));
  assert.equal(fixture.renders(), 0);
  assert.equal(fixture.notices[0], 'Tente mais tarde.');
});

test('incoming review reload cannot redraw a form whose submission is in progress', () => {
  const scope = vm.createContext({ reviewSubmitting: true, document: { getElementById() { throw Error('must keep current form'); } } });
  vm.runInContext(extract('function renderProductReviews()', 'function renderReviewForm()'), scope);
  scope.renderProductReviews();
});
