module.exports = function handler(req, res) {
  const configuredGaId = process.env.GA_MEASUREMENT_ID || 'G-3SYFYVF3DH';
  const gaMeasurementId = /^G-[A-Z0-9]+$/i.test(String(configuredGaId))
    ? configuredGaId.toUpperCase()
    : '';
  const configuredMetaId = process.env.META_PIXEL_ID ?? '4131579330474916';
  const metaPixelId = /^\d{5,25}$/.test(String(configuredMetaId))
    ? String(configuredMetaId)
    : '';

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  res.status(200).json({ gaMeasurementId, metaPixelId });
};
