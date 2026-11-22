import {
  HOTSCOOL_API_URL,
  fetchCoursesFromSchool,
  fetchPackagesFromSchool,
  fetchStudentsFromSchool,
  fetchWithTimeout,
  findStudentInSchool,
  getSchools,
  hotscoolConcurrency,
  invalidateSchoolCache,
  mapWithConcurrency,
  matchStudentEmail,
} from './hotscool.js';
import { randomBytes } from 'node:crypto';
import { filterAuthorizedSchools, requirePermission } from './auth-utils.js';
import { recordEnrollment } from './enrollment-log.js';
import { applyRateLimit, requireTrustedGetRequest, requireTrustedJsonRequest } from './security.js';

const HOTSCOOL_STUDENT_PORTAL_URL = process.env.HOTSCOOL_STUDENT_PORTAL_URL || 'https://app.hotscool.com';
const DEFAULT_ACCESS_DAYS = Number(process.env.HOTSCOOL_DEFAULT_ACCESS_DAYS || 30);

function getAccessLimitDates(days = DEFAULT_ACCESS_DAYS) {
  const limit = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  // Formatos Hotscool: data_limite DD/MM/AAAA HH:mm:ss, data_expiracao DD/MM/AAAA
  const data_limite = `${pad(limit.getDate())}/${pad(limit.getMonth() + 1)}/${limit.getFullYear()} ${pad(limit.getHours())}:${pad(limit.getMinutes())}:${pad(limit.getSeconds())}`;
  const data_expiracao = `${pad(limit.getDate())}/${pad(limit.getMonth() + 1)}/${limit.getFullYear()}`;
  const data_compra = `${pad(new Date().getDate())}/${pad(new Date().getMonth() + 1)}/${new Date().getFullYear()}`;
  return { data_limite, data_expiracao, data_compra };
}

// Corpo de renovação do limite de acesso para o PUT /students/access.
// Devolve null quando o limite está desativado (HOTSCOOL_DEFAULT_ACCESS_DAYS<=0).
function getAccessRenewalBody() {
  if (!(DEFAULT_ACCESS_DAYS > 0)) return null;
  const { data_limite, data_expiracao } = getAccessLimitDates();
  return { data_limite, data_expiracao };
}

