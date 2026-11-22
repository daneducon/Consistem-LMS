import assert from 'node:assert/strict';
import test from 'node:test';

import { calcLicenseRisk, getMaxActiveLicenses, LICENSE_WINDOW_DAYS } from '../api/licenses.js';
import { findEnrollmentDate, logKey } from '../api/enrollment-log.js';

const DAY = 86_400_000;

test('risk: overdue active enrollment is emRisco', () => {
  const enrolledAt = new Date(Date.now() - 31 * DAY).toISOString();
  const out = calcLicenseRisk({ enrolledAtISO: enrolledAt, acessoAtivo: true });
  assert.equal(out.daysLeft, LICENSE_WINDOW_DAYS - 31);
  assert.equal(out.emRisco, true);
});

test('risk: overdue blocked enrollment is not emRisco', () => {
  const enrolledAt = new Date(Date.now() - 60 * DAY).toISOString();
  const out = calcLicenseRisk({ enrolledAtISO: enrolledAt, acessoAtivo: false });
  assert.equal(out.emRisco, false);
});

test('risk: in-deadline active enrollment is not emRisco', () => {
  const enrolledAt = new Date(Date.now() - 10 * DAY).toISOString();
  const out = calcLicenseRisk({ enrolledAtISO: enrolledAt, acessoAtivo: true });
  assert.equal(out.daysLeft, LICENSE_WINDOW_DAYS - 10);
  assert.equal(out.emRisco, false);
});

test('risk: missing date never flags risk', () => {
  assert.equal(calcLicenseRisk({ enrolledAtISO: null, acessoAtivo: true }).emRisco, false);
  assert.equal(calcLicenseRisk({ enrolledAtISO: 'not-a-date', acessoAtivo: true }).daysLeft, null);
});

test('getMaxActiveLicenses reads global env with safe fallback', () => {
  const prev = process.env.HOTSCOOL_MAX_ACTIVE_ENROLLMENTS;
  process.env.HOTSCOOL_MAX_ACTIVE_ENROLLMENTS = '200';
  assert.equal(getMaxActiveLicenses(), 200);
  process.env.HOTSCOOL_MAX_ACTIVE_ENROLLMENTS = 'abc';
  assert.equal(getMaxActiveLicenses(), 0);
  delete process.env.HOTSCOOL_MAX_ACTIVE_ENROLLMENTS;
  assert.equal(getMaxActiveLicenses(), 0);
  if (prev === undefined) delete process.env.HOTSCOOL_MAX_ACTIVE_ENROLLMENTS;
  else process.env.HOTSCOOL_MAX_ACTIVE_ENROLLMENTS = prev;
});

test('enrollment log key normalizes and missing lookup returns null', () => {
  assert.equal(logKey(0, '  Teste@X.com ', 123), logKey(0, 'teste@x.com', 123));
  assert.equal(findEnrollmentDate(0, 'ninguem@exemplo.com', 999999), null);
});
