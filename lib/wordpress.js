// Módulo de acesso à API REST do WordPress (site Colab — BuddyBoss Platform).
// Lê o perfil do colaborador: Cargo/Função, Área de Negócio e Times
// (Departamentos/Squad = "Times" no BuddyBoss). Somente leitura.
//
// Vínculo com o aluno da Hotscool é feito pelo E-MAIL, mas o endpoint do WP
// que expõe e-mail (/wp/v2/users) exige papel de administrador (list_users).
// Sem essa credencial, o match cai para a HEURÍSTICA DE USERNAME: o
// user_login do WP costuma ser igual ao prefixo do e-mail
// (danilo.lopes@consistem.com.br -> user_login "danilo.lopes").
// Se WP_API_USER for administrador, o caminho exato é usado primeiro.
//
// Endpoints usados:
//   GET /wp/v2/users?search=<email>&context=edit   → e-mail -> ID (só admin)
//   GET /buddyboss/v1/members?per_page=100&page=N  → perfis (cargo/área)
//   GET /buddyboss/v1/groups?per_page=100          → times (id, nome, tipo)
//   GET /buddyboss/v1/groups/<id>/members           → membership por time
//
// Credenciais: Application Password do WP em WP_SITE_URL / WP_API_USER /
// WP_APP_PASSWORD. Nunca expostas ao cliente — vivem só no servidor.

import { fetchWithTimeout, mapWithConcurrency } from './hotscool.js';

const PROFILE_TTL_MS = 10 * 60 * 1000; // fresco: serve direto
const DIRECTORY_TTL_MS = 60 * 60 * 1000; // diretório (membros/times mudam raro)

const emailCache = new Map(); // perfil unitário por e-mail
let directoryCache = null; // { timestamp, byLogin, byEmail }

// IDs fixos dos campos de perfil BuddyBoss do site colab.consistem.com.br.
// Documentados em GET /wp-json/buddyboss/v1/xprofile/fields.
const FIELD_NOME = '1';
const FIELD_SOBRENOME = '2';
const FIELD_USUARIO_COLAB = '3'; // "Usuário Colab" (outro candidato a login)
const FIELD_CARGO = '27'; // selectbox "Cargo/Função"
const FIELD_AREA = '18'; // multiselectbox "Área de Negócio"

const PAGE_SIZE = 100;

export function isWordPressConfigured() {
  return Boolean(
    process.env.WP_SITE_URL?.trim()
    && process.env.WP_API_USER?.trim()
    && process.env.WP_APP_PASSWORD?.trim()
  );
}

function wpBaseUrl() {
  const raw = (process.env.WP_SITE_URL || '').trim().replace(/\/+$/, '');
  return raw ? `${raw}/wp-json` : '';
}

