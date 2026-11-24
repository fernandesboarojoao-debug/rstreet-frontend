const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('all catalog consumers use the same recovery database and public key', () => {
  const files = ['admin.html', 'catalogo.html', 'produto.html', 'carrinho.html', 'checkout.html', 'sobre.html', 'rstreet-cart-drawer.js', 'api/sitemap.js', 'api/merchant-feed.js', 'api/product-share.js'];
  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.match(source, /https:\/\/sbjgdtcmhqskgvymmawg\.supabase\.co/, file);
    assert.match(source, /sb_publishable_346i0a9_TM5ZdrMfQO6oNQ_9tlqYDxC/, file);
    assert.doesNotMatch(source, /dxttqvmrpfwxsgrpancz|sb_secret_/, file);
  }
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8'));
  assert.match(config.routes[0].headers['Content-Security-Policy'], /connect-src[^;]*https:\/\/sbjgdtcmhqskgvymmawg\.supabase\.co/);
  assert.doesNotMatch(config.routes[0].headers['Content-Security-Policy'], /dxttqvmrpfwxsgrpancz/);
});
