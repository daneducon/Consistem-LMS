// Indicadores e gráficos do dashboard de Avaliações.
// Funções puras (sem DOM), para os números serem testados. O HTML dos gráficos usa só barras e SVG, sem bibliotecas.

export const COLORS = {
  graphite: '#2e2e30',
  coral: '#df5241',
  gold: '#ebaf2d',
  success: '#1e7a45', // color/feedback-positive (DS Consistem)
  muted: 'rgba(46,46,48,0.40)', // color/text-muted (DS Consistem)
  track: '#eaeaea', // color/surface-hover (DS Consistem)
};

// Nota acima de 7 (de 10) é aprovação: a mesma regra do quiz (nota total maior que 70).
export const PASS_GRADE = 7;

const SCORE_BANDS = [
  { label: 'Abaixo de 5', test: (n) => n < 5 },
  { label: '5 a 6,9', test: (n) => n >= 5 && n < 7 },
  { label: '7 a 7,9', test: (n) => n >= 7 && n < 8 },
  { label: '8 a 9,9', test: (n) => n >= 8 && n < 10 },
  { label: '10', test: (n) => n >= 10 },
];

const TIPO_EVENTO = {
  fullscreen_exit: 'Saiu da tela cheia',
  paste_blocked: 'Tentou colar',
  tab_hidden: 'Trocou de aba',
  window_blur: 'Saiu da janela',
  big_insert: 'Texto inserido de uma vez',
  copy_blocked: 'Tentou copiar',
  cut_blocked: 'Tentou recortar',
  context_blocked: 'Abriu menu de contexto',
  timeout: 'Tempo esgotado',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
}

const media = (valores) => (valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : null);

export function filterByArea({ items, respostas }, area) {
  if (!area) return { items, respostas };
  const alunos = new Set(items.filter((i) => i.area === area).map((i) => i.alunoId));
  return {
    items: items.filter((i) => i.area === area),
    respostas: respostas.filter((r) => alunos.has(r.alunoId)),
  };
}

export function filterByAluno({ items, respostas }, alunoId) {
  if (!alunoId) return { items, respostas };
  return {
    items: items.filter((i) => i.alunoId === alunoId),
    respostas: respostas.filter((r) => r.alunoId === alunoId),
  };
}

// Todos os indicadores de uma visão (geral ou de um aluno).
export function computeStats({ items, respostas }) {
  const tentativas = items.flatMap((i) => i.tentativas.map((t) => ({ ...t, alunoId: i.alunoId })));
  const concluidas = tentativas.filter((t) => t.status === 'concluida');
  const aprovadas = concluidas.filter((t) => t.aprovado === true);
  const notas = concluidas.map((t) => Number(t.nota)).filter(Number.isFinite);
  const duracoes = concluidas.map((t) => t.duracaoMin).filter((d) => d !== null);

  const mc = respostas.filter((r) => r.tipo === 'mc');
  const porModulo = new Map();
  for (const r of mc) {
    const atual = porModulo.get(r.modulo) || { label: r.modulo, total: 0, acertos: 0 };
    atual.total += 1;
    if (r.correta) atual.acertos += 1;
    porModulo.set(r.modulo, atual);
  }
  const modulos = [...porModulo.values()]
    .map((m) => ({ ...m, pct: Math.round((m.acertos / m.total) * 100) }))
    .sort((a, b) => a.pct - b.pct);

  const faixas = SCORE_BANDS.map((band) => ({
    label: band.label,
    value: notas.filter(band.test).length,
  }));

  const porNumero = [1, 2, 3].map((numero) => {
    const doNumero = concluidas.filter((t) => t.numero === numero);
    return {
      label: `${numero}ª`,
      aprovadas: doNumero.filter((t) => t.aprovado === true).length,
      reprovadas: doNumero.filter((t) => t.aprovado === false).length,
    };
  });

  const eventosPorTipo = {};
  for (const t of tentativas) {
    for (const [tipo, n] of Object.entries(t.eventosPorTipo || {})) {
      eventosPorTipo[tipo] = (eventosPorTipo[tipo] || 0) + n;
    }
  }

  const porDia = new Map();
  for (const t of tentativas) {
    const dia = new Date(t.iniciadaEm).toISOString().slice(0, 10);
    porDia.set(dia, (porDia.get(dia) || 0) + 1);
  }

  return {
    kpis: {
      alunos: items.length,
      bloqueados: items.filter((i) => i.situacao !== 'ativo').length,
      taxaAprovacao: concluidas.length ? aprovadas.length / concluidas.length : null,
      notaMedia: media(notas),
      melhorNota: notas.length ? Math.max(...notas) : null,
      duracaoMedia: media(duracoes),
      usadas: items.reduce((soma, i) => soma + i.usadas, 0),
      tentativasTotal: tentativas.length,
      emAndamento: tentativas.filter((t) => t.status === 'em_andamento').length,
    },
    modulos,
    faixas,
    porNumero,
    eventos: Object.entries(eventosPorTipo)
      .map(([tipo, value]) => ({ label: TIPO_EVENTO[tipo] || tipo, value }))
      .sort((a, b) => b.value - a.value),
    atividade: [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dia, value]) => ({ label: dia.slice(5), value })),
    evolucao: concluidas
      .slice()
      .sort((a, b) => a.numero - b.numero)
      .map((t) => ({ label: `${t.numero}ª`, nota: Number(t.nota) })),
  };
}

