import { OAuth2Client } from 'google-auth-library';
import {
  createSessionToken,
  getAuthorization,
  isAuthConfigured,
  isEmailAllowed,
  setSessionCookie,
} from '../../lib/auth-utils.js';
import { applyRateLimit, requireTrustedJsonRequest } from '../../lib/security.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  }
  if (!isAuthConfigured()) {
    return res.status(503).json({ error: 'Autenticação ainda não configurada.' });
  }
  if (!requireTrustedJsonRequest(req, res)) return;
  if (!applyRateLimit(req, res, { name: 'auth-google', max: 10, windowMs: 60_000 })) return;

  const credential = req.body?.credential;
  if (!credential || typeof credential !== 'string' || credential.length > 10000) {
    return res.status(400).json({ error: 'Credencial Google inválida.' });
  }

  try {
    const google = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await google.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    if (!payload?.sub || !payload.email || !payload.email_verified) {
      return res.status(401).json({ error: 'Conta Google não verificada.' });
    }
    if (!isEmailAllowed(payload.email)) {
      return res.status(403).json({ error: 'Esta conta não possui acesso ao sistema.' });
    }

    const token = await createSessionToken({
      sub: payload.sub,
      email: payload.email.toLowerCase(),
      name: payload.name || payload.email,
      picture: payload.picture,
    });
    setSessionCookie(res, token);
    const authorization = getAuthorization(payload.email);

    return res.status(200).json({
      user: {
        email: payload.email.toLowerCase(),
        name: payload.name || payload.email,
        picture: payload.picture || null,
        role: authorization.role,
        schools: authorization.schools,
      },
    });
  } catch {
    return res.status(401).json({ error: 'Não foi possível validar a conta Google.' });
  }
}
