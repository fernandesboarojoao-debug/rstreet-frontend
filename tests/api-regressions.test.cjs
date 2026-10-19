const test = require('node:test');
const assert = require('node:assert/strict');

const publicConfig = require('../api/public-config.js');
const productShare = require('../api/product-share.js');

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(data) { this.data = data; return this; },
  };
}

test('public analytics config exposes only valid public identifiers', () => {
  const previousGa = process.env.GA_MEASUREMENT_ID;
  const previousMeta = process.env.META_PIXEL_ID;
  process.env.GA_MEASUREMENT_ID = 'javascript:alert(1)';
  process.env.META_PIXEL_ID = '<script>';
  const invalid = response();
  publicConfig({}, invalid);
  assert.deepEqual(invalid.data, { gaMeasurementId: '', metaPixelId: '' });

  process.env.GA_MEASUREMENT_ID = 'G-ABC1234';
  process.env.META_PIXEL_ID = '123456789';
  const valid = response();
  publicConfig({}, valid);
  assert.deepEqual(valid.data, { gaMeasurementId: 'G-ABC1234', metaPixelId: '123456789' });
  delete process.env.GA_MEASUREMENT_ID;
  delete process.env.META_PIXEL_ID;
  const store = response();
  publicConfig({}, store);
  assert.deepEqual(store.data, { gaMeasurementId: 'G-3SYFYVF3DH', metaPixelId: '4131579330474916' });
  process.env.META_PIXEL_ID = '';
  const disabled = response();
  publicConfig({}, disabled);
  assert.equal(disabled.data.metaPixelId, '');
  if (previousGa === undefined) delete process.env.GA_MEASUREMENT_ID; else process.env.GA_MEASUREMENT_ID = previousGa;
  if (previousMeta === undefined) delete process.env.META_PIXEL_ID; else process.env.META_PIXEL_ID = previousMeta;
});

test('product share sanitizes HTML and chooses the requested color image', () => {
  assert.equal(productShare.escapeHtml('<script>'), '&lt;script&gt;');
  const image = productShare.firstImage(
    { imagens: ['https://example.com/default.jpg'] },
    [
      { cor: 'Preto', imagens: ['https://example.com/black.jpg'] },
      { cor: 'Vinho', imagem_url: 'https://example.com/wine.jpg' },
    ],
    'vinho'
  );
  assert.equal(image, 'https://example.com/wine.jpg');
});
