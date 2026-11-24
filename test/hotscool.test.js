import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchWithTimeout,
  findStudentInSchool,
  getSchools,
  invalidateSchoolCache,
  mapWithConcurrency,
  matchStudentEmail,
} from '../lib/hotscool.js';

test('mapWithConcurrency preserves order under a limit', async () => {
  let running = 0;
  let peak = 0;
  const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running -= 1;
    return n * 10;
  });
  assert.deepEqual(results, [10, 20, 30, 40, 50]);
  assert.ok(peak <= 2, `peak concurrency ${peak} exceeded limit`);
});

test('fetchWithTimeout retries 429 and then succeeds', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response('{}', { status: 429, headers: { 'retry-after': '0' } });
    }
    return new Response('{"ok":true}', { status: 200 });
  };
  try {
    const res = await fetchWithTimeout('https://example.invalid', {}, { backoffMs: 1 });
    assert.equal(res.status, 200);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchWithTimeout does not retry POST on server error', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('{}', { status: 500 });
  };
  try {
    const res = await fetchWithTimeout('https://example.invalid', { method: 'POST' });
    assert.equal(res.status, 500);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('matchStudentEmail covers primary and secondary emails', () => {
  assert.equal(matchStudentEmail({ email: 'A@x.com' }, 'a@x.com'), true);
  assert.equal(matchStudentEmail({ email: 'a@x.com', emails: ['b@x.com'] }, 'B@X.COM'), true);
  assert.equal(matchStudentEmail({ email: 'a@x.com', emails: 'b@x.com, c@x.com' }, 'c@x.com'), true);
  assert.equal(matchStudentEmail({ email: 'a@x.com' }, 'z@x.com'), false);
  assert.equal(matchStudentEmail({}, 'a@x.com'), false);
});

test('findStudentInSchool stops at first matching page', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    const page = Number(String(url).split('/').pop());
    const list = page === 1 ? [{ id: 7, email: 'alvo@x.com' }] : Array.from({ length: 25 }, (_, i) => ({ id: page * 100 + i, email: `u${page}-${i}@x.com` }));
    return new Response(JSON.stringify(list), { status: 200 });
  };
  try {
    const found = await findStudentInSchool('k', 'ALVO@x.com');
    assert.equal(found?.id, 7);
    assert.equal(calls, 2);
    const missing = await findStudentInSchool('k', 'ninguem@x.com');
    assert.equal(missing, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('getSchools reads indexed keys in order and invalidate is safe', () => {
  const prev = { ...process.env };
  delete process.env.HOTSCOOL_API_KEYS;
  delete process.env.HOTSCOOL_API_KEY;
  process.env.HOTSCOOL_API_KEY_2 = 'key-b';
  process.env.HOTSCOOL_API_KEY_1 = 'key-a';
  try {
    const schools = getSchools();
    assert.deepEqual(schools.map((s) => s.id), [0, 1]);
    invalidateSchoolCache('missing-key');
  } finally {
    for (const k of Object.keys(process.env)) {
      if (!(k in prev)) delete process.env[k];
    }
    Object.assign(process.env, prev);
  }
});
