module.exports = function handler(req, res) {
  const gaMeasurementId = /^G-[A-Z0-9]+$/i.test(String(process.env.GA_MEASUREMENT_ID || ''))
    ? process.env.GA_MEASUREMENT_ID
    : '';
  const metaPixelId = /^\d{5,30}$/.test(String(process.env.META_PIXEL_ID || ''))
    ? process.env.META_PIXEL_ID
    : '';

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  res.status(200).json({ gaMeasurementId, metaPixelId });
};
