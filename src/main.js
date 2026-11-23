import { initializeLessonPlan, refreshLessonPlanPreview } from './lesson-plan.js';
import { APP_VERSION } from './version.js';
import './avaliacoes.css';
import { buildCsv, buildScope, reportPages } from './avaliacoes-relatorio.js';
import { ensureRelatorioCursoLoaded } from './relatorio-curso-tela.js';
import {
  barRows,
  kpiCardsFor,
  columnChart,
  computeStats,
  COLORS,
  donutChart,
  attemptStackChart,
  signalList,
  formatNumber,
  formatPercent,
  kpiCard,
  lineChart,
} from './avaliacoes-dashboard.js';

const appVersionEl = document.getElementById('appVersion');
if (appVersionEl) appVersionEl.textContent = `v${APP_VERSION}`;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

const loginError = document.getElementById('loginError');
let currentUserRole = null;
const googleLoginButton = document.getElementById('googleLoginButton');
const authenticatedUserName = document.getElementById('authenticatedUserName');
const authenticatedUserEmail = document.getElementById('authenticatedUserEmail');
const authenticatedUserAvatar = document.getElementById('authenticatedUserAvatar');
const auditorName = document.getElementById('auditorName');
const auditorEmail = document.getElementById('auditorEmail');
const auditorAvatar = document.getElementById('auditorAvatar');
const logoutBtn = document.getElementById('logoutBtn');

function showLoginError(message) {
  loginError.textContent = message;
  loginError.style.display = 'block';
}

// Função da pessoa no sistema (vem do perfil de acesso no servidor), exibida no header no lugar do e-mail.
const ROLE_LABELS = { admin: 'Administrador', operator: 'Operador', viewer: 'Visualizador', gestor: 'Gestor de área' };

function showAuthenticatedApp(user) {
  currentUserRole = user.role || null;
  // Só os dois primeiros nomes no header.
  const primeirosNomes = String(user.name || '').trim().split(/\s+/).slice(0, 2).join(' ');
  if (authenticatedUserName) authenticatedUserName.textContent = primeirosNomes || 'Usuario autorizado';
  if (authenticatedUserEmail) authenticatedUserEmail.textContent = ROLE_LABELS[user.role] || '';
  if (auditorName) auditorName.textContent = user.name || 'Usuário autorizado';
  if (auditorEmail) auditorEmail.textContent = user.email || '';
  if (user.role === 'viewer') {
    document.querySelectorAll('[data-sidebar="register"], [data-sidebar="csv"]')
      .forEach((button) => { button.hidden = true; });
  }
  // Gestor: só a aba Avaliações, em leitura. Os demais menus ficam ocultos.
  if (user.role === 'gestor') {
    document.querySelectorAll('.sidebar-btn').forEach((button) => {
      if (button.dataset.sidebar !== 'avaliacoes') button.hidden = true;
    });
    switchTab('avaliacoes');
  }

  if (user.picture) {
    const pictureUrl = safeHttpsUrl(user.picture);
    if (authenticatedUserAvatar) {
      authenticatedUserAvatar.textContent = '';
      authenticatedUserAvatar.style.backgroundImage = pictureUrl ? `url("${pictureUrl}")` : '';
      authenticatedUserAvatar.style.backgroundSize = 'cover';
      authenticatedUserAvatar.style.backgroundPosition = 'center';
    }
    if (auditorAvatar) {
      auditorAvatar.textContent = '';
      auditorAvatar.style.backgroundImage = pictureUrl ? `url("${pictureUrl}")` : '';
      auditorAvatar.style.backgroundSize = 'cover';
      auditorAvatar.style.backgroundPosition = 'center';
    }
  } else {
    const names = String(user.name || user.email || 'U').trim().split(/\s+/);
    const initials = names.map((name) => name[0]).join('').slice(0, 2).toUpperCase();
    if (authenticatedUserAvatar) authenticatedUserAvatar.textContent = initials;
    if (auditorAvatar) auditorAvatar.textContent = initials;
  }

  document.body.classList.remove('auth-pending');
}

async function waitForGoogleIdentity() {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (window.google?.accounts?.id) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function handleGoogleCredential(response) {
  loginError.style.display = 'none';
  try {
    const result = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential }),
    });
    const data = await result.json();
    if (!result.ok) throw new Error(data.error || 'Falha ao entrar com Google.');
    showAuthenticatedApp(data.user);
  } catch (error) {
    showLoginError(error.message);
  }
}

async function initializeAuthentication() {
  try {
    const sessionResponse = await fetch('/api/auth/session');
    if (sessionResponse.ok) {
      const session = await sessionResponse.json();
      if (session.authenticated) {
        showAuthenticatedApp(session.user);
        return;
      }
    }

    const configResponse = await fetch('/api/auth/config');
    const config = await configResponse.json();
    if (!configResponse.ok || !config.configured || !config.clientId) {
      showLoginError('Configure as credenciais Google nas variaveis de ambiente da Vercel.');
      return;
    }

    if (!await waitForGoogleIdentity()) {
      showLoginError('Nao foi possivel carregar o login do Google.');
      return;
    }

    window.google.accounts.id.initialize({
      client_id: config.clientId,
      callback: handleGoogleCredential,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    window.google.accounts.id.renderButton(googleLoginButton, {
      theme: 'outline',
      size: 'large',
      shape: 'rectangular',
      text: 'continue_with',
      width: 340,
      locale: 'pt-BR',
    });
  } catch {
    showLoginError('Nao foi possivel iniciar a autenticacao. Tente novamente.');
  }
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    localStorage.removeItem('consistem_lms_lesson_plan_v1');
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    window.google?.accounts?.id?.disableAutoSelect();
    window.location.reload();
  });
}

// ==========================================
// 1. SIDEBAR NAVIGATION
// ==========================================
const sidebarBtns = document.querySelectorAll('.sidebar-btn[data-sidebar]');
const tabContents = document.querySelectorAll('.tab-content');
const breadcrumbPage = document.getElementById('breadcrumbPage');

const tabNames = {
  search: 'Consulta do Aluno',
  register: 'Gestao de Alunos / Cadastro & Matricula Individual',
  csv: 'Matricula em Lote (CSV)',
  lesson: 'Gerador de Plano de Aula',
  licenses: 'Licenças e Riscos',
  relatorioCurso: 'Relatório por curso',
  avaliacoes: 'Avaliações',
};

function switchTab(target) {
  sidebarBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.sidebar === target);
  });
  tabContents.forEach((tc) => {
    const isActive = tc.id === target + 'Tab';
    tc.classList.toggle('active', isActive);
    tc.style.display = isActive ? 'block' : 'none';
  });
  if (breadcrumbPage) breadcrumbPage.textContent = tabNames[target] || '';
  // Ao trocar de tela, começa sempre pelo topo (senão a nova tela abre no meio da rolagem anterior).
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });

  if (target === 'register') ensureSchoolsLoaded();
  else if (target === 'csv') ensureCsvSchoolsLoaded();
  else if (target === 'lesson') requestAnimationFrame(refreshLessonPlanPreview);
  else if (target === 'licenses') ensureLicensesLoaded();
  else if (target === 'relatorioCurso') ensureRelatorioCursoLoaded();
  else if (target === 'avaliacoes') ensureAvaliacoesLoaded();
}

sidebarBtns.forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.sidebar));
});

// ==========================================
// 2. ABA 1: CONSULTA DE ALUNO
// ==========================================
const searchForm = document.getElementById('searchForm');
const emailInput = document.getElementById('emailInput');
const searchBtn = document.getElementById('searchBtn');
const btnText = document.getElementById('btnText');
const btnLoader = document.getElementById('btnLoader');
const errorMsg = document.getElementById('errorMsg');
const searchClearBtn = document.getElementById('searchClearBtn');

// Dashboard 360 elements
const dashboard = document.getElementById('dashboard');
const dashAvatar = document.getElementById('dashAvatar');
const dashStudentName = document.getElementById('dashStudentName');
const dashStudentEmail = document.getElementById('dashStudentEmail');
const dashSchoolText = document.getElementById('dashSchoolText');
const dashEmailConfirmTag = document.getElementById('dashEmailConfirmTag');
const dashAccessText = document.getElementById('dashAccessText');
const dashCadTag = document.getElementById('dashCadTag');
const dashCadText = document.getElementById('dashCadText');
const dashOrgTag = document.getElementById('dashOrgTag');
const dashOrgText = document.getElementById('dashOrgText');
const dashOrgSep = document.getElementById('dashOrgSep');
const dashCodeTag = document.getElementById('dashCodeTag');
const dashCodeText = document.getElementById('dashCodeText');
const dashCadSep = document.getElementById('dashCadSep');

// KPIs
const dashKpiTotalCourses = document.getElementById('dashKpiTotalCourses');
const dashKpiTotalCoursesSub = document.getElementById('dashKpiTotalCoursesSub');
const dashKpiProgress = document.getElementById('dashKpiProgress');
const dashKpiCompletedCourses = document.getElementById('dashKpiCompletedCourses');
const dashKpiCertificates = document.getElementById('dashKpiCertificates');
const dashKpiGamification = document.getElementById('dashKpiGamification');
const dashKpiGamificationSub = document.getElementById('dashKpiGamificationSub');

// Sub-abas
const subtabCoursesBtn = document.querySelector('[data-subtab="courses"]');
const subtabCertsBtn = document.querySelector('[data-subtab="certs"]');
const subtabTrailsBtn = document.querySelector('[data-subtab="trails"]');
const subtabGamificationBtn = document.querySelector('[data-subtab="gamification"]');
const subtabAcademicBtn = document.querySelector('[data-subtab="academic"]');
const subtabCourses = document.getElementById('subtabCourses');
const subtabCerts = document.getElementById('subtabCerts');
const subtabTrails = document.getElementById('subtabTrails');
const subtabGamification = document.getElementById('subtabGamification');
const subtabAcademic = document.getElementById('subtabAcademic');
const countSubtabCourses = document.getElementById('countSubtabCourses');
const countSubtabCerts = document.getElementById('countSubtabCerts');
const countSubtabTrails = document.getElementById('countSubtabTrails');
const subtabsSummary = document.getElementById('subtabsSummary');

const dashCoursesContainer = document.getElementById('dashCoursesContainer');
const dashCertsContainer = document.getElementById('dashCertsContainer');
const dashTrailsContainer = document.getElementById('dashTrailsContainer');

// Gamificacao
const dashGamifLevelName = document.getElementById('dashGamifLevelName');
const dashGamifBadgeText = document.getElementById('dashGamifBadgeText');
const dashGamifPoints = document.getElementById('dashGamifPoints');
const dashGamifCoins = document.getElementById('dashGamifCoins');
const dashGamifActions = document.getElementById('dashGamifActions');

// Academicos
const dashDetailDept = document.getElementById('dashDetailDept');
const dashDetailUnit = document.getElementById('dashDetailUnit');
const dashDetailRole = document.getElementById('dashDetailRole');
const dashDetailCode = document.getElementById('dashDetailCode');
const dashDetailTrails = document.getElementById('dashDetailTrails');
const studentReportBtn = document.getElementById('studentReportBtn');
const studentReportModal = document.getElementById('studentReportModal');
const closeStudentReportBtn = document.getElementById('closeStudentReportBtn');
const downloadStudentReportBtn = document.getElementById('downloadStudentReportBtn');

let currentStudentDashboardData = null;

function setReportText(id, value, fallback = '-') {
  const element = document.getElementById(id);
  if (element) element.textContent = value || fallback;
}

function populateStudentReport(data) {
  const totalCourses = data.totalCursos || 0;
  const completedCourses = data.cursosConcluidos || 0;
  const progress = data.progressoGeral || 0;
  const courses = Array.isArray(data.cursos) ? data.cursos : [];

  setReportText('reportStudentName', data.nome);
  setReportText('reportStudentEmail', data.email);
  setReportText('reportGeneratedAt', new Intl.DateTimeFormat('pt-BR').format(new Date()));
  setReportText('reportSchools', data.escola);
  setReportText('reportStatus', data.status);
  setReportText('reportDepartment', data.departamento, 'Não informado');
  setReportText('reportRole', data.cargo, 'Não informado');
  setReportText('reportUnit', data.unidade, 'Não informada');
  setReportText('reportExternalCode', data.codigoExterno, 'Não informado');
  setReportText('reportRegistrationDate', data.dataCadastro, 'Não informada');
  setReportText('reportLastAccess', data.ultimoAcesso, 'Nunca acessou');
  setReportText('reportTotalCourses', String(totalCourses), '0');
  setReportText('reportAverageProgress', `${progress}%`, '0%');
  setReportText('reportCompletedCourses', String(completedCourses), '0');
  setReportText('reportCertificates', String(data.totalCertificados || 0), '0');

  const inProgress = Math.max(0, totalCourses - completedCourses);
  setReportText(
    'reportManagementSummary',
    `${data.nome || 'O aluno'} possui ${totalCourses} curso(s) matriculado(s), com ${completedCourses} conclusão(ões) e ${inProgress} curso(s) em andamento. O progresso médio atual é de ${progress}%.`
  );

  const visibleCourses = courses.slice(0, 8);
  const reportCoursesBody = document.getElementById('reportCoursesBody');
  const reportCoursesCaption = document.getElementById('reportCoursesCaption');
  reportCoursesCaption.textContent = courses.length > visibleCourses.length
    ? `Exibindo 8 de ${courses.length} cursos`
    : `${courses.length} curso(s)`;

  reportCoursesBody.innerHTML = visibleCourses.length
    ? visibleCourses.map((course) => {
      const courseProgress = Math.min(100, Math.max(0, course.percentual || 0));
      const isCompleted = course.concluido || courseProgress >= 100;
      return `
        <tr>
          <td><strong>${escapeHtml(course.titulo_curso || 'Curso sem título')}</strong></td>
          <td>${escapeHtml(course.escola || 'Não informada')}</td>
          <td><span class="report-course-progress">${courseProgress}%</span></td>
          <td><span class="report-course-status ${isCompleted ? '' : 'pending'}">${isCompleted ? 'Concluído' : 'Em andamento'}</span></td>
        </tr>`;
    }).join('')
    : '<tr><td colspan="4">Nenhum curso matriculado.</td></tr>';
}

function openStudentReport() {
  if (!currentStudentDashboardData) return;
  populateStudentReport(currentStudentDashboardData);
  studentReportModal.classList.add('open');
  studentReportModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('report-open');
}

function closeStudentReport() {
  studentReportModal.classList.remove('open');
  studentReportModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('report-open');
}

studentReportBtn?.addEventListener('click', openStudentReport);
closeStudentReportBtn?.addEventListener('click', closeStudentReport);
studentReportModal?.addEventListener('click', (event) => {
  if (event.target === studentReportModal) closeStudentReport();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && studentReportModal?.classList.contains('open')) closeStudentReport();
});
downloadStudentReportBtn?.addEventListener('click', async () => {
  const reportPage = document.getElementById('studentReportPage');
  const originalContent = downloadStudentReportBtn.innerHTML;
  downloadStudentReportBtn.disabled = true;
  downloadStudentReportBtn.textContent = 'Gerando PDF...';

  try {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ]);
    await document.fonts?.ready;
    await Promise.all(
      Array.from(reportPage.querySelectorAll('img')).map((image) => {
        if (image.complete) return Promise.resolve();
        return new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        });
      })
    );

    const canvas = await html2canvas(reportPage, {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      logging: false,
    });
    const imageData = canvas.toDataURL('image/jpeg', 0.95);
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    pdf.addImage(imageData, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');

    const safeName = String(currentStudentDashboardData?.nome || 'aluno')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    pdf.save(`relatorio_${safeName}_hotscool.pdf`);
  } catch {
    alert('Não foi possível gerar o PDF. Tente novamente.');
  } finally {
    downloadStudentReportBtn.disabled = false;
    downloadStudentReportBtn.innerHTML = originalContent;
  }
});

function switchDashboardSubtab(target) {
  const allBtns = [subtabCoursesBtn, subtabCertsBtn, subtabTrailsBtn, subtabGamificationBtn, subtabAcademicBtn];
  const allPanels = [subtabCourses, subtabCerts, subtabTrails, subtabGamification, subtabAcademic];

  allBtns.forEach((btn) => btn?.classList.remove('active'));
  allPanels.forEach((p) => {
    if (p) {
      p.classList.remove('active');
      p.style.display = 'none';
    }
  });

  const map = { courses: 0, certs: 1, trails: 2, gamification: 3, academic: 4 };
  const idx = map[target];
  if (idx !== undefined && allBtns[idx] && allPanels[idx]) {
    allBtns[idx].classList.add('active');
    allPanels[idx].classList.add('active');
    allPanels[idx].style.display = 'block';
  }
}

