const rateLimitBuckets = new Map();

function isValidIpToken(value) {
  if (!value || value.length > 45) return false;
  if (!/^[0-9a-fA-F:.]+$/.test(value)) return false;
  return /[0-9]/.test(value);
}

function trustedProxyHops() {
  const raw = process.env.TRUST_PROXY_HOPS ?? (process.env.VERCEL ? '1' : '0');
  const hops = Number(raw);
  return Number.isSafeInteger(hops) && hops >= 0 ? hops : 0;
}

// X-Forwarded-For é controlado pelo cliente: só confiamos nele quando há um
// proxy confiável (ex.: edge da Vercel) que anexa o IP real ao final da cadeia.
// Com TRUST_PROXY_HOPS=0 (dev local) o header é ignorado e vale o socket.
export function clientAddress(req) {
  const socketAddr = req.socket?.remoteAddress || 'unknown';
  const hops = trustedProxyHops();
  if (hops === 0) return socketAddr;

  const realIp = String(req.headers['x-real-ip'] || '').trim();
  if (realIp && isValidIpToken(realIp)) return realIp;

  const chain = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((part) => part.trim())
    .filter(isValidIpToken);
  if (chain.length === 0) return socketAddr;
  return chain[Math.min(Math.max(0, chain.length - hops), chain.length - 1)];
}

function getAllowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function applyRateLimit(req, res, { name, identity, max, windowMs }) {
  const now = Date.now();
  if (rateLimitBuckets.size > 10_000) {
    for (const [bucketKey, bucketValue] of rateLimitBuckets) {
      if (bucketValue.resetAt <= now) rateLimitBuckets.delete(bucketKey);
    }
  }
  const key = `${name}:${identity || clientAddress(req)}`;
  const current = rateLimitBuckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : current;

  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);
  res.setHeader('X-RateLimit-Limit', String(max));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));

  if (bucket.count > max) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
    res.status(429).json({ error: 'Muitas requisições. Tente novamente mais tarde.' });
    return false;
  }
  return true;
}

export function requireTrustedJsonRequest(req, res) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    res.status(415).json({ error: 'Use Content-Type application/json.' });
    return false;
  }

  const allowedOrigins = getAllowedOrigins();
  const origin = req.headers.origin;

  if (allowedOrigins.length === 0) {
    res.status(503).json({ error: 'Origens confiáveis não configuradas.' });
    return false;
  }
  if (!origin || !allowedOrigins.includes(origin)) {
    res.status(403).json({ error: 'Origem não autorizada.' });
    return false;
  }
  return true;
}

// Defesa CSRF para GETs autenticados que retornam PII (student/courses/session).
// Fetch same-origin em geral não envia `Origin` no GET, então aceitamos
// `Sec-Fetch-Site: same-origin/same-site` e `Referer` da allowlist como prova.
// Requisições sem nenhum desses sinais (curl, navegação direta) passam —
// um atacante cross-site não consegue ler a resposta mesmo assim (CORS).
export function requireTrustedGetRequest(req, res) {
  const allowedOrigins = getAllowedOrigins();
  if (allowedOrigins.length === 0) {
    res.status(503).json({ error: 'Origens confiáveis não configuradas.' });
    return false;
  }

  const origin = req.headers.origin;
  if (origin) {
    if (!allowedOrigins.includes(origin)) {
      res.status(403).json({ error: 'Origem não autorizada.' });
      return false;
    }
    return true;
  }

  const referer = req.headers.referer || req.headers.referrer;
  if (referer) {
    try {
      const refererOrigin = new URL(String(referer)).origin;
      if (!allowedOrigins.includes(refererOrigin)) {
        res.status(403).json({ error: 'Origem não autorizada.' });
        return false;
      }
      return true;
    } catch {
      res.status(403).json({ error: 'Origem não autorizada.' });
      return false;
    }
  }

  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') {
    res.status(403).json({ error: 'Origem não autorizada.' });
    return false;
  }
  return true;
}
