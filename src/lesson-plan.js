import './lesson-plan.css';
import {
  LESSON_CATEGORIES,
  LESSON_COMPATIBILITIES,
  LESSON_LEVELS,
  downloadLessonPdf,
  downloadLessonTemplate,
  downloadLessonXml,
  formatLessonCompatibility,
  normalizeLessonKey,
  parseLessonWorkbook,
} from './lesson-plan-utils.js';

const STORAGE_ID = 'consistem_lms_lesson_plan_v1';

function createDefaultPlan() {
  return {
    nomeCurso: '', versaoCurso: '1.0', publicacao: 'Março/2026',
    compatibilidadeErp: '', compatibilidadeComponentes: '', cargaHoraria: '8', modalidade: 'EAD',
    objetivoGeral: '',
    publicoAlvo: 'Usuários do sistema Consistem ERP que realizam operações de controle e gestão empresarial.',
    unidades: [],
    conteudistas: [
      { id: crypto.randomUUID(), nome: 'Dieison Fábio', biografia: 'Bacharel em Administração com experiência em Gestão de Projetos e Planejamento, Programação e Controle de Produção (PPCP).' },
      { id: crypto.randomUUID(), nome: 'Claudinei Vieira', biografia: 'Bacharel em Administração e MBA em Lean Manufacturing, com experiência em métodos e processos de manufatura.' },
    ],
    wordpressData: {
      categorias: [], niveis: [], compatibilidades: [], descricaoPrincipal: '', resumoCurto: '',
      numeroDeAulas: '', diasAcesso: '', valor: '', linkPlanoEnsinoPdf: '', linkLms: '',
      requisitosTecnicos: 'Dispositivo com acesso à internet e suporte à reprodução de vídeos em mp4 e de arquivos em pdf.',
      idImagemDestacada: '',
    },
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function loadState() {
  const fallback = { step: 1, plan: createDefaultPlan(), analysis: null, fileName: '', pdfDownloaded: false, showUrl: false };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_ID) || 'null');
    if (!saved?.plan || !Array.isArray(saved.plan.unidades)) return fallback;
    return { ...fallback, ...saved, plan: { ...fallback.plan, ...saved.plan, wordpressData: { ...fallback.plan.wordpressData, ...saved.plan.wordpressData } } };
  } catch {
    return fallback;
  }
}

let root;
let state = loadState();
let busy = false;
let feedback = null;
let programCatalogPromise;
let aiLoading = false;
let aiMessageTimer;
let aiMessageIndex = 0;

const AI_LOADING_MESSAGES = [
  'Analisando a estrutura pedagógica...',
  'Organizando objetivos e referências...',
  'Aplicando as diretrizes da Consistem...',
  'Revisando clareza e consistência...',
  'Preparando o conteúdo final...',
];

async function getProgramCatalog() {
  if (!programCatalogPromise) {
    programCatalogPromise = import('./cod_programas.json')
      .then((module) => Array.isArray(module.default) ? module.default : [])
      .catch(() => []);
  }
  return programCatalogPromise;
}

function enrichProgramsFromCatalog(catalog) {
  const programMap = new Map(catalog.map((program) => [
    normalizeLessonKey(program.Código || program.code),
    String(program.Nome || program.name || '').trim(),
  ]).filter(([code, name]) => code && name));
  let changed = false;
  state.plan.unidades.forEach((unit) => {
    unit.programas = unit.programas.map((program) => {
      const match = program.match(/^([^\s]+)\s*[-:–—]\s*(.*)$/);
      const code = match?.[1] || program;
      const name = programMap.get(normalizeLessonKey(code));
      if (!name) return program;
      const enriched = `${code} - ${name}`;
      if (enriched === program) return program;
      changed = true;
      return enriched;
    });
  });
  if (changed) {
    saveState();
    render();
  }
}

function saveState() {
  try { localStorage.setItem(STORAGE_ID, JSON.stringify(state)); } catch {}
}

function setFeedback(type, message) {
  feedback = { type, message };
  render();
}

function feedbackHtml() {
  return feedback ? `<div class="lesson-feedback ${feedback.type}" role="status">${escapeHtml(feedback.message)}</div>` : '';
}

function aiLoadingHtml() {
  if (!aiLoading) return '';
  return `<div class="lesson-ai-overlay" role="dialog" aria-modal="true" aria-labelledby="lessonAiLoadingTitle">
    <div class="lesson-ai-modal">
      <div class="lesson-ai-spinner" aria-hidden="true"></div>
      <span class="lesson-kicker">REDAÇÃO ASSISTIDA</span>
      <h2 id="lessonAiLoadingTitle">Gerando conteúdo com IA</h2>
      <p id="lessonAiLoadingMessage" aria-live="polite">${AI_LOADING_MESSAGES[aiMessageIndex]}</p>
      <small>Aguarde nesta tela. O conteúdo será exibido assim que estiver pronto.</small>
    </div>
  </div>`;
}

