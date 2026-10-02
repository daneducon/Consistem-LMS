// Módulo compartilhado de acesso à API Hotscool.
// Centraliza catálogos, paginação, cache por escola (SWR), concorrência e retry.
// Nenhuma função daqui altera protocolo/payload da Hotscool — só o envoltório.

export const HOTSCOOL_API_URL = 'https://api.hotscool.com/v1';

const CACHE_TTL_MS = 10 * 60 * 1000; // fresco: serve direto
const CACHE_STALE_MS = 30 * 60 * 1000; // velho: serve + revalida em fundo (SWR)

const studentsCache = new Map();
const coursesCache = new Map();
const packagesCache = new Map();
const schoolNamesCache = new Map();
const pendingRefreshes = new Set();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function hotscoolConcurrency() {
  const raw = Number(process.env.HOTSCOOL_CONCURRENCY ?? 4);
  if (!Number.isSafeInteger(raw)) return 4;
  return Math.min(8, Math.max(1, raw));
}

// GET/HEAD repetem em 429/5xx; POST/PUT só em timeout/rede ou 429,
// para nunca duplicar uma escrita por retry em erro de servidor.
export async function fetchWithTimeout(url, options = {}, { retries = 2, backoffMs = 400 } = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const retryableStatus = (status) => status === 429 || ((method === 'GET' || method === 'HEAD') && status >= 500);
  let attempt = 0;
  for (;;) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      });
      if (retryableStatus(response.status) && attempt < retries) {
        const retryAfter = Number(response.headers?.get?.('retry-after'));
        await sleep(Math.min(Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : backoffMs * 2 ** attempt, 5000));
        attempt += 1;
        continue;
      }
      return response;
    } catch (error) {
      const retryableError = error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.code;
      if (retryableError && attempt < retries) {
        await sleep(backoffMs * 2 ** attempt);
        attempt += 1;
        continue;
      }
      throw error;
    }
  }
}