if (subtabCoursesBtn) subtabCoursesBtn.addEventListener('click', () => switchDashboardSubtab('courses'));
if (subtabCertsBtn) subtabCertsBtn.addEventListener('click', () => switchDashboardSubtab('certs'));
if (subtabTrailsBtn) subtabTrailsBtn.addEventListener('click', () => switchDashboardSubtab('trails'));
if (subtabGamificationBtn) subtabGamificationBtn.addEventListener('click', () => switchDashboardSubtab('gamification'));
if (subtabAcademicBtn) subtabAcademicBtn.addEventListener('click', () => switchDashboardSubtab('academic'));

function setSearchLoading(loading) {
  searchBtn.disabled = loading;
  btnText.style.display = loading ? 'none' : 'inline';
  btnLoader.style.display = loading ? 'inline-block' : 'none';
  emailInput.disabled = loading;
}

function showSearchError(message) {
  errorMsg.textContent = message;
  errorMsg.style.display = 'block';
}

function hideSearchError() {
  errorMsg.style.display = 'none';
}

if (searchClearBtn) {
  searchClearBtn.addEventListener('click', () => {
    emailInput.value = '';
    emailInput.focus();
  });
}

// Ordenação da aba Cursos & Progresso. "api" mantém a ordem recebida da Hotscool.
let dashboardCourses = [];
const coursesSortSelect = document.getElementById('coursesSortSelect');
function sortDashboardCourses(list) {
  const mode = coursesSortSelect?.value || 'api';
  const pct = (c) => Math.min(100, Math.max(0, c.percentual || 0));
  const copy = [...list];
  if (mode === 'progress-desc') copy.sort((a, b) => pct(b) - pct(a));
  if (mode === 'progress-asc') copy.sort((a, b) => pct(a) - pct(b));
  if (mode === 'name') copy.sort((a, b) => String(a.titulo_curso || '').localeCompare(String(b.titulo_curso || ''), 'pt-BR'));
  return copy;
}
coursesSortSelect?.addEventListener('change', () => renderStudentCourses(sortDashboardCourses(dashboardCourses)));

function renderStudentCourses(courses) {
  if (!courses || courses.length === 0) {
    dashCoursesContainer.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:48px 24px;color:var(--graphite-subtle);background:var(--surface-card);border:1px dashed var(--graphite-border);border-radius:var(--r-lg);">
        Nenhum curso matriculado para este aluno.
      </div>`;
    return;
  }

  dashCoursesContainer.innerHTML = courses.map((c) => {
    const perc = Math.min(100, Math.max(0, c.percentual || 0));
    const isDone = c.concluido || perc >= 100;
    const statusClass = isDone ? 'success' : 'neutral';
    const statusText = isDone ? 'Concluido' : 'Em Andamento';
    const turma = c.turma && c.turma !== 'null' ? escapeHtml(c.turma) : '';
    const title = escapeHtml(c.titulo_curso);
    const imageUrl = safeHttpsUrl(c.imagem);
    const accessUrl = safeHttpsUrl(c.acessoUrl) || 'https://app.hotscool.com/';
    const certificateUrl = safeHttpsUrl(c.certificadoUrl);

    // Status de acesso da matrícula: fonte oficial GET /students/course/access
    // (status 1=Ativo, 2=Bloqueado). O botão fica sempre visível para
    // liberação em 1 clique sem ir ao painel da Hotscool.
    const syncing = c.acessoSincronizando === true || (c.acessoAtivo === undefined && c.statusMatricula === undefined);
    const isBlocked = c.acessoAtivo === false;
    const accessLabel = syncing ? 'Sincronizando…' : (c.statusMatricula === 'expirado' ? 'Expirado' : isBlocked ? 'Bloqueado' : 'Ativo');
    const accessClass = syncing ? 'info' : isBlocked ? 'error' : 'success';
    const accessTitle = syncing
      ? 'Carregando dados do curso…'
      : isBlocked
        ? 'Matrícula bloqueada/expirada neste curso. Use Reativar acesso.'
        : 'Status sincronizado com a Hotscool. Se o aluno relatar falta de acesso, use Liberar acesso.';
    const limitLabel = (!syncing && (c.dataLimite || c.dataExpiracao))
      ? `<span style="font-size:11px;color:var(--graphite-muted)">Limite: ${escapeHtml(c.dataLimite || c.dataExpiracao)}</span>`
      : '';

    const hasCourseRef = Number.isSafeInteger(Number(c.id_curso)) && c.schoolId !== undefined && c.schoolId !== null;
    const reactivateBtn = hasCourseRef
      ? `<button type="button" class="btn-reactivate ${isBlocked ? 'blocked' : 'ghost'}" data-reactivate-course="${escapeHtml(String(c.id_curso))}" data-reactivate-school="${escapeHtml(String(c.schoolId))}" data-reactivate-title="${title}" title="Libera o acesso via API sem precisar abrir o painel da Hotscool">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10"/><path d="M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/></svg>
          ${isBlocked ? 'Reativar acesso' : 'Liberar acesso'}
        </button>`
      : '';

    let actions = '';
    if (isDone && certificateUrl) {
      actions = `<a href="${certificateUrl}" target="_blank" rel="noopener noreferrer" class="btn-cert">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>
        Ver Certificado Autenticado
      </a>`;
    } else if (!isDone) {
      actions = `<a href="${accessUrl}" target="_blank" rel="noopener noreferrer" class="btn-continue">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        Continuar Curso
      </a>`;
    }
    if (reactivateBtn) actions += reactivateBtn;

    const progressClass = isDone ? 'green' : '';

    return `
      <div class="course-card ${isBlocked ? 'course-blocked' : ''}">
        <div class="course-card-cover ${imageUrl ? '' : 'empty'}">
          ${imageUrl
        ? `<img src="${imageUrl}" alt="Capa do curso ${title}" loading="lazy">`
        : `<span>${escapeHtml(c.titulo_curso?.slice(0, 1) || 'H')}</span>`}
        </div>
        <div class="course-card-body">
        <div class="course-card-status">
          <span class="status-pill ${statusClass}">${statusText}</span>
          <span class="status-pill ${accessClass}" title="${escapeHtml(accessTitle)}">${accessLabel}</span>
          ${turma ? `<span style="font-size:11px;color:var(--graphite-muted)">Turma: ${turma}</span>` : ''}
          ${limitLabel}
        </div>
        <h4 class="course-card-title">${title}</h4>
        <div class="course-card-meta">
          ${c.escola ? `<span>${escapeHtml(c.escola)}</span>` : ''}
          ${c.categoria ? `<span>+ ${escapeHtml(c.categoria)}</span>` : ''}
        </div>
        <div class="course-progress-section">
          <div class="course-progress-row">
            <span class="course-progress-label">Progresso${!isDone ? ` (Modulo ${Math.ceil(perc / 25)} de 4)` : ' Concluido'}</span>
            <span class="course-progress-pct" style="color:${isDone ? 'var(--success)' : 'var(--graphite)'}">${c.percentualFormatado || perc + '%'}</span>
          </div>
          <div class="progress-bar">
            <div class="progress-bar-fill ${progressClass}" style="width:${perc}%"></div>
          </div>
        </div>
        ${actions ? `<div class="course-card-actions">${actions}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

async function handleReactivateClick(event) {
  const btn = event.target?.closest?.('[data-reactivate-course]');
  if (!btn || !dashCoursesContainer.contains(btn)) return;
  if (btn.disabled) return;
  const email = dashStudentEmail?.textContent?.trim() || emailInput.value.trim();
  if (!EMAIL_REGEX.test(email)) {
    alert('E-mail do aluno inválido para reativação.');
    return;
  }
  const courseTitle = btn.dataset.reactivateTitle || `curso ${btn.dataset.reactivateCourse}`;
  const isBlockedCourse = btn.classList.contains('blocked');
  if (!isBlockedCourse && !confirm(`Liberar o acesso de ${email} ao curso "${courseTitle}"?`)) return;
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = 'Reativando…';
  try {
    const res = await fetch('/api/student', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'reactivate',
        email,
        id_curso: Number(btn.dataset.reactivateCourse),
        schoolId: Number(btn.dataset.reactivateSchool),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Não foi possível reativar o acesso.');
    btn.innerHTML = 'Acesso reativado ✓';
    const card = btn.closest('.course-card');
    const pill = card?.querySelector('.status-pill.error');
    if (pill) {
      pill.className = 'status-pill success';
      pill.textContent = 'Ativo';
    }
    btn.remove();
    const fullResponse = await fetch(`/api/student?email=${encodeURIComponent(email)}&refresh=true`);
    if (fullResponse.ok) showDashboard(await fullResponse.json());
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    alert(err.message);
  }
}

if (dashCoursesContainer && !dashCoursesContainer.dataset.reactivateBound) {
  dashCoursesContainer.dataset.reactivateBound = '1';
  dashCoursesContainer.addEventListener('click', handleReactivateClick);
}

function renderStudentCertificates(certs) {
  if (!certs || certs.length === 0) {
    dashCertsContainer.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:48px 24px;color:var(--graphite-subtle);background:var(--surface-card);border:1px dashed var(--graphite-border);border-radius:var(--r-lg);">
        Nenhum certificado emitido ate o momento.
      </div>`;
    return;
  }

  dashCertsContainer.innerHTML = certs.map((c) => `
    <div class="cert-card">
      <div class="cert-info">
        <span class="cert-name">${escapeHtml(c.cursoNome)}</span>
        <span class="cert-date">Emitido em: ${escapeHtml(c.dataEmissao)}</span>
      </div>
      <a href="${safeHttpsUrl(c.url) || '#'}" target="_blank" rel="noopener noreferrer" class="cert-link">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Abrir PDF
      </a>
    </div>`).join('');
}

function renderStudentTrails(trails) {
  if (!dashTrailsContainer) return;
  if (!trails || trails.length === 0) {
    dashTrailsContainer.innerHTML = `
      <div style="text-align:center;padding:48px 24px;color:var(--graphite-subtle);background:var(--surface-card);border:1px dashed var(--graphite-border);border-radius:var(--r-lg);">
        Nenhuma trilha vinculada a este aluno. Matricule-o em uma trilha via aba Cadastro Individual.
      </div>`;
    return;
  }
  dashTrailsContainer.innerHTML = trails.map((t) => {
    const perc = Math.min(100, Math.max(0, t.progresso || t.progress || 0));
    const isDone = t.concluida || perc >= 100;
    const isProgress = t.emAndamento || (perc > 0 && !isDone);
    const statusText = isDone ? 'Concluída' : isProgress ? 'Em andamento' : 'Não iniciada';
    const statusClass = isDone ? 'success' : isProgress ? 'warning' : '';
    const total = t.totalCursos || (t.cursos ? t.cursos.length : 0);
    const concluidos = t.concluidos || 0;
    const matriculados = t.matriculados != null ? t.matriculados : total;
    const cursosHtml = Array.isArray(t.cursos) && t.cursos.length
      ? `<div style="margin-top:12px;display:flex;flex-direction:column;gap:6px;">${t.cursos.map((c) => {
        const cp = Math.min(100, Math.max(0, c.percentual || 0));
        const cdone = c.concluido || cp >= 100;
        const dot = cdone ? '✓' : c.matriculado ? '●' : '○';
        const col = cdone ? 'var(--success)' : c.matriculado ? 'var(--gold)' : 'var(--graphite-muted)';
        return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;padding:6px 8px;background:var(--surface-muted);border-radius:6px;">
            <span style="display:flex;align-items:center;gap:6px;"><span style="color:${col};font-weight:700;">${dot}</span> ${escapeHtml(c.titulo_curso)}</span>
            <span style="font-weight:600;color:${col};">${cp}%</span>
          </div>`;
      }).join('')}</div>`
      : '';
    return `
      <div class="course-card" style="border-left:4px solid ${isDone ? 'var(--success)' : isProgress ? 'var(--gold)' : 'var(--graphite-border)'}">
        <div class="course-card-body">
          <div class="course-card-status">
            <span class="status-pill ${statusClass}">${statusText}</span>
            <span style="font-size:11px;color:var(--graphite-muted)">${concluidos}/${total} cursos • ${matriculados} matriculados</span>
          </div>
          <h4 class="course-card-title">${escapeHtml(t.nome || t.nome_trilha || 'Trilha')}</h4>
          ${t.descricao ? `<p style="font-size:12px;color:var(--graphite-muted);margin:4px 0 8px;">${escapeHtml(t.descricao.slice(0, 180))}</p>` : ''}
          <div class="course-progress-section">
            <div class="course-progress-row">
              <span class="course-progress-label">Progresso da trilha</span>
              <span class="course-progress-pct">${perc}%</span>
            </div>
            <div class="progress-bar"><div class="progress-bar-fill ${isDone ? 'green' : perc >= 50 ? 'gold' : ''}" style="width:${perc}%"></div></div>
          </div>
          ${cursosHtml}
        </div>
      </div>`;
  }).join('');
}

function showDashboard(data) {
  currentStudentDashboardData = data;

  // Avatar
  const rawNome = data.nome || 'Aluno';
  dashStudentName.textContent = rawNome;
  dashStudentEmail.textContent = data.email || '';
  const registryStudentStatus = document.getElementById('registryStudentStatus');
  const registryStudentId = document.getElementById('registryStudentId');
  const registryExternalCode = document.getElementById('registryExternalCode');
  if (registryStudentStatus) registryStudentStatus.textContent = data.status || 'Nao informado';
  if (registryStudentId) registryStudentId.textContent = data.id ? `#${data.id}` : '-';
  if (registryExternalCode) registryExternalCode.textContent = data.codigoExterno || 'Não informado';

  // Pill principal do header: reflete bloqueios por curso.
  const dashStudentStatus = document.getElementById('dashStudentStatus');
  if (dashStudentStatus) {
    const blocked = Number(data.totalBloqueados || 0);
    const total = Number(data.totalCursos || 0);
    let label = data.status || 'Ativo';
    let cls = 'status-pill success';
    if (data.detail === 'summary' && !total) {
      label = 'Sincronizando…';
      cls = 'status-pill info';
    } else if (blocked > 0 && blocked >= total && total > 0) {
      label = 'Matrícula Bloqueada';
      cls = 'status-pill error';
    } else if (blocked > 0) {
      label = `${blocked} curso(s) bloqueado(s)`;
      cls = 'status-pill error';
    } else if (label === 'Ativo') {
      label = 'Matrícula Ativa';
    }
    dashStudentStatus.className = cls;
    dashStudentStatus.textContent = label;
  }

  const avatarUrl = safeHttpsUrl(data.avatar);
  if (avatarUrl) {
    dashAvatar.className = '';
    dashAvatar.innerHTML = `<img src="${avatarUrl}" alt="${escapeHtml(rawNome)}" class="profile-avatar-img">`;
  } else {
    const names = rawNome.trim().split(/\s+/);
    const initials = names.length > 1
      ? `${names[0][0]}${names[names.length - 1][0]}`
      : names[0].slice(0, 2);
    dashAvatar.className = 'profile-avatar-initials';
    dashAvatar.textContent = initials.toUpperCase();
  }

  // Tags
  dashSchoolText.textContent = data.escola || 'Escola Principal';

  if (data.emailConfirmado) {
    dashEmailConfirmTag.style.display = 'inline-flex';
  } else {
    dashEmailConfirmTag.style.display = 'none';
  }

  dashAccessText.textContent = data.ultimoAcesso || 'Nunca acessou';

  if (data.dataCadastro) {
    dashCadTag.style.display = 'inline-flex';
    dashCadText.textContent = data.dataCadastro;
    if (dashCadSep) dashCadSep.style.display = 'inline';
  } else {
    dashCadTag.style.display = 'none';
    if (dashCadSep) dashCadSep.style.display = 'none';
  }

  if (data.departamento || data.unidade || data.cargo) {
    dashOrgTag.style.display = 'inline-flex';
    dashOrgText.textContent = [data.departamento, data.cargo].filter(Boolean).join(' / ') || data.unidade;
    if (dashOrgSep) dashOrgSep.style.display = 'inline';
  } else {
    dashOrgTag.style.display = 'none';
    if (dashOrgSep) dashOrgSep.style.display = 'none';
  }

  if (data.codigoExterno) {
    dashCodeTag.style.display = 'inline-flex';
    dashCodeText.textContent = data.codigoExterno;
  } else {
    dashCodeTag.style.display = 'none';
  }

  // KPIs
  dashKpiTotalCourses.textContent = String(data.totalCursos || 0);
  if (dashKpiTotalCoursesSub) {
    const extra = Math.max(0, (data.totalCursos || 0) - (data.cursosConcluidos || 0));
    dashKpiTotalCoursesSub.textContent = extra > 0 ? `+${extra} ate mais` : 'Todos concluidos';
  }

  const progresso = Math.min(100, Math.max(0, data.progressoGeral || 0));
  dashKpiProgress.textContent = `${progresso}%`;
  dashKpiCompletedCourses.textContent = `${data.cursosConcluidos || 0} Cursos`;
  dashKpiCertificates.textContent = `${data.totalCertificados || 0} Emitidos`;
  dashKpiGamification.textContent = String(data.gamificacao?.pontos || 0);
  if (dashKpiGamificationSub) {
    dashKpiGamificationSub.textContent = `${data.gamificacao?.nivel || 'Nivel Iniciante'} + ${data.gamificacao?.moedas || 0} Moedas`;
  }

  // Counters
  countSubtabCourses.textContent = String(data.totalCursos || 0);
  countSubtabCerts.textContent = String(data.totalCertificados || 0);
  if (countSubtabTrails) countSubtabTrails.textContent = String(data.totalTrilhas || (Array.isArray(data.trilhas) ? data.trilhas.length : 0));

  const andamento = (data.totalCursos || 0) - (data.cursosConcluidos || 0);
  const concluidos = data.cursosConcluidos || 0;
  if (subtabsSummary) {
    subtabsSummary.textContent = `${andamento} em andamento + ${concluidos} concluidos`;
  }

  // Render
  dashboardCourses = data.cursos || [];
  renderStudentCourses(sortDashboardCourses(dashboardCourses));
  renderStudentCertificates(data.certificados || []);
  renderStudentTrails(data.trilhas || []);
  renderLearningProgress(data.cursos || []);
  renderStatusRing(concluidos, Math.max(0, andamento));

  // Gamificacao
  dashGamifLevelName.textContent = data.gamificacao?.nivel || 'Nivel Inicial';
  dashGamifBadgeText.textContent = data.gamificacao?.badge || 'Conquistas e engajamento na plataforma';
  dashGamifPoints.textContent = String(data.gamificacao?.pontos || 0);
  dashGamifCoins.textContent = String(data.gamificacao?.moedas || 0);
  dashGamifActions.textContent = String(data.gamificacao?.acoes || 0);

  // Academicos
  dashDetailDept.textContent = data.departamento || 'Nao atribuido';
  dashDetailUnit.textContent = data.unidade || 'Nao informada';
  dashDetailRole.textContent = data.cargo || 'Nao informado';
  dashDetailCode.textContent = data.codigoExterno || 'Não informado';

  if (Array.isArray(data.trilhas) && data.trilhas.length > 0) {
    dashDetailTrails.innerHTML = data.trilhas
      .map((t) => {
        const perc = t.progresso != null ? t.progresso : (t.progress || 0);
        const done = t.concluida ? ' • Concluída' : t.emAndamento ? ` • ${perc}%` : '';
        return `<span class="trail-chip" title="${escapeHtml(t.nome || t.titulo || 'Trilha')}${done}">${escapeHtml(t.nome || t.titulo || t.nome_trilha || 'Trilha')}${t.concluida ? ' ✓' : ''}</span>`;
      })
      .join('');
  } else {
    dashDetailTrails.innerHTML = '<span class="trail-empty">Nenhuma trilha vinculada</span>';
  }

  switchDashboardSubtab('courses');
  dashboard.style.display = 'flex';
  dashboard.style.flexDirection = 'column';
  dashboard.style.gap = '24px';
}