function startAiLoading() {
  aiLoading = true;
  aiMessageIndex = 0;
  render();
  clearInterval(aiMessageTimer);
  aiMessageTimer = setInterval(() => {
    aiMessageIndex = (aiMessageIndex + 1) % AI_LOADING_MESSAGES.length;
    const message = document.getElementById('lessonAiLoadingMessage');
    if (message) message.textContent = AI_LOADING_MESSAGES[aiMessageIndex];
  }, 2000);
}

function stopAiLoading() {
  clearInterval(aiMessageTimer);
  aiMessageTimer = null;
  aiLoading = false;
}

function renderStepper() {
  // Fases: atual = coral, concluída = verde, demais = cinza (padrão DS Consistem).
  const labels = ['Importação', 'Revisão', 'Prévia e PDF', 'Publicação'];
  return `<div class="phase-track lesson-phases" aria-label="Fases do plano de aula">${labels.map((label, index) => {
    const step = index + 1;
    const enabled = step === 1 || (step <= 3 && state.plan.unidades.length) || (step === 4 && state.plan.wordpressData.linkPlanoEnsinoPdf);
    const stateClass = state.step > step ? 'is-done' : state.step === step ? 'is-current' : '';
    return `<button type="button" class="phase lesson-phase ${stateClass}" data-action="step" data-step="${step}" ${enabled ? '' : 'disabled'} ${state.step === step ? 'aria-current="step"' : ''}><i></i>${label}</button>`;
  }).join('')}</div>`;
}

function renderUpload() {
  const analysis = state.analysis;
  // Mesmo molde da Matrícula em lote: blocos numerados + painel "Próximo passo".
  const icoUpload = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';
  const icoDown = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  const icoCopy = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const hasUnits = state.plan.unidades.length > 0;
  const diagnostic = analysis
    ? `<div class="lesson-analysis-metrics"><div><strong>${analysis.totalUnits}</strong><span>Aulas extraídas</span></div><div><strong>${analysis.sheets.length}</strong><span>Abas analisadas</span></div><div><strong>${analysis.gerconName ? 'Sim' : 'Não'}</strong><span>Gercon encontrada</span></div></div>
      <div class="lesson-sheet-list">${analysis.sheets.map((sheet) => `<div><span>${escapeHtml(sheet.name)}</span><small>${sheet.type} · ${sheet.rowCount} linhas · ${sheet.colCount} colunas</small></div>`).join('')}</div>
      ${analysis.warnings.map((warning) => `<p class="lesson-notice warning">${escapeHtml(warning)}</p>`).join('')}`
    : '<div class="lesson-empty"><strong>Nenhuma planilha analisada</strong><span>Os detalhes da estrutura aparecerão aqui.</span></div>';
  return `<div class="flow-layout">
    <div class="flow-main">
      <div class="card flow-block">
        <div class="flow-block-header"><span class="flow-step">1</span><h3 class="card-title">Planilha</h3><span class="flow-tag">Obrigatório</span></div>
        <p class="flow-block-desc">Use a planilha MATRIZ e, quando disponível, a aba GERCON para preencher o plano automaticamente.</p>
        <label class="dropzone ${analysis ? 'has-file' : ''}" id="lessonDropzone">
          <input type="file" id="lessonFileInput" class="file-input-hidden" accept=".xlsx,.xls,.csv,.txt" ${busy ? 'disabled' : ''}>
          <div class="dropzone-inner">
            <div class="dropzone-icon-box">${icoUpload}</div>
            <p class="dropzone-title">${busy ? 'Analisando a planilha...' : analysis ? escapeHtml(analysis.fileName) : 'Arraste a planilha aqui ou clique para selecionar'}</p>
            <p class="dropzone-sub">${analysis ? `${analysis.totalUnits} aulas identificadas na aba ${escapeHtml(analysis.matrixName)}` : 'XLSX, XLS ou CSV • até 10 MB'}</p>
          </div>
        </label>
        <div class="flow-inline-actions">
          <button type="button" class="btn-ghost-sm" data-action="template">${icoDown}Baixar modelo XLSX</button>
          <button type="button" class="btn-ghost-sm" data-action="sample">${icoCopy}Usar dados de exemplo</button>
          <span class="flow-hint">Colunas: aula, módulo, carga horária e programa</span>
        </div>
      </div>
      <div class="card flow-block">
        <div class="flow-block-header"><span class="flow-step">2</span><h3 class="card-title">Diagnóstico da importação</h3><span class="flow-tag">Automático</span></div>
        <p class="flow-block-desc">Aulas, metadados e programas permanecem editáveis na próxima etapa.</p>
        ${diagnostic}
      </div>
    </div>
    <aside class="card flow-rail">
      <div class="flow-block-header"><h3 class="card-title">Próximo passo</h3></div>
      <p class="flow-block-desc">Importar não publica nada. Você revisa tudo na próxima fase.</p>
      <ul class="flow-checklist">
        <li class="${analysis ? 'is-done' : ''}"><span class="check-dot"></span><div><strong>Planilha enviada</strong><small>Envie a matriz ou use os dados de exemplo</small></div></li>
        <li class="${hasUnits ? 'is-done' : ''}"><span class="check-dot"></span><div><strong>Aulas identificadas</strong><small>Ao menos uma aula para avançar</small></div></li>
      </ul>
      <div class="flow-rail-actions">
        <button type="button" class="btn-coral" data-action="next" ${hasUnits ? '' : 'disabled'}>Avançar para revisão</button>
        <button type="button" class="btn-ghost" data-action="reset">Recomeçar</button>
      </div>
    </aside>
  </div>
  ${feedbackHtml()}`;
}

