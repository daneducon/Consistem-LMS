import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePercentual, resumirAlunos } from '../lib/relatorio-curso.js';

test('parsePercentual usa o percentual da Hotscool quando vem preenchido', () => {
  assert.equal(parsePercentual('79%', 10, 8), 79);
  assert.equal(parsePercentual('12,6%', 10, 1), 13);
  assert.equal(parsePercentual('250%', 10, 1), 100);
});

test('parsePercentual calcula pelas aulas quando o campo não vem', () => {
  assert.equal(parsePercentual(undefined, 12, 3), 25);
  assert.equal(parsePercentual(null, 0, 0), 0);
});

test('resumirAlunos separa concluídos, em andamento e bloqueados', () => {
  const alunos = [
    { progresso: 100, concluido: true, bloqueado: false },
    { progresso: 40, concluido: false, bloqueado: false },
    { progresso: 0, concluido: false, bloqueado: true },
  ];
  assert.deepEqual(resumirAlunos(alunos), {
    alunos: 3, concluidos: 1, emAndamento: 2, bloqueados: 1, progressoMedio: 47,
  });
});

test('resumirAlunos com lista vazia não quebra', () => {
  assert.deepEqual(resumirAlunos([]), {
    alunos: 0, concluidos: 0, emAndamento: 0, bloqueados: 0, progressoMedio: 0,
  });
});