// Anel de status das inscrições: concluídas (grafite) e em andamento (coral), cores por token da DS.
function renderStatusRing(done, ongoing) {
  const el = document.getElementById('statusRing');
  const legend = document.getElementById('statusLegend');
  if (!el || !legend) return;
  done = Math.max(0, Math.round(Number(done) || 0));
  ongoing = Math.max(0, Math.round(Number(ongoing) || 0));
  const total = done + ongoing;
  const resumo = document.getElementById('learningProgressSub');
  if (resumo) resumo.textContent = `${total} inscrições · ${done} concluída(s) · ${ongoing} em andamento`;
  if (total <= 0) {
    el.innerHTML = '<span class="chart-empty">Sem inscrições para exibir.</span>';
    legend.innerHTML = '';
    return;
  }
  const C = 2 * Math.PI * 60;
  const dDone = (C * done) / total;
  const dOn = (C * ongoing) / total;
  el.innerHTML = `<svg viewBox="0 0 160 160" role="img" aria-label="${done} concluídas e ${ongoing} em andamento">
    <circle cx="80" cy="80" r="60" fill="none" stroke="var(--surface-hover)" stroke-width="20"/>
    <circle cx="80" cy="80" r="60" fill="none" stroke="var(--text-default)" stroke-width="20" stroke-dasharray="${dDone} ${C - dDone}" transform="rotate(-90 80 80)"/>
    <circle cx="80" cy="80" r="60" fill="none" stroke="var(--accent-highlight)" stroke-width="20" stroke-dasharray="${dOn} ${C - dOn}" stroke-dashoffset="${-dDone}" transform="rotate(-90 80 80)"/>
    <text x="80" y="78" text-anchor="middle" class="status-ring__value">${total}</text>
    <text x="80" y="98" text-anchor="middle" class="status-ring__label">inscrições</text>
  </svg>`;
  legend.innerHTML = `<li><span class="status-dot" style="background:var(--text-default)"></span>Concluídas <strong>${done}</strong></li>
    <li><span class="status-dot" style="background:var(--accent-highlight)"></span>Em andamento <strong>${ongoing}</strong></li>`;
}

function renderLearningProgress(courses) {
  const chart = document.getElementById('learningProgressChart');
  const total = document.getElementById('learningProgressTotal');
  if (!chart || !total) return;

  if (!courses.length) {
    chart.innerHTML = '<span class="chart-empty">Sem cursos para exibir.</span>';
    total.textContent = 'Dados sincronizados agora';
    return;
  }

  // Máximo de 6 barras: os 6 últimos cursos da lista recebida da Hotscool, na mesma ordem.
  chart.innerHTML = courses.slice(-6).map((course) => {
    const progress = Math.min(100, Math.max(0, course.percentual || 0));
    return `
      <div class="chart-bar-item" title="${escapeHtml(course.titulo_curso)}: ${progress}%">
        <span class="bar-value">${progress}%</span>
        <div class="bar-track">
          <div class="bar" style="height:${Math.max(8, progress) * 1.8}px">
            <span class="bar-fill ${progress >= 100 ? 'green' : 'ink'}"></span>
          </div>
        </div>
        <span class="bar-label">${escapeHtml(course.titulo_curso)}</span>
      </div>`;
  }).join('');
  const agora = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  total.textContent = `Atualizado em ${agora}`;
}

searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideSearchError();

  const email = emailInput.value.trim();
  if (!email) { showSearchError('Por favor, insira um e-mail.'); return; }
  if (!EMAIL_REGEX.test(email)) { showSearchError('Por favor, insira um e-mail valido.'); return; }

  setSearchLoading(true);
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 3000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Estágio 1 (rápido): identidade + cursos, sem os N relatórios de progresso.
      const summaryResponse = await fetch(`/api/student?email=${encodeURIComponent(email)}&refresh=true&detail=summary`);

      if (summaryResponse.status === 400) {
        showSearchError('E-mail invalido. Verifique e tente novamente.');
        setSearchLoading(false);
        return;
      }
      if (summaryResponse.status === 404) {
        if (attempt < MAX_RETRIES) {
          btnText.textContent = `Aluno nao encontrado... tentativa ${attempt}/${MAX_RETRIES}`;
          await new Promise((r) => setTimeout(r, RETRY_DELAY));
          continue;
        }
        showSearchError('Aluno nao encontrado. Verifique o e-mail ou aguarde alguns segundos apos o cadastro.');
        dashboard.style.display = 'none';
        setSearchLoading(false);
        return;
      }
      if (!summaryResponse.ok) {
        showSearchError('Erro ao buscar dados do aluno. Tente novamente mais tarde.');
        setSearchLoading(false);
        return;
      }

      const summary = await summaryResponse.json();
      showDashboard(summary);
      // Badge honesto de progresso: o botão segue em loading (spinner) e os
      // KPIs ganham shimmer até o estágio 2 chegar — sem delay artificial.
      dashboard.classList.add('is-syncing');

      // Estágio 2: progresso por curso, certificados e gamificação.
      try {
        const fullResponse = await fetch(`/api/student?email=${encodeURIComponent(email)}`);
        if (fullResponse.ok) {
          const data = await fullResponse.json();
          showDashboard(data);
        }
      } catch {
        // Mantém o resumo visível; o usuário pode buscar de novo para detalhes.
      } finally {
        dashboard.classList.remove('is-syncing');
      }
      setSearchLoading(false);
      return;
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        btnText.textContent = `Conectando... tentativa ${attempt}/${MAX_RETRIES}`;
        await new Promise((r) => setTimeout(r, RETRY_DELAY));
        continue;
      }
      showSearchError('Erro de conexao com o servidor. Verifique se o backend esta rodando.');
      setSearchLoading(false);
      return;
    }
  }
  setSearchLoading(false);
});

// ==========================================
// 3. ABA 2: CADASTRO INDIVIDUAL
// ==========================================
const registerForm = document.getElementById('registerForm');
const regSchool = document.getElementById('regSchool');
const regName = document.getElementById('regName');
const regEmail = document.getElementById('regEmail');
const regPassword = document.getElementById('regPassword');
const regSendEmail = document.getElementById('regSendEmail');
const coursesBadge = document.getElementById('coursesBadge');
const selectAllBtn = document.getElementById('selectAllBtn');
const deselectAllBtn = document.getElementById('deselectAllBtn');
const courseFilterInput = document.getElementById('courseFilterInput');
const coursesListContainer = document.getElementById('coursesListContainer');
const regSubmitBtn = document.getElementById('regSubmitBtn');
const regBtnText = document.getElementById('regBtnText');
const regBtnLoader = document.getElementById('regBtnLoader');
const regFeedback = document.getElementById('regFeedback');
const clearRegisterBtn = document.getElementById('clearRegisterBtn');
const resetPasswordBtn = document.getElementById('resetPasswordBtn');

let currentCourses = [];
let selectedCourseIds = new Set();
let schoolsLoaded = false;

async function ensureSchoolsLoaded() {
  if (schoolsLoaded) return;
  try {
    const res = await fetch('/api/courses');
    if (!res.ok) throw new Error('Falha ao carregar escolas');
    const data = await res.json();
    const schools = data.schools || [];
    if (schools.length === 0) {
      regSchool.innerHTML = '<option value="" disabled>Nenhuma escola encontrada</option>';
      return;
    }
    regSchool.innerHTML = schools.map((s) => `<option value="${Number(s.id)}">${escapeHtml(s.name)}</option>`).join('');
    schoolsLoaded = true;
    loadCoursesForSelectedSchool();
  } catch (err) {
    regSchool.innerHTML = '<option value="" disabled>Erro ao carregar escolas</option>';
  }
}

async function loadCoursesForSelectedSchool() {
  const schoolIdx = regSchool.value;
  if (schoolIdx === '') return;
  coursesListContainer.innerHTML = '<div class="empty-state">Carregando cursos da escola...</div>';
  selectedCourseIds.clear();
  updateSelectedCount();
  try {
    const res = await fetch(`/api/courses?schoolIndex=${schoolIdx}`);
    if (!res.ok) throw new Error('Erro ao buscar cursos');
    const data = await res.json();
    currentCourses = Array.isArray(data.courses) ? data.courses : [];
    renderCoursesList(currentCourses);
  } catch (err) {
    coursesListContainer.innerHTML = '<div class="empty-state">Nao foi possivel carregar os cursos desta escola.</div>';
  }
}

function renderCoursesList(courses) {
  if (courses.length === 0) {
    coursesListContainer.innerHTML = '<div class="empty-state">Nenhum curso ativo encontrado nesta escola.</div>';
    return;
  }
  coursesListContainer.innerHTML = courses.map((c) => {
    const courseId = Number(c.id);
    const isChecked = selectedCourseIds.has(courseId);
    // Carga horária no padrão do Figma: pílula coral logo após o nome, com vírgula decimal (ex.: 0,6h).
    const horas = Number(c.duracao);
    const duration = c.duracao && Number.isFinite(horas) ? `${horas.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}h` : '';
    return `
      <label class="course-check-item ${isChecked ? 'selected' : ''}" data-id="${courseId}">
        <input type="checkbox" value="${courseId}" ${isChecked ? 'checked' : ''}>
        <div class="course-check-info">
          <span class="course-check-name-row">
            <span class="course-check-name">${escapeHtml(c.nome)}</span>
            ${duration ? `<span class="course-check-duration">${duration}</span>` : ''}
          </span>
          <div class="course-check-meta">
            ${c.categoria ? `<span>${escapeHtml(c.categoria)}</span>` : ''}
          </div>
        </div>
      </label>`;
  }).join('');

  coursesListContainer.querySelectorAll('.course-check-item').forEach((item) => {
    const checkbox = item.querySelector('input[type="checkbox"]');
    const courseId = Number(item.getAttribute('data-id'));
    checkbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        selectedCourseIds.add(courseId);
        item.classList.add('selected');
      } else {
        selectedCourseIds.delete(courseId);
        item.classList.remove('selected');
      }
      updateSelectedCount();
    });
  });
}

function updateSelectedCount() {
  const count = selectedCourseIds.size;
  coursesBadge.textContent = `${count} curso${count === 1 ? '' : 's'} selecionado${count === 1 ? '' : 's'}`;
  // Curso é obrigatório: o botão de cadastro só habilita com ao menos um curso marcado.
  if (regSubmitBtn) regSubmitBtn.disabled = count === 0;
  updateRegisterFlow();
}

// Resumo do painel "Confirmar" e estado das fases (atual = coral, concluída = verde, demais = cinza).
function updateRegisterFlow() {
  const nome = regName?.value.trim() || '';
  const email = regEmail?.value.trim() || '';
  const schoolOk = !!regSchool && regSchool.value !== '';
  const alunoOk = !!nome && EMAIL_REGEX.test(email);
  const count = selectedCourseIds.size;
  const setCheck = (key, ok, text) => {
    const li = document.querySelector(`#regChecklist [data-check="${key}"]`);
    if (!li) return;
    li.classList.toggle('is-done', ok);
    const small = li.querySelector('small');
    if (small) small.textContent = text;
  };
  setCheck('aluno', alunoOk, alunoOk ? `${nome} · ${email}` : 'Preencha nome e e-mail');
  setCheck('escola', schoolOk, schoolOk ? regSchool.selectedOptions[0].textContent.trim() : 'Selecione a escola de destino');
  setCheck('cursos', count > 0, count > 0 ? `${count} curso${count > 1 ? 's' : ''} selecionado${count > 1 ? 's' : ''}` : 'Selecione ao menos um curso');
  const phase1 = alunoOk && schoolOk;
  const phase2 = phase1 && count > 0;
  document.querySelectorAll('#regPhases .phase').forEach((el) => {
    const n = Number(el.dataset.phase);
    const done = n === 1 ? phase1 : n === 2 ? phase2 : false;
    const current = !done && (n === 1 || (n === 2 && phase1) || (n === 3 && phase2));
    el.classList.toggle('is-done', done);
    el.classList.toggle('is-current', current);
  });
}

if (courseFilterInput) {
  courseFilterInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().trim();
    const filtered = currentCourses.filter(
      (c) => c.nome.toLowerCase().includes(term) || (c.categoria && c.categoria.toLowerCase().includes(term))
    );
    renderCoursesList(filtered);
  });
}

if (selectAllBtn) {
  selectAllBtn.addEventListener('click', () => {
    const term = courseFilterInput.value.toLowerCase().trim();
    const visible = term ? currentCourses.filter((c) => c.nome.toLowerCase().includes(term)) : currentCourses;
    visible.forEach((c) => selectedCourseIds.add(c.id));
    renderCoursesList(visible);
    updateSelectedCount();
  });
}

if (deselectAllBtn) {
  deselectAllBtn.addEventListener('click', () => {
    selectedCourseIds.clear();
    const term = courseFilterInput.value.toLowerCase().trim();
    const visible = term ? currentCourses.filter((c) => c.nome.toLowerCase().includes(term)) : currentCourses;
    renderCoursesList(visible);
    updateSelectedCount();
  });
}