function field(label, name, value, options = {}) {
  const input = options.textarea
    ? `<textarea rows="${options.rows || 3}" data-field="${name}" ${options.required ? 'required' : ''}>${escapeHtml(value)}</textarea>`
    : `<input type="${options.type || 'text'}" data-field="${name}" value="${escapeHtml(value)}" ${options.required ? 'required' : ''} ${options.min ? `min="${options.min}"` : ''}>`;
  return `<label class="lesson-field ${options.wide ? 'wide' : ''}"><span>${label}${options.required ? ' *' : ''}</span>${input}${options.hint ? `<small>${escapeHtml(options.hint)}</small>` : ''}</label>`;
}

function distinctPrograms() {
  const programs = new Map();
  state.plan.unidades.forEach((unit) => unit.programas.forEach((program) => {
    const match = program.match(/^([^\s]+)\s*[-:–—]\s*(.+)$/);
    const code = (match?.[1] || program).trim().toUpperCase();
    if (!programs.has(code)) programs.set(code, { code, name: match?.[2]?.trim() || '' });
  }));
  return [...programs.values()];
}

function renderReview() {
  const plan = state.plan;
  const programs = distinctPrograms();
  return `<form id="lessonReviewForm" class="lesson-flow-stack">
    <article class="lesson-card">
      <div class="lesson-section-heading split"><div><span class="lesson-kicker">IDENTIFICAÇÃO</span><h2>Dados complementares do curso</h2><p>Revise os metadados extraídos e complete as informações institucionais.</p></div><span class="lesson-status-chip">Rascunho salvo</span></div>
      <div class="lesson-form-grid">
        ${field('Nome oficial do curso', 'nomeCurso', plan.nomeCurso, { required: true, wide: true })}
        ${field('Versão do curso', 'versaoCurso', plan.versaoCurso)}
        ${field('Mês/ano de publicação', 'publicacao', plan.publicacao)}
        ${field('Carga horária (horas)', 'cargaHoraria', plan.cargaHoraria, { type: 'number', min: 0 })}
        ${field('Modalidade', 'modalidade', plan.modalidade)}
        ${field('Versão Consistem ERP', 'compatibilidadeErp', plan.compatibilidadeErp)}
        ${field('Versão Componentes', 'compatibilidadeComponentes', plan.compatibilidadeComponentes)}
        <div class="lesson-compat-preview wide"><span>Formato no documento</span><strong>${escapeHtml(formatLessonCompatibility(plan))}</strong></div>
        <div class="lesson-field wide"><div class="lesson-label-row"><span>Objetivo geral</span><button type="button" class="lesson-ai-button" data-action="ai-general">✦ Gerar com IA</button></div><textarea rows="4" data-field="objetivoGeral">${escapeHtml(plan.objetivoGeral)}</textarea></div>
        <div class="lesson-field wide"><div class="lesson-label-row"><span>Público-alvo</span><button type="button" class="lesson-ai-button" data-action="ai-audience">✦ Gerar com IA</button></div><textarea rows="3" data-field="publicoAlvo">${escapeHtml(plan.publicoAlvo)}</textarea></div>
      </div>
    </article>
    ${programs.length ? `<article class="lesson-card"><div class="lesson-section-heading split"><div><span class="lesson-kicker">CATÁLOGO</span><h2>Programas utilizados (${programs.length})</h2><p>Complete nomes ausentes; a alteração será aplicada a todas as aulas.</p></div><span class="lesson-status-chip gold">${programs.filter((item) => !item.name).length} sem nome</span></div><div class="lesson-program-grid">${programs.map((program) => `<label class="lesson-program"><strong>${escapeHtml(program.code)}</strong><input data-program-code="${escapeHtml(program.code)}" value="${escapeHtml(program.name)}" placeholder="Nome do programa"></label>`).join('')}</div></article>` : ''}
    <article class="lesson-card"><div class="lesson-section-heading split"><div><span class="lesson-kicker">AUTORIA</span><h2>Conteudista(s) do curso</h2><p>Registre formação e experiência dos responsáveis pelo conteúdo.</p></div><button type="button" class="btn-ghost-sm" data-action="add-writer">+ Adicionar conteudista</button></div><div class="lesson-writers">${plan.conteudistas.map((writer, index) => `<div class="lesson-writer"><div class="lesson-writer-head"><strong>Conteudista ${index + 1}</strong>${plan.conteudistas.length > 1 ? `<button type="button" data-action="remove-writer" data-id="${writer.id}">Remover</button>` : ''}</div>${field('Nome', `writer-name-${index}`, writer.nome)}${field('Minibiografia / formação e experiência', `writer-bio-${index}`, writer.biografia, { textarea: true, rows: 2 })}</div>`).join('')}</div></article>
    <article class="lesson-card"><div class="lesson-section-heading"><span class="lesson-kicker">ESTRUTURA PEDAGÓGICA</span><h2>${plan.unidades.length} aulas mapeadas</h2><p>Revise objetivos e programas antes de compilar o documento.</p></div><div class="lesson-units">${plan.unidades.map((unit, index) => `<section class="lesson-unit"><div class="lesson-unit-head"><div><span>AULA ${String(index + 1).padStart(2, '0')}</span><h3>${escapeHtml(unit.tituloUnidade)}</h3></div><button type="button" class="lesson-ai-button" data-action="ai-objectives" data-index="${index}">✦ Reescrever com IA</button></div><label class="lesson-field"><span>Objetivos de aprendizagem · um por linha</span><textarea rows="${Math.max(3, unit.objetivos.length)}" data-unit-objectives="${index}">${escapeHtml(unit.objetivos.join('\n'))}</textarea></label><button type="button" class="lesson-add-line" data-action="add-objective" data-index="${index}">+ Adicionar objetivo</button>${unit.programas.length ? `<div class="lesson-program-chips">${unit.programas.map((program) => `<span>${escapeHtml(program)}</span>`).join('')}</div>` : ''}</section>`).join('')}</div></article>
    ${feedbackHtml()}
    <div class="lesson-footer-actions"><button type="button" class="btn-ghost" data-action="back">← Voltar para importação</button><button type="submit" class="btn-coral">Avançar para pré-visualização →</button></div>
  </form>`;
}

