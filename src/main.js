import { initializeLessonPlan, refreshLessonPlanPreview } from './lesson-plan.js';

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

function showAuthenticatedApp(user) {
  authenticatedUserName.textContent = user.name || 'Usuario autorizado';
  authenticatedUserEmail.textContent = user.email || '';
  auditorName.textContent = user.name || 'Usuário autorizado';
  auditorEmail.textContent = user.email || '';
  if (user.role === 'viewer') {
    document.querySelectorAll('[data-sidebar="register"], [data-sidebar="csv"]')
      .forEach((button) => { button.hidden = true; });
  }

  if (user.picture) {
    const pictureUrl = safeHttpsUrl(user.picture);
    authenticatedUserAvatar.textContent = '';
    authenticatedUserAvatar.style.backgroundImage = pictureUrl ? `url("${pictureUrl}")` : '';
    authenticatedUserAvatar.style.backgroundSize = 'cover';
    authenticatedUserAvatar.style.backgroundPosition = 'center';
    auditorAvatar.textContent = '';
    auditorAvatar.style.backgroundImage = pictureUrl ? `url("${pictureUrl}")` : '';
    auditorAvatar.style.backgroundSize = 'cover';
    auditorAvatar.style.backgroundPosition = 'center';
  } else {
    const names = String(user.name || user.email || 'U').trim().split(/\s+/);
    authenticatedUserAvatar.textContent = names.map((name) => name[0]).join('').slice(0, 2).toUpperCase();
    auditorAvatar.textContent = authenticatedUserAvatar.textContent;
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

  if (target === 'register') ensureSchoolsLoaded();
  else if (target === 'csv') ensureCsvSchoolsLoaded();
  else if (target === 'lesson') requestAnimationFrame(refreshLessonPlanPreview);
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
    const statusClass = isDone ? 'success' : 'warning';
    const statusText = isDone ? 'Concluido' : 'Em Andamento';
    const turma = c.turma && c.turma !== 'null' ? escapeHtml(c.turma) : '';
    const title = escapeHtml(c.titulo_curso);
    const imageUrl = safeHttpsUrl(c.imagem);
    const accessUrl = safeHttpsUrl(c.acessoUrl) || 'https://app.hotscool.com/';
    const certificateUrl = safeHttpsUrl(c.certificadoUrl);

    let actions = '';
    if (isDone && certificateUrl) {
      actions = `<a href="${certificateUrl}" target="_blank" rel="noopener noreferrer" class="btn-cert">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>
        Ver Certificado Autenticado
      </a>`;
    } else if (!isDone) {
      actions = `<a href="${accessUrl}" target="_blank" rel="noopener noreferrer" class="btn-continue">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        Continuar Curso
      </a>`;
    }

    const progressClass = isDone ? 'green' : (perc >= 50 ? 'gold' : '');

    return `
      <div class="course-card">
        <div class="course-card-cover ${imageUrl ? '' : 'empty'}">
          ${imageUrl
            ? `<img src="${imageUrl}" alt="Capa do curso ${title}" loading="lazy">`
            : `<span>${escapeHtml(c.titulo_curso?.slice(0, 1) || 'H')}</span>`}
        </div>
        <div class="course-card-body">
        <div class="course-card-status">
          <span class="status-pill ${statusClass}">${statusText}</span>
          ${turma ? `<span style="font-size:11px;color:var(--graphite-muted)">Turma: ${turma}</span>` : ''}
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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
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
          ${t.descricao ? `<p style="font-size:12px;color:var(--graphite-muted);margin:4px 0 8px;">${escapeHtml(t.descricao.slice(0,180))}</p>` : ''}
          <div class="course-progress-section">
            <div class="course-progress-row">
              <span class="course-progress-label">Progresso da trilha</span>
              <span class="course-progress-pct">${perc}%</span>
            </div>
            <div class="progress-bar"><div class="progress-bar-fill ${isDone ? 'green' : perc>=50?'gold':''}" style="width:${perc}%"></div></div>
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
  renderStudentCourses(data.cursos || []);
  renderStudentCertificates(data.certificados || []);
  renderStudentTrails(data.trilhas || []);
  renderLearningProgress(data.cursos || []);

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

function renderLearningProgress(courses) {
  const chart = document.getElementById('learningProgressChart');
  const total = document.getElementById('learningProgressTotal');
  if (!chart || !total) return;

  if (!courses.length) {
    chart.innerHTML = '<span class="chart-empty">Sem cursos para exibir.</span>';
    total.textContent = 'Dados sincronizados agora';
    return;
  }

  chart.innerHTML = courses.slice(0, 6).map((course) => {
    const progress = Math.min(100, Math.max(0, course.percentual || 0));
    const shortTitle = course.titulo_curso.length > 18
      ? `${course.titulo_curso.slice(0, 16)}...`
      : course.titulo_curso;
    return `
      <div class="chart-bar-item" title="${escapeHtml(course.titulo_curso)}: ${progress}%">
        <span class="bar-value">${progress}%</span>
        <div class="bar" style="height:${Math.max(8, progress)}%">
          <span class="bar-fill ${progress >= 100 ? 'green' : progress >= 50 ? 'gold' : 'coral'}"></span>
        </div>
        <span class="bar-label">${escapeHtml(shortTitle)}</span>
      </div>`;
  }).join('');
  total.textContent = `${courses.length} curso(s) sincronizado(s)`;
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
      const response = await fetch(`/api/student?email=${encodeURIComponent(email)}&refresh=true`);

      if (response.status === 400) {
        showSearchError('E-mail invalido. Verifique e tente novamente.');
        setSearchLoading(false);
        return;
      }
      if (response.status === 404) {
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
      if (!response.ok) {
        showSearchError('Erro ao buscar dados do aluno. Tente novamente mais tarde.');
        setSearchLoading(false);
        return;
      }

      const data = await response.json();
      showDashboard(data);
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
  if (packagesListContainer) packagesListContainer.innerHTML = '<div class="empty-state">Carregando trilhas da escola...</div>';
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
    const duration = c.duracao ? `${escapeHtml(c.duracao)}h` : '';
    return `
      <label class="course-check-item ${isChecked ? 'selected' : ''}" data-id="${courseId}">
        <input type="checkbox" value="${courseId}" ${isChecked ? 'checked' : ''}>
        <div class="course-check-info">
          <span class="course-check-name">${escapeHtml(c.nome)}</span>
          <div class="course-check-meta">
            ${c.categoria ? `<span>${escapeHtml(c.categoria)}</span>` : ''}
          </div>
        </div>
        ${duration ? `<span class="course-check-duration">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${duration}
        </span>` : ''}
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

function setRegisterLoading(loading) {
  regSubmitBtn.disabled = loading;
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
    const selectedCourseTitles = currentCourses.filter((c) => selectedCourseIds.has(c.id)).map((c) => c.nome);

    setRegisterLoading(true);
    regBtnText.textContent = courseIds.length > 0
      ? `Matriculando em ${courseIds.length} curso(s)...`
      : 'Cadastrando aluno...';

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
        `<p style="font-size:12px;margin-top:8px;opacity:0.7;">O cadastro e instantaneo. Pode levar alguns segundos para aparecer na consulta.</p>` +
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
const stepEls = document.querySelectorAll('.stepper .step');

function setStepperStep(num) {
  stepEls.forEach((s) => {
    const sNum = Number(s.dataset.step);
    s.classList.remove('active', 'completed');
    if (sNum < num) s.classList.add('completed');
    else if (sNum === num) s.classList.add('active');
  });
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
  btnExecuteText.textContent = `Confirmar e Iniciar Matrículas em Fila (${totalEnrollments})`;
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
  } catch (err) {
    csvSchoolSelect.innerHTML = '<option value="" disabled>Erro ao carregar escolas</option>';
  }
}

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
}

if (btnRemoveFile) {
  btnRemoveFile.addEventListener('click', () => {
    csvSelectedFile = null;
    csvFileInput.value = '';
    csvFileInfoBar.style.display = 'none';
    csvDropzone.style.display = 'block';
  });
}

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
  });
}

if (downloadTemplateBtn) {
  downloadTemplateBtn.addEventListener('click', () => {
    const csv = 'nome;email;enviar email para definir senha;senha;ID dos Conteudos;cpf;endereco;numero;cidade;estado;cep;departamento;ddd;celular\n';
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
  btnAnalyzeCsv.disabled = loading;
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
      : '<span style="color:var(--graphite-subtle);font-style:italic;font-size:12px;">Nenhum curso (lead)</span>';

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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
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
if (btnBackToUpload2) btnBackToUpload2.addEventListener('click', () => { csvSelectedFile = null; csvFileInput.value = ''; csvFileInfoBar.style.display = 'none'; csvDropzone.style.display = 'block'; showCsvSection('upload'); });
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
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
        if (icon) { icon.className = 'log-icon running'; icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>'; }
      }

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
          setTimeout(() => { btnCopyLog.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Baixar Relatório de Execução (.CSV)'; }, 2000);
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
