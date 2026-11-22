// Escopo da tela, CSV e relatório PDF de Avaliações.
// O relatório é o que está filtrado na tela naquele momento: mesmos indicadores, mesma lista.
import { barRows, columnChart, computeStats, COLORS, donutChart, escapeHtml, formatNumber, kpiCardsFor } from './avaliacoes-dashboard.js';

// Escopo: área, pessoas escolhidas e só bloqueados. Sem filtro, vale tudo que a pessoa pode ver.
export function buildScope({ items, respostas }, { area = null, ids = null, onlyBlocked = false } = {}) {
  let scoped = items;
  if (area) scoped = scoped.filter((i) => i.area === area);
  if (ids && ids.size > 0) scoped = scoped.filter((i) => ids.has(i.alunoId));
  if (onlyBlocked) scoped = scoped.filter((i) => i.situacao !== 'ativo');
  const alunos = new Set(scoped.map((i) => i.alunoId));
  return { items: scoped, respostas: respostas.filter((r) => alunos.has(r.alunoId)) };
}

export function melhorNota(item) {
  const notas = item.tentativas.map((t) => Number(t.nota)).filter(Number.isFinite);
  return notas.length ? Math.max(...notas) : null;
}

function csvCell(value) {
  const texto = value === null || value === undefined ? '' : String(value);
  return /[";\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

// CSV com separador ";" (padrão do Excel em português). Uma linha por matrícula, como na tela.
export function buildCsv(items) {
  const cabecalho = [
    'Nome', 'E-mail', 'Cargo', 'Área', 'Time', 'Curso', 'Situação', 'Tentativas usadas', 'Máximo de tentativas',
    'Melhor nota', 'Última nota', 'Bloqueado em', 'Liberado em', 'Liberado por',
  ];
  const linhas = items.map((i) => [
    i.nome, i.email, i.cargo, i.area, i.time, i.courseId, i.situacao, i.usadas, i.maxTentativas,
    melhorNota(i), i.ultimaNota, i.bloqueadoEm, i.liberadoEm, i.liberadoPor,
  ].map(csvCell).join(';'));
  return [cabecalho.join(';'), ...linhas].join('\r\n');
}

const SITUACAO = { ativo: 'Ativo', bloqueado: 'Bloqueado', esgotado: 'Tentativas esgotadas' };

// Quantas pessoas cabem em cada página A4 (a primeira divide a folha com os indicadores).
export const ROWS_FIRST_PAGE = 6;
export const ROWS_NEXT_PAGE = 18;

function linhaPessoa(i) {
  return `
    <tr>
      <td><strong>${escapeHtml(i.nome)}</strong>${i.cargo ? `<br><small>${escapeHtml(i.cargo)}</small>` : ''}<br><small>${escapeHtml(i.email)}</small></td>
      <td>${escapeHtml(i.area || '-')}<br><small>${escapeHtml(i.time || '')}</small></td>
      <td>${escapeHtml(SITUACAO[i.situacao] || i.situacao)}</td>
      <td>${i.usadas} de ${i.maxTentativas}</td>
      <td>${escapeHtml(formatNumber(melhorNota(i)))}</td>
      <td>${escapeHtml(i.liberadoEm ? new Date(i.liberadoEm).toLocaleDateString('pt-BR') : '-')}</td>
    </tr>`;
}

// Páginas A4 do relatório, prontas para virar PDF. Cada página é um bloco de 210 × 297 mm com margens seguras.
export function reportPages({ scope, filtros, geradoEm }) {
  const stats = computeStats(scope);
  const { kpis } = stats;
  const umaPessoa = new Set(scope.items.map((i) => i.alunoId)).size === 1 ? scope.items[0] : null;
  const aprovadas = stats.porNumero.reduce((soma, p) => soma + p.aprovadas, 0);
  const reprovadas = stats.porNumero.reduce((soma, p) => soma + p.reprovadas, 0);

  const cabecalho = `
    <header class="avl-rel-header">
      <div>
        <p class="avl-rel-kicker">Consistem · Quiz de Fundamentos de IA</p>
        <h1 class="avl-rel-title">Relatório de Avaliações</h1>
      </div>
      <p class="avl-rel-meta">Gerado em ${escapeHtml(geradoEm)}</p>
    </header>
    <p class="avl-rel-filtros"><strong>Filtros:</strong> ${escapeHtml(filtros)}</p>`;

  const indicadores = `
    <div class="avl-kpis">${kpiCardsFor(kpis, umaPessoa)}</div>
    <div class="avl-grid">
      <article class="avl-card">
        <h3 class="avl-card__title">Desempenho por módulo</h3>
        <p class="avl-card__sub">Acerto nas alternativas</p>
        ${barRows(stats.modulos.map((m) => ({ label: m.label, value: m.pct })), { suffix: '%', max: 100 })}
      </article>
      <article class="avl-card">
        <h3 class="avl-card__title">Aprovação</h3>
        <p class="avl-card__sub">Tentativas concluídas</p>
        ${donutChart([
          { key: 'aprovadas', label: 'Aprovadas', value: aprovadas, color: COLORS.success },
          { key: 'reprovadas', label: 'Reprovadas', value: reprovadas, color: COLORS.coral },
        ])}
      </article>
      <article class="avl-card">
        <h3 class="avl-card__title">Distribuição de notas</h3>
        <p class="avl-card__sub">Notas de 0 a 10</p>
        ${columnChart(stats.faixas, { color: COLORS.graphite })}
      </article>
      <article class="avl-card">
        <h3 class="avl-card__title">Sinais de integridade</h3>
        <p class="avl-card__sub">Eventos durante a prova</p>
        ${barRows(stats.eventos, { color: COLORS.coral })}
      </article>
    </div>`;

  const tabela = (linhas, titulo) => `
    <h2 class="avl-rel-section">${titulo}</h2>
    <table class="avl-rel-table">
      <thead><tr><th>Pessoa</th><th>Área e time</th><th>Situação</th><th>Tentativas</th><th>Melhor nota</th><th>Liberado em</th></tr></thead>
      <tbody>${linhas.join('')}</tbody>
    </table>`;

  const linhas = scope.items.map(linhaPessoa);
  if (linhas.length === 0) {
    return [`<section class="avl-rel-page">${cabecalho}${indicadores}
      <p class="avl-empty">Nenhuma pessoa com o filtro atual.</p>
      <footer class="avl-rel-footer"><span>Documento interno da Consistem. Não contém o texto das respostas discursivas.</span><span>Página 1 de 1</span></footer>
    </section>`];
  }

  // Divide as pessoas entre as páginas. A primeira página também carrega indicadores e gráficos.
  const pedacos = [linhas.slice(0, ROWS_FIRST_PAGE)];
  for (let i = ROWS_FIRST_PAGE; i < linhas.length; i += ROWS_NEXT_PAGE) {
    pedacos.push(linhas.slice(i, i + ROWS_NEXT_PAGE));
  }
  const total = pedacos.length;

  return pedacos.map((pedaco, indice) => `
    <section class="avl-rel-page">
      ${indice === 0 ? `${cabecalho}${indicadores}` : `<p class="avl-rel-filtros avl-rel-filtros--continua">Relatório de Avaliações · ${escapeHtml(filtros)}</p>`}
      ${tabela(pedaco, indice === 0 ? `Pessoas (${linhas.length})` : `Pessoas (continuação)`)}
      <footer class="avl-rel-footer">
        <span>Documento interno da Consistem. Não contém o texto das respostas discursivas.</span>
        <span>Página ${indice + 1} de ${total}</span>
      </footer>
    </section>`);
}