function renderDocumentContent() {
  const plan = state.plan;
  return `<div class="lesson-document lesson-document-source"><div class="lesson-page-flow">
    <header data-pdf-block><span>PLANO DE ENSINO</span><h2>${escapeHtml(plan.nomeCurso || 'Nome do curso')}</h2><p>Documento institucional Consistem</p></header>
    <div class="lesson-document-meta" data-pdf-block><div><span>Versão</span><strong>${escapeHtml(plan.versaoCurso || '-')}</strong></div><div><span>Publicação</span><strong>${escapeHtml(plan.publicacao || '-')}</strong></div><div><span>Carga horária</span><strong>${escapeHtml(plan.cargaHoraria || '0')} horas</strong></div><div><span>Modalidade</span><strong>${escapeHtml(plan.modalidade || '-')}</strong></div><div class="wide"><span>Compatibilidade</span><strong>${escapeHtml(formatLessonCompatibility(plan))}</strong></div></div>
    ${plan.objetivoGeral ? `<section data-pdf-block><h3>Objetivo geral</h3><p>${escapeHtml(plan.objetivoGeral)}</p></section>` : ''}
    ${plan.publicoAlvo ? `<section data-pdf-block><h3>Público-alvo</h3><p>${escapeHtml(plan.publicoAlvo)}</p></section>` : ''}
    <section class="lesson-document-heading" data-pdf-block><h3 class="coral">Conteúdo</h3></section>
    ${plan.unidades.map((unit, index) => `<article class="lesson-document-unit" data-pdf-block><h4>Aula ${index + 1} | ${escapeHtml(unit.tituloUnidade)}</h4><small>Ao fim desta aula, o usuário deve conseguir:</small><ul>${unit.objetivos.map((objective) => `<li>${escapeHtml(objective)}</li>`).join('')}</ul>${unit.programas.length ? `<strong>Programas utilizados</strong><p>${unit.programas.map(escapeHtml).join('<br>')}</p>` : ''}</article>`).join('')}
    <section class="lesson-document-heading" data-pdf-block><h3 class="coral">Conteudista(s)</h3></section>
    ${plan.conteudistas.map((writer) => `<article class="lesson-document-writer" data-pdf-block><h4>${escapeHtml(writer.nome || 'Conteudista responsável')}</h4>${writer.biografia ? `<p>${escapeHtml(writer.biografia)}</p>` : ''}</article>`).join('')}
  </div></div>`;
}

