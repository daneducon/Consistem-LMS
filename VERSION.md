# Versionamento — Consistem LMS

Fonte única da versão: `src/version.js` (`APP_VERSION`), exibida no rodapé da ferramenta.

## Formato

`v<GERAÇÃO>.<RELEASE>` ou `v<GERAÇÃO>.<RELEASE>.<AJUSTE>` — ex.: `v5.0`, `v5.0.6`, `v5.1`.

## Política (revisar a cada melhoria solicitada)

| Tipo de mudança | Ação |
|---|---|
| Aba nova, estrutura nova (endpoint, modelo de dados, fluxo) | **+1 GERAÇÃO** (zera RELEASE: `v4.4` → `v5.0`) |
| Mudança de funcionalidade, tela nova ou regra nova | **+1 RELEASE** (`v5.0` → `v5.1`) |
| Mudança só de layout/visual (cores, espaçamento, componentes, ícones) | **+1 AJUSTE** no terceiro número (`v5.0.5` → `v5.0.6`) |

## Checklist a cada entrega

1. Classificar a mudança pela tabela acima.
2. Atualizar `APP_VERSION` em `src/version.js`.
3. Registrar abaixo no changelog (data + geração/release + o que mudou).
4. Conferir o rodapé da ferramenta exibindo a nova versão.

> Os deploys da Vercel (`vercel ls`) são contínuos e não carregam significado de
> versão — a versão é curadoria manual por esta política, não contagem de deploys.
> Histórico git (40 commits) serviu de base para o backfill abaixo.

## Changelog

### v5.0.7 — 22/11/2026 — Varredura completa na DS Consistem (AJUSTE)
- Todas as cores literais do CSS passam a usar tokens da DS; botões (40/48 px, raio 8), chips, pílulas de status e campos (48 px) seguem as especificações da biblioteca.
- Ícones com traço de 1,75 px; ícone ativo da sidebar em coral; estilos de layout escritos no HTML viraram classes.

### v5.0.6 — 22/11/2026 — Layout no padrão DS Consistem (AJUSTE)
- Login, Consulta do aluno, Licenças e riscos, Avaliações, Plano de aula e cabeçalho dos cursos com tokens, espaçamentos e componentes da DS (indicadores agrupados, anel de status, linha do tempo de vencimentos, fases coral/verde/cinza).
- Unifica as versões 5.1 a 5.6 anteriores, que eram só de layout.

### v5.0 — 22/11/2026 — Fluxo em blocos e curso obrigatório (GERAÇÃO nova)
- Cadastro individual (agora "Matrícula individual") em blocos numerados, com indicador de fase (atual em coral, concluída em verde, demais em cinza) e painel "Confirmar" com resumo.
- Curso obrigatório: sem curso, o botão fica desabilitado e o servidor recusa a matrícula. O cadastro como lead foi descontinuado.
- Matrícula em lote: fase 1 em blocos (Arquivo e Parâmetros) com painel "Próximo passo". Os parâmetros ficam bloqueados até existir um arquivo (enviado ou colado), e "Validar arquivo" só habilita com arquivo e escola. A execução fica bloqueada enquanto houver aluno sem curso válido.
- Tokens de cor, tipografia, espaçamento, raio, sombra e z-index alinhados à DS Consistem.

### v4.8 — 30/10/2026 — Cargo das pessoas em Avaliações (RELEASE)
- O cargo aparece abaixo do nome na tabela, nas sugestões da busca, no CSV (coluna "Cargo") e no PDF.
- Base de colaboradores carregada em `alunos_area` (coluna `cargo` nova): área e time vêm do grupo da planilha.

### v4.7 — 30/10/2026 — Lista de pessoas só abre ao clicar no campo (RELEASE)
- A lista de sugestões na busca de pessoas não abre mais sozinha ao carregar a tela ou ao escolher uma área.

### v4.6 — 30/10/2026 — Botão Bloquear para tentativas esgotadas (RELEASE)
- Aluno com tentativas esgotadas e ainda ativo ganha o botão **Bloquear**. O bloqueio é enviado à Hotscool (status 2) e só depois gravado no banco. Fica registrado em `acoes_hotscool` e `auditoria`.

