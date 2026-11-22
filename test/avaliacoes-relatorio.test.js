import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCsv, buildScope, reportPages, ROWS_FIRST_PAGE, ROWS_NEXT_PAGE } from '../src/avaliacoes-relatorio.js';

const pessoa = (id, area, situacao = 'ativo') => ({
  alunoId: id, nome: `Pessoa ${id}`, email: `p${id}@x.com`, area, time: 'Time', courseId: 32230,
  situacao, usadas: 1, maxTentativas: 3, ultimaNota: 8, liberadoEm: null, liberadoPor: null, bloqueadoEm: null,
  tentativas: [{ numero: 1, status: 'concluida', aprovado: true, nota: 8, duracaoMin: 20, iniciadaEm: '2026-10-01T10:00:00.000Z', eventosPorTipo: {} }],
});

const items = [
  { ...pessoa(1, 'Financeiro', 'bloqueado'), nome: 'Ana; Lima' },
  pessoa(2, 'RH'),
  pessoa(3, 'Financeiro', 'esgotado'),
];
const respostas = [
  { alunoId: 1, tipo: 'mc', modulo: 'Ética', correta: false },
  { alunoId: 2, tipo: 'mc', modulo: 'Ética', correta: true },
  { alunoId: 3, tipo: 'mc', modulo: 'Dados', correta: true },
];

test('escopo: área, pessoas escolhidas e só bloqueados se somam', () => {
  assert.deepEqual(buildScope({ items, respostas }, { area: 'Financeiro' }).items.map((i) => i.alunoId), [1, 3]);
  assert.deepEqual(buildScope({ items, respostas }, { ids: new Set([2, 3]) }).items.map((i) => i.alunoId), [2, 3]);
  assert.deepEqual(buildScope({ items, respostas }, { onlyBlocked: true }).items.map((i) => i.alunoId), [1, 3]);
  const combinado = buildScope({ items, respostas }, { area: 'Financeiro', onlyBlocked: true, ids: new Set([3]) });
  assert.deepEqual(combinado.items.map((i) => i.alunoId), [3]);
  assert.deepEqual(combinado.respostas.map((r) => r.alunoId), [3]);
});

test('CSV: separador ponto e vírgula, campos com ";" entre aspas', () => {
  const [cabecalho, linha] = buildCsv(items.slice(0, 1)).split('\r\n');
  assert.ok(cabecalho.startsWith('Nome;E-mail;Cargo;Área;Time'));
  assert.ok(linha.startsWith('"Ana; Lima";p1@x.com;;Financeiro;Time;32230;bloqueado;1;3;8;8;'));
});

test('relatório: uma página A4 com indicadores quando cabe, com rodapé de paginação', () => {
  const paginas = reportPages({ scope: buildScope({ items, respostas }), filtros: 'Área: todas', geradoEm: '30/10/2026' });
  assert.equal(paginas.length, 1);
  assert.ok(paginas[0].includes('class="avl-rel-page"'));
  assert.ok(paginas[0].includes('Página 1 de 1'));
  assert.ok(paginas[0].includes('Pessoas (3)'));
});

test('relatório: muitas pessoas quebram em páginas, cada uma com rodapé e sem perder ninguém', () => {
  const muitas = Array.from({ length: ROWS_FIRST_PAGE + ROWS_NEXT_PAGE + 2 }, (_, k) => pessoa(100 + k, 'RH'));
  const paginas = reportPages({ scope: buildScope({ items: muitas, respostas: [] }), filtros: 'Todas', geradoEm: 'agora' });
  assert.equal(paginas.length, 3);
  assert.ok(paginas[2].includes('Página 3 de 3'));
  const todos = paginas.join('');
  for (const p of muitas) assert.ok(todos.includes(p.nome));
});

test('relatório: não traz texto de discursiva nem gabarito', () => {
  const html = reportPages({ scope: buildScope({ items, respostas }), filtros: 'Todas', geradoEm: 'agora' }).join('');
  assert.ok(!html.includes('Rubrica'));
  assert.ok(!html.includes('gabarito'));
});

test('relatório sem pessoas avisa em vez de tabela vazia', () => {
  const html = reportPages({ scope: buildScope({ items: [], respostas: [] }), filtros: 'Todas', geradoEm: 'agora' }).join('');
  assert.ok(html.includes('Nenhuma pessoa com o filtro atual.'));
});