function paginateLessonPreview() {
  const source = root?.querySelector('.lesson-document-source');
  const sourceFlow = source?.querySelector('.lesson-page-flow');
  if (!source || !sourceFlow) return;
  if (!source.getClientRects().length || source.clientWidth === 0) return;
  const blocks = [...sourceFlow.children];
  const pages = document.createElement('div');
  pages.className = 'lesson-document-pages';

  function addPage() {
    const page = document.createElement('div');
    page.className = 'lesson-document';
    const flow = document.createElement('div');
    flow.className = 'lesson-page-flow';
    page.appendChild(flow);
    pages.appendChild(page);
    return flow;
  }

  source.replaceWith(pages);
  let flow = addPage();
  blocks.forEach((block) => {
    flow.appendChild(block);
    if (flow.scrollHeight > flow.clientHeight && flow.children.length > 1) {
      block.remove();
      const sectionHeading = flow.lastElementChild?.classList.contains('lesson-document-heading')
        ? flow.lastElementChild
        : null;
      sectionHeading?.remove();
      flow = addPage();
      if (sectionHeading) flow.appendChild(sectionHeading);
      flow.appendChild(block);
    }
  });
}

function renderPreview() {
  return `<div class="lesson-preview-toolbar lesson-card"><div><span class="lesson-kicker">DOCUMENTO INSTITUCIONAL</span><h2>Visualização do plano de ensino</h2><p>Revise a composição antes de baixar o PDF multipágina.</p></div><button type="button" class="btn-coral" data-action="pdf" ${busy ? 'disabled' : ''}>${busy ? 'Gerando documento...' : '↓ Baixar Plano de Ensino'}</button></div>
  ${state.pdfDownloaded ? `<div class="lesson-feedback success">PDF gerado com sucesso.</div><div class="lesson-card lesson-xml-prompt"><div><strong>Deseja preparar o rascunho para o site?</strong><p>Informe a URL pública do PDF para vinculá-la ao XML WordPress.</p></div><button type="button" class="btn-ghost" data-action="hide-url">Agora não</button><button type="button" class="btn-coral" data-action="show-url">Preparar XML →</button></div>` : ''}
  ${state.showUrl ? `<form id="lessonUrlForm" class="lesson-card lesson-url-form"><div><span class="lesson-kicker">VÍNCULO DO DOCUMENTO</span><h2>URL pública do plano de ensino</h2><p>Envie o PDF ao WordPress e informe o endereço HTTPS do arquivo.</p></div><label class="lesson-field"><span>URL do PDF *</span><input type="url" id="lessonPdfUrl" value="${escapeHtml(state.plan.wordpressData.linkPlanoEnsinoPdf)}" placeholder="https://..." required></label><button type="submit" class="btn-coral">Confirmar e continuar →</button></form>` : ''}
  ${feedbackHtml()}<div class="lesson-preview-stage">${renderDocumentContent()}</div><div class="lesson-footer-actions"><button type="button" class="btn-ghost" data-action="back">← Editar formulário</button>${state.plan.wordpressData.linkPlanoEnsinoPdf ? '<button type="button" class="btn-coral" data-action="next">Preparar WordPress →</button>' : ''}</div>`;
}

function taxonomyGroup(title, name, options, selected) {
  return `<div class="lesson-taxonomy"><span>${title}</span><div>${options.map(([label, slug]) => `<button type="button" data-taxonomy="${name}" data-slug="${slug}" class="${selected.includes(slug) ? 'selected' : ''}">${escapeHtml(label)}</button>`).join('')}</div></div>`;
}

function wpField(label, name, value, options = {}) {
  const control = options.textarea ? `<textarea rows="${options.rows || 3}" data-wp-field="${name}" ${options.readonly ? 'readonly' : ''}>${escapeHtml(value)}</textarea>` : `<input type="${options.type || 'text'}" data-wp-field="${name}" value="${escapeHtml(value)}" ${options.readonly ? 'readonly' : ''}>`;
  return `<label class="lesson-field ${options.wide ? 'wide' : ''}"><span>${label}</span>${control}</label>`;
}