// Application Passwords do WP são geradas com espaços ("xxxx xxxx xxxx");
// normalizamos para garantir compatibilidade com Basic Auth.
function wpAuthHeader() {
  const user = process.env.WP_API_USER.trim();
  const password = process.env.WP_APP_PASSWORD.replace(/\s+/g, '');
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

export async function wpFetch(path, { retries = 2 } = {}) {
  if (!isWordPressConfigured()) {
    const error = new Error('WordPress não configurado (WP_SITE_URL, WP_API_USER, WP_APP_PASSWORD).');
    error.code = 'WP_NOT_CONFIGURED';
    throw error;
  }
  const url = `${wpBaseUrl()}${path}`;
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      'Authorization': wpAuthHeader(),
      'Accept': 'application/json',
    },
    timeoutMs: 10_000,
  }, { retries, backoffMs: 400 });

  if (!response.ok) {
    const error = new Error(`WordPress respondeu ${response.status} em ${path}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

// Pagina um endpoint de coleção. A primeira página é buscada sozinha (descobre
// se há mais); as seguintes em lotes paralelos — o WP custa ~1-2s por página.
async function wpFetchAllPages(path, { maxPages = 20, batchSize = 5 } = {}) {
  const items = [];
  const separator = path.includes('?') ? '&' : '?';
  let page = 1;
  let primeira = true;
  while (page <= maxPages) {
    const limite = page + (primeira ? 1 : batchSize);
    const fatia = [];
    for (let p = page; p < limite && p <= maxPages; p += 1) fatia.push(p);
    const resultados = await Promise.all(fatia.map((p) =>
      wpFetch(`${path}${separator}per_page=${PAGE_SIZE}&page=${p}`)
        .then((batch) => (Array.isArray(batch) ? batch : []))
        .catch((error) => {
          // WP responde 400 (número de página inválido) ao passar da última —
          // é o fim natural da coleção, não uma falha.
          if (p === 1) throw error;
          return [];
        })
    ));
    let acabou = false;
    for (const batch of resultados) {
      items.push(...batch);
      // Só a página VAZIA encerra: o BuddyBoss devolve páginas curtas que não
      // são a última (ex.: 99 itens na página 1 e mais 97 na 2), então a regra
      // "página menor que o tamanho máximo = fim" perdia metade dos membros.
      if (batch.length === 0) {
        acabou = true;
        break;
      }
    }
    if (acabou) break;
    page += fatia.length;
    primeira = false;
  }
  return items;
}

export function clearWordPressCache() {
  emailCache.clear();
  directoryCache = null;
}

function firstValue(fieldValue) {
  if (fieldValue == null) return '';
  if (typeof fieldValue === 'object') {
    const raw = fieldValue.raw;
    if (Array.isArray(raw)) return String(raw[0] ?? '').trim();
    if (raw != null) return String(raw).trim();
    const unserialized = fieldValue.unserialized;
    if (Array.isArray(unserialized)) return String(unserialized[0] ?? '').trim();
    if (unserialized != null && typeof unserialized === 'object') {
      return Object.values(unserialized).filter(Boolean).join(', ');
    }
    return '';
  }
  return String(fieldValue).trim();
}

function allValues(fieldValue) {
  if (fieldValue == null) return [];
  if (typeof fieldValue === 'object') {
    const unserialized = fieldValue.unserialized;
    if (Array.isArray(unserialized)) return unserialized.map((v) => String(v).trim()).filter(Boolean);
    const raw = fieldValue.raw;
    if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
    if (raw != null && String(raw).trim()) return [String(raw).trim()];
    return [];
  }
  const text = String(fieldValue).trim();
  return text ? [text] : [];
}

function readProfileField(member, fieldId) {
  const groups = member?.xprofile?.groups || {};
  for (const group of Object.values(groups)) {
    const field = group?.fields?.[fieldId];
    if (field) return firstValue(field.value);
  }
  return '';
}

function readProfileFieldValues(member, fieldId) {
  const groups = member?.xprofile?.groups || {};
  for (const group of Object.values(groups)) {
    const field = group?.fields?.[fieldId];
    if (field) return allValues(field.value);
  }
  return [];
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// Gera os user_login candidatos a partir do e-mail.
// Ex.: ana.borba@consistem.com.br -> ["ana.borba", "ana-borba"]
function loginCandidatesFromEmail(email) {
  const prefix = normalizeEmail(email).split('@')[0];
  if (!prefix) return [];
  const candidates = new Set([prefix]);
  if (prefix.includes('.')) candidates.add(prefix.replace(/\./g, '-'));
  if (prefix.includes('-')) candidates.add(prefix.replace(/-/g, '.'));
  return [...candidates].filter(Boolean);
}

// Monta o objeto devolvido ao cliente a partir de um membro BuddyBoss.
function buildProfile(member, { equipes = [], found = true, email = '' } = {}) {
  const nome = [readProfileField(member, FIELD_NOME), readProfileField(member, FIELD_SOBRENOME)]
    .filter(Boolean)
    .join(' ') || member?.name || '';
  const area = readProfileFieldValues(member, FIELD_AREA);

  return {
    found,
    email,
    wpUserId: member?.id ?? null,
    userLogin: member?.user_login || '',
    nome,
    cargo: readProfileField(member, FIELD_CARGO),
    // Área de Negócio é multiselect — pode haver mais de uma função.
    funcoes: area,
    areaNegocio: area.join(', '),
    equipes: equipes.map((group) => group.nome),
    equipesDetalhe: equipes,
    equipeDepartamento: equipes.find((group) => group.tipo === 'Departamento')?.nome || '',
    tipoMembro: Object.keys(member?.member_types || {})[0] || '',
    avatar: member?.avatar_urls?.full || '',
  };
}

/**
 * Caminho exato: resolve e-mail -> user ID via /wp/v2/users.
 * Exige usuário WP com list_users (administrador); devolve null em 403.
 */
async function findUserIdByEmailExact(email) {
  try {
    const users = await wpFetch(
      `/wp/v2/users?context=edit&per_page=20&search=${encodeURIComponent(email)}`
    );
    const match = (Array.isArray(users) ? users : []).find(
      (user) => normalizeEmail(user.email) === email
    );
    return match ? Number(match.id) : null;
  } catch (error) {
    if (error?.status === 403 || error?.status === 401) return null; // sem list_users
    throw error;
  }
}

/**
 * Diretório completo de membros: perfis + times, indexado por user_login
 * e por "Usuário Colab". Base da heurística de username e do lote.
 */
async function getDirectory({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && directoryCache && now - directoryCache.timestamp < DIRECTORY_TTL_MS) {
    return directoryCache.data;
  }

  // Lista de grupos primeiro (rápido); em seguida as três caminhadas em
  // paralelo — a de membros dos grupos costuma ser a mais demorada e passa a
  // correr junto com a de membros e a de usuários.
  const groupsRaw = await wpFetch('/buddyboss/v1/groups?per_page=100');

  const groups = (Array.isArray(groupsRaw) ? groupsRaw : [])
    .filter((group) => group?.id)
    .map((group) => ({
      id: Number(group.id),
      nome: group.name || '',
      tipo: group.group_type_label || group.types?.[0] || '',
    }))
    .filter((group) => group.nome);

  const groupsById = new Map(groups.map((group) => [group.id, group]));

  // Membros de cada time (Departamento/Squad) — parallel com teto de 8.
  const memberships = new Map(); // userId -> equipe[]
  let index = 0;
  const walkGroupMembers = async () => {
    const workers = Array.from({ length: 8 }, async () => {
      while (index < groups.length) {
        const current = index;
        index += 1;
        const group = groupsById.get(groups[current].id);
        try {
          const members = await wpFetch(
            `/buddyboss/v1/groups/${group.id}/members?per_page=100`
          );
          for (const member of Array.isArray(members) ? members : []) {
            const userId = Number(member?.id);
            if (!Number.isFinite(userId)) continue;
            const list = memberships.get(userId) || [];
            list.push({ nome: group.nome, tipo: group.tipo });
            memberships.set(userId, list);
          }
        } catch {
          // Grupo privado/removido: segue sem interromper o diretório.
        }
      }
    });
    await Promise.all(workers);
  };

  // A de usuários monta o índice e-mail -> ID que o lote usa (substitui uma
  // busca individual por aluno, que custava ~2s cada); _fields=id,email
  // enxuga a resposta (context=edit sem isso é o mais lento: ~1,5s/página).
  const [, members, users] = await Promise.all([
    walkGroupMembers(),
    wpFetchAllPages('/buddyboss/v1/members'),
    wpFetchAllPages('/wp/v2/users?context=edit&_fields=id,email').catch(() => []),
  ]);

  const byLogin = new Map();
  const byId = new Map();
  for (const member of members) {
    if (!member?.id) continue;
    const equipes = memberships.get(Number(member.id)) || [];
    const profile = buildProfile(member, { equipes, email: '' });
    profile.userLogin = member.user_login || '';
    byId.set(Number(member.id), profile);
    const login = String(member.user_login || '').toLowerCase();
    if (login) byLogin.set(login, profile);
    const colab = readProfileField(member, FIELD_USUARIO_COLAB).toLowerCase();
    if (colab && !byLogin.has(colab)) byLogin.set(colab, profile);
  }

  // e-mail -> user ID (caminho exato, exige list_users): uma única caminhada
  // paginada resolve todos os e-mails do lote em memória.
  const byEmail = new Map();
  for (const user of users) {
    const email = normalizeEmail(user?.email);
    if (email && !byEmail.has(email)) byEmail.set(email, Number(user.id));
  }

  const data = { byLogin, byId, byEmail, groups, memberships };
  if (!forceRefresh) directoryCache = { data, timestamp: Date.now() };
  return data;
}

// Heurística: casa o e-mail com o user_login (ou "Usuário Colab") do WP.
function lookupByEmailHeuristic(email, directory) {
  for (const candidate of loginCandidatesFromEmail(email)) {
    const profile = directory.byLogin.get(candidate.toLowerCase());
    if (profile) return profile;
  }
  return null;
}

function cacheProfile(email, profile) {
  emailCache.set(email, { data: profile, timestamp: Date.now() });
  return profile;
}

/**
 * Busca o perfil do colaborador no WordPress pelo e-mail do aluno.
 *
 * Ordem: e-mail exato (admin) -> heurística de username (diretório).
 * Sem correspondência devolve { found: false } — nunca lança por "não achar".
 *
 * @param {string} email e-mail do aluno (vínculo com a Hotscool)
 */
export async function getWordPressProfileByEmail(email) {
  const cleanEmail = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    const error = new Error('E-mail inválido.');
    error.code = 'INVALID_EMAIL';
    throw error;
  }

  const cached = emailCache.get(cleanEmail);
  if (cached && Date.now() - cached.timestamp < PROFILE_TTL_MS) {
    return cached.data;
  }

  // Diretório já montado (ex.: após um relatório)? Resolve em memória.
  if (directoryCache && Date.now() - directoryCache.timestamp < DIRECTORY_TTL_MS) {
    const id = directoryCache.data.byEmail?.get(cleanEmail);
    const found = (id ? directoryCache.data.byId.get(Number(id)) : null)
      || lookupByEmailHeuristic(cleanEmail, directoryCache.data);
    if (found) return cacheProfile(cleanEmail, { ...found, found: true, email: cleanEmail });
  }

  const exactId = await findUserIdByEmailExact(cleanEmail);
  if (exactId) {
    const [member, groups] = await Promise.all([
      wpFetch(`/buddyboss/v1/members/${exactId}`),
      wpFetch(`/buddyboss/v1/groups?user_id=${exactId}&per_page=100`).catch(() => []),
    ]);
    const equipes = (Array.isArray(groups) ? groups : [])
      .map((group) => ({
        nome: group?.name || '',
        tipo: group?.group_type_label || group?.types?.[0] || '',
      }))
      .filter((group) => group.nome);
    return cacheProfile(cleanEmail, buildProfile(member, { equipes, email: cleanEmail }));
  }

  const directory = await getDirectory();
  const found = lookupByEmailHeuristic(cleanEmail, directory);
  if (found) {
    return cacheProfile(cleanEmail, { ...found, found: true, email: cleanEmail });
  }
  return cacheProfile(cleanEmail, { found: false, email: cleanEmail });
}

/**
 * Lote: resolve vários e-mails de uma vez (tela de relatório).
 * Um único diretório para todos os e-mails — ~30 chamadas no pior caso.
 *
 * @param {string[]} emails
 * @returns {Promise<Record<string, object>>} perfil por e-mail (só os achados)
 */
export async function getWordPressProfilesByEmails(emails = []) {
  const cleanEmails = [...new Set(emails.map(normalizeEmail).filter((email) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ))].slice(0, 300);
  if (cleanEmails.length === 0) return {};

    const missing = cleanEmails.filter((email) => {
      const cached = emailCache.get(email);
      return !cached || Date.now() - cached.timestamp >= PROFILE_TTL_MS;
    });

    const result = {};
    if (missing.length > 0) {
      const directory = await getDirectory();
      const pendentes = [];
      // Passada 1: tudo que o diretório cobre — em memória, zero requests.
      for (const email of missing) {
        const exactId = directory.byEmail?.get(email) ?? null;
        if (exactId) {
          const profile = directory.byId.get(Number(exactId)) || null;
          if (profile) {
            emailCache.set(email, { data: { ...profile, found: true, email }, timestamp: Date.now() });
            continue;
          }
          // Existe no WP mas não aparece na listagem de membros do BuddyBoss.
          pendentes.push({ email, exactId });
        } else {
          const profile = lookupByEmailHeuristic(email, directory);
          emailCache.set(email, {
            data: profile ? { ...profile, found: true, email } : { found: false, email },
            timestamp: Date.now(),
          });
        }
      }
      // Passada 2: os que existem no WP mas não estão na listagem de membros.
      // GET individual por ID em paralelo (o include= do BuddyBoss intersecta
      // com o diretório e os exclui — testado: retorna 1 de 10). Os times já
      // estão no diretório (caminhada dos grupos): zero extra.
      if (pendentes.length > 0) {
        await mapWithConcurrency(pendentes, 8, async ({ email, exactId }) => {
          const member = await wpFetch(`/buddyboss/v1/members/${exactId}`).catch(() => null);
          const equipes = directory.memberships?.get(Number(exactId)) || [];
          const profile = member ? buildProfile(member, { equipes, email }) : null;
          emailCache.set(email, {
            data: profile ? { ...profile, found: true, email } : { found: false, email },
            timestamp: Date.now(),
          });
        });
      }
    }

    for (const email of cleanEmails) {
      const cached = emailCache.get(email);
      if (cached?.data?.found) result[email] = cached.data;
    }
    return result;
  }
