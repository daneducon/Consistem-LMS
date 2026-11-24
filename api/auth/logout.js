import { clearSessionCookie } from '../../lib/auth-utils.js';
import { requireTrustedJsonRequest } from '../../lib/security.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  if (!requireTrustedJsonRequest(req, res)) return;
  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
}