function renderWordPress() {
  const plan = state.plan;
  const wp = plan.wordpressData;
  return `<div class="lesson-flow-stack"><article class="lesson-card"><div class="lesson-section-heading"><span class="lesson-kicker">PUBLICAÇÃO</span><h2>Dados para o WordPress</h2><p>O arquivo será criado como rascunho para revisão antes da publicação.</p></div><div class="lesson-taxonomies">${taxonomyGroup('Categoria', 'categorias', LESSON_CATEGORIES, wp.categorias)}${taxonomyGroup('Nível', 'niveis', LESSON_LEVELS, wp.niveis)}${taxonomyGroup('Compatibilidade', 'compatibilidades', LESSON_COMPATIBILITIES, wp.compatibilidades)}</div></article>
  <article class="lesson-card"><div class="lesson-section-heading split"><div><span class="lesson-kicker">CONTEÚDO EDITORIAL</span><h2>Descrição e resumo</h2><p>Use texto simples; a exportação cuida da estrutura XML.</p></div><button type="button" class="lesson-ai-button" data-action="ai-wordpress">✦ Gerar ambos com IA</button></div><div class="lesson-form-grid">${wpField('Descrição principal', 'descricaoPrincipal', wp.descricaoPrincipal, { textarea: true, rows: 6, wide: true })}${wpField('Resumo curto', 'resumoCurto', wp.resumoCurto, { textarea: true, rows: 3, wide: true })}</div></article>
  <article class="lesson-card"><div class="lesson-section-heading"><span class="lesson-kicker">METADADOS ACF</span><h2>Configuração comercial e técnica</h2></div><div class="lesson-form-grid">${wpField('Nº de aulas', 'numeroDeAulas', wp.numeroDeAulas)}${wpField('Dias de acesso', 'diasAcesso', wp.diasAcesso)}${wpField('Valor (R$)', 'valor', wp.valor)}${wpField('ID da capa', 'idImagemDestacada', wp.idImagemDestacada)}${wpField('Link de venda (LMS)', 'linkLms', wp.linkLms, { type: 'url', wide: true })}${wpField('Link do plano de ensino', 'linkPlanoEnsinoPdf', wp.linkPlanoEnsinoPdf, { type: 'url', wide: true, readonly: true })}${wpField('Requisitos técnicos', 'requisitosTecnicos', wp.requisitosTecnicos, { textarea: true, rows: 3, wide: true })}</div></article>
  <article class="lesson-card"><div class="lesson-section-heading split"><div><span class="lesson-kicker">PRÉVIA AUTOMÁTICA</span><h2>O que você vai aprender</h2></div><span class="lesson-status-chip">${plan.unidades.length} itens</span></div><ol class="lesson-learning-list">${plan.unidades.map((unit) => `<li>${escapeHtml(unit.tituloUnidade)}</li>`).join('')}</ol></article>
  ${feedbackHtml()}<div class="lesson-footer-actions"><button type="button" class="btn-ghost" data-action="back">← Voltar para a prévia</button><button type="button" class="btn-coral" data-action="xml">↓ Baixar arquivo XML</button></div></div>`;
}

function render() {
  if (!root) return;
  root.innerHTML = `<div class="lesson-toolbar"><div><span class="lesson-draft-dot"></span> Rascunho salvo neste navegador</div>${state.plan.unidades.length ? '<button type="button" class="btn-ghost-sm danger" data-action="reset">Recomeçar</button>' : ''}</div>${renderStepper()}<div class="lesson-step-content">${state.step === 1 ? renderUpload() : state.step === 2 ? renderReview() : state.step === 3 ? renderPreview() : renderWordPress()}</div>${aiLoadingHtml()}`;
  if (state.step === 3) requestAnimationFrame(paginateLessonPreview);
}

function applyImportedResult(result) {
  const plan = state.plan;
  state.plan = {
    ...plan,
    ...Object.fromEntries(Object.entries(result.metadata).filter(([, value]) => value)),
    unidades: result.units,
    conteudistas: result.writers.length ? result.writers : plan.conteudistas,
    wordpressData: {
      ...plan.wordpressData,
      numeroDeAulas: String(result.units.reduce((total, unit) => total + unit.objetivos.length, 0)),
      compatibilidades: [
        result.metadata.compatibilidadeErp?.includes('8.1') ? 'consistem-erp-8-1' : null,
        result.metadata.compatibilidadeErp?.includes('8.2') ? 'consistem-erp-8-2' : null,
        result.metadata.compatibilidadeComponentes?.includes('8.0') ? 'consistem-componentes-8-0' : null,
        result.metadata.compatibilidadeComponentes?.includes('8.1') ? 'consistem-componentes-8-1' : null,
      ].filter(Boolean),
    },
  };
  state.analysis = result.analysis;
  state.fileName = result.analysis.fileName;
  feedback = { type: 'success', message: `${result.units.length} aulas importadas com sucesso.` };
  saveState();
}

