import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import studentHandler from './api/student.js';
import coursesHandler from './api/courses.js';
import authConfigHandler from './api/auth/config.js';
import authGoogleHandler from './api/auth/google.js';
import authSessionHandler from './api/auth/session.js';
import authLogoutHandler from './api/auth/logout.js';
import lessonAiHandler from './api/lesson-ai.js';
import licensesHandler from './api/licenses.js';
import wpProfileHandler from './api/wp-profile.js';

const app = express();
const PORT = 3001;

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origem não autorizada'));
  },
}));
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://accounts.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' http://localhost:3001 https://accounts.google.com; frame-src https://accounts.google.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  next();
});
app.use(express.json({ limit: '1mb', strict: true }));

app.all(['/api/student', '/api/students/batch', '/api/batch-enroll'], async (req, res) => {
  try {
    await studentHandler(req, res);
  } catch (error) {
    console.error('Erro geral:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erro no servidor' });
    }
  }
});

app.all('/api/courses', async (req, res) => {
  try {
    await coursesHandler(req, res);
  } catch (error) {
    console.error('Erro no endpoint /api/courses:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erro no servidor ao buscar cursos' });
    }
  }
});

app.all('/api/auth/config', authConfigHandler);
app.all('/api/auth/google', authGoogleHandler);
app.all('/api/auth/session', authSessionHandler);
app.all('/api/auth/logout', authLogoutHandler);
app.all('/api/lesson-ai', lessonAiHandler);
app.all('/api/wp-profile', async (req, res) => {
  try {
    await wpProfileHandler(req, res);
  } catch (error) {
    console.error('Erro no endpoint /api/wp-profile:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erro no servidor ao buscar perfil no WordPress' });
    }
  }
});
app.all('/api/licenses', async (req, res) => {
  try {
    await licensesHandler(req, res);
  } catch (error) {
    console.error('Erro no endpoint /api/licenses:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erro no servidor ao computar licenças' });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Backend rodando em http://localhost:${PORT}`);
});
