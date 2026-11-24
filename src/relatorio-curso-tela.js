// Tela "Relatório por curso": escolhe escola e curso, mostra indicadores e a lista de alunos, exporta PDF e CSV.
// Colunas Área de Negócio e Time vêm do WordPress (perfil do colaborador, anexado em lib/relatorio-curso.js).
import { escapeHtml, kpiCard } from './avaliacoes-dashboard.js';
import { buildCsvCurso, relatorioCursoPages } from './relatorio-curso.js';

const el = (id) => document.getElementById(id);
const relEscola = el('relEscola');
const relCurso = el('relCurso');
const relKpis = el('relKpis');
const relTbody = el('relTbody');
const relStatus = el('relStatus');
const relAtualizado = el('relAtualizado');
const relBusca = el('relBusca');
const relPdfBtn = el('relPdfBtn');
const relCsvBtn = el('relCsvBtn');
const relFiltroTime = el('relFiltroTime');
const relFiltroArea = el('relFiltroArea');

let escolasCarregadas = false;
let dados = null;
let filtro = 'todos';
let filtroTime = '';
let filtroArea = '';

function limpar() {
  dados = null;
  filtro = 'todos';
  filtroTime = '';
  filtroArea = '';
  relKpis.innerHTML = '';
  relTbody.innerHTML = '';
  relStatus.textContent = '';
  relAtualizado.textContent = '';
  if (relFiltroTime) relFiltroTime.innerHTML = '<option value="">Todos os times</option>';
  if (relFiltroArea) relFiltroArea.innerHTML = '<option value="">Todas as áreas</option>';
  ['relCountTodos', 'relCountConcluidos', 'relCountBloqueados'].forEach((id) => { el(id).textContent = '0'; });
}

// Preenche os selects de Time e Área com os valores presentes na lista atual.
function popularFiltros() {
  if (!relFiltroTime || !relFiltroArea || !dados) return;
  const times = [...new Set((dados.alunos || []).flatMap((a) => a.equipes || []))].sort((x, y) => x.localeCompare(y, 'pt-BR'));
  const areas = [...new Set((dados.alunos || []).map((a) => a.areaNegocio).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'pt-BR'));
  relFiltroTime.innerHTML = '<option value="">Todos os times</option>'
    + times.map((t) => `<option value="${escapeHtml(t)}"${t === filtroTime ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('');
  relFiltroArea.innerHTML = '<option value="">Todas as áreas</option>'
    + areas.map((a) => `<option value="${escapeHtml(a)}"${a === filtroArea ? ' selected' : ''}>${escapeHtml(a)}</option>`).join('');
}

function linhaDoAluno(a) {
  const pct = Math.min(100, Math.max(0, a.progresso));
  const situacao = a.bloqueado
    ? '<span class="avl-status avl-status--bad">Bloqueado</span>'
    : a.concluido
      ? '<span class="avl-status avl-status--done">Concluído</span>'
      : '<span class="avl-status avl-status--ok">Em andamento</span>';
  const ultimoLogin = a.ultimoLogin ? new Date(a.ultimoLogin).toLocaleDateString('pt-BR') : 'Nunca';
  const times = Array.isArray(a.equipes) && a.equipes.length ? a.equipes.join(', ') : '—';
  return `<tr>
    <td><strong>${escapeHtml(a.nome)}</strong><br><small>${escapeHtml(a.email)}</small></td>
    <td><div class="rel-progress"><div class="rel-progress__bar"><span style="width:${pct}%"></span></div><span class="rel-progress__pct">${pct}%</span></div></td>
    <td>${escapeHtml(a.areaNegocio || '—')}</td>
    <td>${escapeHtml(times)}</td>
    <td class="col-center">${Number(a.aulasVistas)} de ${Number(a.totalAulas)}</td>
    <td class="col-center">${escapeHtml(ultimoLogin)}</td>
    <td class="col-center">${situacao}</td>
  </tr>`;
}

function renderTabela() {
  const termo = relBusca.value.trim().toLowerCase();
  const lista = dados.alunos
    .filter((a) => filtro === 'todos' || (filtro === 'concluidos' ? a.concluido : a.bloqueado))
    .filter((a) => !filtroArea || a.areaNegocio === filtroArea)
    .filter((a) => !filtroTime || (Array.isArray(a.equipes) && a.equipes.includes(filtroTime)))
    .filter((a) => !termo || `${a.nome} ${a.email}`.toLowerCase().includes(termo))
    .sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));
  relTbody.innerHTML = lista.length
    ? lista.map(linhaDoAluno).join('')
    : '<tr><td colspan="7">Nenhum aluno encontrado.</td></tr>';
  relStatus.textContent = `${lista.length} de ${dados.alunos.length} alunos`;
  relAtualizado.textContent = `Atualizado em ${new Date(dados.atualizadoEm).toLocaleString('pt-BR')}`;
}

function render() {
  const { resumo } = dados;
  relKpis.innerHTML = [
    kpiCard({ label: 'Alunos', value: String(resumo.alunos), sub: 'matrículas no curso', icon: 'users' }),
    kpiCard({ label: 'Progresso médio', value: `${resumo.progressoMedio}%`, sub: 'aulas vistas', tone: 'dark', icon: 'award' }),
    kpiCard({ label: 'Em andamento', value: String(resumo.emAndamento), sub: 'ainda não concluíram', icon: 'star' }),
    kpiCard({ label: 'Bloqueados', value: String(resumo.bloqueados), sub: 'sem acesso ao curso', tone: 'coral', icon: 'alert' }),
  ].join('');
  el('relCountTodos').textContent = String(resumo.alunos);
  el('relCountConcluidos').textContent = String(resumo.concluidos);
  el('relCountBloqueados').textContent = String(resumo.bloqueados);
  popularFiltros();
  renderTabela();
}

export async function ensureRelatorioCursoLoaded() {
  if (escolasCarregadas) return;
  try {
    const res = await fetch('/api/courses');
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Falha ao carregar as escolas.');
    relEscola.innerHTML = '<option value="">Selecione a escola</option>'
      + json.schools.map((s) => `<option value="${Number(s.id)}">${escapeHtml(s.name)}</option>`).join('');
    escolasCarregadas = true;
  } catch (error) {
    relStatus.textContent = error.message;
  }
}

relEscola.addEventListener('change', async () => {
  limpar();
  relCurso.innerHTML = '<option value="">Selecione o curso</option>';
  relCurso.disabled = true;
  if (!relEscola.value) return;
  relStatus.textContent = 'Carregando cursos...';
  try {
    const res = await fetch(`/api/courses?schoolIndex=${Number(relEscola.value)}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Falha ao carregar os cursos.');
    relCurso.innerHTML = '<option value="">Selecione o curso</option>'
      + json.courses.map((c) => `<option value="${Number(c.id)}">${escapeHtml(c.nome)}</option>`).join('');
    relCurso.disabled = false;
    relStatus.textContent = '';
  } catch (error) {
    relStatus.textContent = error.message;
  }
});

