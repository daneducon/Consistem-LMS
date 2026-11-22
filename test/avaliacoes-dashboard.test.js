import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, filterByAluno, filterByArea, formatPercent, kpiCardsFor } from '../src/avaliacoes-dashboard.js';

const items = [
  {
    alunoId: 1, nome: 'Ana', situacao: 'bloqueado', usadas: 3,
    tentativas: [
      { numero: 1, status: 'concluida', aprovado: false, nota: 4.2, duracaoMin: 30, iniciadaEm: '2026-10-01T10:00:00.000Z', eventosPorTipo: { paste_blocked: 2 } },
      { numero: 2, status: 'concluida', aprovado: true, nota: 8, duracaoMin: 20, iniciadaEm: '2026-10-02T10:00:00.000Z', eventosPorTipo: { fullscreen_exit: 1 } },
    ],
  },
  {
    alunoId: 2, nome: 'Bruno', situacao: 'ativo', usadas: 1,
    tentativas: [
      { numero: 1, status: 'concluida', aprovado: true, nota: 9, duracaoMin: 40, iniciadaEm: '2026-10-02T11:00:00.000Z', eventosPorTipo: {} },
      { numero: 2, status: 'em_andamento', aprovado: null, nota: null, duracaoMin: null, iniciadaEm: '2026-10-03T11:00:00.000Z', eventosPorTipo: {} },
    ],
  },
];
const respostas = [
  { alunoId: 1, tipo: 'mc', modulo: 'Ética', correta: true },
  { alunoId: 1, tipo: 'mc', modulo: 'Ética', correta: false },
  { alunoId: 2, tipo: 'mc', modulo: 'Ética', correta: true },
  { alunoId: 2, tipo: 'mc', modulo: 'Dados', correta: false },
  { alunoId: 2, tipo: 'open', modulo: 'Dados', correta: null, nota: 9 },
];

test('indicadores gerais: aprovação, nota média e tempo médio das tentativas concluídas', () => {
  const { kpis } = computeStats({ items, respostas });
  assert.equal(kpis.alunos, 2);
  assert.equal(kpis.bloqueados, 1);
  assert.equal(kpis.taxaAprovacao, 2 / 3);
  assert.equal(kpis.notaMedia, (4.2 + 8 + 9) / 3);
  assert.equal(kpis.melhorNota, 9);
  assert.equal(kpis.duracaoMedia, 30);
  assert.equal(kpis.emAndamento, 1);
});

test('acerto por módulo considera só as alternativas, do pior para o melhor', () => {
  const { modulos } = computeStats({ items, respostas });
  assert.deepEqual(modulos.map((m) => [m.label, m.pct]), [['Dados', 0], ['Ética', 67]]);
});

test('faixas de nota, resultado por tentativa e eventos somados', () => {
  const stats = computeStats({ items, respostas });
  assert.deepEqual(stats.faixas.map((f) => f.value), [1, 0, 0, 2, 0]);
  assert.deepEqual(stats.porNumero[0], { label: '1ª', aprovadas: 1, reprovadas: 1 });
  assert.deepEqual(stats.eventos, [
    { label: 'Tentou colar', value: 2 },
    { label: 'Saiu da tela cheia', value: 1 },
  ]);
});

test('filtro por aluno deixa só as tentativas e respostas dele', () => {
  const filtrado = filterByAluno({ items, respostas }, 1);
  const stats = computeStats(filtrado);
  assert.equal(stats.kpis.alunos, 1);
  assert.equal(stats.kpis.taxaAprovacao, 0.5);
  assert.equal(stats.evolucao.length, 2);
  assert.equal(stats.evolucao[1].nota, 8);
});

test('filtro por área deixa só os alunos e respostas dessa área', () => {
  const com = [
    { ...items[0], area: 'Financeiro' },
    { ...items[1], area: 'RH' },
  ];
  const filtrado = filterByArea({ items: com, respostas }, 'RH');
  assert.deepEqual(filtrado.items.map((i) => i.alunoId), [2]);
  assert.ok(filtrado.respostas.every((r) => r.alunoId === 2));
  assert.equal(filterByArea({ items: com, respostas }, '').items.length, 2);
});

test('cards de uma pessoa mostram tentativas, melhor nota e tempo médio dela', () => {
  const stats = computeStats(filterByAluno({ items, respostas }, 1));
  const html = kpiCardsFor(stats.kpis, items[0]);
  assert.ok(html.includes('Tentativas usadas'));
  assert.ok(html.includes('Melhor nota'));
  assert.ok(html.includes('Tempo médio'));
  assert.ok(html.includes('25,0 min'));
});

test('visão geral não mostra tempo médio nem melhor nota', () => {
  const stats = computeStats({ items, respostas });
  const html = kpiCardsFor(stats.kpis, null);
  assert.ok(!html.includes('Tempo médio'));
  assert.ok(!html.includes('Melhor nota'));
  assert.ok(html.includes('Bloqueados ou esgotados'));
});

test('sem dados, os indicadores ficam nulos em vez de zero', () => {
  const stats = computeStats({ items: [], respostas: [] });
  assert.equal(stats.kpis.taxaAprovacao, null);
  assert.equal(stats.kpis.notaMedia, null);
  assert.equal(formatPercent(null), '-');
});
