import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import {
  createSessionToken,
  filterAuthorizedSchools,
  getAuthorization,
  isAuthConfigured,
  requirePermission,
} from '../api/auth-utils.js';
import { applyRateLimit, clientAddress, requireTrustedGetRequest, requireTrustedJsonRequest } from '../api/security.js';

const createValidSecret = () => randomBytes(32).toString('hex');

function responseMock() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('authorization policy is default-deny and scopes schools', () => {
  process.env.AUTHORIZATION_POLICY = JSON.stringify({
    'viewer@example.com': { role: 'viewer', schools: [0, 2] },
  });

  assert.equal(getAuthorization('unknown@example.com'), null);
  assert.deepEqual(getAuthorization('VIEWER@example.com').permissions, ['courses:read', 'students:read']);
  process.env.AUTHORIZATION_POLICY = JSON.stringify({
    'operator@example.com': { role: 'operator', schools: [0] },
  });
  assert.equal(getAuthorization('operator@example.com').permissions.includes('plans:generate'), true);
  process.env.AUTHORIZATION_POLICY = JSON.stringify({
    'viewer@example.com': { role: 'viewer', schools: [0, 2] },
  });
  assert.deepEqual(
    filterAuthorizedSchools([{ id: 0 }, { id: 1 }, { id: 2 }], {
      authorization: getAuthorization('viewer@example.com'),
    }),
    [{ id: 0 }, { id: 2 }],
  );
});

test('viewer sessions cannot obtain write permission', async () => {
  process.env.AUTH_SECRET = createValidSecret();
  process.env.GOOGLE_CLIENT_ID = 'client.apps.googleusercontent.com';
  process.env.AUTHORIZATION_POLICY = JSON.stringify({
    'viewer@example.com': { role: 'viewer', schools: [0] },
  });
  const token = await createSessionToken({
    sub: 'google-user-1', email: 'viewer@example.com', name: 'Viewer', picture: null,
  });
  const res = responseMock();
  const user = await requirePermission({ headers: { cookie: `hotscool_session=${token}` } }, res, 'students:write');

  assert.equal(user, null);
  assert.equal(res.statusCode, 403);
});

test('auth configuration rejects missing and documented secrets', () => {
  process.env.GOOGLE_CLIENT_ID = 'client.apps.googleusercontent.com';
  process.env.AUTHORIZATION_POLICY = JSON.stringify({
    'admin@example.com': { role: 'admin', schools: ['*'] },
  });
  process.env.AUTH_SECRET = 'gere-uma-chave-aleatoria-com-pelo-menos-32-caracteres';
  assert.equal(isAuthConfigured(), false);
  process.env.AUTH_SECRET = '';
  assert.equal(isAuthConfigured(), false);
  process.env.AUTH_SECRET = 'abcd'.repeat(8);
  assert.equal(isAuthConfigured(), false);
  process.env.AUTH_SECRET = createValidSecret();
  assert.equal(isAuthConfigured(), true);
});

test('state-changing requests require trusted JSON origins', () => {
  process.env.ALLOWED_ORIGINS = 'https://lms.example.com';
  const accepted = responseMock();
  assert.equal(requireTrustedJsonRequest({ headers: {
    origin: 'https://lms.example.com',
    'content-type': 'application/json; charset=utf-8',
  } }, accepted), true);

  const rejected = responseMock();
  assert.equal(requireTrustedJsonRequest({ headers: {
    origin: 'https://evil.example.com',
    'content-type': 'application/json',
  } }, rejected), false);
  assert.equal(rejected.statusCode, 403);
});

test('rate limiter rejects requests above the configured window limit', () => {
  const req = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(applyRateLimit(req, responseMock(), {
    name: 'test-limit', identity: 'user-1', max: 1, windowMs: 60_000,
  }), true);
  const rejected = responseMock();
  assert.equal(applyRateLimit(req, rejected, {
    name: 'test-limit', identity: 'user-1', max: 1, windowMs: 60_000,
  }), false);
  assert.equal(rejected.statusCode, 429);
});

test('client address ignores forged X-Forwarded-For without a trusted proxy', () => {
  const prevHops = process.env.TRUST_PROXY_HOPS;
  const prevVercel = process.env.VERCEL;
  delete process.env.TRUST_PROXY_HOPS;
  delete process.env.VERCEL;
  try {
    assert.equal(clientAddress({
      headers: { 'x-forwarded-for': '1.2.3.4' },
      socket: { remoteAddress: '9.9.9.9' },
    }), '9.9.9.9');
  } finally {
    if (prevHops === undefined) delete process.env.TRUST_PROXY_HOPS;
    else process.env.TRUST_PROXY_HOPS = prevHops;
    if (prevVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = prevVercel;
  }
});

test('client address uses the edge-appended IP behind a trusted proxy', () => {
  const prevHops = process.env.TRUST_PROXY_HOPS;
  process.env.TRUST_PROXY_HOPS = '1';
  try {
    assert.equal(clientAddress({
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
      socket: { remoteAddress: '10.0.0.1' },
    }), '5.6.7.8');
    assert.equal(clientAddress({
      headers: { 'x-forwarded-for': 'garbage!!!' },
      socket: { remoteAddress: '9.9.9.9' },
    }), '9.9.9.9');
  } finally {
    if (prevHops === undefined) delete process.env.TRUST_PROXY_HOPS;
    else process.env.TRUST_PROXY_HOPS = prevHops;
  }
});

test('trusted GET requests enforce origin without breaking same-origin fetch', () => {
  const prevOrigins = process.env.ALLOWED_ORIGINS;
  process.env.ALLOWED_ORIGINS = 'https://lms.example.com';
  try {
    assert.equal(requireTrustedGetRequest({ headers: {
      origin: 'https://lms.example.com',
    } }, responseMock()), true);

    const evilOrigin = responseMock();
    assert.equal(requireTrustedGetRequest({ headers: {
      origin: 'https://evil.example.com',
    } }, evilOrigin), false);
    assert.equal(evilOrigin.statusCode, 403);

    const evilReferer = responseMock();
    assert.equal(requireTrustedGetRequest({ headers: {
      referer: 'https://evil.example.com/page',
    } }, evilReferer), false);
    assert.equal(evilReferer.statusCode, 403);

    assert.equal(requireTrustedGetRequest({ headers: {
      referer: 'https://lms.example.com/page',
    } }, responseMock()), true);
    assert.equal(requireTrustedGetRequest({ headers: {
      'sec-fetch-site': 'same-origin',
    } }, responseMock()), true);

    const crossSite = responseMock();
    assert.equal(requireTrustedGetRequest({ headers: {
      'sec-fetch-site': 'cross-site',
    } }, crossSite), false);
    assert.equal(crossSite.statusCode, 403);

    assert.equal(requireTrustedGetRequest({ headers: {} }, responseMock()), true);
  } finally {
    if (prevOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = prevOrigins;
  }
});
