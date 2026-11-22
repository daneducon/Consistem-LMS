import { parse, serialize } from 'cookie';
import { jwtVerify, SignJWT } from 'jose';

const COOKIE_NAME = 'hotscool_session';
const SESSION_DURATION_SECONDS = 8 * 60 * 60;
const EXAMPLE_SECRET = 'gere-uma-chave-aleatoria-com-pelo-menos-32-caracteres';
const ROLE_PERMISSIONS = {
  viewer: ['courses:read', 'students:read', 'avaliacoes:read'],
  operator: ['courses:read', 'students:read', 'students:write', 'plans:generate', 'avaliacoes:read', 'avaliacoes:write'],
  admin: ['*'],
  // Gestor: só vê a aba Avaliações, em leitura, restrita às áreas da policy.
  gestor: ['avaliacoes:read'],
};

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32 || secret === EXAMPLE_SECRET || new Set(secret).size < 8) return null;
  return new TextEncoder().encode(secret);
}

function getPolicy() {
  try {
    const policy = JSON.parse(process.env.AUTHORIZATION_POLICY || '{}');
    return policy && typeof policy === 'object' && !Array.isArray(policy) ? policy : {};
  } catch {
    return {};
  }
}

export function getAuthorization(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const entry = getPolicy()[normalizedEmail];
  if (!entry || !ROLE_PERMISSIONS[entry.role] || !Array.isArray(entry.schools)) return null;
  const schools = entry.schools.includes('*')
    ? '*'
    : [...new Set(entry.schools.filter(Number.isSafeInteger).filter((id) => id >= 0))];
  if (schools !== '*' && schools.length === 0) return null;
  // Áreas: null = todas (educação). Gestor precisa de pelo menos uma área, senão não entra.
  const areas = Array.isArray(entry.areas)
    ? [...new Set(entry.areas.map((a) => String(a).trim()).filter(Boolean))]
    : null;
  if (entry.role === 'gestor' && (!areas || areas.length === 0)) return null;
  return { role: entry.role, schools, areas, permissions: ROLE_PERMISSIONS[entry.role] };
}

export function isAuthConfigured() {
  const hasValidUser = Object.keys(getPolicy()).some((email) => getAuthorization(email));
  return Boolean(process.env.GOOGLE_CLIENT_ID && getSecret() && hasValidUser);
}

export function isEmailAllowed(email) {
  return Boolean(getAuthorization(email));
}

export async function createSessionToken(user) {
  const secret = getSecret();
  if (!secret) throw new Error('AUTH_SECRET inválido.');

  return new SignJWT({
    email: user.email,
    name: user.name,
    picture: user.picture || null,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.sub)
    .setIssuer('consistem-lms')
    .setAudience('consistem-lms')
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(secret);
}

export function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', serialize(COOKIE_NAME, token, {
    httpOnly: true,
    secure: Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production'),
    sameSite: 'lax',
    maxAge: SESSION_DURATION_SECONDS,
    path: '/',
  }));
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', serialize(COOKIE_NAME, '', {
    httpOnly: true,
    secure: Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production'),
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  }));
}

export async function getSession(req) {
  const secret = getSecret();
  if (!secret) return null;

  const cookies = parse(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: 'consistem-lms',
      audience: 'consistem-lms',
    });
    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    };
  } catch {
    return null;
  }
}

export async function requireAuth(req, res) {
  if (!isAuthConfigured()) {
    res.status(503).json({ error: 'Autenticação ainda não configurada.' });
    return null;
  }

  const user = await getSession(req);
  if (!user || !isEmailAllowed(user.email)) {
    clearSessionCookie(res);
    res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    return null;
  }

  return { ...user, authorization: getAuthorization(user.email) };
}

export async function requirePermission(req, res, permission) {
  const user = await requireAuth(req, res);
  if (!user) return null;
  const permissions = user.authorization.permissions;
  if (!permissions.includes('*') && !permissions.includes(permission)) {
    res.status(403).json({ error: 'Você não possui permissão para esta operação.' });
    return null;
  }
  return user;
}

export function filterAuthorizedSchools(schools, user) {
  if (user.authorization.schools === '*') return schools;
  return schools.filter((school) => user.authorization.schools.includes(school.id));
}
