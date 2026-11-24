// GET /api/wp-profile?email=<aluno>
// Devolve o perfil do colaborador no WordPress (colab.consistem.com.br):
// Cargo/Função, Área de Negócio e Times (Departamentos/Squads), com o
// vínculo feito pelo e-mail. Usado para enriquecer o perfil do aluno.
//
// Auth: mesma sessão JWT do painel (students:read), mesmo padrão de
// /api/student GET, incluindo rate limit por usuário.

import { getWordPressProfileByEmail, isWordPressConfigured } from '../lib/wordpress.js';
import { requirePermission } from '../lib/auth-utils.js';
import { applyRateLimit, requireTrustedGetRequest } from '../lib/security.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }
  if (!requireTrustedGetRequest(req, res)) return;

  const authenticatedUser = await requirePermission(req, res, 'students:read');
  if (!authenticatedUser) return;
  if (!applyRateLimit(req, res, {
    name: 'wp-profile',
    max: 60,
    windowMs: 60_000,
    identity: authenticatedUser.id,
  })) return;

  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');

  const email = String(req.query?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'E-mail inválido.' });
  }

  if (!isWordPressConfigured()) {
    return res.status(503).json({
      error: 'Integração WordPress não configurada (WP_SITE_URL, WP_API_USER, WP_APP_PASSWORD).',
    });
  }

  try {
    const profile = await getWordPressProfileByEmail(email);
    if (!profile.found) {
      // 200 com found:false — o aluno simplesmente não existe no WordPress.
      return res.status(200).json({ found: false, email });
    }
    return res.status(200).json(profile);
  } catch (error) {
    if (error?.code === 'INVALID_EMAIL') {
      return res.status(400).json({ error: 'E-mail inválido.' });
    }
    if (error?.status === 401 || error?.status === 403) {
      console.error('WordPress: credenciais recusadas (verifique WP_API_USER/WP_APP_PASSWORD).');
      return res.status(502).json({ error: 'Credenciais do WordPress recusadas.' });
    }
    if (error?.status) {
      return res.status(502).json({ error: 'Falha ao consultar o WordPress.' });
    }
    console.error('Erro ao consultar WordPress:', error);
    return res.status(500).json({ error: 'Erro ao consultar o WordPress.' });
  }
}
