// Relatório por curso: CSV e páginas do PDF a partir dos dados já carregados na tela.
import { escapeHtml } from './avaliacoes-dashboard.js';

const LINHAS_POR_PAGINA = 20;

const situacaoDo = (a) => (a.bloqueado ? 'Bloqueado' : a.concluido ? 'Concluído' : 'Em andamento');
const dataDo = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : 'Nunca');
const timesDo = (a) => (Array.isArray(a.equipes) && a.equipes.length ? a.equipes.join(', ') : '');

export function buildCsvCurso({ curso, alunos }) {
  const cabecalho = ['Curso', 'Aluno', 'E-mail', 'Cargo', 'Área de Negócio', 'Times', 'Progresso (%)', 'Aulas vistas', 'Total de aulas', 'Último login', 'Situação'];
  const linhas = alunos.map((a) => [
    curso?.nome || '', a.nome, a.email, a.cargo || '', a.areaNegocio || '', timesDo(a),
    a.progresso, a.aulasVistas, a.totalAulas, dataDo(a.ultimoLogin), situacaoDo(a),
  ]);
  return [cabecalho, ...linhas]
    .map((linha) => linha.map((campo) => `"${String(campo ?? '').replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');
}

// Páginas A4 (classes .avl-rel-page, como no PDF de Avaliações). Cada página leva até 20 alunos.
export function relatorioCursoPages({ curso, resumo, alunos, geradoEm }) {
  const blocos = [];
  const total = Math.max(1, Math.ceil(alunos.length / LINHAS_POR_PAGINA));
  for (let pagina = 0; pagina < total; pagina += 1) {
    const fatia = alunos.slice(pagina * LINHAS_POR_PAGINA, (pagina + 1) * LINHAS_POR_PAGINA);
    const linhas = fatia.map((a) => `
      <tr>
        <td><strong>${escapeHtml(a.nome)}</strong><br><small>${escapeHtml(a.email)}</small></td>
        <td>${escapeHtml(a.progresso)}%</td>
        <td>${escapeHtml(a.areaNegocio || '—')}</td>
        <td>${escapeHtml(timesDo(a) || '—')}</td>
        <td>${escapeHtml(a.aulasVistas)} de ${escapeHtml(a.totalAulas)}</td>
        <td>${escapeHtml(dataDo(a.ultimoLogin))}</td>
        <td>${escapeHtml(situacaoDo(a))}</td>
      </tr>`).join('');
    blocos.push(`
      <section class="avl-rel-page" style="position:relative;width:794px;height:1123px;box-sizing:border-box;padding:40px;background:#ffffff;color:#2e2e30;font-family:'DM Sans',sans-serif;">
        <h1 style="font-size:22px;margin:0 0 4px;">Relatório por curso</h1>
        <p style="margin:0 0 16px;font-size:13px;color:#6b6b70;">${escapeHtml(curso?.nome || '')} · gerado em ${escapeHtml(geradoEm)}</p>
        ${pagina === 0 ? `
        <p style="margin:0 0 20px;font-size:13px;">
          <strong>${resumo.alunos}</strong> alunos · <strong>${resumo.concluidos}</strong> concluídos ·
          <strong>${resumo.emAndamento}</strong> em andamento · <strong>${resumo.bloqueados}</strong> bloqueados ·
          progresso médio <strong>${resumo.progressoMedio}%</strong>
        </p>` : ''}
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
          <thead>
            <tr style="text-align:left;color:#6b6b70;">
              <th style="padding:8px 5px;border-bottom:1px solid #e4e4e7;">Aluno</th>
              <th style="padding:8px 5px;border-bottom:1px solid #e4e4e7;">Progresso</th>
              <th style="padding:8px 5px;border-bottom:1px solid #e4e4e7;">Área de Negócio</th>
              <th style="padding:8px 5px;border-bottom:1px solid #e4e4e7;">Time</th>
              <th style="padding:8px 5px;border-bottom:1px solid #e4e4e7;">Aulas vistas</th>
              <th style="padding:8px 5px;border-bottom:1px solid #e4e4e7;">Último login</th>
              <th style="padding:8px 5px;border-bottom:1px solid #e4e4e7;">Situação</th>
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
        <p style="position:absolute;bottom:24px;font-size:11px;color:#6b6b70;">Página ${pagina + 1} de ${total}</p>
      </section>`);
  }
  return blocos;
}
