(function (root) {
  const PAGE_SIZE = 400;
  const MAX_ROWS = 20000;

  async function fetchAll(input, options = {}) {
    const url = new URL(input, root.location?.href);
    if ((options.method || 'GET').toUpperCase() !== 'GET' ||
        !/\/rest\/v1\/(produtos|produto_variantes)$/.test(url.pathname)) {
      throw new Error('Consulta de catálogo inválida.');
    }
    if (url.searchParams.has('limit')) return root.fetch(url.href, options);

    const order = url.searchParams.get('order') || 'id.asc';
    url.searchParams.set('order', /(^|,)id\./.test(order) ? order : `${order},id.asc`);
    url.searchParams.set('limit', String(PAGE_SIZE));
    const rows = [];
    const ids = new Set();
    const signal = options.signal || AbortSignal.timeout(20000);
    const headers = new Headers(options.headers);
    headers.set('Prefer', 'count=exact');
    let expectedTotal = null;
    for (let offset = 0; ;) {
      url.searchParams.set('offset', String(offset));
      const response = await root.fetch(url.href, { ...options, headers, signal });
      if (!response.ok) return response;
      const page = await response.json();
      if (!Array.isArray(page)) throw new Error('Resposta de catálogo inválida.');
      const totalMatch = response.headers.get('Content-Range')?.match(/\/(\d+)$/);
      const total = totalMatch ? Number(totalMatch[1]) : null;
      if (total !== null) {
        if (expectedTotal !== null && total !== expectedTotal) throw new Error('O catálogo mudou durante a consulta. Tente novamente.');
        expectedTotal = total;
      }
      for (const row of page) {
        const id = Number(row?.id);
        if (!Number.isSafeInteger(id) || id <= 0 || ids.has(id)) {
          throw new Error('O catálogo mudou durante a consulta. Tente novamente.');
        }
        ids.add(id);
        rows.push(row);
      }
      if (rows.length > MAX_ROWS || expectedTotal > MAX_ROWS) throw new Error('Consulta de catálogo muito grande.');
      if (expectedTotal !== null ? rows.length >= expectedTotal : page.length < PAGE_SIZE) {
        return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (!page.length) throw new Error('Consulta de catálogo incompleta.');
      offset += page.length;
    }
  }

  root.RStreetCatalogData = { fetchAll };
})(globalThis);
