const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const handler = require('../api/manutencao.js');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8'));
const html = fs.readFileSync(path.join(__dirname, '../manutencao.html'), 'utf8');

test('maintenance returns temporary 503 without caching or database calls', () => {
  for (const method of ['GET', 'HEAD']) {
    const headers = {}; let body;
    const res = { setHeader(key, value) { headers[key] = value; }, end(value) { body = value; } };
    handler({ method, url: '/catalogo.html?busca=teste' }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(headers['Retry-After'], '3600');
    assert.match(headers['Cache-Control'], /no-store/);
    assert.equal(headers['Vercel-CDN-Cache-Control'], 'no-store');
    assert.equal(body, method === 'HEAD' ? undefined : html);
  }
});

test('maintenance covers storefront links but preserves existing orders and admin access', () => {
  const routes = config.rewrites.filter(route => route.destination === '/api/manutencao').map(route => route.source);
  for (const page of ['/', '/index.html', '/catalogo.html', '/produto.html', '/produto/:id', '/carrinho.html', '/checkout.html', '/sobre.html']) assert.ok(routes.includes(page));
  for (const page of ['/admin.html', '/acompanhar.html', '/confirmacao.html', '/politica.html', '/api/public-config']) assert.ok(!routes.includes(page));
  assert.ok(!(config.redirects || []).some(route => route.source === '/'));
  assert.equal(config.functions['api/manutencao.js'].includeFiles, 'manutencao.html');
});

test('maintenance keeps contact and order tracking available without tracking visitors', () => {
  assert.match(html, /https:\/\/wa\.me\/5519993111599\?/);
  assert.match(html, /href="\/acompanhar.html"/);
  assert.match(html, /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(html, /<script\b|supabase|rstreet-tracking|setInterval|countdown/i);
});
