import { requirePermission } from '../lib/auth-utils.js';
import { applyRateLimit, requireTrustedJsonRequest } from '../lib/security.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'google/gemma-4-26b-a4b-it';

const SYSTEM_PROMPTS = {
  objectives: `Você é Cosmos, redator educacional da Consistem. Reescreva objetivos de aprendizagem para um curso corporativo do Consistem ERP. Gere de 4 a 5 linhas, cada uma com 3 a 10 palavras, iniciada por verbo de ação da Taxonomia de Bloom. Seja direto, prático, sem metáforas, títulos ou explicações.`,
  generalObjective: `Você é Cosmos, redator educacional da Consistem. Redija o objetivo geral de um curso corporativo do Consistem ERP em 1 a 3 frases e no máximo 60 palavras. Sintetize finalidade e competências com voz ativa. Responda apenas com o texto final.`,
  audience: `Você é Cosmos, redator educacional da Consistem. Redija o público-alvo de um curso corporativo do Consistem ERP em 1 a 2 frases e no máximo 40 palavras. Descreva perfis profissionais relacionados às operações apresentadas. Responda apenas com o texto final.`,
  wordpress: `Você é Cosmos, redator educacional da Consistem. Gere conteúdo para publicação de um curso corporativo. Responda somente em JSON válido com as chaves descricaoPrincipal e resumoCurto. A descrição deve ter 3 a 5 parágrafos curtos, até 300 palavras, sem HTML. O resumo deve ter 1 a 2 frases e até 50 palavras.`,
};

function boundedText(value, max) {
  return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;
}

function boundedList(value, maxItems, maxLength) {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const items = value.map((item) => boundedText(item, maxLength)).filter(Boolean);
  return items.length === value.length ? items : null;
}

function buildPrompt(action, body) {
  const course = boundedText(body.course, 300);
  const objectives = boundedList(body.objectives || [], 200, 500);
  const descriptions = boundedList(body.descriptions || [], 200, 1000);
  if (!course || !objectives || !descriptions) return null;

  if (action === 'objectives') {
    const title = boundedText(body.title, 300);
    if (!title) return null;
    return `Curso: ${course}\nAula: ${title}\nObjetivos atuais:\n${objectives.join('\n') || '(nenhum)'}`;
  }
  return `Curso: ${course}\nObjetivos:\n${objectives.join('\n')}\nDescrições de OA:\n${descriptions.join('\n')}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  }
  const user = await requirePermission(req, res, 'plans:generate');
  if (!user) return;
  if (!requireTrustedJsonRequest(req, res)) return;
  if (!applyRateLimit(req, res, {
    name: 'lesson-ai', identity: user.id, max: 30, windowMs: 60 * 60 * 1000,
  })) return;

  const action = req.body?.action;
  if (!Object.hasOwn(SYSTEM_PROMPTS, action)) {
    return res.status(400).json({ error: 'Ação de geração inválida.' });
  }
  const prompt = buildPrompt(action, req.body || {});
  if (!prompt || prompt.length > 50_000) {
    return res.status(400).json({ error: 'Os dados do plano são inválidos ou excedem o limite.' });
  }
  if (!process.env.OPENROUTER_API_KEY) {
    return res.status(503).json({ error: 'Geração por IA não configurada.' });
  }

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.ALLOWED_ORIGINS?.split(',')[0]?.trim() || 'https://cadastro-hotscool.vercel.app',
        'X-Title': 'Consistem LMS - Plano de Aula',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS[action] },
          { role: 'user', content: prompt },
        ],
        temperature: action === 'objectives' ? 0.8 : 0.6,
        max_tokens: action === 'wordpress' ? 900 : 600,
      }),
    });
    if (!response.ok) return res.status(502).json({ error: 'O serviço de IA está indisponível.' });
    const data = await response.json();
    const content = String(data.choices?.[0]?.message?.content || '').trim();
    if (!content) return res.status(502).json({ error: 'A IA não retornou conteúdo.' });

    if (action === 'objectives') {
      const generated = content.split('\n')
        .map((line) => line.replace(/^[-•\d.)\s]+/, '').trim())
        .filter(Boolean)
        .slice(0, 5);
      return res.status(200).json({ objectives: generated });
    }
    if (action === 'wordpress') {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) return res.status(502).json({ error: 'A IA retornou um formato inválido.' });
      const parsed = JSON.parse(match[0]);
      const description = boundedText(parsed.descricaoPrincipal, 5000);
      const excerpt = boundedText(parsed.resumoCurto, 1000);
      if (!description || !excerpt) return res.status(502).json({ error: 'A IA retornou conteúdo incompleto.' });
      return res.status(200).json({ description, excerpt });
    }
    return res.status(200).json({ text: content.slice(0, 5000) });
  } catch {
    return res.status(502).json({ error: 'Não foi possível concluir a geração por IA.' });
  }
}
