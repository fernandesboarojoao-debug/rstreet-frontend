(function (root) {
  const connections = new Map();

  function ready(origin) {
    const url = new URL('/health', origin).href;
    const previous = connections.get(url);
    if (previous?.checkedAt && Date.now() - previous.checkedAt < 30000) return Promise.resolve(true);
    if (previous?.pending) return previous.pending;
    const entry = { checkedAt: 0, pending: null };
    entry.pending = (async () => {
      try {
        const response = await root.fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(80000) });
        if (!response.ok) throw new Error('Servidor indisponível.');
        const data = await response.json();
        if (data?.status !== 'ok' || data?.app !== 'R Street Backend') throw new Error('Resposta inválida.');
        entry.checkedAt = Date.now();
        return true;
      } catch {
        const error = new Error('Não foi possível conectar à loja agora. Nenhum novo pagamento foi enviado por esta tentativa. Aguarde e tente novamente nesta página.');
        error.code = 'BACKEND_UNAVAILABLE';
        throw error;
      } finally {
        entry.pending = null;
      }
    })();
    connections.set(url, entry);
    return entry.pending;
  }

  root.RStreetBackendConnection = { ready };
})(globalThis);