async function handleFile(file) {
  busy = true; feedback = null; render();
  try { applyImportedResult(await parseLessonWorkbook(file, await getProgramCatalog())); }
  catch (error) { feedback = { type: 'error', message: error.message || 'Não foi possível analisar a planilha.' }; }
  finally { busy = false; render(); }
}

function samplePlan() {
  return {
    units: [
      { index: 1, tituloUnidade: 'Fundamentos e acesso ao Consistem ERP', objetivos: ['Identificar os componentes do ambiente', 'Configurar preferências iniciais', 'Navegar pelos menus principais'], descricaoOA: ['Ambientação inicial no ERP'], programas: ['CSMEN010 - Menu principal'] },
      { index: 2, tituloUnidade: 'Operação e validação dos processos', objetivos: ['Executar o fluxo operacional', 'Validar dados antes da conclusão', 'Analisar resultados do processamento'], descricaoOA: ['Aplicação prática do processo'], programas: ['CCPGA045 - Gestão de processos'] },
    ],
    metadata: { nomeCurso: 'Formação em Operações no Consistem ERP', objetivoGeral: 'Capacitar usuários a executar e validar operações essenciais no Consistem ERP.', compatibilidadeErp: '8.2', compatibilidadeComponentes: '8.1' },
    writers: [],
    analysis: { fileName: 'Exemplo_Consistem_Matriz_e_Gercon.xlsx', matrixName: 'MATRIZ', gerconName: 'GERCON', totalUnits: 2, sheets: [{ name: 'MATRIZ', type: 'MATRIZ', rowCount: 7, colCount: 4 }, { name: 'GERCON', type: 'GERCON', rowCount: 7, colCount: 2 }], warnings: [] },
  };
}

function updateProgram(code, name) {
  state.plan.unidades.forEach((unit) => {
    unit.programas = unit.programas.map((program) => {
      const programCode = (program.match(/^([^\s]+)\s*[-:–—]/)?.[1] || program).toUpperCase();
      return programCode === code ? (name.trim() ? `${code} - ${name.trim()}` : code) : program;
    });
  });
}

async function callLessonAi(action, index) {
  busy = true;
  feedback = null;
  startAiLoading();
  const objectives = state.plan.unidades.flatMap((unit) => unit.objetivos).filter(Boolean);
  const descriptions = state.plan.unidades.flatMap((unit) => unit.descricaoOA || []).filter(Boolean);
  const body = { action, course: state.plan.nomeCurso || 'Curso Consistem ERP', objectives, descriptions };
  if (action === 'objectives') body.title = state.plan.unidades[index].tituloUnidade;
  try {
    const response = await fetch('/api/lesson-ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível gerar o conteúdo.');
    if (action === 'objectives') state.plan.unidades[index].objetivos = data.objectives;
    else if (action === 'generalObjective') state.plan.objetivoGeral = data.text;
    else if (action === 'audience') state.plan.publicoAlvo = data.text;
    else { state.plan.wordpressData.descricaoPrincipal = data.description; state.plan.wordpressData.resumoCurto = data.excerpt; }
    feedback = { type: 'success', message: 'Conteúdo gerado. Revise antes de continuar.' };
    saveState();
  } catch (error) { feedback = { type: 'error', message: error.message }; }
  finally { busy = false; stopAiLoading(); render(); }
}

function nextStep() {
  if (state.step === 1 && !state.plan.unidades.length) return setFeedback('error', 'Importe uma matriz antes de continuar.');
  if (state.step === 2 && !state.plan.nomeCurso.trim()) return setFeedback('error', 'Informe o nome oficial do curso.');
  if (state.step === 3 && !state.plan.wordpressData.linkPlanoEnsinoPdf) return setFeedback('error', 'Informe a URL pública do PDF antes de preparar o XML.');
  state.step = Math.min(4, state.step + 1); feedback = null; saveState(); render();
  document.getElementById('lessonTab')?.scrollIntoView({ behavior: 'smooth' });
}