// ---------- HTML dos componentes ----------

export function kpiCard({ label, value, sub = '', tone = 'graphite' }) {
  return `
    <div class="avl-kpi avl-kpi--${tone}">
      <span class="avl-kpi__label">${escapeHtml(label)}</span>
      <strong class="avl-kpi__value">${escapeHtml(value)}</strong>
      <span class="avl-kpi__sub">${escapeHtml(sub)}</span>
    </div>`;
}

// Cards de indicadores do escopo. Com uma pessoa só, mostra os números dela; com várias, os da turma filtrada.
export function kpiCardsFor(kpis, umaPessoa = null) {
  const tempoMedio = kpis.duracaoMedia === null ? '-' : `${formatNumber(kpis.duracaoMedia)} min`;
  if (umaPessoa) {
    return [
      kpiCard({ label: 'Tentativas usadas', value: `${kpis.usadas} de 3`, sub: 'desde a última liberação' }),
      kpiCard({ label: 'Melhor nota', value: formatNumber(kpis.melhorNota), sub: 'de 10', tone: 'gold' }),
      kpiCard({ label: 'Aprovação', value: formatPercent(kpis.taxaAprovacao), sub: 'tentativas concluídas', tone: 'success' }),
      kpiCard({ label: 'Tempo médio', value: tempoMedio, sub: 'por tentativa' }),
    ].join('');
  }
  return [
    kpiCard({ label: 'Pessoas', value: kpis.alunos, sub: 'matrículas no filtro' }),
    kpiCard({ label: 'Aprovação', value: formatPercent(kpis.taxaAprovacao), sub: 'tentativas concluídas', tone: 'success' }),
    kpiCard({ label: 'Nota média', value: formatNumber(kpis.notaMedia), sub: 'de 10', tone: 'gold' }),
    kpiCard({ label: 'Bloqueados ou esgotados', value: kpis.bloqueados, sub: 'precisam de liberação', tone: 'coral' }),
  ].join('');
}

export function formatNumber(value, digits = 1) {
  return value === null || value === undefined ? '-' : Number(value).toFixed(digits).replace('.', ',');
}

export function formatPercent(value) {
  return value === null || value === undefined ? '-' : `${Math.round(value * 100)}%`;
}

export function barRows(rows, { suffix = '', color = COLORS.graphite, max = null } = {}) {
  if (rows.length === 0) return '<p class="avl-empty">Sem dados ainda.</p>';
  const top = max ?? Math.max(...rows.map((r) => r.value), 1);
  return rows.map((row) => `
    <div class="avl-bar">
      <span class="avl-bar__label">${escapeHtml(row.label)}</span>
      <div class="avl-bar__track">
        <div class="avl-bar__fill" style="width:${Math.max(2, Math.round((row.value / top) * 100))}%;background:${row.color || color}"></div>
      </div>
      <strong class="avl-bar__value">${escapeHtml(row.value)}${escapeHtml(suffix)}</strong>
    </div>`).join('');
}

