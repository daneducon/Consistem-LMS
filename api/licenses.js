// Dashboard de licenças e risco de vencimento.
// Definição: licença ativa = matrícula com acesso ativo (course/access = 1),
// somada sobre todos os usuários da lista geral de cada escola.
// Risco = dias restantes < 0 (janela de 30 dias da matrícula) E acesso ativo:
// deveria ter sido desfeita/bloqueada. Ação é sempre manual (1 clique).
import avaliacoesHandler from '../lib/avaliacoes.js';
import { filterAuthorizedSchools, requirePermission } from './auth-utils.js';
import { applyRateLimit, requireTrustedGetRequest } from './security.js';
import {
  HOTSCOOL_API_URL,
  fetchLeadsFromSchool,
  fetchSchoolName,
  fetchStudentsFromSchool,
  getSchools,
  hotscoolConcurrency,
  mapWithConcurrency,
} from './hotscool.js';
import { findEnrollmentDate } from './enrollment-log.js';
import { fetchCourseAccessStatus } from './student.js';

export const LICENSE_WINDOW_DAYS = 30;
const CACHE_TTL_MS = 15 * 60 * 1000;
const licensesCache = new Map();

// Persistência em disco do cache (data/, gitignored): sobrevive a restart do
// backend local/VPS. Em serverless o disco é efêmero — lá vale só o cache em memória.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DISK_CACHE_PATH = join(process.cwd(), 'data', 'licenses-cache.json');
let diskCacheLoaded = false;

function loadDiskCacheOnce() {
  if (diskCacheLoaded) return;
  diskCacheLoaded = true;
  try {
    const parsed = JSON.parse(readFileSync(DISK_CACHE_PATH, 'utf8'));
    for (const [k, v] of Object.entries(parsed || {})) {
      if (v && Date.now() - (v.timestamp || 0) < CACHE_TTL_MS) licensesCache.set(k, v);
    }
  } catch {}
}

function saveDiskCache() {
  try {
    mkdirSync(dirname(DISK_CACHE_PATH), { recursive: true });
    writeFileSync(DISK_CACHE_PATH, JSON.stringify(Object.fromEntries(licensesCache)));
  } catch {}
}

// diasRestantes = janela - dias desde a matrícula. emRisco = venceu mas ativo.
export function calcLicenseRisk({ enrolledAtISO, acessoAtivo, windowDays = LICENSE_WINDOW_DAYS, now = Date.now() }) {
  const enrolledAt = enrolledAtISO ? new Date(enrolledAtISO).getTime() : null;
  const valid = enrolledAt !== null && !Number.isNaN(enrolledAt);
  const daysSince = valid ? Math.floor((now - enrolledAt) / 86_400_000) : null;
  const daysLeft = daysSince === null ? null : windowDays - daysSince;
  return { daysSince, daysLeft: daysLeft, emRisco: daysLeft !== null && daysLeft < 0 && acessoAtivo === true };
}

// Teto global de matrículas ativas somando todas as escolas (contrato Hotscool).
export function getMaxActiveLicenses() {
  const raw = Number(process.env.HOTSCOOL_MAX_ACTIVE_ENROLLMENTS);
  return Number.isSafeInteger(raw) && raw >= 0 ? raw : 0;
}