if (regSchool) regSchool.addEventListener('change', loadCoursesForSelectedSchool);
[regName, regEmail].forEach((el) => el?.addEventListener('input', updateRegisterFlow));
regSchool?.addEventListener('change', updateRegisterFlow);
updateRegisterFlow();

if (regSubmitBtn) regSubmitBtn.disabled = selectedCourseIds.size === 0;

function setRegisterLoading(loading) {
  regSubmitBtn.disabled = loading || selectedCourseIds.size === 0;
  regBtnText.style.display = loading ? 'none' : 'inline';
  regBtnLoader.style.display = loading ? 'inline-block' : 'none';
}

function showRegisterFeedback(type, message) {
  regFeedback.className = `feedback-box ${type}`;
  regFeedback.innerHTML = message;
  regFeedback.style.display = 'block';
}

function hideRegisterFeedback() {
  regFeedback.style.display = 'none';
}

if (clearRegisterBtn) {
  clearRegisterBtn.addEventListener('click', () => {
    registerForm.reset();
    hideRegisterFeedback();
    selectedCourseIds.clear();
    updateSelectedCount();
    renderCoursesList(currentCourses);
  });
}

if (resetPasswordBtn) {
  resetPasswordBtn.addEventListener('click', () => {
    regPassword.value = '';
  });
}

if (regSubmitBtn) {
  regSubmitBtn.addEventListener('click', () => registerForm.requestSubmit());
}

if (registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideRegisterFeedback();

    const nome = regName.value.trim();
    const email = regEmail.value.trim();
    const password = regPassword.value;
    const schoolIndex = regSchool.value;

    if (!nome) { showRegisterFeedback('error', 'Por favor, informe o nome completo do aluno.'); return; }
    if (!email || !EMAIL_REGEX.test(email)) { showRegisterFeedback('error', 'Por favor, informe um e-mail valido.'); return; }
    if (password && password.length < 6) { showRegisterFeedback('error', 'A senha deve ter no minimo 6 caracteres.'); return; }
    if (schoolIndex === '') { showRegisterFeedback('error', 'Por favor, selecione uma escola.'); return; }

    const courseIds = Array.from(selectedCourseIds);
    if (courseIds.length === 0) { showRegisterFeedback('error', 'Selecione ao menos um curso para matricular o aluno.'); return; }
    const selectedCourseTitles = currentCourses.filter((c) => selectedCourseIds.has(c.id)).map((c) => c.nome);

    setRegisterLoading(true);
    regBtnText.textContent = `Matriculando em ${courseIds.length} curso(s)...`;

    try {
      const res = await fetch('/api/student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome, email, password, schoolIndex, courseIds,
          enviar_email_notificacao: regSendEmail?.checked ? 1 : 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showRegisterFeedback('error', escapeHtml(data.error || 'Erro ao realizar cadastro.'));
        return;
      }

      const cursosHtml = selectedCourseTitles.length > 0
        ? `<ul style="margin:8px 0 8px 20px;font-size:13px;">${selectedCourseTitles.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : '';

      showRegisterFeedback('success',
        `<strong>${escapeHtml(data.message)}</strong>${cursosHtml}` +
        `<p style="font-size:12px;margin-top:8px;opacity:0.7;">O cadastro é instantâneo. Pode levar alguns segundos para aparecer na consulta.</p>` +
        `<button type="button" id="goToSearchBtn" class="btn-coral" style="margin-top:12px;padding:8px 16px;font-size:13px;width:auto;">Ver cadastro deste aluno</button>`
      );

      const goToSearchBtn = document.getElementById('goToSearchBtn');
      if (goToSearchBtn) {
        goToSearchBtn.addEventListener('click', () => {
          emailInput.value = email;
          switchTab('search');
          searchForm.dispatchEvent(new Event('submit'));
        });
      }

      regName.value = '';
      regEmail.value = '';
      regPassword.value = '';
      selectedCourseIds.clear();
      updateSelectedCount();
      renderCoursesList(currentCourses);
    } catch (err) {
      showRegisterFeedback('error', 'Erro de comunicacao com o servidor. Verifique se o backend esta rodando.');
    } finally {
      setRegisterLoading(false);
      regBtnText.textContent = 'Cadastrar e Matricular Aluno';
    }
  });
}

// ==========================================
// 4. ABA 3: MATRICULA EM LOTE CSV
// ==========================================
const csvSchoolSelect = document.getElementById('csvSchoolSelect');
const csvPaisSelect = document.getElementById('csvPaisSelect');
const csvDefaultPassword = document.getElementById('csvDefaultPassword');
const csvForceWelcomeEmail = document.getElementById('csvForceWelcomeEmail');
const csvEmpresa = document.getElementById('csvEmpresa');
const csvOrigem = document.getElementById('csvOrigem');
const csvProjetoServ = document.getElementById('csvProjetoServ');
const csvIdEmpresa = document.getElementById('csvIdEmpresa');
const csvUniversidadeFields = document.getElementById('csvUniversidadeFields');
const csvDropzone = document.getElementById('csvDropzone');
const csvFileInput = document.getElementById('csvFileInput');
const csvFileInfoBar = document.getElementById('csvFileInfoBar');
const csvFileNameText = document.getElementById('csvFileNameText');
const csvFileSizeText = document.getElementById('csvFileSizeText');
const btnRemoveFile = document.getElementById('btnRemoveFile');
const togglePasteBtn = document.getElementById('togglePasteBtn');
const pasteWrapper = document.getElementById('pasteWrapper');
const csvPasteTextarea = document.getElementById('csvPasteTextarea');
const btnAnalyzeCsv = document.getElementById('btnAnalyzeCsv');
const btnAnalyzeText = document.getElementById('btnAnalyzeText');
const btnAnalyzeLoader = document.getElementById('btnAnalyzeLoader');
const csvUploadFeedback = document.getElementById('csvUploadFeedback');

const csvUploadSection = document.getElementById('csvUploadSection');
const csvPreviewSection = document.getElementById('csvPreviewSection');
const csvExecutionSection = document.getElementById('csvExecutionSection');

const previewFileName = document.getElementById('previewFileName');
const previewFileMeta = document.getElementById('previewFileMeta');
const kpiTotalStudents = document.getElementById('kpiTotalStudents');
const kpiTotalEnrollments = document.getElementById('kpiTotalEnrollments');
const kpiUniqueCourses = document.getElementById('kpiUniqueCourses');
const kpiTotalCourseIds = document.getElementById('kpiTotalCourseIds');
const kpiCourseMappingMeta = document.getElementById('kpiCourseMappingMeta');
const kpiCourseMappingText = document.getElementById('kpiCourseMappingText');
const kpiCourseMappingIcon = document.getElementById('kpiCourseMappingIcon');
const kpiAverageEnrollments = document.getElementById('kpiAverageEnrollments');
const kpiMissingCourses = document.getElementById('kpiMissingCourses');
const previewFilterInput = document.getElementById('previewFilterInput');
const btnBackToUpload = document.getElementById('btnBackToUpload');
const btnBackToUpload2 = document.getElementById('btnBackToUpload2');
const btnExecuteEnrollments = document.getElementById('btnExecuteEnrollments');
const btnExecuteText = document.getElementById('btnExecuteText');
const previewTableBody = document.getElementById('previewTableBody');
const filterAllCount = document.getElementById('filterAllCount');
const filterDefaultCount = document.getElementById('filterDefaultCount');
const filterCustomCount = document.getElementById('filterCustomCount');
const confirmStudentCount = document.getElementById('confirmStudentCount');
const confirmEnrollCount = document.getElementById('confirmEnrollCount');

const execSpeed = document.getElementById('execSpeed');
const execProcessedCount = document.getElementById('execProcessedCount');
const execTotalCount = document.getElementById('execTotalCount');
const execTimeEstimate = document.getElementById('execTimeEstimate');
const executionProgressPercent = document.getElementById('executionProgressPercent');
const batchProgressBar = document.getElementById('batchProgressBar');
const execSuccessCount = document.getElementById('execSuccessCount');
const execSuccessPct = document.getElementById('execSuccessPct');
const execFailCount = document.getElementById('execFailCount');
const execFailBadge = document.getElementById('execFailBadge');
const execRemainingCount = document.getElementById('execRemainingCount');
const execRemainingPct = document.getElementById('execRemainingPct');
const executionLogList = document.getElementById('executionLogList');
const logTotalCount = document.getElementById('logTotalCount');
const logTotalCount2 = document.getElementById('logTotalCount2');
const logVisibleCount = document.getElementById('logVisibleCount');
const btnCopyLog = document.getElementById('btnCopyLog');
const btnRestartBatch = document.getElementById('btnRestartBatch');
const btnGoToSearch = document.getElementById('btnGoToSearch');
const discardBatchBtn = document.getElementById('discardBatchBtn');
const execEmailsSent = document.getElementById('execEmailsSent');
const execRetries = document.getElementById('execRetries');
const clearCsvBtn = document.getElementById('clearCsvBtn');
const downloadTemplateBtn = document.getElementById('downloadTemplateBtn');

// Stepper elements
const stepEls = document.querySelectorAll('#csvPhases .phase');

// Fases: atual = coral, concluída = verde, demais = cinza.
function setStepperStep(num) {
  stepEls.forEach((s) => {
    const sNum = Number(s.dataset.step);
    s.classList.remove('is-current', 'is-done');
    if (sNum < num) s.classList.add('is-done');
    else if (sNum === num) s.classList.add('is-current');
  });
}

// Fase 1: os parâmetros ficam bloqueados até existir um arquivo (enviado ou colado),
// para o usuário não preencher e depois refazer.
function csvHasSource() {
  return !!csvSelectedFile || (csvPasteTextarea && csvPasteTextarea.value.trim().length > 0);
}
function csvReadyToAnalyze() {
  return csvHasSource() && !!csvSchoolSelect && csvSchoolSelect.value !== '';
}
function updateCsvFlow() {
  const hasSource = csvHasSource();
  const schoolOk = !!csvSchoolSelect && csvSchoolSelect.value !== '';
  const block = document.getElementById('csvParamsBlock');
  if (block) {
    block.classList.toggle('is-locked', !hasSource);
    block.querySelectorAll('input, select, button').forEach((el) => { el.disabled = !hasSource; });
    const tag = document.getElementById('csvParamsTag');
    const desc = document.getElementById('csvParamsDesc');
    if (tag) tag.textContent = hasSource ? 'Obrigatório' : 'Bloqueado';
    if (desc) desc.textContent = hasSource
      ? 'Defina a escola de destino e as credenciais padrão do lote.'
      : 'Envie o arquivo para liberar os parâmetros. Assim você preenche uma vez só.';
  }
  const setCheck = (key, ok, text) => {
    const li = document.querySelector(`#csvChecklist [data-check="${key}"]`);
    if (!li) return;
    li.classList.toggle('is-done', ok);
    const small = li.querySelector('small');
    if (small) small.textContent = text;
  };
  setCheck('arquivo', hasSource, hasSource ? (csvSelectedFile ? csvSelectedFile.name : 'CSV colado como texto') : 'Envie ou cole o CSV');
  setCheck('escola', schoolOk, schoolOk ? csvSchoolSelect.selectedOptions[0].textContent.trim() : 'Escolha a escola de destino');
  if (btnAnalyzeCsv) btnAnalyzeCsv.disabled = !csvReadyToAnalyze();
}

function showCsvSection(section) {
  csvUploadSection.style.display = 'none';
  csvPreviewSection.style.display = 'none';
  csvExecutionSection.style.display = 'none';
  csvUploadSection.classList.remove('active');
  csvPreviewSection.classList.remove('active');
  csvExecutionSection.classList.remove('active');

  if (section === 'upload') {
    csvUploadSection.style.display = 'block';
    csvUploadSection.classList.add('active');
    setStepperStep(1);
  } else if (section === 'preview') {
    csvPreviewSection.style.display = 'block';
    csvPreviewSection.classList.add('active');
    setStepperStep(2);
  } else if (section === 'execution') {
    csvExecutionSection.style.display = 'block';
    csvExecutionSection.classList.add('active');
    setStepperStep(3);
  }
}

let csvSelectedFile = null;
let csvLoadedSchools = [];
let csvSchoolCoursesCache = new Map();
let parsedStudentsData = [];

function updatePreviewMetrics(students) {
  const mappedCourseIds = new Set();
  const missingCourseIds = new Set();
  let totalEnrollments = 0;

  students.forEach((student) => {
    student.validCourses.forEach((course) => mappedCourseIds.add(course.id));
    student.mappedCourses
      .filter((course) => !course.found)
      .forEach((course) => missingCourseIds.add(course.id));
    totalEnrollments += student.validCourses.length;
  });

  const totalCourseIds = mappedCourseIds.size + missingCourseIds.size;
  const mappingPercent = totalCourseIds > 0
    ? Math.round((mappedCourseIds.size / totalCourseIds) * 100)
    : 0;
  const average = students.length > 0 ? (totalEnrollments / students.length).toFixed(2) : '0';

  kpiTotalStudents.textContent = `${students.length} registros`;
  kpiTotalEnrollments.textContent = `${totalEnrollments} Inscrições`;
  kpiUniqueCourses.textContent = String(mappedCourseIds.size);
  kpiTotalCourseIds.textContent = String(totalCourseIds);
  kpiCourseMappingMeta.className = `preview-file-meta ${mappingPercent === 100 ? 'success' : 'warning'}`;
  kpiCourseMappingIcon.innerHTML = mappingPercent === 100
    ? '<polyline points="20 6 9 17 4 12" />'
    : '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>';
  kpiCourseMappingText.textContent = totalCourseIds > 0
    ? `${mappingPercent}% mapeados no LMS${missingCourseIds.size ? ` · ${missingCourseIds.size} não encontrado(s)` : ''}`
    : 'Nenhum curso informado';
  kpiAverageEnrollments.textContent = `Média de ${average} cursos por estudante`;
  if (kpiMissingCourses) kpiMissingCourses.textContent = String(missingCourseIds.size);
  if (confirmStudentCount) confirmStudentCount.textContent = String(students.length);
  if (confirmEnrollCount) confirmEnrollCount.textContent = String(totalEnrollments);
  // Curso é obrigatório: bloqueia a execução enquanto houver aluno sem curso válido.
  const withoutCourse = students.filter((s) => !s.validCourseIds || s.validCourseIds.length === 0).length;
  if (btnExecuteEnrollments) btnExecuteEnrollments.disabled = withoutCourse > 0 || totalEnrollments === 0;
  btnExecuteText.textContent = withoutCourse > 0
    ? `Corrija ${withoutCourse} aluno(s) sem curso para continuar`
    : `Confirmar e Iniciar Matrículas em Fila (${totalEnrollments})`;
}

async function ensureCsvSchoolsLoaded() {
  if (csvLoadedSchools.length > 0) return;
  try {
    const res = await fetch('/api/courses');
    if (!res.ok) throw new Error('Falha ao carregar escolas');
    const data = await res.json();
    csvLoadedSchools = data.schools || [];
    if (csvLoadedSchools.length === 0) {
      csvSchoolSelect.innerHTML = '<option value="" disabled>Nenhuma escola encontrada</option>';
      return;
    }
    csvSchoolSelect.innerHTML = csvLoadedSchools.map((s) => `<option value="${Number(s.id)}">${escapeHtml(s.name)}</option>`).join('');
    updateUniversidadeFieldsVisibility();
  } catch (err) {
    csvSchoolSelect.innerHTML = '<option value="" disabled>Erro ao carregar escolas</option>';
  }
}

function isUniversidadeConsistemSelected() {
  const idx = csvSchoolSelect?.value;
  if (idx === '' || idx == null) return false;
  const obj = csvLoadedSchools.find((s) => String(s.id) === String(idx));
  const name = String(obj?.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return name.includes('universidade');
}

function updateUniversidadeFieldsVisibility() {
  if (!csvUniversidadeFields) return;
  csvUniversidadeFields.style.display = isUniversidadeConsistemSelected() ? 'block' : 'none';
}

if (csvSchoolSelect) {
  csvSchoolSelect.addEventListener('change', updateUniversidadeFieldsVisibility);
  csvSchoolSelect.addEventListener('change', updateCsvFlow);
}
updateCsvFlow();

// Drag & Drop
if (csvDropzone) {
  csvDropzone.addEventListener('dragover', (e) => { e.preventDefault(); csvDropzone.classList.add('dragover'); });
  csvDropzone.addEventListener('dragleave', () => csvDropzone.classList.remove('dragover'));
  csvDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    csvDropzone.classList.remove('dragover');
    if (e.dataTransfer.files?.length) handleSelectedFile(e.dataTransfer.files[0]);
  });
}
if (csvFileInput) {
  csvFileInput.addEventListener('change', (e) => {
    if (e.target.files?.length) handleSelectedFile(e.target.files[0]);
  });
}

