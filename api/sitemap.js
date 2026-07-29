const SUPABASE_URL = 'https://dxttqvmrpfwxsgrpancz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_TxSQPVP-gFjgTst7fTj4tw_G2qw7ssn';
const SITE_URL = 'https://www.rstreet.com.br';

function xmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function createUrlEntry({ loc, lastmod, changefreq, priority }) {
  return [
    '  <url>',
    `    <loc>${xmlEscape(loc)}</loc>`,
    `    <lastmod>${formatDate(lastmod)}</lastmod>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    '  </url>'
  ].join('\n');
}

function createSitemapXml(products = []) {
  const now = new Date().toISOString();
  const fixedPages = [
    { loc: `${SITE_URL}/catalogo.html`, lastmod: now, changefreq: 'daily', priority: '1.0' },
    { loc: `${SITE_URL}/sobre.html`, lastmod: now, changefreq: 'monthly', priority: '0.6' },
    { loc: `${SITE_URL}/acompanhar.html`, lastmod: now, changefreq: 'monthly', priority: '0.5' },
    { loc: `${SITE_URL}/politica.html`, lastmod: now, changefreq: 'monthly', priority: '0.5' }
  ];

  const productPages = products
    .filter(product => product && product.id)
    .map(product => ({
      loc: `${SITE_URL}/produto.html?id=${encodeURIComponent(product.id)}`,
      lastmod: product.atualizado_em || product.criado_em || now,
      changefreq: 'weekly',
      priority: '0.8'
    }));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...fixedPages.concat(productPages).map(createUrlEntry),
    '</urlset>'
  ].join('\n');
}

async function fetchActiveProducts() {
  const base = `${SUPABASE_URL}/rest/v1/produtos`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`
  };

  const detailedUrl = `${base}?select=id,criado_em,atualizado_em&ativo=eq.true&order=criado_em.desc&limit=1000`;
  let response = await fetch(detailedUrl, { headers });

  if (!response.ok) {
    const fallbackUrl = `${base}?select=id&ativo=eq.true&order=id.desc&limit=1000`;
    response = await fetch(fallbackUrl, { headers });
  }

  if (!response.ok) {
    throw new Error(`Supabase sitemap fetch failed: ${response.status}`);
  }

  return response.json();
}

module.exports = async function handler(req, res) {
  try {
    const products = await fetchActiveProducts();
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).send(createSitemapXml(products));
  } catch (error) {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
    res.status(200).send(createSitemapXml([]));
  }
};

module.exports.createSitemapXml = createSitemapXml;