async function computeSchoolLicenses(school, forceRefresh) {
  const cached = licensesCache.get(school.apiKey);
  if (!forceRefresh && cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }
  const [students, leads] = await Promise.all([
    fetchStudentsFromSchool(school.apiKey, forceRefresh),
    fetchLeadsFromSchool(school.apiKey, forceRefresh).catch(() => []),
  ]);
  const realName = await fetchSchoolName(school.apiKey).catch(() => null);
  const schoolName = realName || school.name;

  const enrollments = [];
  for (const s of students) {
    const cursos = Array.isArray(s.cursos_matriculados) ? s.cursos_matriculados : [];
    for (const c of cursos) {
      const courseId = Number(c.id_curso);
      if (!Number.isSafeInteger(courseId) || courseId <= 0) continue;
      enrollments.push({ student: s, courseId, titulo: c.titulo_curso || c.nome || 'Curso sem título' });
    }
  }

  const items = await mapWithConcurrency(
    enrollments,
    hotscoolConcurrency(),
    async ({ student, courseId, titulo }) => {
      const loggedAt = findEnrollmentDate(school.id, student.email, courseId);
      const enrolledAt = loggedAt || student.data_cadastro || null;
      const estimado = !loggedAt;
      let acessoAtivo = null;
      let verificado = false;
      try {
        const info = await fetchCourseAccessStatus(school.apiKey, student.id, courseId);
        const st = Number(info?.status);
        if (st === 1 || st === 2) {
          acessoAtivo = st === 1;
          verificado = true;
        }
      } catch {}
      const { daysSince, daysLeft, emRisco } = calcLicenseRisk({ enrolledAtISO: enrolledAt, acessoAtivo });
      return {
        schoolId: school.id,
        escola: schoolName,
        studentId: student.id,
        nome: student.nome || 'Nome não informado',
        email: student.email || '',
        courseId,
        titulo,
        dataMatricula: enrolledAt,
        estimado,
        diasDesdeMatricula: daysSince,
        diasRestantes: daysLeft,
        acessoAtivo,
        statusMatricula: acessoAtivo === null ? 'desconhecido' : (acessoAtivo ? 'ativo' : 'bloqueado'),
        verificado,
        emRisco,
      };
    }
  );

  const ativas = items.filter((i) => i.acessoAtivo === true).length;
  const bloqueadas = items.filter((i) => i.acessoAtivo === false).length;

  // Usuários ativos = usuários da lista geral com 1+ matrícula ativa.
  // É a definição do card "Usuários" do painel Hotscool (bate exato em 2/3 escolas).
  const activeEmails = new Set(
    items.filter((i) => i.acessoAtivo === true).map((i) => i.email)
  );

  // Segunda passada: quem não tem curso ativo pode estar ativo VIA TRILHA
  // (o painel conta; 54+20=74 na Academia fecha exato). Inclui alunos com
  // zero matrículas (ex.: só trilha) — barata porque só consulta /students/3
  // de quem zerou na primeira passada.
  const trailCheckCandidates = new Map();
  for (const i of items) {
    if (!activeEmails.has(i.email) && !trailCheckCandidates.has(i.email)) {
      trailCheckCandidates.set(i.email, i.studentId);
    }
  }
  for (const s of students) {
    const cursos = Array.isArray(s.cursos_matriculados) ? s.cursos_matriculados : [];
    const hasAny = cursos.some((c) => Number.isSafeInteger(Number(c.id_curso)) && Number(c.id_curso) > 0);
    const email = String(s.email || '').trim().toLowerCase();
    if (!hasAny && email && !activeEmails.has(email) && !trailCheckCandidates.has(email)) {
      trailCheckCandidates.set(email, s.id);
    }
  }
  const trailActiveEmails = new Set();
  await mapWithConcurrency(
    Array.from(trailCheckCandidates.entries()),
    hotscoolConcurrency(),
    async ([email, studentId]) => {
      try {
        const res = await fetch(
          `https://api.hotscool.com/v1/students/3/${studentId}`,
          { headers: { 'x-access-token': school.apiKey, 'Accept': 'application/json' } }
        );
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (Array.isArray(data?.trilhas) && data.trilhas.length > 0) {
          trailActiveEmails.add(email);
        }
      } catch {}
    }
  );
  const usuariosAtivos = new Set([...activeEmails, ...trailActiveEmails]).size;
  const usuariosTrilha = trailActiveEmails.size;
  const trailEmails = Array.from(trailActiveEmails);
  const usuariosTotal = new Set(items.map((i) => i.email)).size;

  // Usuários na base sem nenhum vínculo (matrícula ou trilha): leads que nunca
  // viraram aluno + alunos que tiveram tudo desfeito e não têm trilha.
  const enrolledEmails = new Set(
    students.flatMap((s) => {
      const cursos = Array.isArray(s.cursos_matriculados) ? s.cursos_matriculados : [];
      const hasAny = cursos.some((c) => Number.isSafeInteger(Number(c.id_curso)) && Number(c.id_curso) > 0);
      return hasAny && s.email ? [String(s.email).trim().toLowerCase()] : [];
    })
  );
  for (const email of trailActiveEmails) enrolledEmails.add(email);
  const unenrolled = [];
  const seenUnenrolled = new Set();
  const pushUnenrolled = (person, origin) => {
    const email = String(person.email || '').trim().toLowerCase();
    if (!email || enrolledEmails.has(email) || seenUnenrolled.has(email)) return;
    seenUnenrolled.add(email);
    unenrolled.push({
      schoolId: school.id,
      escola: schoolName,
      studentId: person.id ?? null,
      nome: person.nome || 'Nome não informado',
      email,
      dataCadastro: person.data_cadastro || null,
      origin,
      semMatricula: true,
    });
  };
  for (const lead of leads) pushUnenrolled(lead, 'lead');
  for (const s of students) pushUnenrolled(s, 'student');

  const data = {
    id: school.id,
    name: schoolName,
    totalMatriculas: items.length,
    ativas,
    bloqueadas,
    desconhecidas: items.length - ativas - bloqueadas,
    emRisco: items.filter((i) => i.emRisco).length,
    semMatricula: unenrolled.length,
    usuariosAtivos,
    usuariosTrilha,
    usuariosTotal,
    trailEmails,
    items,
    unenrolled,
  };
  licensesCache.set(school.apiKey, { data, timestamp: Date.now() });
  saveDiskCache();
  return data;
}