function handleSelectedFile(file) {
  const isCsv = file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv');
  if (!isCsv || file.size > 10 * 1024 * 1024) {
    csvSelectedFile = null;
    if (csvFileInput) csvFileInput.value = '';
    showCsvFeedback('error', 'Selecione um arquivo CSV de até 10 MB.');
    return;
  }
  csvSelectedFile = file;
  csvFileNameText.textContent = file.name;
  csvFileSizeText.textContent = `${(file.size / 1024).toFixed(1)} KB`;
  csvFileInfoBar.style.display = 'flex';
  csvDropzone.style.display = 'none';
  hideCsvFeedback();
  updateCsvFlow();
}

if (btnRemoveFile) {
  btnRemoveFile.addEventListener('click', () => {
    csvSelectedFile = null;
    csvFileInput.value = '';
    csvFileInfoBar.style.display = 'none';
    csvDropzone.style.display = 'block';
    updateCsvFlow();
  });
}
csvPasteTextarea?.addEventListener('input', updateCsvFlow);

if (togglePasteBtn) {
  togglePasteBtn.addEventListener('click', () => {
    pasteWrapper.style.display = pasteWrapper.style.display === 'none' ? 'block' : 'none';
  });
}

if (clearCsvBtn) {
  clearCsvBtn.addEventListener('click', () => {
    csvSelectedFile = null;
    parsedStudentsData = [];
    csvFileInput.value = '';
    csvPasteTextarea.value = '';
    csvFileInfoBar.style.display = 'none';
    csvDropzone.style.display = 'block';
    hideCsvFeedback();
    updateCsvFlow();
  });
}

if (downloadTemplateBtn) {
  downloadTemplateBtn.addEventListener('click', () => {
    const csv = 'nome;email;enviar email para definir senha;senha;ID dos Conteudos;cpf;endereco;numero;cidade;estado;cep;departamento;ddd;celular;empresa;origem;projeto_serv;id_empresa\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'modelo_matricula_hotscool.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  });
}

function showCsvFeedback(type, message) {
  csvUploadFeedback.className = `feedback-box ${type}`;
  csvUploadFeedback.innerHTML = message;
  csvUploadFeedback.style.display = 'block';
}
function hideCsvFeedback() { csvUploadFeedback.style.display = 'none'; }

function setCsvAnalyzeLoading(loading) {
  btnAnalyzeCsv.disabled = loading || !csvReadyToAnalyze();
  btnAnalyzeText.style.display = loading ? 'none' : 'inline';
  btnAnalyzeLoader.style.display = loading ? 'inline-block' : 'none';
}

// CSV Parser
function parseCsvRows(text) {
  const cleanText = text.replace(/^\uFEFF/, '').trim();
  if (!cleanText) return [];
  const lines = cleanText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  const countSemi = (headerLine.match(/;/g) || []).length;
  const countComma = (headerLine.match(/,/g) || []).length;
  const delimiter = countSemi >= countComma ? ';' : ',';

  function splitRespectingQuotes(line, delim) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') inQuotes = !inQuotes;
      else if (char === delim && !inQuotes) {
        result.push(current.trim().replace(/^"(.*)"$/, '$1').trim());
        current = '';
      } else current += char;
    }
    result.push(current.trim().replace(/^"(.*)"$/, '$1').trim());
    return result;
  }

  const rawHeaders = splitRespectingQuotes(headerLine, delimiter);
  const normalizedHeaders = rawHeaders.map((h) =>
    h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')
  );

  const parsedStudents = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitRespectingQuotes(lines[i], delimiter);
    if (cols.length === 0 || (cols.length === 1 && !cols[0])) continue;
    const row = {};
    cols.forEach((val, idx) => { const h = normalizedHeaders[idx]; if (h) row[h] = val; });

    const nome = row.nome || row.aluno || cols[0] || '';
    const email = row.email || row.emaildoaluno || cols[1] || '';
    if (!nome.trim() && !email.trim()) continue;

    const rawNotify = row.enviaremailparadefinirsenha || row.enviaremail || row.notificacao || cols[2] || '';
    const senha = row.senha || row.password || cols[3] || '';

    let rawCourses = '';
    const courseKeys = Object.keys(row).filter((k) => k.includes('conteudo') || k.includes('contedo') || k.includes('curso') || k.includes('id'));
    if (courseKeys.length > 0) {
      const exactKey = courseKeys.find((k) => k.includes('conteudo') || k.includes('contedo')) || courseKeys[0];
      rawCourses = row[exactKey];
    } else rawCourses = cols[4] || '';

    const cpf = row.cpf || cols[5] || '';
    const endereco = row.endereco || row.endereo || cols[6] || '';
    const numero = row.numero || row.nmero || cols[7] || '';
    const cidade = row.cidade || cols[8] || '';
    const estado = row.estado || row.uf || cols[9] || '';
    const cep = row.cep || cols[10] || '';
    const departamento = row.departamento || row.dept || '';
    const ddd = row.ddd || '';
    const celular = row.celular || row.telefone || '';
    // Campos extra Universidade Consistem
    const empresa = row.empresa || row.emprs || '';
    const origem = row.origem || row.origm || '';
    const projetoServ = row.projetoserv || row.projetoservio || row.projetoservico || row.projeto || '';
    const idEmpresa = row.idempresa || row.idempr || row.idemp || row.idempresa2 || '';

    const cleanedCoursesStr = String(rawCourses || '').replace(/["']/g, '').trim();
    const courseIdList = cleanedCoursesStr
      ? [...new Set(cleanedCoursesStr.split(/[,;]/).map((id) => parseInt(id.trim(), 10)).filter((id) => !isNaN(id) && id > 0))]
      : [];

    const shouldNotify = String(rawNotify).trim().toLowerCase() === 'sim' || String(rawNotify).trim() === '1' || csvForceWelcomeEmail?.checked;

    parsedStudents.push({
      idOriginal: i, nome: nome.trim(), email: email.trim().toLowerCase(), senha: senha.trim(),
      shouldNotify, courseIds: courseIdList, cpf: cpf.trim(), ddd: ddd.trim(), celular: celular.trim(),
      cep: cep.trim(), endereco: endereco.trim(), numero: numero.trim(), cidade: cidade.trim(),
      estado: estado.trim(), departamento: departamento.trim(),
      empresa: empresa.trim(), origem: origem.trim(), projetoServ: projetoServ.trim(), idEmpresa: idEmpresa.trim(),
    });
  }
  return parsedStudents;
}

async function fetchSchoolCourses(schoolIndex) {
  const idx = Number(schoolIndex);
  if (csvSchoolCoursesCache.has(idx)) return csvSchoolCoursesCache.get(idx);
  const res = await fetch(`/api/courses?schoolIndex=${idx}`);
  if (!res.ok) throw new Error('Nao foi possivel obter a lista de cursos da escola na Hotscool.');
  const data = await res.json();
  const courses = Array.isArray(data.courses) ? data.courses : [];
  csvSchoolCoursesCache.set(idx, courses);
  return courses;
}

async function analyzeAndCrossReference(rawCsvContent) {
  const students = parseCsvRows(rawCsvContent);
  if (students.length === 0) throw new Error('Nenhum aluno valido encontrado na planilha.');

  const schoolIdx = csvSchoolSelect.value;
  if (schoolIdx === '') throw new Error('Por favor, selecione uma escola de destino.');

  const schoolObj = csvLoadedSchools.find((s) => String(s.id) === String(schoolIdx));
  const schoolName = schoolObj?.name || `Escola #${schoolIdx}`;

  const schoolCourses = await fetchSchoolCourses(schoolIdx);
  const coursesMap = new Map();
  schoolCourses.forEach((c) => coursesMap.set(Number(c.id), c));

  let totalEnrollments = 0;
  const uniqueCourseIdsSet = new Set();
  const missingCourseIdsSet = new Set();

  const crossReferencedStudents = students.map((s) => {
    const mappedCourses = s.courseIds.map((cid) => {
      const foundCourse = coursesMap.get(cid);
      if (foundCourse) {
        uniqueCourseIdsSet.add(cid);
        return { id: cid, nome: foundCourse.nome, categoria: foundCourse.categoria, found: true };
      } else {
        missingCourseIdsSet.add(cid);
        return { id: cid, nome: `Curso #${cid} (Nao encontrado)`, categoria: 'Alerta', found: false };
      }
    });
    const validCourses = mappedCourses.filter((c) => c.found);
    totalEnrollments += validCourses.length;
    return {
      ...s, mappedCourses, validCourses,
      validCourseIds: validCourses.map((c) => c.id),
      hasMissingCourse: mappedCourses.some((c) => !c.found),
    };
  });

  return {
    schoolName, schoolIndex: schoolIdx, students: crossReferencedStudents,
    stats: {
      totalStudents: crossReferencedStudents.length, totalEnrollments,
      uniqueCoursesCount: uniqueCourseIdsSet.size,
      missingCoursesCount: missingCourseIdsSet.size,
      missingCourseIds: Array.from(missingCourseIdsSet),
    },
  };
}

// Analyze button
if (btnAnalyzeCsv) {
  btnAnalyzeCsv.addEventListener('click', async () => {
    hideCsvFeedback();
    const pasteText = csvPasteTextarea?.value.trim();
    if (!csvSelectedFile && !pasteText) {
      showCsvFeedback('error', 'Por favor, selecione um arquivo CSV ou cole o conteúdo na área de texto.');
      return;
    }
    setCsvAnalyzeLoading(true);
    try {
      let content = pasteText;
      if (csvSelectedFile) {
        content = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = () => reject(new Error('Erro ao ler o arquivo CSV.'));
          reader.readAsText(csvSelectedFile, 'UTF-8');
        });
      }
      const result = await analyzeAndCrossReference(content);
      parsedStudentsData = result.students;

      if (previewFileName) previewFileName.textContent = csvSelectedFile?.name || 'CSV colado';
      if (previewFileMeta) previewFileMeta.textContent = `${result.schoolName}`;
      updatePreviewMetrics(parsedStudentsData);

      const defaultPassCount = parsedStudentsData.filter((s) => !s.senha).length;
      const customPassCount = parsedStudentsData.length - defaultPassCount;
      if (filterAllCount) filterAllCount.textContent = parsedStudentsData.length;
      if (filterDefaultCount) filterDefaultCount.textContent = defaultPassCount;
      if (filterCustomCount) filterCustomCount.textContent = customPassCount;
      renderPreviewTable(parsedStudentsData);
      showCsvSection('preview');
    } catch (err) {
      showCsvFeedback('error', escapeHtml(err.message));
    } finally {
      setCsvAnalyzeLoading(false);
    }
  });
}

function renderPreviewTable(students) {
  if (!previewTableBody) return;
  if (students.length === 0) {
    previewTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--graphite-subtle);">Nenhum aluno corresponde ao filtro.</td></tr>`;
    return;
  }

  previewTableBody.innerHTML = students.map((s, idx) => {
    const initials = s.nome.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
    const courseChips = s.mappedCourses.length > 0
      ? s.mappedCourses.map((c) => c.found
        ? `<span class="course-chip valid">${escapeHtml(c.nome)} <small>#${Number(c.id)}</small></span>`
        : `<span class="course-chip invalid">#${c.id} (Nao encontrado)</span>`
      ).join('')
      : '<span class="course-chip invalid">Curso obrigatório: informe ao menos um</span>';

    const passBadge = s.senha
      ? `<span class="credential-badge custom">Senha do CSV (Criptografada)</span>`
      : `<span class="credential-badge default">Senha segura gerada individualmente</span>`;

    const subMeta = [s.cidade, s.estado, s.departamento].filter(Boolean).join(' / ');

    return `
      <tr>
        <td>
          <div class="student-cell">
            <div class="student-avatar">${escapeHtml(initials)}</div>
            <div>
              <div class="student-name">${escapeHtml(s.nome)}</div>
              ${subMeta ? `<div class="student-meta">${escapeHtml(subMeta)}</div>` : ''}
            </div>
          </div>
        </td>
        <td><code style="font-size:12px;color:var(--graphite-muted)">${escapeHtml(s.email)}</code></td>
        <td style="font-size:12px">${escapeHtml(csvLoadedSchools.find((sc) => String(sc.id) === String(csvSchoolSelect.value))?.name || '')}</td>
        <td><div class="course-chips">${courseChips}</div></td>
        <td>${passBadge}</td>
        <td><span class="status-ready">Pronto p/ envio</span></td>
        <td>
          <button type="button" class="btn-remove-row" data-remove-idx="${idx}" title="Remover">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </td>
      </tr>`;
  }).join('');

  previewTableBody.querySelectorAll('.btn-remove-row').forEach((btn) => {
    btn.addEventListener('click', () => {
      const removeIdx = Number(btn.getAttribute('data-remove-idx'));
      parsedStudentsData.splice(removeIdx, 1);
      updatePreviewMetrics(parsedStudentsData);
      renderPreviewTable(parsedStudentsData);
    });
  });
}

if (previewFilterInput) {
  previewFilterInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().trim();
    if (!term) { renderPreviewTable(parsedStudentsData); return; }
    const filtered = parsedStudentsData.filter(
      (s) => s.nome.toLowerCase().includes(term) || s.email.toLowerCase().includes(term) ||
        s.mappedCourses.some((c) => c.nome.toLowerCase().includes(term) || String(c.id).includes(term))
    );
    renderPreviewTable(filtered);
  });
}

if (btnBackToUpload) btnBackToUpload.addEventListener('click', () => showCsvSection('upload'));
if (btnBackToUpload2) btnBackToUpload2.addEventListener('click', () => { csvSelectedFile = null; csvFileInput.value = ''; csvFileInfoBar.style.display = 'none'; csvDropzone.style.display = 'block'; updateCsvFlow(); showCsvSection('upload'); });
if (discardBatchBtn) discardBatchBtn.addEventListener('click', () => { parsedStudentsData = []; showCsvSection('upload'); });

