const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../catalogo.html'), 'utf8');
function load(start, end, scope) {
  const from = source.indexOf(start);
  vm.runInContext(source.slice(from, source.indexOf(end, from + start.length)), scope);
}

test('in-stock filter announces in-stock rather than sold-out products', () => {
  const scope = vm.createContext({ currentStock: 'estoque', currentCampaignTheme: null,
    currentMobileCatalogMode: 'all', currentBrand: 'todos', currentCategory: 'todos',
    currentColor: 'todos', currentSize: 'todos', document: { getElementById: () => ({ value: '' }) } });
  load('function getCatalogActiveChips()', 'function clearCatalogFilter(', scope);
  assert.equal(scope.getCatalogActiveChips()[0].label, 'Em estoque');
  scope.currentStock = 'todos';
  assert.equal(scope.getCatalogActiveChips().length, 0);
});

test('desktop and mobile availability controls stay synchronized when filters are cleared', () => {
  const buttons = ['todos', 'estoque', 'todos', 'estoque'].map(stock => ({
    dataset: { stock }, classList: { toggle(_name, value) { this.active = value; } },
    setAttribute(name, value) { this[name] = value; },
  }));
  const scope = vm.createContext({ currentStock: 'estoque', document: { querySelectorAll: () => buttons } });
  load('function syncStockFilterButtons()', 'function setColorFilter(', scope);
  scope.syncStockFilterButtons();
  assert.deepEqual(buttons.map(b => b['aria-pressed']), ['false', 'true', 'false', 'true']);
  scope.currentStock = 'todos';
  scope.syncStockFilterButtons();
  assert.deepEqual(buttons.map(b => b['aria-pressed']), ['true', 'false', 'true', 'false']);
});

test('desktop categories render keyboard-accessible buttons with selected state', () => {
  const scope = vm.createContext({ currentCategory: 'Calca', allProducts: [],
    categoryMatches: (a, b) => a === b, escapeHtml: String, jsStringAttr: JSON.stringify });
  load('function renderCategoryButton(', 'function updateDynamicCategoryFilters()', scope);
  const html = scope.renderCategoryButton({ value: 'Calca', label: 'Calcas', count: 2 });
  assert.match(html, /^<button type="button"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /<\/button>$/);
});

test('filtering or refreshing a later page cannot hide existing results on the first page', () => {
  for (const count of [0, 1, 12, 13]) {
    const scope = vm.createContext({ currentPage: 3, PER_PAGE: 12, filtered: [],
      document: { getElementById: () => ({ value: 'default' }) },
      syncStockFilterButtons() {}, updateCatalogSearchMode() {}, updateCatalogShareUrl() {},
      getCatalogBaseProducts: () => Array.from({ length: count }, (_, id) => ({ id })), productMatchesColorAndSize: () => true,
      normalizeSearchText: () => '', updateDynamicCategoryFilters() {}, updateMobileCatalogHub() {},
      updateCatalogActiveArea() {}, updateSmartFilterOptions() {}, updateCampaignFilterBar() {},
      updateCatalogShowcases() {}, updateCatalogQuickNav() {}, renderPage() {}, renderPagination() {},
    });
    scope.document.getElementById = () => ({ value: 'default', setAttribute() {}, removeAttribute() {} });
    load('function applyFilters()', 'function handleCatalogSearchInput()', scope);
    scope.applyFilters();
    assert.equal(scope.currentPage, count > 12 ? 2 : 1);
    if (count) assert.ok(scope.filtered.slice((scope.currentPage - 1) * 12, scope.currentPage * 12).length > 0);
  }
});

test('a new search always starts with the first ranked results', () => {
  let pageAtRender;
  const scope = vm.createContext({ currentPage: 2, applyFilters: () => { pageAtRender = scope.currentPage; },
    requestAnimationFrame: callback => callback(), window: { scrollTo() {} } });
  load('function handleCatalogSearchInput()', 'function updateCatalogShareUrl()', scope);
  scope.handleCatalogSearchInput();
  assert.equal(pageAtRender, 1);
});
