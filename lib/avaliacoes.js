// Avaliações do quiz de Fundamentos de IA: visão dos gestores e liberação de alunos bloqueados.
// Os dados vêm do Supabase (banco do quiz), com a chave de serviço guardada só no servidor.
// Liberar: primeiro reativa o acesso na Hotscool; só depois grava no banco. Se a Hotscool falhar, nada muda.
import { requirePermission } from './auth-utils.js';
import { applyRateLimit, requireTrustedGetRequest, requireTrustedJsonRequest } from './security.js';
import { getSchools, HOTSCOOL_API_URL } from './hotscool.js';

// id_escola da Academia Consistem na Hotscool (o quiz só atende esta escola).
export const QUIZ_SCHOOL_ID = 7137;
export const MAX_TENTATIVAS = 3;

export class LiberacaoError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function db(method, path, { body, prefer } = {}) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('Banco do quiz não configurado.');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Supabase respondeu ${response.status} em ${path.split('?')[0]}.`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

// Junta matrículas, alunos, tentativas e eventos em uma linha por aluno e curso.
// "usadas" conta só as tentativas feitas depois da última liberação.
export function summarizeEnrollments({ alunos, matriculas, tentativas, eventos, areasPorEmail = new Map() }) {
  const alunoById = new Map(alunos.map((a) => [a.id, a]));
  const eventosPorTentativa = new Map();
  for (const e of eventos) {
    const tipos = eventosPorTentativa.get(e.tentativa_id) || {};
    tipos[e.tipo] = (tipos[e.tipo] || 0) + 1;
    eventosPorTentativa.set(e.tentativa_id, tipos);
  }

  return matriculas
    .filter((m) => alunoById.has(m.aluno_id))
    .map((m) => {
      const aluno = alunoById.get(m.aluno_id);
      const desde = m.liberado_em ? Date.parse(m.liberado_em) : 0;
      const doCurso = tentativas
        .filter((t) => t.aluno_id === m.aluno_id && t.course_id === m.course_id)
        .sort((a, b) => a.numero - b.numero);
      const ultima = doCurso.at(-1) || null;
      const usadas = doCurso.filter((t) => Date.parse(t.iniciada_em) >= desde).length;
      const situacao = m.status === 'bloqueado' ? 'bloqueado' : usadas >= MAX_TENTATIVAS ? 'esgotado' : 'ativo';
      const cadastro = areasPorEmail.get(String(aluno.email || '').toLowerCase()) || {};
      return {
        alunoId: m.aluno_id,
        nome: aluno.nome,
        email: aluno.email,
        area: cadastro.area || null,
        time: cadastro.time || null,
        cargo: cadastro.cargo || null,
        courseId: m.course_id,
        status: m.status,
        situacao,
        bloqueadoEm: m.bloqueado_em,
        liberadoEm: m.liberado_em,
        liberadoPor: m.liberado_por,
        usadas,
        maxTentativas: MAX_TENTATIVAS,
        ultimaNota: ultima?.nota ?? null,
        tentativas: doCurso.map((t) => ({
          numero: t.numero,
          iniciadaEm: t.iniciada_em,
          finalizadaEm: t.finalizada_em,
          duracaoMin: t.finalizada_em
            ? Math.round(((Date.parse(t.finalizada_em) - Date.parse(t.iniciada_em)) / 60_000) * 10) / 10
            : null,
          nota: t.nota,
          aprovado: t.aprovado,
          status: t.status,
          eventos: Object.values(eventosPorTentativa.get(t.id) || {}).reduce((soma, n) => soma + n, 0),
          eventosPorTipo: eventosPorTentativa.get(t.id) || {},
        })),
      };
    });
}

// Uma linha por resposta, com módulo e nível da questão. O texto das discursivas não sai do servidor.
export function summarizeAnswers({ respostas, questoes, tentativas }) {
  const questaoById = new Map(questoes.map((q) => [q.id, q]));
  const tentativaById = new Map(tentativas.map((t) => [t.id, t]));
  return respostas.flatMap((r) => {
    const tentativa = tentativaById.get(r.tentativa_id);
    const questao = questaoById.get(r.questao_id);
    if (!tentativa || !questao) return [];
    return [{
      tentativaId: tentativa.id,
      alunoId: tentativa.aluno_id,
      courseId: tentativa.course_id,
      numero: tentativa.numero,
      questaoId: questao.id,
      tipo: questao.tipo,
      modulo: questao.modulo?.nome || 'Sem módulo',
      nivel: questao.matriz?.nivel || null,
      correta: r.correta,
      nota: r.nota_discursiva,
      tempoMs: r.tempo_ms,
    }];
  });
}

// Nome do curso (título na Hotscool) para cada id, com cache de 1 hora. Falha em silêncio: sem nome, a tela mostra o código.
const nomesCursoCache = new Map();
const NOMES_CURSO_TTL_MS = 60 * 60 * 1000;

async function nomesDosCursos(courseIds) {
  const nomes = new Map();
  const chaves = getSchools().map((s) => s.apiKey);
  await Promise.all([...new Set(courseIds.map(Number))].map(async (id) => {
    const emCache = nomesCursoCache.get(id);
    if (emCache && emCache.ate > Date.now()) { nomes.set(id, emCache.nome); return; }
    for (const apiKey of chaves) {
      try {
        const response = await fetch(`${HOTSCOOL_API_URL}/courses/${id}`, {
          headers: { 'x-access-token': apiKey, Accept: 'application/json' },
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) continue;
        const data = await response.json().catch(() => ({}));
        if (Number(data.id_escola) !== QUIZ_SCHOOL_ID) continue;
        const nome = String(data.titulo_curso || data.nome || data.titulo || '').trim();
        if (nome) {
          nomesCursoCache.set(id, { nome, ate: Date.now() + NOMES_CURSO_TTL_MS });
          nomes.set(id, nome);
        }
        return;
      } catch {
        // tenta a próxima chave
      }
    }
  }));
  return nomes;
}

// areas: lista de áreas que o usuário pode ver (gestor). null = todas (educação).
export async function listEnrollments({ areas = null } = {}) {
  const [alunos, matriculas, tentativas, eventos, respostas, questoes, cadastros] = await Promise.all([
    db('GET', `alunos?school_id=eq.${QUIZ_SCHOOL_ID}&select=id,nome,email`),
    db('GET', 'matriculas?select=aluno_id,course_id,status,bloqueado_em,liberado_em,liberado_por'),
    db('GET', 'tentativas?select=id,aluno_id,course_id,numero,iniciada_em,finalizada_em,nota,aprovado,status'),
    db('GET', 'eventos_integridade?select=tentativa_id,tipo'),
    db('GET', 'respostas_tentativa?select=tentativa_id,questao_id,correta,nota_discursiva,tempo_ms'),
    db('GET', 'questoes?select=id,tipo,modulo:modulos(nome),matriz:matrizes(nivel)'),
    db('GET', 'alunos_area?select=email,area,time,cargo'),
  ]);
  const areasPorEmail = new Map(cadastros.map((c) => [String(c.email).toLowerCase(), { area: c.area, time: c.time, cargo: c.cargo }]));
  let items = summarizeEnrollments({ alunos, matriculas, tentativas, eventos, areasPorEmail });
  const nomes = await nomesDosCursos(items.map((i) => i.courseId)).catch(() => new Map());
  items = items.map((i) => ({ ...i, cursoNome: nomes.get(Number(i.courseId)) || null }));
  let respostasVisiveis = summarizeAnswers({ respostas, questoes, tentativas });
  if (areas) {
    // Gestor: só alunos das áreas dele. Quem não tem cadastro de área não aparece.
    const permitidas = new Set(areas);
    items = items.filter((i) => i.area && permitidas.has(i.area));
    const alunosVisiveis = new Set(items.map((i) => i.alunoId));
    respostasVisiveis = respostasVisiveis.filter((r) => alunosVisiveis.has(r.alunoId));
  }
  return { items, respostas: respostasVisiveis };
}

// Chave da Hotscool que enxerga a escola do quiz. As chaves do LMS são indexadas, então testamos cada uma no curso.
async function keyForQuizSchool(courseId) {
  for (const school of getSchools()) {
    const response = await fetch(`${HOTSCOOL_API_URL}/courses/${courseId}`, {
      headers: { 'x-access-token': school.apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) continue;
    const data = await response.json().catch(() => ({}));
    if (Number(data.id_escola) === QUIZ_SCHOOL_ID) return school.apiKey;
  }
  return null;
}

export async function liberarAluno({ alunoId, courseId, email }) {
  const [matricula] = await db('GET', `matriculas?aluno_id=eq.${alunoId}&course_id=eq.${courseId}&select=status,liberado_em`);
  if (!matricula) throw new LiberacaoError(404, 'Matrícula não encontrada.');
  // Liberável quando está bloqueada ou quando as tentativas desde a última liberação acabaram.
  const desde = matricula.liberado_em ? Date.parse(matricula.liberado_em) : 0;
  const tentativas = await db('GET', `tentativas?aluno_id=eq.${alunoId}&course_id=eq.${courseId}&select=iniciada_em`);
  const usadas = tentativas.filter((t) => Date.parse(t.iniciada_em) >= desde).length;
  if (matricula.status !== 'bloqueado' && usadas < MAX_TENTATIVAS) {
    throw new LiberacaoError(409, 'Este aluno ainda tem tentativas disponíveis.');
  }

  const apiKey = await keyForQuizSchool(courseId);
  if (!apiKey) throw new LiberacaoError(503, 'Nenhuma chave da Hotscool com acesso a esta escola.');

  // Status 1 = ativo. Repetir a chamada é seguro: a Hotscool só reativa.
  const response = await fetch(`${HOTSCOOL_API_URL}/students/access/${alunoId}/${courseId}/1`, {
    method: 'PUT',
    headers: { 'x-access-token': apiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new LiberacaoError(502, `A Hotscool recusou a liberação (HTTP ${response.status}).`);

  const liberadoEm = new Date().toISOString();
  await db('PATCH', `matriculas?aluno_id=eq.${alunoId}&course_id=eq.${courseId}`, {
    body: { status: 'ativo', liberado_em: liberadoEm, liberado_por: email },
    prefer: 'return=minimal',
  });
  await db('POST', 'acoes_hotscool', {
    body: [{
      tipo: 'liberar',
      payload: { student_id: alunoId, course_id: courseId, status: 1 },
      status: 'ok',
      tentativas: 1,
      atualizado_em: liberadoEm,
    }],
    prefer: 'return=minimal',
  });
  try {
    await db('POST', 'auditoria', {
      body: [{ ator_email: email, acao: 'liberar_acesso', alvo: { aluno_id: alunoId, curso_id: courseId } }],
      prefer: 'return=minimal',
    });
  } catch (error) {
    console.error('[avaliacoes] falha ao registrar auditoria', error.message);
  }
  return { ok: true, liberadoEm };
}

// Bloqueio manual: só para quem esgotou as tentativas desde a última liberação e ainda está ativo.
export function podeBloquear({ status, usadas }) {
  return status !== 'bloqueado' && usadas >= MAX_TENTATIVAS;
}

export async function bloquearAluno({ alunoId, courseId, email }) {
  const [matricula] = await db('GET', `matriculas?aluno_id=eq.${alunoId}&course_id=eq.${courseId}&select=status,liberado_em`);
  if (!matricula) throw new LiberacaoError(404, 'Matrícula não encontrada.');
  const desde = matricula.liberado_em ? Date.parse(matricula.liberado_em) : 0;
  const tentativas = await db('GET', `tentativas?aluno_id=eq.${alunoId}&course_id=eq.${courseId}&select=iniciada_em`);
  const usadas = tentativas.filter((t) => Date.parse(t.iniciada_em) >= desde).length;
  if (!podeBloquear({ status: matricula.status, usadas })) {
    throw new LiberacaoError(409, 'Só é possível bloquear quem esgotou as tentativas e ainda está ativo.');
  }

  const apiKey = await keyForQuizSchool(courseId);
  if (!apiKey) throw new LiberacaoError(503, 'Nenhuma chave da Hotscool com acesso a esta escola.');

  // Status 2 = bloqueado na Hotscool. Primeiro a Hotscool; só depois o banco.
  const response = await fetch(`${HOTSCOOL_API_URL}/students/access/${alunoId}/${courseId}/2`, {
    method: 'PUT',
    headers: { 'x-access-token': apiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new LiberacaoError(502, `A Hotscool recusou o bloqueio (HTTP ${response.status}).`);

  const bloqueadoEm = new Date().toISOString();
  await db('PATCH', `matriculas?aluno_id=eq.${alunoId}&course_id=eq.${courseId}`, {
    body: { status: 'bloqueado', bloqueado_em: bloqueadoEm },
    prefer: 'return=minimal',
  });
  await db('POST', 'acoes_hotscool', {
    body: [{
      tipo: 'bloquear',
      payload: { student_id: alunoId, course_id: courseId, status: 2 },
      status: 'ok',
      tentativas: 1,
      atualizado_em: bloqueadoEm,
    }],
    prefer: 'return=minimal',
  });
  try {
    await db('POST', 'auditoria', {
      body: [{ ator_email: email, acao: 'bloquear_acesso', alvo: { aluno_id: alunoId, curso_id: courseId, origem: 'lms' } }],
      prefer: 'return=minimal',
    });
  } catch (error) {
    console.error('[avaliacoes] falha ao registrar auditoria', error.message);
  }
  return { ok: true, bloqueadoEm };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  if (req.method === 'GET') {
    const user = await requirePermission(req, res, 'avaliacoes:read');
    if (!user) return;
    if (!applyRateLimit(req, res, { name: 'avaliacoes', identity: user.id, max: 30, windowMs: 60_000 })) return;
    if (!requireTrustedGetRequest(req, res)) return;
    try {
      return res.status(200).json(await listEnrollments({ areas: user.authorization.areas }));
    } catch (error) {
      console.error('[avaliacoes] falha ao listar', error.message);
      return res.status(502).json({ error: 'Não foi possível carregar as avaliações agora.' });
    }
  }

  if (req.method === 'POST') {
    const user = await requirePermission(req, res, 'avaliacoes:write');
    if (!user) return;
    if (!requireTrustedJsonRequest(req, res)) return;
    if (!applyRateLimit(req, res, { name: 'avaliacoes-write', identity: user.id, max: 20, windowMs: 60_000 })) return;

    const alunoId = Number(req.body?.alunoId);
    const courseId = Number(req.body?.courseId);
    if (!Number.isSafeInteger(alunoId) || !Number.isSafeInteger(courseId) || alunoId <= 0 || courseId <= 0) {
      return res.status(400).json({ error: 'Informe o aluno e o curso.' });
    }
    try {
      const acao = req.body?.acao === 'bloquear' ? bloquearAluno : liberarAluno;
      return res.status(200).json(await acao({ alunoId, courseId, email: user.email }));
    } catch (error) {
      if (error instanceof LiberacaoError) return res.status(error.status).json({ error: error.message });
      console.error('[avaliacoes] falha ao liberar', error.message);
      return res.status(502).json({ error: 'Não foi possível liberar o aluno agora. Tente novamente.' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Método não permitido.' });
}