export function invalidateLicensesCache(apiKey) {
  if (apiKey) licensesCache.delete(apiKey);
  else licensesCache.clear();
}

export default async function handler(req, res) {
  // Mesma função serverless, para caber no limite de funções do plano: ?view=avaliacoes entrega a aba Avaliações.
  if (req.query?.view === 'avaliacoes') return avaliacoesHandler(req, res);

  const authenticatedUser = await requirePermission(req, res, 'students:read');
  if (!authenticatedUser) return;
  if (!applyRateLimit(req, res, {
    name: 'licenses', identity: authenticatedUser.id, max: 20, windowMs: 60_000,
  })) return;

  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Método não permitido.' });
  }
  if (!requireTrustedGetRequest(req, res)) return;

  try {
    loadDiskCacheOnce();
    const schools = filterAuthorizedSchools(getSchools(), authenticatedUser);
    if (schools.length === 0) {
      return res.status(500).json({ error: 'Nenhuma chave de API configurada no .env' });
    }
    const forceRefresh = req.query.refresh === 'true' || req.query.refresh === '1';
    const { schoolIndex } = req.query;
    const targets = /^\d+$/.test(String(schoolIndex ?? ''))
      ? schools.filter((s) => s.id === Number(schoolIndex))
      : schools;
    if (targets.length === 0) {
      return res.status(404).json({ error: 'Escola não encontrada.' });
    }

    const perSchool = await mapWithConcurrency(
      targets,
      Math.min(targets.length, 3),
      (school) => computeSchoolLicenses(school, forceRefresh)
    );

    const sum = (pick) => perSchool.reduce((acc, s) => acc + s[pick], 0);
    const ativasTotal = sum('ativas');
    const teto = getMaxActiveLicenses();
    const distinctEmails = (onlyActive) => new Set(
      perSchool.flatMap((s) => s.items)
        .filter((i) => !onlyActive || i.acessoAtivo === true)
        .map((i) => i.email)
    ).size;
    // Licença = usuário ativo (curso ativo OU trilha), sem dupla contagem
    // entre escolas (ex.: mesmo e-mail em 2 escolas).
    const courseActiveAll = perSchool.flatMap((s) => s.items)
      .filter((i) => i.acessoAtivo === true)
      .map((i) => i.email);
    const trailAll = perSchool.flatMap((s) => s.trailEmails || []);
    const usuariosAtivosTotal = new Set([...courseActiveAll, ...trailAll]).size;
    const usuariosTrilhaTotal = new Set(trailAll).size;
    return res.status(200).json({
      windowDays: LICENSE_WINDOW_DAYS,
      cachedAt: new Date().toISOString(),
      schools: perSchool.map(({ items, unenrolled, trailEmails, ...summary }) => summary),
      total: {
        teto,
        totalMatriculas: sum('totalMatriculas'),
        ativas: ativasTotal,
        livres: teto > 0 ? teto - usuariosAtivosTotal : null,
        usoPercentual: teto > 0 ? Math.round((usuariosAtivosTotal / teto) * 100) : null,
        bloqueadas: sum('bloqueadas'),
        desconhecidas: sum('desconhecidas'),
        emRisco: sum('emRisco'),
        semMatricula: sum('semMatricula'),
        usuariosAtivos: usuariosAtivosTotal,
        usuariosTrilha: usuariosTrilhaTotal,
        usuariosTotal: distinctEmails(false),
      },
      items: perSchool.flatMap((s) => s.items),
      unenrolled: perSchool.flatMap((s) => s.unenrolled),
    });
  } catch (error) {
    console.error('❌ Erro ao computar licenças:', error);
    return res.status(500).json({ error: 'Erro interno ao computar licenças.' });
  }
}
