import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCourseAccessStatus, getEnrollmentAccessStatus } from '../api/student.js';

test('applyCourseAccessStatus maps official status 1 to ativo verificado', () => {
  const base = getEnrollmentAccessStatus({}, {});
  const out = applyCourseAccessStatus(base, { status: 1, descricao: 'Ativo' });
  assert.equal(out.acessoAtivo, true);
  assert.equal(out.statusMatricula, 'ativo');
  assert.equal(out.verificado, true);
});

test('applyCourseAccessStatus maps official status 2 to bloqueado verificado', () => {
  const base = getEnrollmentAccessStatus({}, {});
  const out = applyCourseAccessStatus(base, { status: 2, descricao: 'Bloqueado' });
  assert.equal(out.acessoAtivo, false);
  assert.equal(out.statusMatricula, 'bloqueado');
  assert.equal(out.verificado, true);
});

test('applyCourseAccessStatus ignores missing or invalid status', () => {
  const base = getEnrollmentAccessStatus({}, {});
  for (const info of [null, undefined, {}, { status: 0 }, { status: 3 }, { status: 'x' }]) {
    assert.deepEqual(applyCourseAccessStatus(base, info), base);
  }
});

test('applyCourseAccessStatus accepts string status "2"', () => {
  const base = getEnrollmentAccessStatus({}, {});
  const out = applyCourseAccessStatus(base, { status: '2' });
  assert.equal(out.acessoAtivo, false);
  assert.equal(out.verificado, true);
});