relCurso.addEventListener('change', async () => {
  limpar();
  if (!relCurso.value) return;
  relStatus.textContent = 'Carregando alunos do curso... pode levar alguns segundos.';
  try {
    const res = await fetch(`/api/licenses?view=relatorio-curso&schoolIndex=${Number(relEscola.value)}&courseId=${Number(relCurso.value)}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Falha ao carregar o relatório.');
    dados = json;
    render();
  } catch (error) {
    relStatus.textContent = error.message;
  }
});

document.querySelectorAll('[data-rel-filter]').forEach((btn) => {
  btn.addEventListener('click', () => {
    filtro = btn.dataset.relFilter;
    document.querySelectorAll('[data-rel-filter]').forEach((b) => {
      const ativo = b === btn;
      b.classList.toggle('is-active', ativo);
      b.setAttribute('aria-pressed', String(ativo));
    });
    if (dados) renderTabela();
  });
});

if (relFiltroTime) {
  relFiltroTime.addEventListener('change', () => {
    filtroTime = relFiltroTime.value;
    if (dados) renderTabela();
  });
}

if (relFiltroArea) {
  relFiltroArea.addEventListener('change', () => {
    filtroArea = relFiltroArea.value;
    if (dados) renderTabela();
  });
}

relBusca.addEventListener('input', () => { if (dados) renderTabela(); });

relCsvBtn.addEventListener('click', () => {
  if (!dados) return;
  const blob = new Blob(['﻿' + buildCsvCurso(dados)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `relatorio-curso-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

relPdfBtn.addEventListener('click', async () => {
  if (!dados) return;
  const original = relPdfBtn.textContent;
  relPdfBtn.disabled = true;
  relPdfBtn.textContent = 'Gerando PDF...';
  // Palco fora da tela: as páginas são montadas, capturadas e descartadas.
  const palco = document.createElement('div');
  palco.style.cssText = 'position:fixed;left:-10000px;top:0;background:#ffffff;';
  document.body.appendChild(palco);
  try {
    let bibliotecas;
    try {
      bibliotecas = await Promise.all([import('html2canvas'), import('jspdf')]);
    } catch {
      // Arquivo de uma versão anterior: a aba está desatualizada depois de um novo deploy.
      relStatus.textContent = 'Esta página está desatualizada. Recarregue com Ctrl+F5 e gere o PDF de novo.';
      return;
    }
    const [{ default: html2canvas }, { jsPDF }] = bibliotecas;
    palco.innerHTML = relatorioCursoPages({
      curso: dados.curso,
      resumo: dados.resumo,
      alunos: [...dados.alunos].sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR')),
      geradoEm: new Date().toLocaleString('pt-BR'),
    }).join('');
    await document.fonts?.ready;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const paginas = palco.querySelectorAll('.avl-rel-page');
    for (let i = 0; i < paginas.length; i += 1) {
      const canvas = await html2canvas(paginas[i], { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false });
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    }
    pdf.save(`relatorio-curso-${new Date().toISOString().slice(0, 10)}.pdf`);
  } catch {
    relStatus.textContent = 'Não foi possível gerar o PDF. Tente novamente.';
  } finally {
    palco.remove();
    relPdfBtn.disabled = false;
    relPdfBtn.textContent = original;
  }
});