// Executa fn sobre items com no máximo `limit` promessas simultâneas,
// preservando a ordem dos resultados (results[i] corresponde a items[i]).
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  if (workerCount === 0) return results;
  const workers = Array.from({ length: workerCount }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function getCachedOrFetch(cache, key, fetcher, { forceRefresh = false } = {}) {
  const now = Date.now();
  const cached = cache.get(key);
  if (!forceRefresh && cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }
  if (!forceRefresh && cached && now - cached.timestamp < CACHE_STALE_MS) {
    refreshInBackground(cache, key, fetcher);
    return cached.data;
  }
  const data = await fetcher();
  cache.set(key, { data, timestamp: Date.now() });
  return data;
}

function refreshInBackground(cache, key, fetcher) {
  if (pendingRefreshes.has(key)) return;
  pendingRefreshes.add(key);
  fetcher()
    .then((data) => cache.set(key, { data, timestamp: Date.now() }))
    .catch(() => {})
    .finally(() => pendingRefreshes.delete(key));
}

// Invalida só a escola alterada (antes: clear global). Chave é a apiKey,
// nunca exposta ao cliente — vive apenas na memória do servidor.
export function invalidateSchoolCache(apiKey) {
  studentsCache.delete(apiKey);
  coursesCache.delete(apiKey);
  packagesCache.delete(apiKey);
  schoolNamesCache.delete(apiKey);
}

export function clearAllCaches() {
  studentsCache.clear();
  coursesCache.clear();
  packagesCache.clear();
  schoolNamesCache.clear();
}

/**
 * Obtém as chaves de API das escolas e seus nomes identificadores
 */
export function getSchools() {
  const schools = [];

  // 1. Chaves indexadas: HOTSCOOL_API_KEY_1, HOTSCOOL_API_KEY_2, etc.
  const envKeys = Object.keys(process.env).filter((k) =>
    /^HOTSCOOL_API_KEY_\d+$/i.test(k)
  );
  envKeys.sort((a, b) => Number(a.match(/\d+$/)[0]) - Number(b.match(/\d+$/)[0]));

  envKeys.forEach((k) => {
    const val = process.env[k]?.trim();
    if (val) {
      const id = Number(k.match(/\d+$/)[0]) - 1;
      schools.push({
        id,
        name: `Escola ${id + 1}`,
        apiKey: val,
      });
    }
  });

  // 2. Chaves separadas por vírgula em HOTSCOOL_API_KEYS
  if (schools.length === 0 && process.env.HOTSCOOL_API_KEYS) {
    process.env.HOTSCOOL_API_KEYS.split(',').forEach((k, idx) => {
      const val = k.trim();
      if (val) {
        schools.push({
          id: idx,
          name: `Escola ${idx + 1}`,
          apiKey: val,
        });
      }
    });
  }

  // 3. Fallback para HOTSCOOL_API_KEY única
  if (schools.length === 0 && process.env.HOTSCOOL_API_KEY) {
    const val = process.env.HOTSCOOL_API_KEY.trim();
    if (val) {
      schools.push({
        id: 0,
        name: 'Escola Principal',
        apiKey: val,
      });
    }
  }

  return schools;
}

async function fetchAllStudents(apiKey) {
  const allStudents = [];
  let page = 0;
  let hasMore = true;
  const BATCH_SIZE = 6;

  while (hasMore && page < 60) {
    const batchPages = Array.from({ length: BATCH_SIZE }, (_, i) => page + i);
    const fetchPromises = batchPages.map(async (p) => {
      try {
        const response = await fetchWithTimeout(`${HOTSCOOL_API_URL}/students/all/${p}`, {
          method: 'GET',
          headers: {
            'x-access-token': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        });

        if (!response.ok) {
          return { page: p, ok: false, data: [] };
        }

        const data = await response.json();
        const list = Array.isArray(data) ? data : (data?.data || []);
        return { page: p, ok: true, data: Array.isArray(list) ? list : [] };
      } catch (err) {
        return { page: p, ok: false, data: [] };
      }
    });

    const results = await Promise.all(fetchPromises);
    results.sort((a, b) => a.page - b.page);

    for (const res of results) {
      if (!res.ok || res.data.length === 0) {
        hasMore = false;
        break;
      }
      allStudents.push(...res.data);
      if (res.data.length < 25) {
        hasMore = false;
        break;
      }
    }

    page += BATCH_SIZE;
  }

  return allStudents;
}

export async function fetchStudentsFromSchool(apiKey, forceRefresh = false) {
  return getCachedOrFetch(studentsCache, apiKey, () => fetchAllStudents(apiKey), { forceRefresh });
}

/**
 * Busca o nome real da escola na API da Hotscool
 */
export async function fetchSchoolName(apiKey) {
  return getCachedOrFetch(schoolNamesCache, apiKey, async () => {
    try {
      // Tenta buscar informações da escola através de um aluno aleatório
      const response = await fetchWithTimeout(`${HOTSCOOL_API_URL}/students/all/0`, {
        method: 'GET',
        headers: {
          'x-access-token': apiKey,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        const list = Array.isArray(data) ? data : (data?.data || []);

        if (list.length > 0 && list[0].escola) {
          return list[0].escola;
        }
      }
    } catch (err) {
      // Fallback para nome genérico
    }

    return null;
  });
}

/**
 * Busca todos os cursos de uma escola com paginação paralela e cache
 */
export async function fetchCoursesFromSchool(apiKey, forceRefresh = false) {
  return getCachedOrFetch(coursesCache, apiKey, async () => {
    const allCourses = [];
    let page = 0;
    let hasMore = true;
    const BATCH_SIZE = 6;

    while (hasMore && page < 60) {
      const batchPages = Array.from({ length: BATCH_SIZE }, (_, i) => page + i);
      const fetchPromises = batchPages.map(async (p) => {
        try {
          const response = await fetchWithTimeout(`${HOTSCOOL_API_URL}/courses/all/${p}`, {
            method: 'GET',
            headers: {
              'x-access-token': apiKey,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
          });

          if (!response.ok) {
            return { page: p, ok: false, data: [] };
          }

          const data = await response.json();
          const list = Array.isArray(data) ? data : (data?.data || []);
          return { page: p, ok: true, data: Array.isArray(list) ? list : [] };
        } catch (err) {
          return { page: p, ok: false, data: [] };
        }
      });

      const results = await Promise.all(fetchPromises);
      results.sort((a, b) => a.page - b.page);

      for (const res of results) {
        if (!res.ok || res.data.length === 0) {
          hasMore = false;
          break;
        }
        allCourses.push(...res.data);
        if (res.data.length < 25) {
          hasMore = false;
          break;
        }
      }

      page += BATCH_SIZE;
    }

    // Mapeia e formata os cursos
    return allCourses.flatMap((c) => {
      const id = Number(c.id);
      if (!Number.isSafeInteger(id) || id <= 0) return [];
      return [{
        id,
        nome: String(c.nome || c.titulo || 'Curso sem título').slice(0, 300),
        descricao: String(c.descricao || '').slice(0, 5000),
        categoria: String(c.categoria || 'Geral').slice(0, 200),
        duracao: c.duracao_curso == null ? null : String(c.duracao_curso).slice(0, 40),
        imagem: typeof c.imagem === 'string' ? c.imagem : null,
        status: String(c.status || 'Ativo').slice(0, 40),
      }];
    });
  }, { forceRefresh });
}

export async function fetchPackagesFromSchool(apiKey, forceRefresh = false) {
  return getCachedOrFetch(packagesCache, apiKey, async () => {
    const candidates = [];
    // Tenta endpoint oficial e variações paginadas/legadas para cobrir todos os pacotes/trilhas
    const urls = [
      `${HOTSCOOL_API_URL}/packages`,
      `${HOTSCOOL_API_URL}/packages/all/0`,
      `${HOTSCOOL_API_URL}/packages/all/1`,
    ];
    for (const url of urls) {
      try {
        const response = await fetchWithTimeout(url, {
          method: 'GET',
          headers: {
            'x-access-token': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        });
        if (!response.ok) continue;
        const data = await response.json();
        // Hotscool varia formato: array direto, {data:[]}, {packages:[]}, {result:[]}
        const raw = Array.isArray(data) ? data : (data?.data || data?.packages || data?.result || data?.items || []);
        const list = Array.isArray(raw) ? raw : [];
        if (list.length > 0) {
          candidates.push(...list);
        }
        // Se já pegou do /packages sem paginação, não precisa continuar se retornou <25
        if (url === `${HOTSCOOL_API_URL}/packages` && list.length > 0) break;
      } catch {}
    }
    // Deduplica por id
    const uniqMap = new Map();
    for (const p of candidates) {
      const id = Number(p.id);
      if (!Number.isSafeInteger(id) || id <= 0) continue;
      if (!uniqMap.has(id)) uniqMap.set(id, p);
    }
    const list = Array.from(uniqMap.values());
    if (list.length === 0) {
      // Fallback: tenta decodificar resposta bruta como array mesmo se candidatos vazios
      try {
        const r = await fetchWithTimeout(`${HOTSCOOL_API_URL}/packages`, {
          method: 'GET', headers: { 'x-access-token': apiKey, 'Accept': 'application/json' },
        });
        if (r.ok) {
          const j = await r.json();
          console.log('[Packages] raw keys:', Object.keys(j || {}), 'isArray:', Array.isArray(j), 'len:', Array.isArray(j) ? j.length : (j?.data?.length || 0));
        }
      } catch {}
    } else {
      console.log(`[Packages] fetched ${list.length} packages:`, list.map((p) => `${p.id}:${p.nome}`).join(' | '));
    }
    return list.map((p) => ({
      id: Number(p.id),
      nome: String(p.nome || p.titulo || 'Pacote sem título').slice(0, 300),
      // Decodifica entidades HTML da descrição (ex: &lt;p&gt; -> <p>)
      descricao: String(p.descricao || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").slice(0, 5000),
      status: String(p.status || 'Ativo').slice(0, 40),
      cursos: Array.isArray(p.cursos) ? p.cursos.map((c) => ({
        id: Number(c.id || c.id_curso),
        nome: String(c.nome || c.titulo_curso || '').slice(0, 300),
      })).filter((c) => Number.isSafeInteger(c.id)) : [],
      escola: p.escola || null,
    })).filter((p) => Number.isSafeInteger(p.id) && p.id > 0);
  }, { forceRefresh });
}

export async function fetchPackagesFromAllSchools(apiKeys) {
  const all = [];
  const seen = new Set();
  for (const key of apiKeys) {
    const pkgs = await fetchPackagesFromSchool(key);
    for (const p of pkgs) {
      if (!seen.has(p.id)) { seen.add(p.id); all.push(p); }
    }
  }
  return all;
}
