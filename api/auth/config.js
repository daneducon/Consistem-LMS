import { isAuthConfigured } from '../../lib/auth-utils.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    configured: isAuthConfigured(),
    clientId: process.env.GOOGLE_CLIENT_ID || null,
  });
}