// Reativa o acesso ao curso renovando o limite (data_limite/data_expiracao
// a partir de hoje). Se a Hotscool rejeitar os campos no PUT (400 citando
// data_limite), repete sem corpo — mesmo padrão de fallback do enrollment.
async function putStudentAccess(apiKey, studentId, courseId) {
  const url = `${HOTSCOOL_API_URL}/students/access/${studentId}/${courseId}/1`;
  const headers = {
    'x-access-token': apiKey,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  const renewal = getAccessRenewalBody();
  let accessRes = await fetchWithTimeout(url, {
    method: 'PUT',
    headers,
    ...(renewal ? { body: JSON.stringify(renewal) } : {}),
  });
  let accessData = await accessRes.json().catch(() => ({}));
  if (!accessRes.ok && accessRes.status === 400 && renewal
    && JSON.stringify(accessData).toLowerCase().includes('data_limite')) {
    accessRes = await fetchWithTimeout(url, { method: 'PUT', headers });
    accessData = await accessRes.json().catch(() => ({}));
  }
  return { accessRes, accessData };
}

// Desbloqueio em nível de aluno (coluna "Matrícula" do painel Hotscool:
// "Assinatura expirada" x "Ativa"). status 1=active, 2=blocked.
// Ao contrário do PUT /students/access (por curso), este endpoint aceita as
// chaves atuais — é o que o cadeado "Bloquear/Desbloquear Matrícula" faz.
async function putStudentBlockAccess(apiKey, studentId, status) {
  const res = await fetchWithTimeout(
    `${HOTSCOOL_API_URL}/students/block-access/all/${studentId}/${status}`,
    {
      method: 'PUT',
      headers: {
        'x-access-token': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    }
  );
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

// Detecta falha de autorização no PUT /students/access (401/403 ou 400 com
// errors[].msg como "API Token Não autorizado"). Algumas chaves têm escrita
// no POST /students/enrollment mas não têm grant nesse endpoint.
function isAccessAuthFailure(status, data) {
  if (status === 401 || status === 403) return true;
  const msg = Array.isArray(data?.errors)
    ? data.errors.map((e) => e?.msg).filter(Boolean).join('; ')
    : (data?.message || data?.error || '');
  return /não autorizado|unauthor|permiss|forbidden/i.test(String(msg || ''));
}

function paisToId(pais) {
  const s = String(pais || '').toLowerCase();
  if (/united|e\.u\.a|[^a-z]usa[^a-z]/.test(` ${s} `)) return 2;
  return 1;
}

// Plano B de reativação: rematricula via POST /students/enrollment.
// Sem senha (não altera credencial) e sem e-mail de notificação.
async function reactivateViaEnrollment(apiKey, { nome, email, courseId, idPais = 1 }) {
  const body = {
    nome, email, id_curso: courseId, id_turma: 0, id_pais: idPais,
    enviar_email_notificacao: 0,
  };
  const renewal = getAccessRenewalBody();
  if (renewal) {
    body.data_limite = renewal.data_limite;
    body.data_expiracao = renewal.data_expiracao;
  }
  const res = await fetchWithTimeout(`${HOTSCOOL_API_URL}/students/enrollment`, {
    method: 'POST',
    headers: {
      'x-access-token': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

function getStudentPortalUrl(schoolName) {
  const normalizedName = String(schoolName || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (normalizedName.includes('universidade')) {
    return 'https://ead.el.consistem.com.br/login';
  }
  if (normalizedName.includes('academia')) {
    return 'https://academia.el.consistem.com.br/';
  }
  if (normalizedName.includes('desenvolvimento')) {
    return 'https://aprenda.el.consistem.com.br/login';
  }

  return HOTSCOOL_STUDENT_PORTAL_URL;
}

// Re-exportado para compatibilidade com importadores existentes.
export { getSchools };

function isStudentMatch(student, targetEmail) {
  return matchStudentEmail(student, targetEmail);
}

// --- Status de acesso da matrícula (ativo/bloqueado/expirado) ---
// A Hotscool varia os nomes dos campos entre /students/all, /students/3 e
// /students/{id}/report/course/{id}. Centraliza a heurística aqui para o
// frontend só consumir `acessoAtivo` + `statusMatricula`.
function parseBrDate(value) {
  const m = String(value || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return isNaN(d) ? null : d;
}

function normalizeAccessFlag(value) {
  if (value === true) return true;
  if (value === false) return false;
  const s = String(value ?? '').trim().toLowerCase();
  if (['1', 'ativo', 'ativa', 'active', 'liberado', 'liberada', 'released'].includes(s)) return true;
  if (['0', 'bloqueado', 'bloqueada', 'blocked', 'inativo', 'inativa', 'inactive'].includes(s)) return false;
  return null;
}

export function getEnrollmentAccessStatus(enrollment = {}, report = {}) {
  const sources = [report, report?.relatorio_curso, enrollment].filter((s) => s && typeof s === 'object');
  const pick = (...keys) => {
    for (const src of sources) {
      for (const key of keys) {
        if (src[key] !== undefined && src[key] !== null && src[key] !== '') return src[key];
      }
    }
    return undefined;
  };

  // 1. Flags explícitas de acesso/bloqueio
  let acessoAtivo = null;
  const flagKeys = ['acesso', 'access', 'liberado', 'bloqueado', 'ativo', 'active', 'situacao', 'status_acesso'];
  for (const key of flagKeys) {
    const raw = pick(key);
    if (raw === undefined) continue;
    if (key === 'bloqueado') {
      if (raw === true || String(raw).trim() === '1') { acessoAtivo = false; break; }
      if (raw === false || String(raw).trim() === '0') { acessoAtivo = true; break; }
      continue;
    }
    const normalized = normalizeAccessFlag(raw);
    if (normalized !== null) { acessoAtivo = normalized; break; }
  }

  // 2. Status textual genérico (ex.: status/situacao = 'bloqueado')
  if (acessoAtivo === null) {
    const statusRaw = String(pick('status_matricula', 'status', 'situacao') ?? '').trim().toLowerCase();
    if (['bloqueado', 'bloqueada', 'blocked', 'inativo', 'inativa', 'inactive', 'suspenso', 'expirado', 'expirada', 'expired'].includes(statusRaw)) acessoAtivo = false;
    else if (['ativo', 'ativa', 'active', 'liberado', 'liberada', 'cursando'].includes(statusRaw)) acessoAtivo = true;
  }

  // 3. Datas de expiração (data_limite / data_expiracao / expiracao)
  const dataLimite = pick('data_limite', 'dataLimite', 'limite_acesso');
  const dataExpiracao = pick('data_expiracao', 'dataExpiracao', 'expiracao', 'expires_at');
  let expirado = false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const candidate of [dataLimite, dataExpiracao]) {
    const parsed = parseBrDate(candidate) || (candidate ? new Date(candidate) : null);
    if (parsed && !isNaN(parsed) && parsed < today) { expirado = true; break; }
  }
  if (expirado) acessoAtivo = false;

  // Default: sem evidência de bloqueio na heurística, considera ativo para
  // não gerar falso "bloqueado" em massa. `verificado=false` indica que nem a
  // heurística nem a fonte oficial informaram o acesso.
  const verificado = acessoAtivo !== null;
  if (acessoAtivo === null) acessoAtivo = true;
  const statusMatricula = !acessoAtivo ? (expirado ? 'expirado' : 'bloqueado') : 'ativo';
  return {
    acessoAtivo,
    statusMatricula,
    verificado,
    dataLimite: dataLimite != null ? String(dataLimite) : null,
    dataExpiracao: dataExpiracao != null ? String(dataExpiracao) : null,
  };
}

// Fonte oficial de acesso por curso (descoberta 10/2026):
// GET /students/course/access/{id_aluno}/{id_curso} -> {status: 1 Ativo, 2 Bloqueado}.
// Quando responde com status válido, prevalece sobre a heurística.
export function applyCourseAccessStatus(access, accessInfo) {
  const st = Number(accessInfo?.status);
  if (!Number.isSafeInteger(st) || (st !== 1 && st !== 2)) return access;
  return {
    ...access,
    acessoAtivo: st === 1,
    statusMatricula: st === 1 ? 'ativo' : 'bloqueado',
    verificado: true,
  };
}

export async function fetchCourseAccessStatus(apiKey, studentId, courseId) {
  try {
    const res = await fetchWithTimeout(
      `${HOTSCOOL_API_URL}/students/course/access/${studentId}/${courseId}`,
      { headers: { 'x-access-token': apiKey, 'Accept': 'application/json' } }
    );
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

/**
 * Tenta cadastrar aluno na escola com melhor permissão disponível.
 * Fluxo:
 *   1. Se tem cursos selecionados → matricula via /students/enrollment (com id_curso + id_turma)
 *   2. Se não tem cursos → cadastra como lead via /leads/enrollment
 *   3. Se a Key não tem permissão de escrita → retorna erro claro
 */
export default async function handler(req, res) {
  const requiredPermission = req.method === 'POST' ? 'students:write' : 'students:read';
  const authenticatedUser = await requirePermission(req, res, requiredPermission);
  if (!authenticatedUser) return;
  const rateLimit = req.method === 'POST'
    ? { name: 'students-write', max: 120, windowMs: 60_000 }
    : { name: 'students-read', max: 30, windowMs: 60_000 };
  if (!applyRateLimit(req, res, { ...rateLimit, identity: authenticatedUser.id })) return;

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const schools = filterAuthorizedSchools(getSchools(), authenticatedUser);
  if (schools.length === 0) {
    return res.status(500).json({
      error: 'Nenhuma chave de API configurada no .env (configure HOTSCOOL_API_KEY_1, _2, _3)',
    });
  }

  // ==========================================
  // POST: Cadastrar aluno(s) e matricular em cursos
  // ==========================================
  if (req.method === 'POST') {
    if (!requireTrustedJsonRequest(req, res)) return;
    const { batch, students, ...singleData } = req.body || {};

    // Ação pontual: reativar acesso bloqueado/expirado de um curso.
    // Body: { action: 'reactivate', email, id_curso, schoolId }
    // Tenta PUT /students/access/{id_aluno}/{id_curso}/1 e, se a chave não
    // tiver grant nesse endpoint, cai para rematrícula via POST /enrollment.
    if (singleData.action === 'reactivate') {
      const cleanEmail = String(singleData.email || '').trim().toLowerCase();
      const courseId = Number(singleData.id_curso ?? singleData.courseId);
      const rawSchoolId = singleData.schoolId ?? singleData.schoolIndex;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 254) {
        return res.status(400).json({ error: 'E-mail inválido para reativação.' });
      }
      if (!Number.isSafeInteger(courseId) || courseId <= 0) {
        return res.status(400).json({ error: 'Curso inválido para reativação.' });
      }
      if (!/^\d+$/.test(String(rawSchoolId ?? ''))) {
        return res.status(400).json({ error: 'Escola inválida para reativação.' });
      }
      const reactSchool = schools.find((school) => school.id === Number(rawSchoolId));
      if (!reactSchool) {
        return res.status(403).json({ error: 'Escola selecionada não autorizada.' });
      }
      try {
        const found = await findStudentInSchool(reactSchool.apiKey, cleanEmail);
        if (!found) {
          return res.status(404).json({ error: 'Aluno não encontrado nesta escola.' });
        }
        // 1) Desbloqueio em nível de aluno ("Assinatura expirada" -> ativa).
        let studentUnlocked = false;
        try {
          const ub = await putStudentBlockAccess(reactSchool.apiKey, found.id, 1);
          studentUnlocked = ub.res.ok;
        } catch { /* segue para as tentativas por curso */ }
        // 2) Reativação por curso (com datas renovadas).
        let { accessRes, accessData } = await putStudentAccess(reactSchool.apiKey, found.id, courseId);
        let viaFallback = false;
        if (!accessRes.ok && !studentUnlocked && isAccessAuthFailure(accessRes.status, accessData)) {
          const fb = await reactivateViaEnrollment(reactSchool.apiKey, {
            nome: found.nome || cleanEmail,
            email: cleanEmail,
            courseId,
            idPais: paisToId(found.pais),
          });
          if (fb.res.ok || fb.res.status === 409) {
            viaFallback = true;
            accessData = fb.data;
          }
        }
        invalidateSchoolCache(reactSchool.apiKey);
        try { (await import('./licenses.js')).invalidateLicensesCache(reactSchool.apiKey); } catch {}
        const reactivated = accessRes.ok || viaFallback || studentUnlocked;
        if (!reactivated) {          if (accessRes.status === 401 || accessRes.status === 403) {
            return res.status(403).json({ error: 'A chave desta escola não tem permissão de escrita na Hotscool.' });
          }
          // A Hotscool valida o token nesse endpoint e responde 400 com
          // errors[].msg (ex.: "API Token Não autorizado") quando a chave só
          // tem leitura. Repassa a mensagem real em vez de erro genérico.
          const hotscoolMsg = Array.isArray(accessData?.errors)
            ? accessData.errors.map((e) => e?.msg).filter(Boolean).join('; ')
            : (accessData?.message || accessData?.error || null);
          const detail = hotscoolMsg ? `: ${hotscoolMsg}` : '';
          if (/não autorizado|unauthor|permiss|forbidden/i.test(hotscoolMsg || '')) {
            return res.status(403).json({ error: `A chave desta escola não tem grant neste endpoint da Hotscool${detail}. Confira o FULL ACESSO desta chave no painel (pode ser preciso regenerá-la).` });
          }
          return res.status(502).json({ error: `A Hotscool rejeitou a reativação (HTTP ${accessRes.status})${detail}.`, detalhes: accessData });
        }
        recordEnrollment({ schoolId: reactSchool.id, email: cleanEmail, courseId, source: 'reactivate' });
        return res.status(200).json({
          message: viaFallback
            ? 'Acesso ao curso reativado via rematrícula!'
            : (studentUnlocked && !accessRes.ok
              ? 'Matrícula desbloqueada (assinatura reativada)!'
              : 'Acesso ao curso reativado com sucesso!'),
          email: cleanEmail,
          id_curso: courseId,
          id_aluno: found.id,
          escola: reactSchool.name,
          ...(viaFallback ? { viaFallback: true } : {}),
          ...(studentUnlocked ? { studentUnlocked: true } : {}),
        });
      } catch (err) {
        return res.status(500).json({ error: 'Erro interno ao reativar acesso.' });
      }
    }

    // Ação pontual: bloquear acesso a um curso.
    // Body: { action: 'block', email, id_curso, schoolId }
    // Usa PUT /students/access/{id_aluno}/{id_curso}/2.
    if (singleData.action === 'block') {
      const cleanEmail = String(singleData.email || '').trim().toLowerCase();
      const courseId = Number(singleData.id_curso ?? singleData.courseId);
      const rawSchoolId = singleData.schoolId ?? singleData.schoolIndex;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 254) {
        return res.status(400).json({ error: 'E-mail inválido para bloqueio.' });
      }
      if (!Number.isSafeInteger(courseId) || courseId <= 0) {
        return res.status(400).json({ error: 'Curso inválido para bloqueio.' });
      }
      if (!/^\d+$/.test(String(rawSchoolId ?? ''))) {
        return res.status(400).json({ error: 'Escola inválida para bloqueio.' });
      }
      const blockSchool = schools.find((school) => school.id === Number(rawSchoolId));
      if (!blockSchool) {
        return res.status(403).json({ error: 'Escola selecionada não autorizada.' });
      }
      try {
        const found = await findStudentInSchool(blockSchool.apiKey, cleanEmail);
        if (!found) {
          return res.status(404).json({ error: 'Aluno não encontrado nesta escola.' });
        }
        const blockRes = await fetchWithTimeout(
          `${HOTSCOOL_API_URL}/students/access/${found.id}/${courseId}/2`,
          {
            method: 'PUT',
            headers: {
              'x-access-token': blockSchool.apiKey,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
          }
        );
        const blockData = await blockRes.json().catch(() => ({}));
        invalidateSchoolCache(blockSchool.apiKey);
        try { (await import('./licenses.js')).invalidateLicensesCache(blockSchool.apiKey); } catch {}
        if (!blockRes.ok) {
          if (isAccessAuthFailure(blockRes.status, blockData)) {
            return res.status(403).json({ error: 'A chave desta escola não tem grant neste endpoint da Hotscool. Confira o FULL ACESSO desta chave no painel (pode ser preciso regenerá-la).' });
          }
          return res.status(502).json({ error: `A Hotscool rejeitou o bloqueio (HTTP ${blockRes.status}).`, detalhes: blockData });
        }
        return res.status(200).json({
          message: 'Acesso ao curso bloqueado com sucesso!',
          email: cleanEmail,
          id_curso: courseId,
          id_aluno: found.id,
          escola: blockSchool.name,
        });
      } catch (err) {
        return res.status(500).json({ error: 'Erro interno ao bloquear acesso.' });
      }
    }

    // Ação pontual: desmatricular aluno de um curso específico.
    // Body: { action: 'withdraw', email, id_curso, schoolId }
    // Usa DELETE /students/withdraw/{id_aluno}/{id_curso}.
    if (singleData.action === 'withdraw') {
      const cleanEmail = String(singleData.email || '').trim().toLowerCase();
      const courseId = Number(singleData.id_curso ?? singleData.courseId);
      const rawSchoolId = singleData.schoolId ?? singleData.schoolIndex;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 254) {
        return res.status(400).json({ error: 'E-mail inválido para desmatricular.' });
      }
      if (!Number.isSafeInteger(courseId) || courseId <= 0) {
        return res.status(400).json({ error: 'Curso inválido para desmatricular.' });
      }
      if (!/^\d+$/.test(String(rawSchoolId ?? ''))) {
        return res.status(400).json({ error: 'Escola inválida para desmatricular.' });
      }
      const withdrawSchool = schools.find((school) => school.id === Number(rawSchoolId));
      if (!withdrawSchool) {
        return res.status(403).json({ error: 'Escola selecionada não autorizada.' });
      }
      try {
        const found = await findStudentInSchool(withdrawSchool.apiKey, cleanEmail);
        if (!found) {
          return res.status(404).json({ error: 'Aluno não encontrado nesta escola.' });
        }
        // A matrícula propaga de forma assíncrona na Hotscool: um POST /enrollment
        // com 200 pode responder "não matriculado" no withdraw segundos depois.
        // Repete até 3x com backoff antes de desistir.
        let withdrawRes = null;
        let withdrawData = {};
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt > 0) await new Promise((r) => setTimeout(r, 3000 * attempt));
          withdrawRes = await fetchWithTimeout(
            `${HOTSCOOL_API_URL}/students/withdraw/${found.id}/${courseId}`,
            {
              method: 'DELETE',
              headers: {
                'x-access-token': withdrawSchool.apiKey,
                'Accept': 'application/json',
              },
            }
          );
          withdrawData = await withdrawRes.json().catch(() => ({}));
          if (withdrawRes.ok) break;
          const msg = Array.isArray(withdrawData?.errors)
            ? withdrawData.errors.map((e) => e?.msg).filter(Boolean).join('; ')
            : (withdrawData?.message || '');
          if (!/não matriculado|not enrolled|not found/i.test(msg)) break;
        }
        invalidateSchoolCache(withdrawSchool.apiKey);
        try { (await import('./licenses.js')).invalidateLicensesCache(withdrawSchool.apiKey); } catch {}
        if (!withdrawRes.ok) {
          if (isAccessAuthFailure(withdrawRes.status, withdrawData)) {
            return res.status(403).json({ error: 'A chave desta escola não tem grant neste endpoint da Hotscool. Confira o FULL ACESSO desta chave no painel (pode ser preciso regenerá-la).' });
          }
          const msg = Array.isArray(withdrawData?.errors)
            ? withdrawData.errors.map((e) => e?.msg).filter(Boolean).join('; ')
            : (withdrawData?.message || null);
          return res.status(502).json({ error: `A Hotscool rejeitou a desmatrícula (HTTP ${withdrawRes.status})${msg ? `: ${msg}` : ''}.`, detalhes: withdrawData });
        }
        return res.status(200).json({
          message: 'Aluno desmatriculado do curso com sucesso!',
          email: cleanEmail,
          id_curso: courseId,
          id_aluno: found.id,
          escola: withdrawSchool.name,
        });
      } catch (err) {
        return res.status(500).json({ error: 'Erro interno ao desmatricular.' });
      }
    }

    // Se for requisição em lote
    const isBatch = Array.isArray(batch) || Array.isArray(students);
    const studentsToProcess = isBatch ? (batch || students) : [singleData];

    if (studentsToProcess.length === 0) {
      return res.status(400).json({ error: 'Nenhum dado de aluno fornecido.' });
    }
    if (studentsToProcess.length > 100) {
      return res.status(413).json({ error: 'O lote excede o limite de 100 alunos.' });
    }
    const requestedOperations = studentsToProcess.reduce((total, student) => {
      const count = Array.isArray(student?.courseIds) ? student.courseIds.length : 0;
      return total + Math.max(1, count);
    }, 0);
    if (requestedOperations > 500) {
      return res.status(413).json({ error: 'O lote excede o limite de 500 operações.' });
    }

    const rawSchoolIndex = singleData.schoolIndex ?? studentsToProcess[0]?.schoolIndex;
    if (!/^\d+$/.test(String(rawSchoolIndex))) {
      return res.status(400).json({ error: 'Escola selecionada inválida.' });
    }
    const schoolIdx = Number(rawSchoolIndex);
    const targetSchool = schools.find((school) => school.id === schoolIdx);
    if (!targetSchool) {
      return res.status(403).json({ error: 'Escola selecionada não autorizada.' });
    }
    const schoolCourses = await fetchCoursesFromSchool(targetSchool.apiKey);
    const schoolPackages = await fetchPackagesFromSchool(targetSchool.apiKey).catch(() => []);
    const inactiveStatuses = new Set(['inativo', 'inactive', 'arquivado', 'archived']);
    const allowedCourseIds = new Set(
      schoolCourses
        .filter((course) => !inactiveStatuses.has(String(course.status).trim().toLowerCase()))
        .map((course) => course.id)
    );
    const allowedPackageIds = new Set(
      schoolPackages
        .filter((pkg) => !inactiveStatuses.has(String(pkg.status).trim().toLowerCase()))
        .map((pkg) => pkg.id)
    );

    // Função auxiliar para matricular um único aluno
    async function processSingleStudent(student) {
      if (!student || typeof student !== 'object' || Array.isArray(student)) {
        return { ok: false, error: 'Dados do aluno inválidos.', student: {} };
      }
      const {
        nome,
        email,
        password,
        senha,
        id_pais = 1,
        courseIds = [],
        packageIds = [],
        trilhaIds = [],
        pacotes = [],
        trilhas = [],
        enviar_email_notificacao,
        enviarEmailDefinirSenha,
        cpf,
        ddd,
        celular,
        telefone,
        cep,
        endereco,
        numero,
        cidade,
        estado,
        bairro,
        complemento,
        empresa,
        origem,
        projetoServ,
        idEmpresa,
      } = student;
      // Normaliza campos extra Universidade Consistem (aliases snake/camel)
      const effEmpresa = String(empresa ?? student.empresa ?? student.Empresa ?? '').trim().slice(0, 200);
      const effOrigem = String(origem ?? student.origem ?? student.Origem ?? '').trim().slice(0, 200);
      const effProjetoServ = String(projetoServ ?? student.projetoServ ?? student.projeto_serv ?? student['Projeto Serv'] ?? '').trim().slice(0, 200);
      const effIdEmpresa = String(idEmpresa ?? student.idEmpresa ?? student.id_empresa ?? student['ID Empresa'] ?? '').trim().slice(0, 100);
      // Normaliza packageIds aceitando múltiplos aliases (packageIds, trilhaIds, pacotes, trilhas)
      const rawPackageIdsInput = Array.isArray(packageIds) && packageIds.length ? packageIds
        : Array.isArray(trilhaIds) && trilhaIds.length ? trilhaIds
        : Array.isArray(pacotes) && pacotes.length ? pacotes
        : Array.isArray(trilhas) && trilhas.length ? trilhas
        : Array.isArray(student.id_packages) ? student.id_packages
        : Array.isArray(student.packages) ? student.packages
        : [];

      const boundedFields = [
        [cpf, 20], [ddd, 5], [celular, 30], [telefone, 30], [cep, 20],
        [endereco, 300], [numero, 20], [cidade, 150], [estado, 2],
        [bairro, 150], [complemento, 300],
        [effEmpresa, 200], [effOrigem, 200], [effProjetoServ, 200], [effIdEmpresa, 100],
      ];
      if (boundedFields.some(([value, max]) => value != null && String(value).length > max)) {
        return { ok: false, error: 'Um ou mais campos excedem o tamanho permitido.', student: {} };
      }

      if (typeof nome !== 'string' || !nome.trim() || nome.length > 200) {
        return { ok: false, error: 'O nome do aluno é obrigatório.', student: { nome, email } };
      }
      if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        return { ok: false, error: 'O e-mail do aluno é inválido.', student: { nome } };
      }

      const cleanNome = nome.trim();
      const cleanEmail = email.trim().toLowerCase();
      const rawPassword = typeof (password || senha) === 'string' ? (password || senha).trim() : '';
      if (rawPassword.length > 128) {
        return { ok: false, error: 'A senha excede 128 caracteres.', student: { nome: cleanNome } };
      }

      const shouldNotifyEmail =
        enviar_email_notificacao === 1 ||
        enviar_email_notificacao === '1' ||
        enviar_email_notificacao === true ||
        enviarEmailDefinirSenha === true ||
        String(enviarEmailDefinirSenha).toLowerCase() === 'sim' ||
        String(student['enviar email para definir senha']).toLowerCase() === 'sim';

      // Se a senha não foi informada ou tem menos de 6 caracteres
      let cleanPassword = rawPassword;
      if (!cleanPassword || cleanPassword.length < 6) {
        cleanPassword = randomBytes(18).toString('base64url');
      }

      const paisNum = Number(id_pais) || 1;
      const cleanCpf = cpf ? String(cpf).replace(/\D/g, '') : undefined;
      const cleanDdd = ddd ? Number(String(ddd).replace(/\D/g, '').slice(0, 2)) : undefined;
      const cleanTel = (telefone || celular) ? Number(String(telefone || celular).replace(/\D/g, '')) : undefined;
      const cleanCep = cep ? Number(String(cep).replace(/\D/g, '')) : undefined;
      const cleanNum = numero ? Number(String(numero).replace(/\D/g, '')) : undefined;

      // Deduplica cursos
      if (!Array.isArray(courseIds)) {
        return { ok: false, error: 'A lista de cursos é inválida.', student: { nome: cleanNome } };
      }
      const normalizedCourseIds = courseIds.map(Number);
      if (normalizedCourseIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
        return { ok: false, error: 'A lista de cursos contém IDs inválidos.', student: { nome: cleanNome } };
      }
      const uniqueCourseIds = [...new Set(normalizedCourseIds)];
      if (uniqueCourseIds.length > 50) {
        return { ok: false, error: 'O aluno excede o limite de 50 cursos.', student: { nome: cleanNome } };
      }
      if (uniqueCourseIds.some((id) => !allowedCourseIds.has(id))) {
        return { ok: false, error: 'Um ou mais cursos não pertencem à escola selecionada.', student: { nome: cleanNome } };
      }

      // Deduplica pacotes/trilhas
      const normalizedPackageIds = rawPackageIdsInput.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
      if (rawPackageIdsInput.length > 0 && normalizedPackageIds.length === 0 && rawPackageIdsInput.some((v) => Number(v) > 0)) {
        return { ok: false, error: 'A lista de trilhas/pacotes contém IDs inválidos.', student: { nome: cleanNome } };
      }
      const uniquePackageIds = [...new Set(normalizedPackageIds)];
      if (uniquePackageIds.length > 20) {
        return { ok: false, error: 'O aluno excede o limite de 20 trilhas/pacotes.', student: { nome: cleanNome } };
      }
      if (uniquePackageIds.some((id) => !allowedPackageIds.has(id))) {
        return { ok: false, error: 'Uma ou mais trilhas/pacotes não pertencem à escola selecionada.', student: { nome: cleanNome } };
      }

      // === MATRÍCULA EM CURSOS E TRILHAS/PACOTES (rematrícula idempotente) ===
      if (uniqueCourseIds.length > 0 || uniquePackageIds.length > 0) {
        // Pré-busca: verifica se aluno já existe
        let existingStudent = null;
        let alreadyEnrolledIds = new Set();
        try {
          const allStudents = await fetchStudentsFromSchool(targetSchool.apiKey, false);
          const found = allStudents.find((s) => isStudentMatch(s, cleanEmail));
          if (found) {
            existingStudent = found;
            const cursos = Array.isArray(found.cursos_matriculados) ? found.cursos_matriculados : [];
            cursos.forEach((c) => {
              const cid = Number(c.id_curso);
              if (Number.isSafeInteger(cid)) alreadyEnrolledIds.add(cid);
            });
          }
        } catch (e) {
          console.error('[Rematricula] Falha ao buscar aluno existente:', e.message);
        }

        // --- Campos extra Universidade Consistem ---
        const camposExtras = [];
        if (effEmpresa) camposExtras.push({ campo: 'Empresa', valor: effEmpresa });
        if (effOrigem) camposExtras.push({ campo: 'Origem', valor: effOrigem });
        if (effProjetoServ) camposExtras.push({ campo: 'Projeto Serv', valor: effProjetoServ });
        if (effIdEmpresa) camposExtras.push({ campo: 'ID Empresa', valor: effIdEmpresa });
        // Tenta sincronizar extra fields se houver (não bloqueia matrícula em caso de falha)
        if (camposExtras.length > 0) {
          try {
            if (existingStudent?.id) {
              // Atualiza aluno existente com extra fields
              const extraRes = await fetchWithTimeout(`${HOTSCOOL_API_URL}/leads/extrafields/${existingStudent.id}`, {
                method: 'PUT',
                headers: { 'x-access-token': targetSchool.apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ campos_extras: camposExtras }),
              });
              if (!extraRes.ok) {
                // Fallback: tenta enrollment/extrafields
                const fallbackRes = await fetchWithTimeout(`${HOTSCOOL_API_URL}/leads/enrollment/extrafields`, {
                  method: 'POST',
                  headers: { 'x-access-token': targetSchool.apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                  body: JSON.stringify({ nome: cleanNome, email: cleanEmail, id_pais: paisNum, campos_extras: camposExtras }),
                });
                console.log(`[ExtraFields] sync fallback status ${fallbackRes.status} for ${cleanEmail}`);
              } else {
                console.log(`[ExtraFields] updated ${camposExtras.length} campos for aluno ${existingStudent.id}`);
              }
            } else {
              // Aluno novo: cria via extrafields enrollment (será complementado pela matrícula de cursos abaixo)
              const createExtraRes = await fetchWithTimeout(`${HOTSCOOL_API_URL}/leads/enrollment/extrafields`, {
                method: 'POST',
                headers: { 'x-access-token': targetSchool.apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ nome: cleanNome, email: cleanEmail, id_pais: paisNum, campos_extras: camposExtras }),
              });
              if (createExtraRes.ok) {
                const createData = await createExtraRes.json().catch(() => ({}));
                const newId = createData.id || createData.data?.id;
                if (newId && !existingStudent) {
                  // Refetch para obter id para pacotes
                  try {
                    const refreshed = await fetchStudentsFromSchool(targetSchool.apiKey, true);
                    const newly = refreshed.find((s) => isStudentMatch(s, cleanEmail));
                    if (newly) existingStudent = newly;
                  } catch {}
                }
                console.log(`[ExtraFields] created lead with extrafields for ${cleanEmail} status ${createExtraRes.status}`);
              }
            }
          } catch (extraErr) {
            console.error('[ExtraFields] falha ao sincronizar:', extraErr.message);
          }
        }

        const packageResults = [];

        // --- Cursos (paralelismo limitado; sem sleeps fixos — retry em 429) ---
        async function enrollCourse(courseId) {
          if (existingStudent && alreadyEnrolledIds.has(courseId)) {
            try {
              const { accessRes, accessData } = await putStudentAccess(targetSchool.apiKey, existingStudent.id, courseId);
              if (accessRes.ok) {
                recordEnrollment({ schoolId: targetSchool.id, email: cleanEmail, courseId, source: 'renew' });
              }
              if (!accessRes.ok && isAccessAuthFailure(accessRes.status, accessData)) {
                let studentUnlocked = false;
                try {
                  const ub = await putStudentBlockAccess(targetSchool.apiKey, existingStudent.id, 1);
                  studentUnlocked = ub.res.ok;
                } catch {}
                if (studentUnlocked) {
                  return {
                    courseId,
                    ok: true,
                    status: 200,
                    data: { alreadyEnrolled: true, reactivated: true, studentUnlocked: true, accessData },
                    rematricula: true,
                  };
                }
                const fb = await reactivateViaEnrollment(targetSchool.apiKey, {
                  nome: cleanNome,
                  email: cleanEmail,
                  courseId,
                  idPais: paisNum,
                });
                if (fb.res.ok || fb.res.status === 409) {
                  return {
                    courseId,
                    ok: true,
                    status: 200,
                    data: { alreadyEnrolled: true, reactivated: true, viaFallback: true, accessData: fb.data },
                    rematricula: true,
                  };
                }
                return { courseId, ok: false, status: fb.res.status, data: fb.data };
              }
              return {
                courseId,
                ok: true,
                status: 200,
                data: { alreadyEnrolled: true, reactivated: accessRes.ok, accessData },
                rematricula: true,
              };
            } catch (accessErr) {
              return {
                courseId,
                ok: true,
                status: 200,
                data: { alreadyEnrolled: true, error: accessErr.message },
                rematricula: true,
              };
            }
          }
          try {
            const bodyPayload = {
              nome: cleanNome,
              email: cleanEmail,
              senha: cleanPassword,
              id_curso: courseId,
              id_turma: 0,
              id_pais: paisNum,
              enviar_email_notificacao: shouldNotifyEmail ? 1 : 0,
            };
            if (cleanCpf) bodyPayload.cpf = cleanCpf;
            if (cleanDdd) bodyPayload.ddd = cleanDdd;
            if (cleanTel) bodyPayload.telefone = cleanTel;
            if (cleanCep) bodyPayload.cep = cleanCep;
            if (cleanNum) bodyPayload.numero = cleanNum;
            if (endereco) bodyPayload.endereco = String(endereco).trim();
            if (cidade) bodyPayload.cidade = String(cidade).trim();
            if (estado) bodyPayload.estado = String(estado).trim().toUpperCase();
            if (bairro) bodyPayload.bairro = String(bairro).trim();
            if (complemento) bodyPayload.complemento = String(complemento).trim();
            if (DEFAULT_ACCESS_DAYS > 0) {
              const { data_limite, data_expiracao } = getAccessLimitDates();
              // Tenta enviar limite para matrícula de curso (se API aceitar, aplica 30 dias)
              bodyPayload.data_limite = data_limite;
              bodyPayload.data_expiracao = data_expiracao;
            }
            const response = await fetchWithTimeout(`${HOTSCOOL_API_URL}/students/enrollment`, {
              method: 'POST',
              headers: {
                'x-access-token': targetSchool.apiKey,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              },
              body: JSON.stringify(bodyPayload),
            });
            let resData = await response.json().catch(() => ({}));
            // Fallback se data_limite não for suportado para cursos (400)
            if (!response.ok && response.status === 400 && JSON.stringify(resData).toLowerCase().includes('data_limite') && bodyPayload.data_limite) {
              delete bodyPayload.data_limite;
              delete bodyPayload.data_expiracao;
              const retryRes = await fetchWithTimeout(`${HOTSCOOL_API_URL}/students/enrollment`, {
                method: 'POST',
                headers: { 'x-access-token': targetSchool.apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(bodyPayload),
              });
              const retryData = await retryRes.json().catch(() => ({}));
              if (retryRes.ok) {
                recordEnrollment({ schoolId: targetSchool.id, email: cleanEmail, courseId, source: 'enrollment' });
                return { courseId, ok: true, status: retryRes.status, data: retryData };
              } else if (retryRes.status === 409) {
                return { courseId, ok: true, status: 200, data: { ...retryData, alreadyEnrolled: true }, rematricula: true };
              } else {
                console.error(`[Hotscool API ${retryRes.status}] Falha curso ${courseId} (retry sem limite)`);
                return { courseId, ok: false, status: retryRes.status, data: retryData };
              }
            } else if (!response.ok && response.status === 409) {
              return { courseId, ok: true, status: 200, data: { ...resData, alreadyEnrolled: true }, rematricula: true };
            } else {
              if (!response.ok) console.error(`[Hotscool API ${response.status}] Falha curso ${courseId}`);
              if (response.ok) {
                recordEnrollment({ schoolId: targetSchool.id, email: cleanEmail, courseId, source: 'enrollment' });
              }
              return { courseId, ok: response.ok, status: response.status, data: resData };
            }
          } catch (fetchErr) {
            return { courseId, ok: false, status: 500, data: { error: fetchErr.message } };
          }
        }
        const enrollResults = await mapWithConcurrency(uniqueCourseIds, hotscoolConcurrency(), enrollCourse);

        // --- Trilhas/Pacotes ---
        if (uniquePackageIds.length > 0) {
          // Garante id_aluno para package enrollment
          let studentIdForPackage = existingStudent?.id || null;
          // Se ainda não existe e houve matrícula de cursos acima que criou o aluno, refetch
          if (!studentIdForPackage && enrollResults.some((r) => r.ok)) {
            try {
              const refreshed = await fetchStudentsFromSchool(targetSchool.apiKey, true);
              const newly = refreshed.find((s) => isStudentMatch(s, cleanEmail));
              if (newly) { studentIdForPackage = newly.id; existingStudent = newly; }
            } catch {}
          }
          // Se ainda não existe (só pacotes), cria como lead primeiro
          if (!studentIdForPackage) {
            try {
              const leadPayloadTmp = {
                nome: cleanNome,
                email: cleanEmail,
                senha: cleanPassword,
                id_pais: paisNum,
                enviar_email_notificacao: shouldNotifyEmail ? 1 : 0,
              };
              if (cleanCpf) leadPayloadTmp.cpf = cleanCpf;
              if (cleanDdd) leadPayloadTmp.ddd = cleanDdd;
              if (cleanTel) leadPayloadTmp.telefone = cleanTel;
              const leadRes = await fetchWithTimeout(`${HOTSCOOL_API_URL}/leads/enrollment`, {
                method: 'POST',
                headers: { 'x-access-token': targetSchool.apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(leadPayloadTmp),
              });
              const leadData = await leadRes.json().catch(() => ({}));
              if (leadRes.ok) {
                studentIdForPackage = leadData.id || leadData.data?.id || null;
              }
              // Fallback refetch
              if (!studentIdForPackage) {
                const refreshed2 = await fetchStudentsFromSchool(targetSchool.apiKey, true);
                const newly2 = refreshed2.find((s) => isStudentMatch(s, cleanEmail));
                if (newly2) { studentIdForPackage = newly2.id; existingStudent = newly2; }
              }
            } catch (e) {
              console.error('[Trilha] Falha ao criar aluno para pacote:', e.message);
            }
          }
          if (!studentIdForPackage) {
            uniquePackageIds.forEach((pkgId) => {
              packageResults.push({ packageId: pkgId, ok: false, status: 404, data: { error: 'Aluno não encontrado para matrícula em trilha' } });
            });
          } else {
            async function enrollPackage(pkgId) {
              try {
                const { data_limite, data_expiracao, data_compra } = getAccessLimitDates();
                const pkgBody = { id_aluno: studentIdForPackage, id_package: pkgId };
                if (DEFAULT_ACCESS_DAYS > 0) {
                  pkgBody.data_limite = data_limite;
                  pkgBody.data_expiracao = data_expiracao;
                  pkgBody.data_compra = data_compra;
                }
                const pkgRes = await fetchWithTimeout(`${HOTSCOOL_API_URL}/students/package/enrollment`, {
                  method: 'POST',
                  headers: { 'x-access-token': targetSchool.apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                  body: JSON.stringify(pkgBody),
                });
                const pkgData = await pkgRes.json().catch(() => ({}));
                if (!pkgRes.ok && pkgRes.status === 409) {
                  // Já matriculado no pacote -> trata como sucesso e tenta reativar via PUT com novo limite
                  try {
                    const putBody = { id_aluno: studentIdForPackage, id_package: pkgId };
                    if (DEFAULT_ACCESS_DAYS > 0) {
                      const upd = getAccessLimitDates();
                      putBody.data_limite = upd.data_limite;
                      putBody.data_expiracao = upd.data_expiracao;
                    }
                    await fetchWithTimeout(`${HOTSCOOL_API_URL}/students/package/enrollment/${studentIdForPackage}/${pkgId}`, {
                      method: 'PUT',
                      headers: { 'x-access-token': targetSchool.apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                      body: JSON.stringify(putBody),
                    });
                  } catch {}
                  return { packageId: pkgId, ok: true, status: 200, data: { ...pkgData, alreadyEnrolled: true }, rematricula: true };
                } else {
                  if (!pkgRes.ok) console.error(`[Hotscool API ${pkgRes.status}] Falha pacote ${pkgId}`);
                  return { packageId: pkgId, ok: pkgRes.ok, status: pkgRes.status, data: pkgData, rematricula: pkgRes.ok && pkgData.alreadyEnrolled };
                }
              } catch (pkgErr) {
                return { packageId: pkgId, ok: false, status: 500, data: { error: pkgErr.message } };
              }
            }
            packageResults.push(...await mapWithConcurrency(uniquePackageIds, hotscoolConcurrency(), enrollPackage));
          }
        }

        const successfulCourses = enrollResults.filter((r) => r.ok);
        const failedCourses = enrollResults.filter((r) => !r.ok);
        const successfulPkgs = packageResults.filter((r) => r.ok);
        const failedPkgs = packageResults.filter((r) => !r.ok);
        function formatHotscoolError(item) {
          const status = item.status;
          if (status === 401 || status === 403) return `Chave sem permissão (HTTP ${status})`;
          if (status === 400 || status === 422) return 'A Hotscool rejeitou os dados.';
          if (status === 409) return 'Já matriculado/conflito.';
          if (status === 429) return 'Limite temporário excedido.';
          if (status === 404) return item.data?.error || 'Não encontrado.';
          return `Erro ${status} na Hotscool`;
        }
        const allSuccessful = successfulCourses.length + successfulPkgs.length;
        const allFailed = failedCourses.length + failedPkgs.length;
        const rematriculas = [...enrollResults, ...packageResults].filter((r) => r.rematricula).length;
        return {
          ok: allSuccessful > 0,
          nome: cleanNome,
          email: cleanEmail,
          totalMatriculas: successfulCourses.length,
          totalSolicitado: uniqueCourseIds.length,
          totalPacotes: successfulPkgs.length,
          totalPacotesSolicitados: uniquePackageIds.length,
          rematriculas,
          falhas: allFailed,
          detalhesFalhas: [...failedCourses.map((f) => ({ courseId: f.courseId, status: f.status, error: formatHotscoolError(f) })), ...failedPkgs.map((f) => ({ packageId: f.packageId, status: f.status, error: formatHotscoolError(f) }))],
          detalhesCursos: enrollResults,
          detalhesPacotes: packageResults,
        };
      }

      // === CADASTRO COMO LEAD (sem cursos) ===
      const leadCamposExtras = [];
      if (effEmpresa) leadCamposExtras.push({ campo: 'Empresa', valor: effEmpresa });
      if (effOrigem) leadCamposExtras.push({ campo: 'Origem', valor: effOrigem });
      if (effProjetoServ) leadCamposExtras.push({ campo: 'Projeto Serv', valor: effProjetoServ });
      if (effIdEmpresa) leadCamposExtras.push({ campo: 'ID Empresa', valor: effIdEmpresa });
      const leadPayload = {
        nome: cleanNome,
        email: cleanEmail,
        senha: cleanPassword,
        id_pais: paisNum,
        enviar_email_notificacao: shouldNotifyEmail ? 1 : 0,
      };
      if (cleanCpf) leadPayload.cpf = cleanCpf;
      if (cleanDdd) leadPayload.ddd = cleanDdd;
      if (cleanTel) leadPayload.telefone = cleanTel;
      if (cleanCep) leadPayload.cep = cleanCep;
      if (cleanNum) leadPayload.numero = cleanNum;
      if (endereco) leadPayload.endereco = String(endereco).trim();
      if (cidade) leadPayload.cidade = String(cidade).trim();
      if (estado) leadPayload.estado = String(estado).trim().toUpperCase();

      let leadResponse;
      if (leadCamposExtras.length > 0) {
        // Usa endpoint com extra fields para Universidade Consistem
        leadResponse = await fetchWithTimeout(`${HOTSCOOL_API_URL}/leads/enrollment/extrafields`, {
          method: 'POST',
          headers: { 'x-access-token': targetSchool.apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ ...leadPayload, campos_extras: leadCamposExtras }),
        });
      } else {
        leadResponse = await fetchWithTimeout(`${HOTSCOOL_API_URL}/leads/enrollment`, {
          method: 'POST',
          headers: { 'x-access-token': targetSchool.apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(leadPayload),
        });
      }

      return {
        ok: leadResponse.ok,
        nome: cleanNome,
        email: cleanEmail,
        totalMatriculas: 0,
        isLead: true,
        error: !leadResponse.ok ? 'A Hotscool rejeitou o cadastro do aluno.' : null,
      };
    }

    try {
      // Se for apenas 1 aluno
      if (!isBatch) {
        const result = await processSingleStudent(studentsToProcess[0]);
        invalidateSchoolCache(targetSchool.apiKey);
        try { (await import('./licenses.js')).invalidateLicensesCache(targetSchool.apiKey); } catch {}

        if (!result.ok) {
          return res.status(400).json({
            error: result.error || (result.detalhesFalhas?.[0]?.error) || 'Erro ao processar matrícula.',
            detalhes: result,
            escola: targetSchool.name,
          });
        }

        return res.status(200).json({
          message: result.totalMatriculas > 0
            ? `Aluno matriculado com sucesso em ${result.totalMatriculas} curso(s)!`
            : 'Aluno cadastrado com sucesso!',
          ...result,
          escola: targetSchool.name,
        });
      }

      // Se for lote (batch): alunos em paralelo limitado (cada aluno já
      // paraleliza cursos/pacotes com o mesmo limite via HOTSCOOL_CONCURRENCY)
      const batchResults = await mapWithConcurrency(
        studentsToProcess,
        Math.min(3, hotscoolConcurrency()),
        (student) => processSingleStudent(student),
      );

      invalidateSchoolCache(targetSchool.apiKey);
      try { (await import('./licenses.js')).invalidateLicensesCache(targetSchool.apiKey); } catch {}

      const totalSucesso = batchResults.filter((r) => r.ok).length;
      const totalFalhas = batchResults.length - totalSucesso;

      return res.status(200).json({
        message: `Lote concluído: ${totalSucesso} aluno(s) processado(s) com sucesso, ${totalFalhas} falha(s).`,
        totalProcessado: batchResults.length,
        totalSucesso,
        totalFalhas,
        resultados: batchResults,
        escola: targetSchool.name,
      });
    } catch (err) {
      console.error('Erro interno no processamento de cadastro.');
      return res.status(500).json({ error: 'Erro interno ao realizar cadastro.' });
    }
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ error: 'Método não permitido.' });
  }
  if (!requireTrustedGetRequest(req, res)) return;

  // ==========================================
  // GET: Consulta detalhada de dados do aluno por e-mail (Dashboard 360°)
  // detail=summary: estágio 1 progressivo (identidade + cursos, sem os
  // N relatórios de progresso). O frontend renderiza e busca o full depois.
  // ==========================================
  const { email, refresh, detail } = req.query;
  const forceRefresh = refresh === 'true' || refresh === '1';

  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: 'Digite o e-mail do aluno.' });
  }

  try {
    const cleanEmail = email.trim().toLowerCase();

    // 1. Localiza o aluno em todas as escolas configuradas
    const searchResults = (await mapWithConcurrency(
      schools,
      hotscoolConcurrency(),
      async (school) => {
        const students = await fetchStudentsFromSchool(school.apiKey, forceRefresh);
        const match = students.find((s) => isStudentMatch(s, cleanEmail));
        return match ? { match, school } : null;
      },
    )).filter(Boolean);

    if (searchResults.length === 0) {
      return res.status(404).json({ error: 'Aluno não encontrado em nenhuma das escolas.' });
    }

    const primaryResult = searchResults[0];
    const primaryStudent = primaryResult.match;
    const primarySchool = primaryResult.school;
    const primaryStudentId = primaryStudent.id;

    const escolas = [...new Set(searchResults.map((r) => r.match.escola || r.school.name).filter(Boolean))];

    // 2. Busca dados enriquecidos nível 3 (/v1/students/3/{id})
    let s3Data = {};
    try {
      const s3Res = await fetchWithTimeout(`${HOTSCOOL_API_URL}/students/3/${primaryStudentId}`, {
        headers: {
          'x-access-token': primarySchool.apiKey,
          'Accept': 'application/json',
        },
      });
      if (s3Res.ok) {
        s3Data = await s3Res.json();
      }
    } catch (err) {
      console.error('Erro ao buscar /students/3:', err.message);
    }

    // 3. Carrega os catálogos para enriquecer as matrículas com capa e descrição.
    const catalogsByApiKey = new Map(
      await mapWithConcurrency(
        searchResults,
        hotscoolConcurrency(),
        async ({ school }) => {
          try {
            return [school.apiKey, await fetchCoursesFromSchool(school.apiKey)];
          } catch {
            return [school.apiKey, []];
          }
        },
      )
    );

    // 4. Consolidação de cursos matriculados de todas as escolas
    const cursosMap = new Map();
    searchResults.forEach((r) => {
      const schoolName = r.match.escola || r.school.name;
      const cursos = Array.isArray(r.match.cursos_matriculados) ? r.match.cursos_matriculados : [];
      cursos.forEach((c) => {
        const id = c.id_curso || c.titulo_curso;
        const enrollmentKey = `${r.school.id}:${id}`;
        const catalogCourse = catalogsByApiKey.get(r.school.apiKey)?.find(
          (item) => Number(item.id) === Number(c.id_curso)
        );
        if (!cursosMap.has(enrollmentKey)) {
          const initialAccess = getEnrollmentAccessStatus(c, {});
          cursosMap.set(enrollmentKey, {
            id_curso: c.id_curso,
            titulo_curso: c.titulo_curso || c.nome || 'Curso sem título',
            turma: c.turma || null,
            id_turma: c.id_turma || null,
            escola: schoolName,
            imagem: catalogCourse?.imagem || null,
            descricao: catalogCourse?.descricao || '',
            categoria: catalogCourse?.categoria || null,
            duracao: catalogCourse?.duracao || null,
            acessoUrl: getStudentPortalUrl(schoolName),
            studentId: r.match.id,
            schoolId: r.school.id,
            schoolApiKey: r.school.apiKey,
            ...initialAccess,
          });
        }
      });
    });

    // Se s3Data trouxer mais cursos
    if (Array.isArray(s3Data.cursos_matriculados)) {
      s3Data.cursos_matriculados.forEach((c) => {
        const id = c.id_curso || c.titulo_curso;
        const enrollmentKey = `${primarySchool.id}:${id}`;
        const catalogCourse = catalogsByApiKey.get(primarySchool.apiKey)?.find(
          (item) => Number(item.id) === Number(c.id_curso)
        );
        if (!cursosMap.has(enrollmentKey)) {
          const initialAccess = getEnrollmentAccessStatus(c, {});
          cursosMap.set(enrollmentKey, {
            id_curso: c.id_curso,
            titulo_curso: c.titulo_curso || 'Curso sem título',
            turma: c.turma || null,
            id_turma: c.id_turma || null,
            escola: primaryStudent.escola || primarySchool.name,
            imagem: catalogCourse?.imagem || null,
            descricao: catalogCourse?.descricao || '',
            categoria: catalogCourse?.categoria || null,
            duracao: catalogCourse?.duracao || null,
            acessoUrl: getStudentPortalUrl(primaryStudent.escola || primarySchool.name),
            studentId: primaryStudentId,
            schoolId: primarySchool.id,
            schoolApiKey: primarySchool.apiKey,
            ...initialAccess,
          });
        }
      });
    }

    const cursosList = Array.from(cursosMap.values());

    // 4b. Resumo progressivo: identidade + cursos sem os N relatórios de
    // progresso (rápido). O frontend renderiza e busca o full em seguida.
    if (detail === 'summary') {
      // Status oficial por curso (leve: 1 chamada pequena por curso, em paralelo).
      const accessByKey = new Map(
        await mapWithConcurrency(
          cursosList.filter((c) => c.id_curso),
          hotscoolConcurrency(),
          async (curso) => [
            `${curso.schoolId}:${curso.id_curso}`,
            await fetchCourseAccessStatus(curso.schoolApiKey, curso.studentId, curso.id_curso),
          ],
        )
      );
      const summaryCourses = cursosList.map((curso) => {
        const { schoolApiKey, ...publicFields } = curso;
        const official = accessByKey.get(`${curso.schoolId}:${curso.id_curso}`);
        const withOfficial = applyCourseAccessStatus(publicFields, official);
        if (official && Number.isSafeInteger(Number(official.status))) {
          return { ...withOfficial, percentual: 0, percentualFormatado: '0%', concluido: false };
        }
        return { ...withOfficial, acessoSincronizando: true, percentual: 0, percentualFormatado: '0%', concluido: false };
      });
      let summaryCadastro = null;
      if (s3Data.data_cadastro) {
        const parsed = new Date(s3Data.data_cadastro);
        if (!isNaN(parsed)) summaryCadastro = parsed.toLocaleDateString('pt-BR');
      }
      const summaryBlocked = summaryCourses.filter((c) => c.acessoAtivo === false).length;
      return res.status(200).json({
        detail: 'summary',
        id: primaryStudentId,
        nome: s3Data.nome || primaryStudent.nome || 'Nome não informado',
        email: s3Data.email || primaryStudent.email || cleanEmail,
        avatar: s3Data.avatar || primaryStudent.avatar || null,
        status: summaryBlocked > 0 ? 'Atenção' : 'Ativo',
        totalBloqueados: summaryBlocked,
        emailConfirmado: s3Data.email_confirmado === 1,
        codigoExterno: s3Data.codigo_externo || null,
        dataCadastro: summaryCadastro,
        ultimoAcesso: 'Sincronizando…',
        escola: escolas.join(', '),
        escolas,
        departamento: s3Data.categorizacao?.departamento || s3Data.departamento || null,
        unidade: s3Data.categorizacao?.unidade || null,
        cargo: s3Data.categorizacao?.cargo || null,
        trilhas: [],
        trilhasRaw: [],
        totalTrilhas: 0,
        trilhasConcluidas: 0,
        totalCursos: summaryCourses.length,
        cursosConcluidos: 0,
        progressoGeral: 0,
        totalCertificados: 0,
        cursos: summaryCourses,
        certificados: [],
        gamificacao: { pontos: 0, moedas: 0, acoes: 0, nivel: 'Sincronizando…', badge: null },
      });
    }

    // 5. Busca com paralelismo limitado o relatório de progresso de cada curso
    const cursosComProgresso = await mapWithConcurrency(
      cursosList,
      hotscoolConcurrency(),
      async (curso) => {
        if (!curso.id_curso) {
          return {
            ...curso,
            schoolApiKey: undefined,
            percentual: 0,
            percentualFormatado: '0%',
            concluido: false,
          };
        }

        let accessInfo = null;
        try {
          const [repRes, fetched] = await Promise.all([
            fetchWithTimeout(
              `${HOTSCOOL_API_URL}/students/${curso.studentId}/report/course/${curso.id_curso}`,
              {
                headers: {
                  'x-access-token': curso.schoolApiKey,
                  'Accept': 'application/json',
                },
              }
            ),
            fetchCourseAccessStatus(curso.schoolApiKey, curso.studentId, curso.id_curso),
          ]);
          accessInfo = fetched;

          if (repRes.ok) {
            const repData = await repRes.json();
            const rel = repData.relatorio_curso || {};
            const percRaw = rel.percentual_visto || '0%';
            const percNum = parseInt(String(percRaw).replace(/\D/g, ''), 10) || 0;
            const isDone = rel.curso_concluido === true || percNum >= 100;

            let certUrl = null;
            if (rel.certificado && Array.isArray(rel.certificado) && rel.certificado.length > 0) {
              certUrl = rel.certificado[0].url || null;
            } else if (rel.certificado?.url) {
              certUrl = rel.certificado.url;
            }

            const access = applyCourseAccessStatus(getEnrollmentAccessStatus(curso, rel), accessInfo);
            return {
              id_curso: curso.id_curso,
              titulo_curso: curso.titulo_curso,
              turma: rel.turma || curso.turma || 'Geral',
              escola: curso.escola,
              imagem: curso.imagem,
              descricao: curso.descricao,
              categoria: curso.categoria,
              duracao: curso.duracao,
              acessoUrl: curso.acessoUrl,
              studentId: curso.studentId,
              schoolId: curso.schoolId,
              ...access,
              percentual: percNum,
              percentualFormatado: `${percNum}%`,
              concluido: isDone,
              certificadoUrl: certUrl,
              aulasAssistidasCount: Array.isArray(rel.aulas_visualizadas) ? rel.aulas_visualizadas.length : 0,
            };
          }
        } catch (repErr) {
          // Fallback se não conseguir obter o relatório do curso
        }

        return {
          ...curso,
          ...applyCourseAccessStatus(getEnrollmentAccessStatus(curso, {}), accessInfo),
          schoolApiKey: undefined,
          percentual: 0,
          percentualFormatado: '0%',
          concluido: false,
        };
      },
    );

    // 5. Busca Certificados Emitidos
    let certificados = [];
    try {
      const certRes = await fetchWithTimeout(`${HOTSCOOL_API_URL}/certificates/issued/all/0`, {
        headers: {
          'x-access-token': primarySchool.apiKey,
          'Accept': 'application/json',
        },
      });

      if (certRes.ok) {
        const certJson = await certRes.json();
        const rawList = Array.isArray(certJson.data) ? certJson.data : (Array.isArray(certJson) ? certJson : []);
        
        certificados = rawList
          .filter((c) => {
            const cEmail = (c.aluno?.email || '').toLowerCase().trim();
            const cId = c.aluno?.id;
            return cEmail === cleanEmail || cId === primaryStudentId;
          })
          .map((c) => ({
            id: c.id,
            cursoNome: c.curso?.nome || 'Certificado de Curso',
            dataEmissao: c.data ? new Date(c.data).toLocaleDateString('pt-BR') : 'Data não informada',
            url: c.url,
          }));
      }
    } catch (certErr) {
      console.error('Erro ao buscar certificados:', certErr.message);
    }

    // 6. Gamificação
    let gamificacao = {
      pontos: 0,
      moedas: 0,
      acoes: 0,
      nivel: 'Iniciante',
      badge: null,
    };

    if (s3Data.gamificacao && typeof s3Data.gamificacao === 'object' && !Array.isArray(s3Data.gamificacao)) {
      gamificacao.pontos = s3Data.gamificacao.total_pontos || 0;
      gamificacao.moedas = s3Data.gamificacao.total_moedas || 0;
      gamificacao.acoes = s3Data.gamificacao.total_acoes || 0;
      gamificacao.nivel = s3Data.gamificacao.nivel || 'Iniciante';
      gamificacao.badge = s3Data.gamificacao.badge || null;
    }

    // 6b. Trilhas/Pacotes enriquecidas com progresso
    let trilhasEnriquecidas = [];
    try {
      const packagesCatalog = await fetchPackagesFromSchool(primarySchool.apiKey).catch(() => []);
      const cursoProgressMap = new Map(cursosComProgresso.map((c) => [Number(c.id_curso), c]));
      const rawTrilhas = Array.isArray(s3Data.trilhas) ? s3Data.trilhas : [];

      // Helper para computar progresso de um pacote
      const enrichPackage = (pkg, origem) => {
        const pkgCursos = Array.isArray(pkg.cursos) ? pkg.cursos : [];
        const cursosDaTrilha = pkgCursos.map((pc) => {
          const prog = cursoProgressMap.get(Number(pc.id));
          return {
            id_curso: Number(pc.id),
            titulo_curso: pc.nome || prog?.titulo_curso || `Curso #${pc.id}`,
            percentual: prog?.percentual || 0,
            percentualFormatado: prog?.percentualFormatado || '0%',
            concluido: prog?.concluido || false,
            matriculado: !!prog,
            imagem: prog?.imagem || null,
          };
        });
        const total = cursosDaTrilha.length;
        const matriculados = cursosDaTrilha.filter((c) => c.matriculado).length;
        const concluidos = cursosDaTrilha.filter((c) => c.concluido).length;
        const soma = cursosDaTrilha.reduce((acc, c) => acc + (c.percentual || 0), 0);
        const progresso = total > 0 ? Math.round(soma / total) : 0;
        const concluida = total > 0 && matriculados === total && concluidos === total;
        const emAndamento = matriculados > 0 && !concluida;
        return {
          id: pkg.id,
          id_trilha: pkg.id,
          nome: pkg.nome || origem?.nome_trilha || origem?.nome || 'Trilha',
          descricao: pkg.descricao || '',
          origem: origem ? 'hotscool_trilha' : 'pacote',
          totalCursos: total,
          matriculados,
          concluidos,
          progresso,
          percentualFormatado: `${progresso}%`,
          concluida,
          emAndamento,
          cursos: cursosDaTrilha,
        };
      };

      // 1) Trilhas nativas da Hotscool
      for (const t of rawTrilhas) {
        const tid = Number(t.id_trilha || t.id);
        const pkgMatch = packagesCatalog.find((p) => Number(p.id) === tid || String(p.nome).toLowerCase() === String(t.nome_trilha || t.nome || '').toLowerCase());
        if (pkgMatch) {
          trilhasEnriquecidas.push(enrichPackage(pkgMatch, t));
        } else {
          // Trilha sem pacote correspondente: estima progresso pelos cursos matriculados que pertencem ao nome
          trilhasEnriquecidas.push({
            id: tid || 0,
            id_trilha: tid || 0,
            nome: t.nome_trilha || t.nome || 'Trilha',
            descricao: '',
            origem: 'hotscool_trilha',
            totalCursos: 0,
            matriculados: 0,
            concluidos: 0,
            progresso: 0,
            percentualFormatado: '0%',
            concluida: false,
            emAndamento: false,
            cursos: [],
          });
        }
      }
      // 2) Pacotes onde aluno já tem pelo menos 1 curso, mas não está em s3Data.trilhas
      for (const pkg of packagesCatalog) {
        const jaExiste = trilhasEnriquecidas.some((tr) => Number(tr.id) === Number(pkg.id));
        if (jaExiste) continue;
        const temCursoDoPacote = pkg.cursos.some((pc) => cursoProgressMap.has(Number(pc.id)));
        if (temCursoDoPacote) {
          trilhasEnriquecidas.push(enrichPackage(pkg, null));
        }
      }
    } catch (e) {
      console.error('[Trilhas] Falha ao enriquecer trilhas:', e.message);
      trilhasEnriquecidas = Array.isArray(s3Data.trilhas) ? s3Data.trilhas.map((t) => ({ ...t, nome: t.nome_trilha || t.nome, id_trilha: t.id_trilha || t.id, progresso: 0, concluida: false, cursos: [] })) : [];
    }

    // 7. Cálculos de indicadores
    const totalCursos = cursosComProgresso.length;
    const cursosConcluidos = cursosComProgresso.filter((c) => c.concluido).length;
    const somaProgresso = cursosComProgresso.reduce((acc, c) => acc + (c.percentual || 0), 0);
    const progressoGeral = totalCursos > 0 ? Math.round(somaProgresso / totalCursos) : 0;

    // Datas formatadas
    let ultimoLoginDate = null;
    if (s3Data.ultimo_login) {
      const d = new Date(s3Data.ultimo_login);
      if (!isNaN(d)) ultimoLoginDate = d;
    } else {
      searchResults.forEach((r) => {
        if (r.match.ultimo_login) {
          const d = new Date(r.match.ultimo_login);
          if (!isNaN(d) && (!ultimoLoginDate || d > ultimoLoginDate)) {
            ultimoLoginDate = d;
          }
        }
      });
    }

    const dataAcessoFormatada = ultimoLoginDate
      ? ultimoLoginDate.toLocaleDateString('pt-BR') + ' às ' + ultimoLoginDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : 'Nunca acessou';

    const dataCadastroFormatada = s3Data.data_cadastro
      ? new Date(s3Data.data_cadastro).toLocaleDateString('pt-BR')
      : null;

    // Grupos / Departamentos (Categorização sem CPF/Endereço/Telefone)
    const categorizacao = s3Data.categorizacao || {};
    const departamento = categorizacao.departamento || s3Data.departamento || null;
    const unidade = categorizacao.unidade || null;
    const cargo = categorizacao.cargo || null;

    // Resposta consolidada (SEM CPF, SEM ENDEREÇO, SEM TELEFONE)
    // SEM apiKey: cada curso leva apenas schoolId + studentId para reativação.
    const cursosPublicos = cursosComProgresso.map((curso) => {
      const { schoolApiKey, ...rest } = curso;
      return rest;
    });
    const totalBloqueados = cursosPublicos.filter((c) => c.acessoAtivo === false).length;
    return res.status(200).json({
      id: primaryStudentId,
      nome: s3Data.nome || primaryStudent.nome || 'Nome não informado',
      email: s3Data.email || primaryStudent.email || cleanEmail,
      avatar: s3Data.avatar || primaryStudent.avatar || null,
      status: totalBloqueados > 0 ? (totalBloqueados >= totalCursos ? 'Bloqueado' : 'Atenção') : 'Ativo',
      totalBloqueados,
      emailConfirmado: s3Data.email_confirmado === 1,
      codigoExterno: s3Data.codigo_externo || null,
      dataCadastro: dataCadastroFormatada,
      ultimoAcesso: dataAcessoFormatada,
      escola: escolas.join(', '),
      escolas: escolas,
      departamento,
      unidade,
      cargo,
      trilhas: trilhasEnriquecidas,
      trilhasRaw: Array.isArray(s3Data.trilhas) ? s3Data.trilhas : [],
      totalTrilhas: trilhasEnriquecidas.length,
      trilhasConcluidas: trilhasEnriquecidas.filter((t) => t.concluida).length,
      // Indicadores
      totalCursos,
      cursosConcluidos,
      progressoGeral,
      totalCertificados: certificados.length,
      // Listas
      cursos: cursosPublicos,
      certificados,
      gamificacao,
    });
  } catch (error) {
    console.error('Erro interno na consulta de aluno.');
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
}