export function columnChart(rows, { color = COLORS.graphite } = {}) {
  if (rows.length === 0) return '<p class="avl-empty">Sem dados ainda.</p>';
  const top = Math.max(...rows.map((r) => r.value), 1);
  return `<div class="avl-columns">${rows.map((row) => `
    <div class="avl-column">
      <span class="avl-column__value">${escapeHtml(row.value)}</span>
      <div class="avl-column__track">
        <div class="avl-column__fill" style="height:${Math.max(4, Math.round((row.value / top) * 100))}%;background:${color}"></div>
      </div>
      <span class="avl-column__label">${escapeHtml(row.label)}</span>
    </div>`).join('')}</div>`;
}

// Notas por tentativa (aluno), com a linha de aprovação em 7.
export function lineChart(points) {
  if (points.length === 0) return '<p class="avl-empty">Nenhuma tentativa concluída ainda.</p>';
  const width = 360;
  const height = 180;
  const pad = 28;
  const x = (i) => (points.length === 1 ? width / 2 : pad + (i * (width - pad * 2)) / (points.length - 1));
  const y = (nota) => height - pad - (Math.min(Math.max(nota, 0), 10) / 10) * (height - pad * 2);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.nota).toFixed(1)}`).join(' ');
  const dots = points.map((p, i) => `
    <circle cx="${x(i).toFixed(1)}" cy="${y(p.nota).toFixed(1)}" r="5" fill="${p.nota > PASS_GRADE ? COLORS.success : COLORS.coral}" />
    <text x="${x(i).toFixed(1)}" y="${(y(p.nota) - 10).toFixed(1)}" text-anchor="middle" class="avl-svg-value">${formatNumber(p.nota)}</text>
    <text x="${x(i).toFixed(1)}" y="${height - 6}" text-anchor="middle" class="avl-svg-label">${escapeHtml(p.label)}</text>`).join('');
  return `
    <svg viewBox="0 0 ${width} ${height}" class="avl-line" role="img" aria-label="Notas por tentativa">
      <line x1="${pad}" x2="${width - pad}" y1="${y(PASS_GRADE)}" y2="${y(PASS_GRADE)}" stroke="${COLORS.gold}" stroke-dasharray="4 4" />
      <text x="${width - pad}" y="${y(PASS_GRADE) - 6}" text-anchor="end" class="avl-svg-label">aprovação: 7</text>
      <path d="${path}" fill="none" stroke="${COLORS.graphite}" stroke-width="2.5" stroke-linejoin="round" />
      ${dots}
    </svg>`;
}

// Anel com aprovadas, reprovadas e em andamento, por tentativa.
export function donutChart(partes) {
  const total = partes.reduce((soma, p) => soma + p.value, 0);
  if (total === 0) return '<p class="avl-empty">Sem tentativas concluídas ainda.</p>';
  const raio = 46;
  const circunferencia = 2 * Math.PI * raio;
  let acumulado = 0;
  const arcos = partes.map((p) => {
    const tamanho = (p.value / total) * circunferencia;
    const arco = `<circle r="${raio}" cx="60" cy="60" fill="none" stroke="${p.color}" stroke-width="16"
      stroke-dasharray="${tamanho} ${circunferencia - tamanho}" stroke-dashoffset="${-acumulado}" transform="rotate(-90 60 60)" />`;
    acumulado += tamanho;
    return arco;
  }).join('');
  const aprovadas = partes.find((p) => p.key === 'aprovadas')?.value ?? 0;
  return `
    <div class="avl-donut">
      <svg viewBox="0 0 120 120" role="img" aria-label="Aprovadas e reprovadas">
        <circle r="${raio}" cx="60" cy="60" fill="none" stroke="${COLORS.track}" stroke-width="16" />
        ${arcos}
        <text x="60" y="58" text-anchor="middle" class="avl-donut__value">${formatPercent(aprovadas / total)}</text>
        <text x="60" y="74" text-anchor="middle" class="avl-svg-label">aprovação</text>
      </svg>
      <ul class="avl-legend">
        ${partes.map((p) => `<li><span class="avl-dot" style="background:${p.color}"></span>${escapeHtml(p.label)} <strong>${p.value}</strong></li>`).join('')}
      </ul>
    </div>`;
}
