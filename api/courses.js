import { filterAuthorizedSchools, requirePermission } from './auth-utils.js';
import { applyRateLimit } from './security.js';

const HOTSCOOL_API_URL = 'https://api.hotscool.com/v1';
const fetchWithTimeout = (url, options = {}) => fetch(url, {
  ...options,
  signal: AbortSignal.timeout(10_000),
});

// Cache em memória para os cursos de cada escola (TTL de 10 minutos)
const coursesCache = new Map();
const packagesCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

// Cache para nomes das escolas
const schoolNamesCache = new Map();

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

/**
 * Busca o nome real da escola na API da Hotscool
 */
export async function fetchSchoolName(apiKey) {
  const cached = schoolNamesCache.get(apiKey);
  const now = Date.now();

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.name;
  }

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
        const schoolName = list[0].escola;
        schoolNamesCache.set(apiKey, { name: schoolName, timestamp: now });
        return schoolName;
      }
    }
  } catch (err) {
    // Fallback para nome genérico
  }

  return null;
}

/**
 * Busca todos os cursos de uma escola com paginação paralela e cache
 */
export async function fetchCoursesFromSchool(apiKey) {
  const cached = coursesCache.get(apiKey);
  const now = Date.now();

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.courses;
  }

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
  const formatted = allCourses.flatMap((c) => {
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

  coursesCache.set(apiKey, { courses: formatted, timestamp: now });
  return formatted;
}

export async function fetchPackagesFromSchool(apiKey) {
  const cached = packagesCache.get(apiKey);
  const now = Date.now();
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.packages;
  }
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
  const formatted = list.map((p) => ({
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
  packagesCache.set(apiKey, { packages: formatted, timestamp: now });
  return formatted;
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

export default async function handler(req, res) {
  const authenticatedUser = await requirePermission(req, res, 'courses:read');
  if (!authenticatedUser) return;
  if (!applyRateLimit(req, res, {
    name: 'courses', identity: authenticatedUser.id, max: 60, windowMs: 60_000,
  })) return;

  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  try {
    const schools = filterAuthorizedSchools(getSchools(), authenticatedUser);

    if (schools.length === 0) {
      return res.status(500).json({
        error: 'Nenhuma chave de API configurada no .env',
      });
    }

    const { schoolIndex, packages: packagesQuery } = req.query;

    // Se schoolIndex não for passado ou for 'all', retorna a lista de escolas com nomes reais
    if (schoolIndex === undefined || schoolIndex === '') {
      const schoolsWithNames = await Promise.all(
        schools.map(async (s) => {
          const realName = await fetchSchoolName(s.apiKey);
          return {
            id: s.id,
            name: realName || s.name,
          };
        })
      );
      return res.status(200).json({
        schools: schoolsWithNames,
      });
    }

    if (!/^\d+$/.test(String(schoolIndex))) {
      return res.status(400).json({ error: 'Escola inválida.' });
    }
    const idx = Number(schoolIndex);
    const targetSchool = schools.find((school) => school.id === idx);

    if (!targetSchool) {
      return res.status(404).json({ error: 'Escola não encontrada.' });
    }

    const courses = await fetchCoursesFromSchool(targetSchool.apiKey);
    const realSchoolName = await fetchSchoolName(targetSchool.apiKey);

    // Suporte a trilhas/packages: ?packages=1
    if (packagesQuery === '1' || packagesQuery === 'true') {
      const packages = await fetchPackagesFromSchool(targetSchool.apiKey);
      return res.status(200).json({
        school: { id: targetSchool.id, name: realSchoolName || targetSchool.name },
        courses,
        packages,
        total: courses.length,
        totalPackages: packages.length,
      });
    }

    return res.status(200).json({
      school: { id: targetSchool.id, name: realSchoolName || targetSchool.name },
      courses: courses,
      total: courses.length,
    });
  } catch (error) {
    console.error('❌ Erro ao buscar cursos:', error);
    return res.status(500).json({ error: 'Erro interno ao carregar cursos.' });
  }
}
