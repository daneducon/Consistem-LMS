// Relatório por curso: alunos de um curso com progresso, aulas vistas, último login e situação.
// Fonte: Hotscool. Lista de alunos em /courses/{id}/report/classes/{page}; por aluno, report2 (progresso e aulas)
// e access (bloqueio). Só são repassados os campos necessários à tela: CPF, telefone e endereço nunca saem daqui.
import { filterAuthorizedSchools, requirePermission } from './auth-utils.js';
import { applyRateLimit, requireTrustedGetRequest } from './security.js';
import { getSchools, HOTSCOOL_API_URL, mapWithConcurrency } from './hotscool.js';
import { getWordPressProfilesByEmails } from './wordpress.js';

const CACHE_MS = 10 * 60 * 1000;
const MAX_PAGINAS = 200;
const CONCORRENCIA = 8;
const cache = new Map();

async function hsGet(apiKey, path) {
  const response = await fetch(`${HOTSCOOL_API_URL}${path}`, {
    headers: { 'x-access-token': apiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Hotscool respondeu ${response.status}.`);
  return response.json();
}

// Percentual de aulas vistas: usa o campo da Hotscool ("79%") e, se faltar, calcula pelas aulas.
export function parsePercentual(bruto, totalAulas, aulasVistas) {
  const numero = Number.parseFloat(String(bruto ?? '').replace(',', '.'));
  if (Number.isFinite(numero)) return Math.min(100, Math.max(0, Math.round(numero)));
  if (totalAulas > 0) return Math.min(100, Math.max(0, Math.round((aulasVistas / totalAulas) * 100)));
  return 0;
}

// Totais da tela. "Em andamento" são os alunos que ainda não concluíram o curso.
export function resumirAlunos(alunos) {
  const total = alunos.length;
  const concluidos = alunos.filter((a) => a.concluido).length;
  const bloqueados = alunos.filter((a) => a.bloqueado).length;
  const progressoMedio = total ? Math.round(alunos.reduce((soma, a) => soma + a.progresso, 0) / total) : 0;
  return { alunos: total, concluidos, emAndamento: total - concluidos, bloqueados, progressoMedio };
}

async function listarAlunosDoCurso(apiKey, cursoId) {
  const porId = new Map();
  let nomeCurso = null;
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
    const json = await hsGet(apiKey, `/courses/${cursoId}/report/classes/${pagina}`);
    nomeCurso ??= json?.nome ? String(json.nome) : null;
    const alunos = Array.isArray(json?.alunos) ? json.alunos : [];
    if (alunos.length === 0) break;
    for (const aluno of alunos) {
      const id = Number(aluno.id);
      if (Number.isSafeInteger(id)) porId.set(id, aluno);
    }
  }
  return { nomeCurso, alunos: [...porId.values()] };
}

async function detalheDoAluno(apiKey, cursoId, aluno) {
  const [report, acesso] = await Promise.all([
    hsGet(apiKey, `/students/${Number(aluno.id)}/report2/course/${Number(cursoId)}`).catch(() => null),
    hsGet(apiKey, `/students/course/access/${Number(aluno.id)}/${Number(cursoId)}`).catch(() => null),
  ]);
  const relatorio = report?.alunos?.[0]?.relatorio_curso ?? null;
  const totalAulas = Number(relatorio?.total_aulas) || 0;
  const aulasVistas = Number(relatorio?.total_aulas_visto) || 0;
  const progresso = parsePercentual(relatorio?.percentual_visto, totalAulas, aulasVistas);
  return {
    id: Number(aluno.id),
    nome: String(aluno.nome || ''),
    email: String(aluno.email || ''),
    ultimoLogin: typeof aluno.ultimo_login === 'string' ? aluno.ultimo_login : null,
    totalAulas,
    aulasVistas,
    progresso,
    // Mesma regra da Consulta do aluno: concluído quando a Hotscool marca o curso ou quando todas as aulas foram vistas.
    concluido: relatorio?.curso_concluido === true || progresso >= 100,
    certificado: Array.isArray(relatorio?.certificado) && relatorio.certificado.length > 0,
    bloqueado: acesso?.status === 2 || acesso?.status === '2',
  };
}

// Junta o perfil do WordPress (Cargo/Função, Área de Negócio e Times) a cada
// aluno, casando por e-mail. Nunca derruba o relatório: se o WP falhar ou o
// aluno não existir lá, os campos ficam vazios.
async function anexarPerfilWordPress(alunos) {
  for (const aluno of alunos) {
    aluno.cargo = '';
    aluno.areaNegocio = '';
    aluno.funcoes = [];
    aluno.equipes = [];
  }
  try {
    const emails = alunos.map((aluno) => aluno.email).filter(Boolean);
    const perfis = await getWordPressProfilesByEmails(emails);
    for (const aluno of alunos) {
      const perfil = perfis[String(aluno.email || '').toLowerCase()];
      if (!perfil?.found) continue;
      aluno.cargo = perfil.cargo || '';
      aluno.areaNegocio = perfil.areaNegocio || '';
      aluno.funcoes = Array.isArray(perfil.funcoes) ? perfil.funcoes : [];
      aluno.equipes = Array.isArray(perfil.equipes) ? perfil.equipes : [];
    }
  } catch (error) {
    console.warn('[relatorio-curso] perfil WordPress indisponível:', error?.message || error);
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método não permitido.' });
  }
  const user = await requirePermission(req, res, 'students:read');
  if (!user) return;
  if (!applyRateLimit(req, res, { name: 'relatorio-curso', identity: user.id, max: 20, windowMs: 60_000 })) return;
  if (!requireTrustedGetRequest(req, res)) return;

  const schoolIndex = String(req.query?.schoolIndex ?? '');
  const cursoId = String(req.query?.courseId ?? '');
  if (!/^\d+$/.test(schoolIndex) || !/^\d+$/.test(cursoId)) {
    return res.status(400).json({ error: 'Informe a escola e o curso.' });
  }
  const escola = filterAuthorizedSchools(getSchools(), user).find((s) => s.id === Number(schoolIndex));
  if (!escola) return res.status(404).json({ error: 'Escola não encontrada.' });

  const chave = `${escola.id}:${cursoId}`;
  const emCache = cache.get(chave);
  if (emCache && emCache.ate > Date.now()) return res.status(200).json(emCache.dados);

  try {
    const { nomeCurso, alunos } = await listarAlunosDoCurso(escola.apiKey, cursoId);
    const detalhes = await mapWithConcurrency(alunos, CONCORRENCIA, (a) => detalheDoAluno(escola.apiKey, cursoId, a));
    await anexarPerfilWordPress(detalhes);
    const dados = {
      curso: { id: Number(cursoId), nome: nomeCurso || `Curso ${cursoId}` },
      atualizadoEm: new Date().toISOString(),
      resumo: resumirAlunos(detalhes),
      alunos: detalhes,
    };
    cache.set(chave, { dados, ate: Date.now() + CACHE_MS });
    return res.status(200).json(dados);
  } catch (error) {
    console.error('[relatorio-curso] falha', error.message);
    return res.status(502).json({ error: 'Não foi possível carregar o relatório agora.' });
  }
}