// Execution
if (btnExecuteEnrollments) {
  btnExecuteEnrollments.addEventListener('click', async () => {
    if (parsedStudentsData.length === 0) { alert('Nao ha alunos na fila.'); return; }

    const schoolIdx = csvSchoolSelect.value;
    const idPais = csvPaisSelect?.value || '1';
    const defaultPassword = csvDefaultPassword?.value.trim() || '';

    showCsvSection('execution');

    const total = parsedStudentsData.length;
    let successCount = 0;
    let failCount = 0;

    execSuccessCount.textContent = '0';
    execFailCount.textContent = '0';
    execRemainingCount.textContent = String(total);
    execTotalCount.textContent = String(total);
    batchProgressBar.style.width = '0%';
    executionProgressPercent.textContent = '0%';

    executionLogList.innerHTML = parsedStudentsData.map((s, idx) => {
      const initials = s.nome.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
      return `
        <div class="log-row" id="execRow-${idx}">
          <div class="log-icon pending">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="12" r="10"/></svg>
          </div>
          <div class="log-info">
            <div class="log-name">${escapeHtml(s.nome)}</div>
            <div class="log-email">${escapeHtml(s.email)}</div>
          </div>
          <div class="log-courses">${s.validCourseIds.map((id) => `<span>#${id}</span>`).join(' ')}</div>
          <span class="log-status pending" id="execStatus-${idx}">Aguardando fila...</span>
        </div>`;
    }).join('');

    logTotalCount.textContent = `${total} registros`;
    logTotalCount2.textContent = String(total);
    logVisibleCount.textContent = String(Math.min(5, total));

    const executionReport = [];

    for (let i = 0; i < total; i++) {
      const student = parsedStudentsData[i];
      const statusEl = document.getElementById(`execStatus-${i}`);
      const rowEl = document.getElementById(`execRow-${i}`);

      if (statusEl) {
        statusEl.className = 'log-status running';
        statusEl.textContent = 'Processando agora...';
      }
      if (rowEl) {
        const icon = rowEl.querySelector('.log-icon');
        if (icon) { icon.className = 'log-icon running'; icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>'; }
      }

      // Campos Universidade Consistem: prioridade para valor da linha CSV, fallback para campo do lote
      const effEmpresa = (student.empresa || csvEmpresa?.value.trim() || '');
      const effOrigem = (student.origem || csvOrigem?.value.trim() || '');
      const effProjetoServ = (student.projetoServ || csvProjetoServ?.value.trim() || '');
      const effIdEmpresa = (student.idEmpresa || csvIdEmpresa?.value.trim() || '');
      try {
        const res = await fetch('/api/student', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nome: student.nome, email: student.email,
            password: student.senha || defaultPassword,
            enviar_email_notificacao: student.shouldNotify ? 1 : 0,
            id_pais: idPais, schoolIndex: schoolIdx,
            courseIds: student.validCourseIds,
            empresa: effEmpresa, origem: effOrigem, projetoServ: effProjetoServ, idEmpresa: effIdEmpresa,
          }),
        });
        const resData = await res.json();

        if (res.ok) {
          successCount++;
          if (statusEl) { statusEl.className = 'log-status success'; statusEl.textContent = `Sucesso \u2022 ${student.validCourseIds.length} cursos`; }
          if (rowEl) { const icon = rowEl.querySelector('.log-icon'); if (icon) { icon.className = 'log-icon success'; icon.innerHTML = '\u2713'; } }
          executionReport.push({ aluno: student.nome, email: student.email, status: 'Sucesso', matriculas: student.validCourseIds.length });
        } else {
          failCount++;
          const errorText = resData.error || 'Erro na Hotscool';
          if (statusEl) { statusEl.className = 'log-status warning'; statusEl.textContent = `Alerta \u2022 E-mail na fila de reenvio`; }
          if (rowEl) { const icon = rowEl.querySelector('.log-icon'); if (icon) { icon.className = 'log-icon warning'; icon.innerHTML = '\u26A0'; } }
          executionReport.push({ aluno: student.nome, email: student.email, status: 'Falha', erro: errorText });
        }
      } catch (err) {
        failCount++;
        if (statusEl) { statusEl.className = 'log-status error'; statusEl.textContent = 'Erro de conexao'; }
        if (rowEl) { const icon = rowEl.querySelector('.log-icon'); if (icon) { icon.className = 'log-icon error'; icon.innerHTML = '\u2717'; } }
        executionReport.push({ aluno: student.nome, email: student.email, status: 'Falha', erro: err.message });
      }

      const remaining = total - (i + 1);
      const percent = Math.round(((i + 1) / total) * 100);
      execSuccessCount.textContent = String(successCount);
      execFailCount.textContent = String(failCount);
      execRemainingCount.textContent = String(remaining);
      execProcessedCount.textContent = String(i + 1);
      batchProgressBar.style.width = `${percent}%`;
      executionProgressPercent.textContent = `${percent}%`;
      if (execSuccessPct) execSuccessPct.textContent = total > 0 ? `${Math.round((successCount / total) * 100)}%` : '0%';
      if (execRemainingPct) execRemainingPct.textContent = `${remaining} restante`;
      if (execEmailsSent) execEmailsSent.textContent = `${successCount} enviados`;

      if (i < total - 1) await new Promise((r) => setTimeout(r, 250));
    }

    btnRestartBatch.style.display = 'inline-flex';
    btnGoToSearch.style.display = 'inline-flex';

    if (btnCopyLog) {
      btnCopyLog.onclick = () => {
        const textReport = executionReport.map((r) => `${r.aluno} (${r.email}): ${r.status} ${r.matriculas ? `- ${r.matriculas} cursos` : `- Erro: ${r.erro}`}`).join('\n');
        navigator.clipboard.writeText(textReport).then(() => {
          btnCopyLog.textContent = 'Copiado!';
          setTimeout(() => { btnCopyLog.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Baixar Relatório de Execução (.CSV)'; }, 2000);
        });
      };
    }

    if (btnRestartBatch) {
      btnRestartBatch.addEventListener('click', () => {
        csvSelectedFile = null;
        if (csvFileInput) csvFileInput.value = '';
        if (csvFileInfoBar) csvFileInfoBar.style.display = 'none';
        if (csvDropzone) csvDropzone.style.display = 'block';
        parsedStudentsData = [];
        updateCsvFlow();
        showCsvSection('upload');
      });
    }

    if (btnGoToSearch) {
      btnGoToSearch.addEventListener('click', () => switchTab('search'));
    }
  });
}

// Copy password
const copyPasswordBtn = document.getElementById('copyPasswordBtn');
if (copyPasswordBtn) {
  copyPasswordBtn.addEventListener('click', () => {
    if (!csvDefaultPassword?.value) return;
    navigator.clipboard.writeText(csvDefaultPassword.value).then(() => {
      copyPasswordBtn.textContent = 'Copiado!';
      setTimeout(() => (copyPasswordBtn.textContent = 'Copiar'), 2000);
    });
  });
}

// Init
showCsvSection('upload');

const enrollNewCourseBtn = document.getElementById('enrollNewCourseBtn');
if (enrollNewCourseBtn) {
  enrollNewCourseBtn.addEventListener('click', async () => {
    const student = currentStudentDashboardData;
    switchTab('register');
    await ensureSchoolsLoaded();
    if (student) {
      regName.value = student.nome || '';
      regEmail.value = student.email || '';
      regName.dispatchEvent(new Event('input', { bubbles: true }));
      regEmail.dispatchEvent(new Event('input', { bubbles: true }));
    }
    courseFilterInput?.focus();
  });
}

initializeAuthentication();
initializeLessonPlan();

// ==========================================
// ABA LICENCAS E RISCOS
// ==========================================
const licSchoolSelect = document.getElementById('licSchoolSelect');
const licChips = document.getElementById('licChips');
const licSearchInput = document.getElementById('licSearchInput');
const licRefreshBtn = document.getElementById('licRefreshBtn');
const licExportBtn = document.getElementById('licExportBtn');
const licTableBody = document.getElementById('licTableBody');
const licError = document.getElementById('licError');
const licMeta = document.getElementById('licMeta');
const licSelectAll = document.getElementById('licSelectAll');
const licPageSize = document.getElementById('licPageSize');
const licPagination = document.getElementById('licPagination');
const licSelectedCount = document.getElementById('licSelectedCount');
const licBatchRenew = document.getElementById('licBatchRenew');
const licBatchWithdraw = document.getElementById('licBatchWithdraw');
const licBatchFeedback = document.getElementById('licBatchFeedback');
const licSchoolsRow = document.getElementById('licSchoolsRow');

let licData = null;
let licLoaded = false;
let licLoading = false;
let licRiskVal = 'all';
let licSelected = new Set();
let licPage = 1;
let licPageSizeVal = 20;

function licRowKey(item) {
  return `${item.schoolId}|${item.email}|${item.courseId}`;
}

function licCanWrite() {
  return currentUserRole !== 'viewer';
}

function licFilteredItems() {
  if (!licData) return [];
  const schoolVal = licSchoolSelect?.value ?? 'all';
  const term = (licSearchInput?.value || '').toLowerCase().trim();
  return licData.items.filter((item) => {
    if (schoolVal !== 'all' && String(item.schoolId) !== String(schoolVal)) return false;
    if (licRiskVal === 'risk' && !item.emRisco) return false;
    if (licRiskVal === 'active' && item.acessoAtivo !== true) return false;
    if (licRiskVal === 'blocked' && item.acessoAtivo !== false) return false;
    if (term && !`${item.nome} ${item.email} ${item.titulo}`.toLowerCase().includes(term)) return false;
    return true;
  });
}

function licFilteredUnenrolled() {
  if (!licData || licRiskVal !== 'none') return [];
  const schoolVal = licSchoolSelect?.value ?? 'all';
  const term = (licSearchInput?.value || '').toLowerCase().trim();
  return (licData.unenrolled || []).filter((person) => {
    if (schoolVal !== 'all' && String(person.schoolId) !== String(schoolVal)) return false;
    if (term && !`${person.nome} ${person.email}`.toLowerCase().includes(term)) return false;
    return true;
  });
}

function licFormatDate(iso, estimado) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d)) return '-';
  return d.toLocaleDateString('pt-BR') + (estimado ? ' *' : '');
}

function licFormatDays(item) {
  if (item.diasRestantes === null || item.diasRestantes === undefined) return '-';
  if (item.diasRestantes < 0) return `vencido há ${Math.abs(item.diasRestantes)}d`;
  return `${item.diasRestantes}d`;
}

function licInitials(nome) {
  const names = String(nome || '?').trim().split(/\s+/);
  const first = names[0]?.[0] || '?';
  const last = names.length > 1 ? (names[names.length - 1]?.[0] || '') : '';
  return (first + last).toUpperCase();
}

// ==========================================
// ABA AVALIAÇÕES: quiz de Fundamentos de IA
// ==========================================
const avaliacoesSearch = document.getElementById('avaliacoesSearch');
const avaliacoesSomenteBloqueados = document.getElementById('avaliacoesSomenteBloqueados');
const avaliacoesRefreshBtn = document.getElementById('avaliacoesRefreshBtn');
const avaliacoesPdfBtn = document.getElementById('avaliacoesPdfBtn');
const avaliacoesCsvBtn = document.getElementById('avaliacoesCsvBtn');
const avaliacoesStatus = document.getElementById('avaliacoesStatus');
const avaliacoesTbody = document.getElementById('avaliacoesTbody');
const avaliacoesDashboard = document.getElementById('avaliacoesDashboard');
const avaliacoesArea = document.getElementById('avaliacoesArea');
const avaliacoesAreaField = document.getElementById('avaliacoesAreaField');
const avaliacoesChips = document.getElementById('avaliacoesPessoasChips');
const avaliacoesSugestoes = document.getElementById('avaliacoesPessoasSugestoes');
const avaliacoesPessoaBusca = document.getElementById('avaliacoesPessoaBusca');
const avaliacoesPessoasLimpar = document.getElementById('avaliacoesPessoasLimpar');
let avaliacoesItems = [];
let avaliacoesRespostas = [];
let avaliacoesLoaded = false;
// Pessoas escolhidas (ids). Vazio = todas as pessoas do filtro de área.
let pessoasSelecionadas = new Set();

// Escopo da tela: área, pessoas escolhidas e só bloqueados. Indicadores, lista e relatório usam o mesmo escopo.
function escopoAvaliacoes() {
  return buildScope({ items: avaliacoesItems, respostas: avaliacoesRespostas }, {
    area: avaliacoesArea?.value || null,
    ids: pessoasSelecionadas,
    onlyBlocked: Boolean(avaliacoesSomenteBloqueados?.checked),
  });
}

function descricaoFiltros() {
  const pessoas = pessoasSelecionadas.size ? `${pessoasSelecionadas.size} escolhida(s)` : 'todas';
  const partes = [`Área: ${avaliacoesArea?.value || 'todas'}`, `Pessoas: ${pessoas}`];
  if (avaliacoesSomenteBloqueados?.checked) partes.push('somente bloqueados ou esgotados');
  return partes.join(' · ');
}

// Cartões e gráficos: sempre o escopo atual. Com uma pessoa só, a última carta mostra a evolução dela.
function renderAvaliacoesDashboard() {
  const escopo = escopoAvaliacoes();
  const { kpis, modulos, faixas, porNumero, eventos, atividade, evolucao } = computeStats(escopo);
  const pessoasNoEscopo = new Set(escopo.items.map((i) => i.alunoId));
  const umaPessoa = pessoasNoEscopo.size === 1 ? escopo.items[0] : null;

  const kpiHtml = kpiCardsFor(kpis, umaPessoa);

  avaliacoesDashboard.innerHTML = `
    <div class="avl-kpis">${kpiHtml}</div>
    <div class="avl-grid">
      <article class="avl-card">
        <h3 class="avl-card__title">Desempenho por módulo</h3>
        <p class="avl-card__sub">Acerto nas alternativas, do módulo mais fraco ao mais forte</p>
        ${barRows(modulos.map((m) => ({ label: m.label, value: m.pct })), { suffix: '%', max: 100 })}
      </article>
      <article class="avl-card">
        <h3 class="avl-card__title">Resultado por tentativa</h3>
        <p class="avl-card__sub">Aprovações e reprovações em cada número de tentativa</p>
        ${attemptStackChart(porNumero)}
      </article>
      <article class="avl-card">
        <h3 class="avl-card__title">Distribuição de notas</h3>
        <p class="avl-card__sub">Notas das tentativas concluídas, de 0 a 10</p>
        ${columnChart(faixas, { colorFor: (_row, i) => (i < 2 ? COLORS.coral : COLORS.graphite), cutAt: 2 })}
        <ul class="avl-legend avl-legend--row">
          <li><span class="avl-dot" style="background:${COLORS.coral}"></span>Abaixo de 7 (reprovação)</li>
          <li><span class="avl-dot" style="background:${COLORS.graphite}"></span>7 ou mais (aprovação)</li>
        </ul>
      </article>
      <article class="avl-card">
        <h3 class="avl-card__title">Sinais de integridade</h3>
        <p class="avl-card__sub">Eventos registrados durante a prova</p>
        ${signalList(eventos)}
      </article>
      <article class="avl-card avl-card--wide">
        <h3 class="avl-card__title">${umaPessoa ? `Evolução de ${escapeHtml(umaPessoa.nome)}` : 'Atividade por dia'}</h3>
        <p class="avl-card__sub">${umaPessoa ? 'Nota de cada tentativa concluída. A linha tracejada marca a aprovação.' : 'Tentativas iniciadas em cada dia'}</p>
        ${umaPessoa ? lineChart(evolucao) : columnChart(atividade, { color: COLORS.graphite })}
      </article>
    </div>`;
}

// Gestor vê só as pessoas do time dele e não tem filtro de área; a educação filtra por área e por pessoa.
function atualizarFiltrosAvaliacoes() {
  const areas = [...new Set(avaliacoesItems.map((i) => i.area).filter(Boolean))].sort();
  const areaAtual = avaliacoesArea.value;
  avaliacoesArea.innerHTML = '<option value="">Todas as áreas</option>'
    + areas.map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
  avaliacoesArea.value = areaAtual;
  if (avaliacoesAreaField) avaliacoesAreaField.hidden = currentUserRole === 'gestor';
  if (avaliacoesCsvBtn) avaliacoesCsvBtn.hidden = !podeLiberar();

  // Mantém só as pessoas escolhidas que continuam dentro da área atual.
  const visiveis = new Set(pessoasDaArea().map((i) => i.alunoId));
  pessoasSelecionadas = new Set([...pessoasSelecionadas].filter((id) => visiveis.has(id)));
  renderChips();
  renderSugestoes();
}

// Pessoas que podem ser escolhidas: uma entrada por pessoa, dentro da área do filtro.
function pessoasDaArea() {
  const area = avaliacoesArea?.value || null;
  const porPessoa = new Map();
  for (const i of avaliacoesItems) {
    if (area && i.area !== area) continue;
    if (!porPessoa.has(i.alunoId)) porPessoa.set(i.alunoId, i);
  }
  return [...porPessoa.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function nomeDaPessoa(id) {
  return avaliacoesItems.find((i) => i.alunoId === id)?.nome || 'Pessoa';
}

// Chips: cada pessoa escolhida aparece como etiqueta, com × para tirar do filtro.
function renderChips() {
  avaliacoesChips.innerHTML = [...pessoasSelecionadas]
    .map((id) => `<span class="avl-chip">${escapeHtml(nomeDaPessoa(id))}<button type="button" class="avl-chip__remover" data-remover-pessoa="${id}" aria-label="Remover ${escapeHtml(nomeDaPessoa(id))}">×</button></span>`)
    .join('');
  avaliacoesPessoasLimpar.hidden = pessoasSelecionadas.size === 0;
}

// Sugestões: abrem ao focar ou digitar. Quem já está nos chips não aparece de novo.
function renderSugestoes() {
  const busca = (avaliacoesPessoaBusca.value || '').trim().toLowerCase();
  const sugestoes = pessoasDaArea()
    .filter((i) => !pessoasSelecionadas.has(i.alunoId))
    .filter((i) => !busca || `${i.nome} ${i.email}`.toLowerCase().includes(busca))
    .slice(0, 8);
  avaliacoesSugestoes.innerHTML = sugestoes.length
    ? sugestoes.map((i) => `
      <li><button type="button" class="avl-suggest__item" data-escolher-pessoa="${i.alunoId}">
        <span>${escapeHtml(i.nome)}</span><small>${escapeHtml([i.cargo, i.area].filter(Boolean).join(' · ') || 'sem área')}</small>
      </button></li>`).join('')
    : `<li class="avl-suggest__vazio">${busca ? 'Nenhuma pessoa encontrada.' : 'Digite um nome para buscar.'}</li>`;
}

// Abre a lista só quando o usuário está no campo (foco ou digitação). Atualizações da tela não abrem sozinhas.
function abrirSugestoes() {
  renderSugestoes();
  avaliacoesSugestoes.hidden = false;
}

function fecharSugestoes() {
  avaliacoesSugestoes.hidden = true;
}

function escolherPessoa(id) {
  pessoasSelecionadas.add(id);
  avaliacoesPessoaBusca.value = '';
  renderChips();
  renderSugestoes();
  atualizarTudo();
}

function removerPessoa(id) {
  pessoasSelecionadas.delete(id);
  renderChips();
  renderSugestoes();
  atualizarTudo();
}

// Liberar é exclusivo da educação (quem tem avaliacoes:write). O gestor só visualiza.
function podeLiberar() {
  return currentUserRole !== 'gestor';
}

function formatAvaliacaoData(iso) {
  return iso ? new Date(iso).toLocaleString('pt-BR') : '-';
}

function situacaoAvaliacao(item) {
  if (item.situacao === 'bloqueado') return `<strong>Bloqueado</strong><br><small>desde ${escapeHtml(formatAvaliacaoData(item.bloqueadoEm))}</small>`;
  if (item.situacao === 'esgotado') return '<strong>Tentativas esgotadas</strong><br><small>precisa de liberação</small>';
  if (item.liberadoEm) return `Ativo<br><small>liberado em ${escapeHtml(formatAvaliacaoData(item.liberadoEm))}</small>`;
  return 'Ativo';
}

function resultadoTentativa(t) {
  const resultado = t.aprovado === true ? 'aprovado' : t.aprovado === false ? 'reprovado' : 'em andamento';
  const partes = [`#${t.numero}: nota ${t.nota ?? '-'} (${resultado})`];
  if (t.duracaoMin !== null) partes.push(`${t.duracaoMin} min`);
  if (t.eventos) partes.push(`${t.eventos} evento(s) de integridade`);
  return escapeHtml(partes.join(' · '));
}

// Tentativas como pílulas (padrão Figma): nota colorida pelo resultado; vagas restantes em cinza.
function tentativasPills(item) {
  const pills = item.tentativas.map((t) => {
    const classe = t.aprovado === true ? 'ok' : t.aprovado === false ? 'rep' : 'neutral';
    return `<span class="avl-pill avl-pill--${classe}" title="${resultadoTentativa(t)}">${escapeHtml(t.nota ?? '-')}</span>`;
  });
  const vagas = Math.max(0, item.maxTentativas - item.tentativas.length);
  for (let i = 0; i < vagas; i += 1) pills.push('<span class="avl-pill avl-pill--vazia">—</span>');
  return `<span class="avl-attempts__sum">${item.usadas} de ${item.maxTentativas} usadas</span><span class="avl-pills">${pills.join('')}</span>`;
}

function situacaoPill(item) {
  if (item.situacao === 'bloqueado') return `<span class="avl-status avl-status--bad">Bloqueado</span><small class="avl-status__meta">desde ${escapeHtml(formatAvaliacaoData(item.bloqueadoEm))}</small>`;
  if (item.situacao === 'esgotado') return '<span class="avl-status avl-status--bad">Tentativas esgotadas</span><small class="avl-status__meta">precisa de liberação</small>';
  const liberado = item.liberadoEm ? `<small class="avl-status__meta">liberado em ${escapeHtml(formatAvaliacaoData(item.liberadoEm))}</small>` : '';
  return `<span class="avl-status avl-status--ok">Ativo</span>${liberado}`;
}

function avaliacaoRowHtml(item) {
  // Esgotado e ativo: pode bloquear. Bloqueado: pode liberar. Só a educação vê esses botões.
  let acao = '';
  if (podeLiberar()) {
    if (item.situacao === 'esgotado') {
      acao = `<button type="button" class="btn-secondary-outline" data-bloquear-aluno="${item.alunoId}" data-bloquear-curso="${item.courseId}">Bloquear</button>`;
    } else if (item.situacao === 'bloqueado') {
      acao = `<button type="button" class="btn-coral" data-liberar-aluno="${item.alunoId}" data-liberar-curso="${item.courseId}">Liberar</button>`;
    }
  }
  const temNota = item.ultimaNota !== null && item.ultimaNota !== undefined;
  const aprovada = temNota && Number(item.ultimaNota) > 7;
  const reprovada = temNota && !aprovada;
  const nota = temNota ? Number(item.ultimaNota).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '-';
  // Nome do curso quando a API informar; sem ele, mostra o código, sem inventar título.
  const curso = item.cursoNome || item.courseId;
  return `<tr>
    <td><strong>${escapeHtml(item.nome)}</strong>${item.cargo ? `<br><small>${escapeHtml(item.cargo)}</small>` : ''}<br><small>${escapeHtml(item.email)}</small></td>
    <td>${escapeHtml(curso)}</td>
    <td class="avl-attempts">${tentativasPills(item)}</td>
    <td class="col-center"><span class="avl-last-grade${aprovada ? ' is-ok' : reprovada ? ' is-rep' : ''}">${nota}</span></td>
    <td class="col-center avl-situacao">${situacaoPill(item)}${item.liberadoPor ? `<small class="avl-status__meta">por ${escapeHtml(item.liberadoPor)}</small>` : ''}</td>
    <td class="col-center">${acao}</td>
  </tr>`;
}

// Abas de situação (padrão Figma): Todas, Ativas e Bloqueadas (bloqueadas inclui esgotadas).
let avaliacoesStatusFiltro = 'todas';
const estaBloqueada = (item) => item.situacao === 'bloqueado' || item.situacao === 'esgotado';

function renderAvaliacoes() {
  const term = (avaliacoesSearch?.value || '').trim().toLowerCase();
  const todos = escopoAvaliacoes().items;
  const ativas = todos.filter((i) => !estaBloqueada(i)).length;
  const bloqueadas = todos.length - ativas;
  document.getElementById('avlCountTodas').textContent = String(todos.length);
  document.getElementById('avlCountAtivas').textContent = String(ativas);
  document.getElementById('avlCountBloqueadas').textContent = String(bloqueadas);
  document.querySelectorAll('[data-status-filter]').forEach((btn) => {
    const ativo = btn.dataset.statusFilter === avaliacoesStatusFiltro;
    btn.classList.toggle('is-active', ativo);
    btn.setAttribute('aria-pressed', String(ativo));
  });

  const rows = todos
    .filter((i) => avaliacoesStatusFiltro === 'todas' || (avaliacoesStatusFiltro === 'ativas' ? !estaBloqueada(i) : estaBloqueada(i)))
    .filter((item) => !term || `${item.nome} ${item.email}`.toLowerCase().includes(term));
  avaliacoesTbody.innerHTML = rows.length
    ? rows.map(avaliacaoRowHtml).join('')
    : '<tr><td colspan="6">Nenhum aluno encontrado.</td></tr>';
  avaliacoesStatus.textContent = `${rows.length} de ${avaliacoesItems.length} matrículas`;
}

document.querySelectorAll('[data-status-filter]').forEach((btn) => {
  btn.addEventListener('click', () => {
    avaliacoesStatusFiltro = btn.dataset.statusFilter;
    renderAvaliacoes();
  });
});

function atualizarTudo() {
  renderAvaliacoesDashboard();
  renderAvaliacoes();
}

async function ensureAvaliacoesLoaded(force = false) {
  if (avaliacoesLoaded && !force) return atualizarTudo();
  avaliacoesStatus.textContent = 'Carregando...';
  try {
    const res = await fetch('/api/licenses?view=avaliacoes');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Falha ao carregar avaliações.');
    avaliacoesItems = data.items;
    avaliacoesRespostas = data.respostas;
    avaliacoesLoaded = true;
    atualizarFiltrosAvaliacoes();
    atualizarTudo();
  } catch (error) {
    avaliacoesStatus.textContent = error.message;
  }
}

// Relatório PDF: o que está filtrado na tela, em páginas A4 com margens seguras (mesmo padrão dos outros PDFs do sistema).
async function gerarRelatorioPdf() {
  const escopo = escopoAvaliacoes();
  if (escopo.items.length === 0) {
    avaliacoesStatus.textContent = 'Nenhuma pessoa com o filtro atual. Ajuste os filtros antes de gerar o relatório.';
    return;
  }
  const original = avaliacoesPdfBtn.innerHTML;
  avaliacoesPdfBtn.disabled = true;
  avaliacoesPdfBtn.textContent = 'Gerando PDF...';

  // Palco fora da tela: as páginas são montadas aqui, capturadas e descartadas.
  const palco = document.createElement('div');
  palco.id = 'avaliacoesReportHost';
  palco.style.cssText = 'position:fixed;left:-10000px;top:0;background:#ffffff;';
  document.body.appendChild(palco);

  try {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ]);
    palco.innerHTML = reportPages({
      scope: escopo,
      filtros: descricaoFiltros(),
      geradoEm: new Date().toLocaleString('pt-BR'),
    }).join('');
    await document.fonts?.ready;

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const paginas = palco.querySelectorAll('.avl-rel-page');
    for (let indice = 0; indice < paginas.length; indice += 1) {
      const canvas = await html2canvas(paginas[indice], { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false });
      if (indice > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    }
    pdf.save(`relatorio-avaliacoes-${new Date().toISOString().slice(0, 10)}.pdf`);
  } catch {
    avaliacoesStatus.textContent = 'Não foi possível gerar o PDF. Tente novamente.';
  } finally {
    palco.remove();
    avaliacoesPdfBtn.disabled = false;
    avaliacoesPdfBtn.innerHTML = original;
  }
}

// CSV do escopo atual (só a educação). Separador ";" e BOM, para o Excel abrir com acentos certos.
function exportarCsv() {
  const escopo = escopoAvaliacoes();
  if (escopo.items.length === 0) {
    avaliacoesStatus.textContent = 'Nenhuma pessoa com o filtro atual. Ajuste os filtros antes de exportar.';
    return;
  }
  const blob = new Blob(['﻿' + buildCsv(escopo.items)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `avaliacoes-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

avaliacoesTbody?.addEventListener('click', async (event) => {
  const btn = event.target.closest('[data-liberar-aluno], [data-bloquear-aluno]');
  if (!btn) return;
  const bloquear = btn.hasAttribute('data-bloquear-aluno');
  const alunoId = Number(bloquear ? btn.dataset.bloquearAluno : btn.dataset.liberarAluno);
  const courseId = Number(bloquear ? btn.dataset.bloquearCurso : btn.dataset.liberarCurso);
  const item = avaliacoesItems.find((i) => i.alunoId === alunoId && i.courseId === courseId);
  const nome = item?.nome || 'o aluno';
  const confirmado = window.confirm(bloquear
    ? `Bloquear ${nome} no curso? O acesso é removido na Hotscool e ela só volta com a liberação.`
    : `Liberar ${nome} para refazer a avaliação? As tentativas passam a contar a partir de agora.`);
  if (!confirmado) return;

  btn.disabled = true;
  try {
    const res = await fetch('/api/licenses?view=avaliacoes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alunoId, courseId, acao: bloquear ? 'bloquear' : 'liberar' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Falha ao atualizar o aluno.');
    avaliacoesStatus.textContent = bloquear ? 'Aluno bloqueado.' : 'Aluno liberado.';
    await ensureAvaliacoesLoaded(true);
  } catch (error) {
    btn.disabled = false;
    avaliacoesStatus.textContent = error.message;
  }
});

avaliacoesArea?.addEventListener('change', () => {
  atualizarFiltrosAvaliacoes();
  atualizarTudo();
});
avaliacoesPessoaBusca?.addEventListener('focus', abrirSugestoes);
avaliacoesPessoaBusca?.addEventListener('input', abrirSugestoes);
// Fecha a lista ao sair do campo, com um pequeno atraso para o clique numa sugestão ainda funcionar.
avaliacoesPessoaBusca?.addEventListener('blur', () => setTimeout(fecharSugestoes, 150));
// mousedown (e não click) para a escolha acontecer antes do campo perder o foco.
avaliacoesSugestoes?.addEventListener('mousedown', (event) => {
  const botao = event.target.closest('[data-escolher-pessoa]');
  if (!botao) return;
  event.preventDefault();
  escolherPessoa(Number(botao.dataset.escolherPessoa));
});
avaliacoesChips?.addEventListener('click', (event) => {
  const botao = event.target.closest('[data-remover-pessoa]');
  if (botao) removerPessoa(Number(botao.dataset.removerPessoa));
});
avaliacoesPessoasLimpar?.addEventListener('click', () => {
  pessoasSelecionadas.clear();
  renderChips();
  renderSugestoes();
  atualizarTudo();
});
avaliacoesSomenteBloqueados?.addEventListener('change', atualizarTudo);
avaliacoesSearch?.addEventListener('input', renderAvaliacoes);
avaliacoesRefreshBtn?.addEventListener('click', () => ensureAvaliacoesLoaded(true));
avaliacoesPdfBtn?.addEventListener('click', gerarRelatorioPdf);
avaliacoesCsvBtn?.addEventListener('click', exportarCsv);

function renderLicenses() {
  if (!licData) return;
  const t = licData.total;
  const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  const licUsuarios = t.usuariosAtivos ?? 0;
  const licLivres = t.teto > 0 ? t.teto - licUsuarios : null;
  setText('licKpiTeto', t.teto > 0 ? `${t.usoPercentual}%` : '-');
  setText('licKpiTetoSub', t.teto > 0
    ? (licLivres < 0
      ? `${licUsuarios}/${t.teto} em uso • ${Math.abs(licLivres)} acima do teto`
      : `${licUsuarios}/${t.teto} em uso • ${licLivres} livres`)
    : 'configure HOTSCOOL_MAX_ACTIVE_ENROLLMENTS no .env');
  setText('licKpiRisco', String(t.emRisco));
  setText('licKpiBloqueadas', String(t.bloqueadas));
  setText('licKpiBloqueadasSub', `${t.desconhecidas} sem status`);
  setText('licKpiSemMat', String(t.semMatricula ?? 0));

  const licSchoolsRow = document.getElementById('licSchoolsRow');
  if (licSchoolsRow) {
    const maxUsers = Math.max(1, ...licData.schools.map((s) => Number(s.usuariosAtivos) || 0));
    licSchoolsRow.innerHTML = licData.schools.map((s) => {
      const users = Number(s.usuariosAtivos) || 0;
      const pct = Math.max(2, Math.round((users / maxUsers) * 100));
      return `
      <div class="lic-school">
        <div class="lic-school__head">
          <span class="lic-school__name">${escapeHtml(s.name)}</span>
          <strong class="lic-school__users">${users} ${users === 1 ? 'usuário' : 'usuários'}</strong>
        </div>
        <span class="lic-school__meta">${Number(s.ativas) || 0} matrículas ativas • ${Number(s.bloqueadas) || 0} bloqueadas • ${Number(s.emRisco) || 0} em risco (${Number(s.usuariosTrilha) || 0} só trilha) • ${Number(s.semMatricula) || 0} não matriculados</span>
        <div class="lic-school__bar"><span style="width:${pct}%"></span></div>
      </div>`;
    }).join('');
  }
  renderLicDue(licData.items || []);

  if (licSchoolSelect && licSchoolSelect.options.length === 0) {
    licSchoolSelect.innerHTML = '<option value="all">Todas as escolas</option>'
      + licData.schools.map((s) => `<option value="${Number(s.id)}">${escapeHtml(s.name)} (${s.usuariosAtivos ?? 0} usuários)</option>`).join('');
  }
  if (licMeta) {
    const when = licData.cachedAt ? new Date(licData.cachedAt).toLocaleString('pt-BR') : '-';
    licMeta.textContent = `Sincronizado em ${when} • janela de ${licData.windowDays} dias • * dia do cadastro no banco`;
  }

  const isNone = licRiskVal === 'none';
  const rows = isNone ? licFilteredUnenrolled() : licFilteredItems();
  if (licData) {
    const items = licData.items;
    const chipCount = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = String(n); };
    chipCount('licCountAll', items.length);
    chipCount('licCountRisk', items.filter((i) => i.emRisco).length);
    chipCount('licCountActive', items.filter((i) => i.acessoAtivo === true).length);
    chipCount('licCountBlocked', items.filter((i) => i.acessoAtivo === false).length);
    chipCount('licCountNone', (licData.unenrolled || []).length);
  }
  if (licSelectAll) licSelectAll.disabled = isNone;
  const pageSize = licPageSizeVal;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  if (licPage > totalPages) licPage = totalPages;
  const pageRows = rows.slice((licPage - 1) * pageSize, licPage * pageSize);
  const renderPageStatus = (list) => {
    if (!licPagination) return;
    if (!list.length) { licPagination.innerHTML = ''; return; }
    const from = (licPage - 1) * pageSize + 1;
    const to = Math.min(licPage * pageSize, list.length);
    licPagination.innerHTML = `
      <button type="button" class="btn-ghost-sm" data-lic-page="prev" ${licPage <= 1 ? 'disabled' : ''} aria-label="Página anterior">‹</button>
      <span style="font-size:13px;">${from}–${to} de ${list.length}</span>
      <button type="button" class="btn-ghost-sm" data-lic-page="next" ${licPage >= totalPages ? 'disabled' : ''} aria-label="Próxima página">›</button>`;
  };
  if (!rows.length) {
    licTableBody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;">Nenhum registro para os filtros.</td></tr>';
    renderPageStatus(rows);
  } else if (isNone) {
    licTableBody.innerHTML = rows.slice(0, 500).map((person) => `
      <tr>
        <td><input type="checkbox" disabled aria-label="Sem ação disponível"></td>
        <td><div class="student-cell"><div class="student-avatar">${escapeHtml(licInitials(person.nome))}</div><div><div class="student-name">${escapeHtml(person.nome)}</div><div style="font-size:11px;color:var(--graphite-muted)">${escapeHtml(person.email)}</div></div></div></td>
        <td style="color:var(--graphite-muted)">—</td>
        <td>${escapeHtml(person.escola)}</td>
        <td>${licFormatDate(person.dataCadastro, false)}</td>
        <td>—</td>
        <td><span class="status-pill info">Não matriculado</span></td>
      </tr>`).join('');
    renderPageStatus(rows);
  } else {
    licTableBody.innerHTML = pageRows.map((item) => {
      const key = licRowKey(item);
      const checked = licSelected.has(key) ? 'checked' : '';
      const pill = item.emRisco
        ? '<span class="status-pill error">Em risco</span>'
        : item.acessoAtivo === true
          ? '<span class="status-pill success">Ativo</span>'
          : item.acessoAtivo === false
            ? '<span class="status-pill error">Bloqueado</span>'
            : '<span class="status-pill info">Desconhecido</span>';
      return `<tr>
        <td><input type="checkbox" data-lic-check="${escapeHtml(key)}" ${checked} aria-label="Selecionar matrícula"></td>
        <td><div class="student-cell"><div class="student-avatar">${escapeHtml(licInitials(item.nome))}</div><div><div class="student-name">${escapeHtml(item.nome)}</div><div style="font-size:11px;color:var(--graphite-muted)">${escapeHtml(item.email)}</div></div></div></td>
        <td>${escapeHtml(item.titulo)}</td>
        <td>${escapeHtml(item.escola)}</td>
        <td>${licFormatDate(item.dataMatricula, item.estimado)}</td>
        <td>${licFormatDays(item)}</td>
        <td>${pill}</td>
      </tr>`;
    }).join('');
    renderPageStatus(rows);
  }
  updateLicSelectionUi(isNone ? [] : pageRows);
}

// Próximos vencimentos: matrículas ativas que vencem em até 60 dias, da mais próxima para a mais distante.
function renderLicDue(items) {
  const list = document.getElementById('licDueList');
  if (!list) return;
  const day = 24 * 60 * 60 * 1000;
  const upcoming = items
    .filter((i) => typeof i.diasRestantes === 'number' && i.diasRestantes >= 0 && i.diasRestantes <= 60 && i.acessoAtivo !== false)
    .sort((a, b) => a.diasRestantes - b.diasRestantes)
    .slice(0, 5);
  if (!upcoming.length) {
    list.innerHTML = '<li class="lic-due__empty">Nenhum vencimento nos próximos 60 dias.</li>';
    return;
  }
  list.innerHTML = upcoming.map((i) => {
    const d = Number(i.diasRestantes);
    const when = new Date(Date.now() + d * day).toLocaleDateString('pt-BR');
    const soon = d <= 30;
    return `<li class="lic-due__item${soon ? ' is-soon' : ''}">
      <span class="lic-due__dot"></span>
      <div class="lic-due__body">
        <strong>${d === 0 ? 'vence hoje' : `vence em ${d} ${d === 1 ? 'dia' : 'dias'}`}</strong>
        <small>${escapeHtml(i.nome)} · ${escapeHtml(i.titulo)}</small>
      </div>
      <span class="lic-due__date">${escapeHtml(when)}</span>
    </li>`;
  }).join('');
}

const LIC_SKELETON_IDS =['licKpiTeto', 'licKpiRisco', 'licKpiBloqueadas', 'licKpiSemMat'];

function showLicSkeletons(statusText) {
  for (const id of LIC_SKELETON_IDS) document.getElementById(id)?.classList.add('skel');
  if (licSchoolsRow) {
    licSchoolsRow.innerHTML = [1, 2, 3].map(() => `
      <div class="lic-school">
        <div class="lic-school__head"><span class="lic-school__name skel">Escola carregando</span></div>
        <span class="lic-school__meta skel">carregando dados da escola…</span>
        <div class="lic-school__bar"><span class="skel" style="width:60%"></span></div>
      </div>`).join('');
  }
  const dueList = document.getElementById('licDueList');
  if (dueList) dueList.innerHTML = '<li class="lic-due__empty skel">carregando vencimentos…</li>';
  if (licTableBody) {
    licTableBody.innerHTML = Array.from({ length: 8 }).map(() => `
      <tr class="skel-row">
        <td><span class="skel" style="width:16px;height:16px;">&nbsp;</span></td>
        <td><span class="skel" style="width:180px;">&nbsp;</span></td>
        <td><span class="skel" style="width:140px;">&nbsp;</span></td>
        <td><span class="skel" style="width:120px;">&nbsp;</span></td>
        <td><span class="skel" style="width:80px;">&nbsp;</span></td>
        <td><span class="skel" style="width:60px;">&nbsp;</span></td>
        <td><span class="skel" style="width:90px;">&nbsp;</span></td>
      </tr>`).join('');
  }
  if (licMeta && statusText) licMeta.textContent = statusText;
}

function clearLicSkeletons() {
  for (const id of LIC_SKELETON_IDS) document.getElementById(id)?.classList.remove('skel');
}

function mergeLicSchoolData(acc, incoming) {
  if (!incoming || !Array.isArray(incoming.schools)) return acc;
  acc.windowDays = incoming.windowDays || acc.windowDays;
  acc.cachedAt = new Date().toISOString();
  acc.schools.push(...incoming.schools);
  acc.items.push(...(incoming.items || []));
  acc.unenrolled.push(...(incoming.unenrolled || []));
  const sum = (pick) => acc.schools.reduce((n, s) => n + (s[pick] || 0), 0);
  const emails = (onlyActive) => new Set(
    acc.items.filter((i) => !onlyActive || i.acessoAtivo === true).map((i) => i.email)
  );
  acc.total = {
    teto: incoming.total?.teto ?? acc.total.teto,
    totalMatriculas: sum('totalMatriculas'),
    ativas: sum('ativas'),
    bloqueadas: sum('bloqueadas'),
    desconhecidas: sum('desconhecidas'),
    emRisco: sum('emRisco'),
    semMatricula: sum('semMatricula'),
    usuariosAtivos: emails(true).size,
    usuariosTrilha: sum('usuariosTrilha'),
    usuariosTotal: emails(false).size,
  };
  const t = acc.total;
  t.livres = t.teto > 0 ? t.teto - t.usuariosAtivos : null;
  t.usoPercentual = t.teto > 0 ? Math.round((t.usuariosAtivos / t.teto) * 100) : null;
  return acc;
}

function blankLicData() {
  return {
    windowDays: 30, cachedAt: null, schools: [], items: [], unenrolled: [],
    total: { teto: 0, totalMatriculas: 0, ativas: 0, bloqueadas: 0, desconhecidas: 0, emRisco: 0, semMatricula: 0, usuariosAtivos: 0, usuariosTrilha: 0, usuariosTotal: 0, livres: null, usoPercentual: null },
  };
}

async function ensureLicensesLoaded(force = false) {
  if (licLoading || (licLoaded && !force)) return;
  licLoading = true;
  if (licError) licError.style.display = 'none';
  if (licBatchFeedback) licBatchFeedback.style.display = 'none';
  try {
    // 1) Lista de escolas (rápido, vem do cache de nomes).
    const resSchools = await fetch('/api/courses');
    const schoolsJson = await resSchools.json().catch(() => ({}));
    if (!resSchools.ok) throw new Error(schoolsJson.error || 'Falha ao listar escolas.');
    const schoolList = Array.isArray(schoolsJson.schools) ? schoolsJson.schools : [];
    if (!schoolList.length) throw new Error('Nenhuma escola encontrada.');
    if (licSchoolSelect) {
      const keep = licSchoolSelect.value || 'all';
      licSchoolSelect.innerHTML = '<option value="all">Todas as escolas</option>'
        + schoolList.map((s) => `<option value="${Number(s.id)}">${escapeHtml(s.name)}</option>`).join('');
      licSchoolSelect.value = keep;
    }
    // 2) Uma request por escola em paralelo; cada chegada já renderiza.
    licData = blankLicData();
    licPage = 1;
    let done = 0;
    const failures = [];
    showLicSkeletons(`Localizando escolas… (0/${schoolList.length})`);
    renderLicenses();
    await Promise.all(schoolList.map(async (s) => {
      try {
        const res = await fetch(`/api/licenses?schoolIndex=${Number(s.id)}${force ? '&refresh=true' : ''}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        mergeLicSchoolData(licData, data);
      } catch (err) {
        failures.push(`${s.name}: ${err.message}`);
      } finally {
        done += 1;
        clearLicSkeletons();
        renderLicenses();
        if (licMeta) {
          const when = licData.cachedAt ? new Date(licData.cachedAt).toLocaleString('pt-BR') : '-';
          licMeta.textContent = done < schoolList.length
            ? `Carregando ${done}/${schoolList.length} escolas… • janela de ${licData.windowDays} dias`
            : `Sincronizado em ${when} • janela de ${licData.windowDays} dias • * data estimada`;
        }
      }
    }));
    licLoaded = true;
    if (failures.length) throw new Error(`Falha em ${failures.length} escola(s): ${failures.join(' | ')}`);
  } catch (err) {
    if (licError) {
      licError.textContent = err.message;
      licError.style.display = 'block';
    }
  } finally {
    licLoading = false;
  }
}