### v4.5 — 30/10/2026 — Busca de pessoas com chips e cards por pessoa (RELEASE)
- Pessoas são escolhidas por busca, em chips que se removem com ×. As sugestões aparecem ao digitar e somem quem já está escolhido.
- Melhor nota e tempo médio aparecem só quando uma única pessoa está selecionada. A visão geral mostra Pessoas, Aprovação, Nota média e Bloqueados ou esgotados.

### v4.4 — 30/10/2026 — Indicadores de uma pessoa restaurados (RELEASE)
- Com uma pessoa escolhida, os cards voltam a mostrar tentativas usadas, melhor nota, aprovação e tempo médio. Com várias pessoas, os cards mostram a turma filtrada, incluindo o tempo médio.
- O PDF usa os mesmos cards da tela.

### v4.3 — 30/10/2026 — PDF do relatório em A4 (RELEASE)
- O PDF de Avaliações agora sai em páginas A4 com margens seguras de 16 mm e rodapé com paginação, no mesmo padrão dos outros PDFs do sistema (html2canvas + jsPDF).
- Pessoas que não cabem na primeira página continuam nas seguintes, sem perder ninguém.

### v4.2 — 30/10/2026 — Filtros, relatório PDF e CSV em Avaliações (RELEASE)
- Filtros valem para tudo: área, pessoas (várias, de qualquer time, para a educação) e somente bloqueados. Indicadores, lista e relatório seguem o mesmo filtro.
- Gestor vê só o time dele, sem filtro de área, e não libera.
- Gerar PDF (A4): gera o que está na tela, com indicadores, gráficos e a lista de pessoas.
- Exportar CSV (só educação): mesma lista da tela, com separador ";".
- Nomes dos cursos na tela de entrada do quiz vêm da Hotscool.

### v4.1 — 30/10/2026 — Dashboard da aba Avaliações (RELEASE)
- Indicadores gerais (alunos, aprovação, nota média, bloqueados) e por aluno (tentativas usadas, melhor nota, evolução), com filtro por aluno.
- Gráficos: desempenho por módulo, aprovação, distribuição de notas, sinais de integridade, atividade por dia e aprovações por tentativa.
- Situação "Tentativas esgotadas" e liberação também nesse caso.
- Quiz passa a gravar as respostas de cada questão (`respostas_tentativa`), com tempo gasto.

### v4.0 — 30/10/2026 — Aba Avaliações (GERAÇÃO nova)
- Nova aba: lista de alunos do quiz de Fundamentos de IA com tentativas usadas, notas, duração, eventos de integridade e situação (bloqueado ou ativo).
- Ação **Liberar** para alunos bloqueados: reativa o acesso na Hotscool e só depois grava no banco. As tentativas passam a contar a partir da liberação.
- Estrutura: `GET /api/avaliacoes` e `POST /api/avaliacoes` (lê e grava no Supabase do quiz com a chave de serviço, somente no servidor), permissões `avaliacoes:read` e `avaliacoes:write`.
- Variáveis novas: `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.

### v3.0 — 09/10/2026 — Aba Licenças e Riscos (GERAÇÃO nova)
- Nova aba: KPIs (teto global, risco, bloqueadas, sem matrícula, usuários), visão por escola, tabela com filtros, lote (renovar/desmatricular), paginação, CSV, skeletons + carga progressiva.
- Estrutura: `GET /api/licenses`, log local de matrículas (`api/enrollment-log.js`), teto global `HOTSCOOL_MAX_ACTIVE_ENROLLMENTS=200`, ações `block`/`withdraw`.
- Status real por curso (`course/access`) no dashboard; desbloqueio por aluno (`block-access`) com fallback de rematrícula; `data_limite` na reativação.

### v2.x — base anterior (backfill pelo git)
- Dashboard 360 do aluno, rematrícula idempotente, trilhas/pacotes, rate limiting e CSRF, login Google + sessões, gerador de plano de aula, PDF/relatórios, matrícula em lote via CSV.

### v1.x — base inicial
- Consulta, cadastro individual, escolas múltiplas, portal do aluno.
