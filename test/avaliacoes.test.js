import { test } from 'node:test';
import assert from 'node:assert/strict';
import { podeBloquear, summarizeEnrollments } from '../lib/avaliacoes.js';

test('bloqueio manual: só quem esgotou as tentativas e está ativo', () => {
  assert.equal(podeBloquear({ status: 'ativo', usadas: 3 }), true);
  assert.equal(podeBloquear({ status: 'ativo', usadas: 2 }), false);
  assert.equal(podeBloquear({ status: 'bloqueado', usadas: 3 }), false);
});

const alunos = [{ id: 1, nome: 'Ana Lima', email: 'ana@exemplo.com' }];
const matriculas = [{
  aluno_id: 1,
  course_id: 32230,
  status: 'bloqueado',
  bloqueado_em: '2026-10-05T12:00:00.000Z',
  liberado_em: '2026-10-20T00:00:00.000Z',
  liberado_por: 'gestor@consistem.com.br',
}];
const tentativas = [
  {
    id: 10, aluno_id: 1, course_id: 32230, numero: 1,
    iniciada_em: '2026-10-01T10:00:00.000Z', finalizada_em: '2026-10-01T10:30:00.000Z',
    nota: 4.2, aprovado: false, status: 'concluida',
  },
  {
    id: 11, aluno_id: 1, course_id: 32230, numero: 2,
    iniciada_em: '2026-10-22T10:00:00.000Z', finalizada_em: '2026-10-22T10:20:00.000Z',
    nota: 8, aprovado: true, status: 'concluida',
  },
];
const eventos = [
  { tentativa_id: 11, tipo: 'fullscreen_exit' },
  { tentativa_id: 11, tipo: 'paste_blocked' },
];

test('resumo: só conta tentativas feitas depois da liberação', () => {
  const [linha] = summarizeEnrollments({ alunos, matriculas, tentativas, eventos });
  assert.equal(linha.usadas, 1);
  assert.equal(linha.maxTentativas, 3);
  assert.equal(linha.ultimaNota, 8);
  assert.equal(linha.liberadoPor, 'gestor@consistem.com.br');
});

test('resumo: duração em minutos e eventos de integridade por tentativa', () => {
  const [linha] = summarizeEnrollments({ alunos, matriculas, tentativas, eventos });
  assert.equal(linha.tentativas[0].duracaoMin, 30);
  assert.equal(linha.tentativas[0].eventos, 0);
  assert.equal(linha.tentativas[1].duracaoMin, 20);
  assert.equal(linha.tentativas[1].eventos, 2);
});

test('resumo: matrícula sem aluno correspondente na escola não aparece', () => {
  const linhas = summarizeEnrollments({ alunos: [], matriculas, tentativas, eventos });
  assert.deepEqual(linhas, []);
});