function updateLicSelectionUi(visibleRows) {
  const rows = visibleRows ?? licFilteredItems();
  for (const key of Array.from(licSelected)) {
    if (!licData?.items.some((i) => licRowKey(i) === key)) licSelected.delete(key);
  }
  const selectedVisible = rows.filter((i) => licSelected.has(licRowKey(i))).length;
  if (licSelectAll && !licSelectAll.disabled) {
    licSelectAll.checked = rows.length > 0 && selectedVisible === rows.length;
    licSelectAll.indeterminate = selectedVisible > 0 && selectedVisible < rows.length;
  }
  if (licSelectedCount) {
    licSelectedCount.textContent = licSelected.size === 0
      ? 'Nenhuma matrícula selecionada'
      : `${licSelected.size} matrícula${licSelected.size === 1 ? '' : 's'} selecionada${licSelected.size === 1 ? '' : 's'}`;
  }
  const showBar = licCanWrite();
  if (licBatchRenew) licBatchRenew.style.display = showBar ? '' : 'none';
  if (licBatchWithdraw) licBatchWithdraw.style.display = showBar ? '' : 'none';
}

function handleLicCheck(event) {
  const box = event.target?.closest?.('[data-lic-check]');
  if (!box || !licTableBody.contains(box)) return;
  if (box.checked) licSelected.add(box.dataset.licCheck);
  else licSelected.delete(box.dataset.licCheck);
  updateLicSelectionUi();
}

