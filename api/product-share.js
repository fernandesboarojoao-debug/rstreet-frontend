const SUPABASE_URL = 'https://dxttqvmrpfwxsgrpancz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_TxSQPVP-gFjgTst7fTj4tw_G2qw7ssn';
const SITE_URL = 'https://www.rstreet.com.br';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function publicImage(value) {
  return /^https:\/\//i.test(String(value || '').trim()) ? String(value).trim() : '';
}

function firstImage(product, variants, color) {
  const normalizedColor = String(color || '').trim().toLocaleLowerCase('pt-BR');
  const variant = (variants || []).find(item => String(item.cor || '').trim().toLocaleLowerCase('pt-BR') === normalizedColor)
    || (variants || [])[0];
  const candidates = [
    ...(Array.isArray(variant?.imagens) ? variant.imagens : []),
    variant?.imagem_url,
    ...(Array.isArray(product?.imagens) ? product.imagens : []),
    product?.imagem_url,
  ];
  return candidates.map(publicImage).find(Boolean) || `${SITE_URL}/rstreet-social-image.jpg`;
}

async function fetchProduct(id) {
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
  const [productResponse, variantsResponse] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/produtos?id=eq.${id}&ativo=eq.true&select=id,nome,marca,categoria,descricao,imagem_url,imagens`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/produto_variantes?produto_id=eq.${id}&ativo=eq.true&select=cor,imagem_url,imagens,ordem&order=ordem.asc`, { headers }),
  ]);
  if (!productResponse.ok || !variantsResponse.ok) throw new Error('Catalog fetch failed');
  const products = await productResponse.json();
  return { product: products[0], variants: await variantsResponse.json() };
}

module.exports = async function handler(req, res) {
  const id = Number(req.query?.id);
  if (!Number.isInteger(id) || id <= 0) return res.redirect(302, '/catalogo.html');
  const color = String(req.query?.cor || '').slice(0, 80);
  const target = `/produto.html?id=${encodeURIComponent(id)}${color ? `&cor=${encodeURIComponent(color)}` : ''}`;

  try {
    const { product, variants } = await fetchProduct(id);
    if (!product) return res.redirect(302, '/catalogo.html');
    const title = `${product.nome} | R Street`;
    const description = String(product.descricao || `${product.nome} na R Street. Consulte cores, tamanhos e estoque atualizado.`)
      .replace(/\s+/g, ' ').trim().slice(0, 220);
    const image = firstImage(product, variants, color);
    const canonical = `${SITE_URL}${target}`;
    const safeTarget = JSON.stringify(target).replace(/</g, '\\u003c');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=86400');
    return res.status(200).send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:type" content="product"><meta property="og:site_name" content="R Street"><meta property="og:title" content="${escapeHtml(product.nome)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(canonical)}"><meta property="og:image" content="${escapeHtml(image)}"><meta property="og:image:secure_url" content="${escapeHtml(image)}"><meta property="og:image:alt" content="${escapeHtml(product.nome)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(product.nome)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${escapeHtml(image)}"><script>window.location.replace(${safeTarget})</script></head><body><p><a href="${escapeHtml(target)}">Ver produto na R Street</a></p></body></html>`);
  } catch {
    return res.redirect(302, target);
  }
};

module.exports.escapeHtml = escapeHtml;
module.exports.firstImage = firstImage;
