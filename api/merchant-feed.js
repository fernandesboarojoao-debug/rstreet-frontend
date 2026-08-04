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

function slug(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'produto';
}

function price(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function getImageList(value) {
  return Array.isArray(value) ? value.filter(isPublicMediaUrl) : [];
}

function isPublicMediaUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function getProductImages(product) {
  const images = getImageList(product.imagens);
  if (images.length) return images;
  return isPublicMediaUrl(product.imagem_url) ? [product.imagem_url] : [];
}

function getVariantImages(variant) {
  const images = getImageList(variant.imagens);
  if (images.length) return images;
  return isPublicMediaUrl(variant.imagem_url) ? [variant.imagem_url] : [];
}

function categoryLabel(product) {
  const text = String(product.categoria || product.nome || '').toLowerCase();
  if (text.includes('tenis') || text.includes('chinelo') || text.includes('calçado') || text.includes('calcado')) return 'Apparel & Accessories > Shoes';
  if (text.includes('calca') || text.includes('bermuda') || text.includes('short')) return 'Apparel & Accessories > Clothing > Pants';
  if (text.includes('camiseta') || text.includes('camisa') || text.includes('polo') || text.includes('regata') || text.includes('moletom') || text.includes('blusa')) return 'Apparel & Accessories > Clothing > Shirts & Tops';
  if (text.includes('carteira') || text.includes('cinto')) return 'Apparel & Accessories > Clothing Accessories';
  return 'Apparel & Accessories';
}

function descriptionFor(product) {
  const raw = String(product.descricao || product.especificacoes_tecnicas || '').replace(/\s+/g, ' ').trim();
  if (raw) return raw.slice(0, 4500);
  return `${product.nome} na R Street Moda Masculina. Consulte cores, tamanhos e estoque no site.`;
}

function createItem(product, variant, productImages) {
  const variantImages = variant ? getVariantImages(variant) : [];
  const image = variantImages[0] || productImages[0] || `${SITE_URL}/rstreet-social-image.jpg`;
  const color = String(variant?.cor || '').trim();
  const size = String(variant?.tamanho || '').trim();
  const itemPrice = price(variant?.preco ?? product.preco);
  const stock = variant ? price(variant.estoque) : price(product.estoque);
  const id = variant ? `${product.id}-${slug(color)}-${slug(size)}` : String(product.id);
  const link = `${SITE_URL}/produto.html?id=${encodeURIComponent(product.id)}${color ? `&cor=${encodeURIComponent(color)}` : ''}`;

  return [
    '    <item>',
    `      <g:id>${xmlEscape(id)}</g:id>`,
    `      <g:item_group_id>${xmlEscape(product.id)}</g:item_group_id>`,
    `      <g:title>${xmlEscape(product.nome)}</g:title>`,
    `      <g:description>${xmlEscape(descriptionFor(product))}</g:description>`,
    `      <g:link>${xmlEscape(link)}</g:link>`,
    `      <g:image_link>${xmlEscape(image)}</g:image_link>`,
    `      <g:availability>${stock > 0 ? 'in_stock' : 'out_of_stock'}</g:availability>`,
    `      <g:price>${itemPrice.toFixed(2)} BRL</g:price>`,
    `      <g:brand>${xmlEscape(product.marca || 'R Street')}</g:brand>`,
    '      <g:condition>new</g:condition>',
    `      <g:google_product_category>${xmlEscape(categoryLabel(product))}</g:google_product_category>`,
    color ? `      <g:color>${xmlEscape(color)}</g:color>` : '',
    size ? `      <g:size>${xmlEscape(size)}</g:size>` : '',
    '    </item>'
  ].filter(Boolean).join('\n');
}

function createFeedXml(products, variants) {
  const activeProducts = products.filter(product => product && product.id && product.ativo !== false);
  const activeVariants = variants.filter(variant => variant && variant.ativo !== false);
  const items = activeProducts.flatMap(product => {
    const productImages = getProductImages(product);
    const productVariants = activeVariants.filter(variant => Number(variant.produto_id) === Number(product.id));
    if (productVariants.length) return productVariants.map(variant => createItem(product, variant, productImages));
    return [createItem(product, null, productImages)];
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    '  <channel>',
    '    <title>R Street Moda Masculina</title>',
    `    <link>${SITE_URL}</link>`,
    '    <description>Produtos ativos da R Street para o Google Merchant Center.</description>',
    ...items,
    '  </channel>',
    '</rss>'
  ].join('\n');
}

async function fetchJson(path) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`
    }
  });
  if (!response.ok) throw new Error(`Supabase fetch failed: ${response.status}`);
  return response.json();
}

module.exports = async function handler(req, res) {
  try {
    const [products, variants] = await Promise.all([
      fetchJson('produtos?select=*&ativo=eq.true&order=criado_em.desc&limit=1000'),
      fetchJson('produto_variantes?select=*&ativo=eq.true&order=produto_id.asc,ordem.asc,cor.asc,tamanho.asc&limit=5000')
    ]);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).send(createFeedXml(products, variants));
  } catch (error) {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
    res.status(200).send(createFeedXml([], []));
  }
};

module.exports.createFeedXml = createFeedXml;