function licSelectedItems() {
  if (!licData) return [];
  return licData.items.filter((i) => licSelected.has(licRowKey(i)));
}

function showLicBatchFeedback(type, message) {
  if (!licBatchFeedback) return;
  licBatchFeedback.className = `feedback-box ${type}`;
  licBatchFeedback.innerHTML = message;
  licBatchFeedback.style.display = 'block';
}

async function runLicBatch(action) {
  const targets = licSelectedItems();
  if (!targets.length) {
    showLicBatchFeedback('error', 'Selecione ao menos uma matrícula na tabela.');
    return;
  }
  const verb = action === 'withdraw' ? 'Desmatricular' : 'Renovar (+30 dias)';
  if (!confirm(`${verb} ${targets.length} matrícula(s) selecionada(s)?`)) return;
  const btn = action === 'withdraw' ? licBatchWithdraw : licBatchRenew;
  const originalText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; }
  let ok = 0;
  const failures = [];
  for (let idx = 0; idx < targets.length; idx++) {
    const item = targets[idx];
    if (btn) btn.textContent = `${verb} ${idx + 1}/${targets.length}…`;
    try {
      const res = await fetch('/api/student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          email: item.email,
          id_curso: Number(item.courseId),
          schoolId: Number(item.schoolId),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      ok += 1;
      licSelected.delete(licRowKey(item));
    } catch (err) {
      failures.push(`${item.email} / ${item.titulo}: ${err.message}`);
    }
  }
  if (btn) { btn.disabled = false; btn.textContent = originalText; }
  showLicBatchFeedback(
    failures.length === 0 ? 'success' : 'error',
    `<strong>${ok} de ${targets.length} concluída(s).</strong>`
    + (failures.length ? `<ul style="margin:8px 0 8px 20px;font-size:13px;">${failures.slice(0, 10).map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>` : '')
  );
  await ensureLicensesLoaded(true);
}

function exportLicensesCsv() {
  const header = ['aluno', 'email', 'curso', 'escola', 'matricula_em', 'data_estimada', 'dias_restantes', 'status', 'em_risco'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const brDate = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '');
  let lines;
  let filename = 'licencas_riscos.csv';
  if (licRiskVal === 'none') {
    lines = [header.join(';')].concat(licFilteredUnenrolled().map((p) => [
      cell(p.nome), p.email, '-', cell(p.escola), brDate(p.dataCadastro), '', '', 'nao_matriculado', '',
    ].join(';')));
    filename = 'usuarios_nao_matriculados.csv';
  } else {
    lines = [header.join(';')].concat(licFilteredItems().map((i) => [
      cell(i.nome), i.email, cell(i.titulo), cell(i.escola), brDate(i.dataMatricula),
      i.estimado ? 'sim' : 'nao', i.diasRestantes ?? '', i.statusMatricula, i.emRisco ? 'sim' : 'nao',
    ].join(';')));
  }
  const blob = new Blob([String.fromCharCode(0xFEFF) + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function licCurrentPageRows() {
  if (licRiskVal === 'none') return [];
  const rows = licFilteredItems();
  return rows.slice((licPage - 1) * licPageSizeVal, licPage * licPageSizeVal);
}

licSchoolSelect?.addEventListener('change', () => { licPage = 1; renderLicenses(); });
licChips?.addEventListener('click', (event) => {
  const chip = event.target?.closest?.('[data-lic-filter]');
  if (!chip) return;
  licRiskVal = chip.dataset.licFilter;
  licPage = 1;
  licChips.querySelectorAll('.filter-chip').forEach((c) => c.classList.toggle('active', c === chip));
  renderLicenses();
});
licSearchInput?.addEventListener('input', () => { licPage = 1; renderLicenses(); });
licPageSize?.addEventListener('change', () => {
  licPageSizeVal = Number(licPageSize.value) || 20;
  licPage = 1;
  renderLicenses();
});
licPagination?.addEventListener('click', (event) => {
  const btn = event.target?.closest?.('[data-lic-page]');
  if (!btn || btn.disabled) return;
  licPage += btn.dataset.licPage === 'next' ? 1 : -1;
  renderLicenses();
});
licRefreshBtn?.addEventListener('click', () => ensureLicensesLoaded(true));
licExportBtn?.addEventListener('click', exportLicensesCsv);
licTableBody?.addEventListener('change', handleLicCheck);
licSelectAll?.addEventListener('change', () => {
  const rows = licCurrentPageRows();
  if (licSelectAll.checked) rows.forEach((i) => licSelected.add(licRowKey(i)));
  else rows.forEach((i) => licSelected.delete(licRowKey(i)));
  renderLicenses();
});
licBatchRenew?.addEventListener('click', () => runLicBatch('reactivate'));
licBatchWithdraw?.addEventListener('click', () => runLicBatch('withdraw'));