async function handleAction(button) {
  const action = button.dataset.action;
  if (action === 'next') return nextStep();
  if (action === 'back') { state.step = Math.max(1, state.step - 1); feedback = null; saveState(); return render(); }
  if (action === 'step') {
    const requestedStep = Number(button.dataset.step);
    if (requestedStep >= 3 && !state.plan.nomeCurso.trim()) {
      state.step = 2;
      return setFeedback('error', 'Informe o nome oficial do curso antes da pré-visualização.');
    }
    state.step = requestedStep; feedback = null; saveState(); return render();
  }
  if (action === 'reset') {
    if (!confirm('Recomeçar e apagar somente o rascunho deste plano de aula?')) return;
    localStorage.removeItem(STORAGE_ID); state = { step: 1, plan: createDefaultPlan(), analysis: null, fileName: '', pdfDownloaded: false, showUrl: false }; feedback = null; return render();
  }
  if (action === 'template') return downloadLessonTemplate();
  if (action === 'sample') { applyImportedResult(samplePlan()); return render(); }
  if (action === 'add-writer') { state.plan.conteudistas.push({ id: crypto.randomUUID(), nome: '', biografia: '' }); saveState(); return render(); }
  if (action === 'remove-writer') { state.plan.conteudistas = state.plan.conteudistas.filter((writer) => writer.id !== button.dataset.id); saveState(); return render(); }
  if (action === 'add-objective') { state.plan.unidades[Number(button.dataset.index)].objetivos.push(''); saveState(); return render(); }
  if (action === 'ai-objectives') return callLessonAi('objectives', Number(button.dataset.index));
  if (action === 'ai-general') return callLessonAi('generalObjective');
  if (action === 'ai-audience') return callLessonAi('audience');
  if (action === 'ai-wordpress') return callLessonAi('wordpress');
  if (action === 'pdf') {
    busy = true;
    button.disabled = true;
    button.textContent = 'Gerando documento...';
    try { await downloadLessonPdf(state.plan); state.pdfDownloaded = true; feedback = null; saveState(); }
    catch (error) {
      console.error('Erro ao gerar o plano de ensino em PDF:', error);
      feedback = { type: 'error', message: 'Não foi possível gerar o PDF. Atualize a página e tente novamente.' };
    }
    finally { busy = false; render(); }
    return;
  }
  if (action === 'show-url') { state.showUrl = true; saveState(); return render(); }
  if (action === 'hide-url') { state.showUrl = false; state.pdfDownloaded = false; saveState(); return render(); }
  if (action === 'xml') { downloadLessonXml(state.plan); localStorage.removeItem(STORAGE_ID); return setFeedback('success', 'XML WordPress gerado como rascunho.'); }
}

export function initializeLessonPlan() {
  root = document.getElementById('lessonPlanApp');
  if (!root) return;
  render();
  if (state.plan.unidades.length) getProgramCatalog().then(enrichProgramsFromCatalog);
  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action], [data-taxonomy]');
    if (!button || !root.contains(button)) return;
    if (button.dataset.taxonomy) {
      const values = state.plan.wordpressData[button.dataset.taxonomy];
      state.plan.wordpressData[button.dataset.taxonomy] = values.includes(button.dataset.slug) ? values.filter((value) => value !== button.dataset.slug) : [...values, button.dataset.slug];
      saveState(); render(); return;
    }
    handleAction(button);
  });
  root.addEventListener('input', (event) => {
    const target = event.target;
    if (target.dataset.field) {
      const writerMatch = target.dataset.field.match(/^writer-(name|bio)-(\d+)$/);
      if (writerMatch) state.plan.conteudistas[Number(writerMatch[2])][writerMatch[1] === 'name' ? 'nome' : 'biografia'] = target.value;
      else state.plan[target.dataset.field] = target.value;
    }
    if (target.dataset.wpField) state.plan.wordpressData[target.dataset.wpField] = target.value;
    if (target.dataset.unitObjectives) state.plan.unidades[Number(target.dataset.unitObjectives)].objetivos = target.value.split('\n').map((value) => value.trim()).filter(Boolean);
    if (target.dataset.programCode) updateProgram(target.dataset.programCode, target.value);
    saveState();
  });
  root.addEventListener('change', (event) => { if (event.target.id === 'lessonFileInput' && event.target.files?.[0]) handleFile(event.target.files[0]); });
  root.addEventListener('dragover', (event) => { if (event.target.closest('#lessonDropzone')) event.preventDefault(); });
  root.addEventListener('drop', (event) => { const zone = event.target.closest('#lessonDropzone'); if (zone) { event.preventDefault(); if (event.dataTransfer.files?.[0]) handleFile(event.dataTransfer.files[0]); } });
  root.addEventListener('submit', (event) => {
    event.preventDefault();
    if (event.target.id === 'lessonReviewForm') nextStep();
    if (event.target.id === 'lessonUrlForm') {
      try {
        const url = new URL(document.getElementById('lessonPdfUrl').value);
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
        state.plan.wordpressData.linkPlanoEnsinoPdf = url.href;
        state.showUrl = false;
        saveState();
        nextStep();
      } catch { setFeedback('error', 'Informe uma URL HTTPS pública e válida.'); }
    }
  });
}

export function refreshLessonPlanPreview() {
  if (!root || state.step !== 3) return;
  render();
}
